/**
 * LLM 调用限流器（token bucket，基于 Redis）
 *
 * 避免高并发场景下打爆 LLM API 触发 429。
 * 按 model 分桶，每秒一个时间窗，超过 QPS 阈值则 sleep 到下一窗。
 * Redis 不可用时降级为不限流（与 Bull 队列降级策略一致）。
 */

import { redisClient } from './redis';
import { getLlmRateLimit } from './system-config';

const WINDOW_KEY_PREFIX = 'llm:rate:';
const enabled = process.env.DISABLE_LLM_RATE_LIMIT !== '1';

/**
 * 获取一个调用令牌。若当前秒内调用数已达上限，则阻塞到下一秒。
 * @param model LLM 模型名（用作分桶 key）
 */
export async function acquireLlmToken(model: string): Promise<void> {
  if (!enabled) return;

  let limit: number;
  try {
    limit = await getLlmRateLimit();
  } catch {
    limit = 20;
  }
  if (limit <= 0) return;

  const bucket = `${WINDOW_KEY_PREFIX}${model}`;
  const now = Math.floor(Date.now() / 1000);
  const key = `${bucket}:${now}`;

  try {
    const count = await redisClient.getClient().incr(key);
    // 首次写入时设置 2s 过期（窗过期自动清理）
    if (count === 1) {
      await redisClient.getClient().expire(key, 2);
    }
    if (count > limit) {
      // 当前窗已满，sleep 到下一窗
      // P1-4：加随机 jitter（0~300ms）分散等待者，避免所有被限流的请求同时醒来
      // 挤在下一秒窗口起点形成 thundering herd（原本全挤在 1000-now%1000 同一点）
      const sleepMs = (1000 - (Date.now() % 1000)) + Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, sleepMs));
      // 递归重试（下一窗）
      return acquireLlmToken(model);
    }
  } catch (e: any) {
    // Redis 不可用：降级为不限流，仅告警一次
    console.warn('[LlmRateLimiter] Redis 不可用，降级为不限流:', e.message);
  }
}
