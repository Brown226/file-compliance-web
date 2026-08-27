/**
 * ask-user 挂起服务 — Agent 主动提问机制的后端状态存储（对标 pi-web ExtensionUiRequest）
 *
 * 机制：
 * - Agent 工具 ask_user 执行时，把「待用户回答的问题」写入 Redis（key: agent:ask-pending:{sessionId}，
 *   TTL = timeoutSec），主链路 chatStream 检测到 ask_user 工具调用后中断流式循环（stopWhen 命中）
 * - 流式结束后，前端轮询 GET /sessions/:id/pending-ask 拿到挂起问题，弹提问对话框
 * - 用户回复后，前端带 pendingAskAnswer 重发 chat/stream，chatStream 把「ask_user tool-call + 用户回答」
 *   注入消息序列续跑（恢复注入）
 * - 恢复注入时调用 resolvePendingById 取出并删除挂起项
 *
 * P2-1 优化（多实例兼容）：
 * - 原实现为进程内 Map，多实例部署时挂起问题只在写入实例可见（前端轮询可能落到其他实例）。
 * - 现改为 Redis 存储（ioredis），挂起问题跨实例可见；Redis 不可用时降级回内存 Map
 *   （与项目其他 Redis 降级策略一致：Bull 队列 / QPS 限流器 / tool-cache）。
 * - 单挂起语义保留：同一 session 新提问覆盖旧的（Redis SET 天然覆盖，TTL 自动过期清理）。
 */

import { redisClient } from '../../../utils/redis';

export type AskMethod = 'confirm' | 'input' | 'select' | 'editor';

export interface PendingAsk {
  requestId: string;
  question: string;
  method: AskMethod;
  options?: string[];
  timeoutSec: number;
  toolCallId: string;
  createdAt: number;
}

// Redis key 前缀（agent:ask-pending:{sessionId}）
const REDIS_PREFIX = 'agent:ask-pending:';

// ==================== 写操作确认标记（P1 硬门禁） ====================
// 写工具（delete_file/edit_file/kb_upsert)执行前检查会话最近确认窗口；
// confirm 类提问被用户回答时由 chatStream 标记（见 agent.service.ts 恢复注入）。

/** Redis 确认标记 key 前缀（agent:confirm:{sessionId}） */
const CONFIRM_PREFIX = 'agent:confirm:';
/** 确认有效窗口（秒，默认 5 分钟） */
export const CONFIRM_TTL_SEC = 300;
/** 内存兜底 Map（Redis 不可用时） */
const confirmMap = new Map<string, number>();

// 内存兜底 Map（Redis 不可用时使用，语义与原实现一致）
const pendingMap = new Map<string, PendingAsk>();

/** 判断挂起项是否已过期 */
function isExpired(ask: PendingAsk): boolean {
  return Date.now() > ask.createdAt + ask.timeoutSec * 1000;
}

export const AskUserService = {
  /**
   * 写入挂起问题（同一 session 仅保留最新一条；Redis 优先，失败降级内存）
   */
  async setPending(sessionId: string, ask: PendingAsk): Promise<void> {
    try {
      await redisClient.set(`${REDIS_PREFIX}${sessionId}`, ask, ask.timeoutSec || 300);
      // 写 Redis 成功 → 清掉内存兜底副本，避免双写不一致
      pendingMap.delete(sessionId);
      return;
    } catch (e: any) {
      // Redis 不可用：降级内存（仅告警一次由调用方日志覆盖，这里静默）
      console.warn('[AskUser] Redis 不可用，降级内存存储:', (e as Error)?.message || e);
    }
    pendingMap.set(sessionId, ask);
  },

  /**
   * 读取挂起问题；命中过期项则清理并返回 null
   */
  async getPending(sessionId: string): Promise<PendingAsk | null> {
    try {
      const ask = await redisClient.get<PendingAsk>(`${REDIS_PREFIX}${sessionId}`);
      if (!ask) return null;
      if (isExpired(ask)) {
        // TTL 未生效时的惰性清理（防御：TTL 设置失败的场景）
        await redisClient.del(`${REDIS_PREFIX}${sessionId}`).catch(() => {});
        return null;
      }
      return ask;
    } catch (e: any) {
      console.warn('[AskUser] Redis 不可用，降级内存读取:', (e as Error)?.message || e);
    }
    const ask = pendingMap.get(sessionId);
    if (!ask) return null;
    if (isExpired(ask)) {
      pendingMap.delete(sessionId);
      return null;
    }
    return ask;
  },

  /**
   * 断言 session 存在挂起且 requestId 匹配，取出删除；否则返回 null
   * （恢复注入时用，防止错配）
   */
  async resolvePendingById(sessionId: string, requestId: string): Promise<PendingAsk | null> {
    try {
      const ask = await redisClient.get<PendingAsk>(`${REDIS_PREFIX}${sessionId}`);
      if (!ask) return null;
      if (ask.requestId !== requestId) return null;
      await redisClient.del(`${REDIS_PREFIX}${sessionId}`);
      pendingMap.delete(sessionId); // 清内存兜底副本
      return ask;
    } catch (e: any) {
      console.warn('[AskUser] Redis 不可用，降级内存解析:', (e as Error)?.message || e);
    }
    const ask = pendingMap.get(sessionId);
    if (!ask) return null;
    if (ask.requestId !== requestId) return null;
    pendingMap.delete(sessionId);
    return ask;
  },

  // ==================== 写操作确认标记（P1 硬门禁） ====================

  /**
   * 记录会话级「用户已确认过写操作」标记。
   * confirm 类提问被用户回答（前端带 pendingAskAnswer 重发）时由 chatStream 调用；
   * 写工具（delete_file/edit_file/kb_upsert）在同一会话的 TTL 窗口内放行。
   */
  async markConfirmed(sessionId: string, ttlSec: number = CONFIRM_TTL_SEC): Promise<void> {
    if (!sessionId) return;
    try {
      await redisClient.set(`${CONFIRM_PREFIX}${sessionId}`, { ts: Date.now() }, ttlSec);
      confirmMap.delete(sessionId); // 写 Redis 成功 → 清内存兜底副本
      return;
    } catch (e: any) {
      console.warn('[AskUser] Redis 不可用，降级内存记录确认:', (e as Error)?.message || e);
    }
    confirmMap.set(sessionId, Date.now());
  },

  /**
   * 检查会话最近 withinMs 内是否有确认标记（写工具门禁入口）。
   * 无记录 / 出错一律视为未确认（保守拦截：宁可让 LLM 再问一次，不可静默执行破坏性操作）。
   */
  async isConfirmedRecently(sessionId: string, withinMs: number = CONFIRM_TTL_SEC * 1000): Promise<boolean> {
    if (!sessionId) return false;
    try {
      const rec = await redisClient.get<{ ts: number }>(`${CONFIRM_PREFIX}${sessionId}`);
      if (rec && rec.ts && Date.now() - rec.ts <= withinMs) return true;
    } catch (e: any) {
      console.warn('[AskUser] Redis 不可用，降级内存检查确认:', (e as Error)?.message || e);
    }
    const ts = confirmMap.get(sessionId);
    return !!ts && Date.now() - ts <= withinMs;
  },
};

export default AskUserService;
