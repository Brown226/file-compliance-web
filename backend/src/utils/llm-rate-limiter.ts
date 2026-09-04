/**
 * LLM 调用限流器（固定 1 秒窗口计数，基于 Redis）
 *
 * 避免高并发场景下打爆 LLM API 触发 429。
 *
 * 设计要点（2026-09-02 重构）：
 * 1. 按「网关 + 模型」分桶——此前只按模型名分桶，同名模型配在多个网关时会
 *    共享配额互相误伤（内网 vLLM 被外部 SaaS 的预算拖累）；
 * 2. 交互优先：同一窗口内双阈值——Agent 对话（interactive，人在等）可用全部
 *    配额，审查等批处理（batch）最多用 BATCH_QUOTA_RATIO 比例，饱和时为
 *    对话预留剩余配额；总量仍 ≤ limit，网关保护不变；
 * 3. 可观测：等待超过 WAIT_LOG_THRESHOLD_MS 输出结构化日志（scope/lane/waitedMs），
 *    返回值 waitedMs 供调用方记录，让限流参数有调优依据；
 * 4. 安全阀：单次获取最长等待 MAX_WAIT_MS，超过后放行并告警，避免极端饱和下
 *    任务无限挂起（放行略超限比挂死更可接受）。
 *
 * 降级策略：Redis 不可用时降级为不限流（与 Bull 队列降级策略一致）；
 * 环境变量 DISABLE_LLM_RATE_LIMIT=1 可整体关闭。
 */

import { redisClient } from './redis';
import { getLlmRateLimit } from './system-config';

const WINDOW_KEY_PREFIX = 'llm:rate:';
const enabled = process.env.DISABLE_LLM_RATE_LIMIT !== '1';

/** 批处理通道配额比例：interactive 可用 100%，batch 最多用该比例（为对话预留余量） */
const BATCH_QUOTA_RATIO = 0.8;
/** 单次获取令牌的最长等待（安全阀） */
const MAX_WAIT_MS = 10_000;
/** 等待超过该值输出观测日志 */
const WAIT_LOG_THRESHOLD_MS = 200;

export type LlmRateLane = 'interactive' | 'batch';

/** 桶 scope：网关维度 + 模型维度（apiBase 去协议、非法字符替换，保证 key 可读） */
function bucketScope(apiBaseUrl: string, model: string): string {
  const host = (apiBaseUrl || 'unknown')
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${host}::${model}`;
}

/**
 * 获取一个调用令牌。当前秒窗口内调用数达到该通道配额时，阻塞到下一秒窗。
 *
 * @param apiBaseUrl LLM 网关地址（分桶维度之一，同名模型不同网关互不影响）
 * @param model      模型名（分桶维度之二）
 * @param lane       通道：interactive（Agent 对话，人在等，可用全部配额）
 *                        | batch（审查等后台任务，默认，最多用 80% 配额）
 * @returns 实际等待毫秒数（0 = 立即通过；Redis 不可用时也是 0）
 */
export async function acquireLlmToken(
  apiBaseUrl: string,
  model: string,
  lane: LlmRateLane = 'batch',
): Promise<number> {
  if (!enabled) return 0;

  let limit: number;
  try {
    limit = await getLlmRateLimit();
  } catch {
    limit = 20;
  }
  if (limit <= 0) return 0;

  const scope = bucketScope(apiBaseUrl, model);
  // 交互通道可用全部配额；批处理通道只允许 BATCH_QUOTA_RATIO（为对话预留余量）
  const quota = lane === 'interactive'
    ? limit
    : Math.max(1, Math.floor(limit * BATCH_QUOTA_RATIO));

  const start = Date.now();
  try {
    for (;;) {
      const now = Math.floor(Date.now() / 1000);
      const key = `${WINDOW_KEY_PREFIX}${scope}:${now}`;
      const count = await redisClient.getClient().incr(key);
      // 首次写入时设置 2s 过期（窗过期自动清理）
      if (count === 1) {
        await redisClient.getClient().expire(key, 2);
      }
      if (count <= quota) break;

      // 当前窗该通道配额已满
      const waited = Date.now() - start;
      if (waited >= MAX_WAIT_MS) {
        console.warn(`[LlmRateLimiter] 安全阀：等待 ${waited}ms 仍饱和，放行以免任务挂死 scope=${scope} lane=${lane} limit=${limit}`);
        break;
      }
      // sleep 到下一窗；加随机 jitter（0~300ms）分散等待者，避免惊群
      const sleepMs = (1000 - (Date.now() % 1000)) + Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, sleepMs));
    }
  } catch (e: any) {
    // Redis 不可用：降级为不限流，仅告警
    console.warn('[LlmRateLimiter] Redis 不可用，降级为不限流:', e.message);
    return 0;
  }

  const waitedMs = Date.now() - start;
  if (waitedMs >= WAIT_LOG_THRESHOLD_MS) {
    console.warn(`[LlmRateLimiter] 限流等待 scope=${scope} lane=${lane} waited=${waitedMs}ms limit=${limit} quota=${quota}`);
  }
  return waitedMs;
}
