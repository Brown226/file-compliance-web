/**
 * ask-user 挂起服务 — Agent 主动提问机制的后端状态存储（对标 pi-web ExtensionUiRequest）
 *
 * 机制：
 * - Agent 工具 ask_user 执行时，把「待用户回答的问题」写入内存 Map（按 sessionId 维度）
 * - 主链路 chatStream 检测到 ask_user 工具调用后中断流式循环（stopWhen 命中）
 * - 流式结束后，前端轮询 GET /sessions/:id/pending-ask 拿到挂起问题，弹提问对话框
 * - 用户回复后，前端带 pendingAskAnswer 重发 chat/stream，chatStream 把「ask_user tool-call + 用户回答」
 *   注入消息序列续跑（恢复注入）
 * - 恢复注入时调用 resolvePending 取出并删除挂起项
 *
 * 设计为进程内内存存储（不持久化）：会话级挂起本就是短时状态（用户当场回复），
 * 多实例部署下建议前端轮询兜底；超时由 getPending 惰性清理。
 */

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

// sessionId -> PendingAsk（单挂起，新提问覆盖旧的）
const pendingMap = new Map<string, PendingAsk>();

function nowMs(): number {
  // 避免使用 Date.now 之外的依赖；Node 运行环境 Date.now 可用
  return Date.now();
}

export const AskUserService = {
  /**
   * 写入挂起问题（同一 session 仅保留最新一条）
   */
  setPending(sessionId: string, ask: PendingAsk): void {
    pendingMap.set(sessionId, ask);
  },

  /**
   * 读取挂起问题；命中过期项则清理并返回 null
   */
  getPending(sessionId: string): PendingAsk | null {
    const ask = pendingMap.get(sessionId);
    if (!ask) return null;
    if (nowMs() > ask.createdAt + ask.timeoutSec * 1000) {
      pendingMap.delete(sessionId);
      return null;
    }
    return ask;
  },

  /**
   * 取出并删除挂起项（恢复注入时调用）
   */
  resolvePending(sessionId: string): PendingAsk | null {
    const ask = pendingMap.get(sessionId);
    if (!ask) return null;
    pendingMap.delete(sessionId);
    return ask;
  },

  /**
   * 断言 session 存在挂起且 requestId 匹配，取出删除；否则返回 null
   * （恢复注入时用，防止错配）
   */
  resolvePendingById(sessionId: string, requestId: string): PendingAsk | null {
    const ask = pendingMap.get(sessionId);
    if (!ask) return null;
    if (ask.requestId !== requestId) return null;
    pendingMap.delete(sessionId);
    return ask;
  },

  /** 清理指定 session 的所有挂起（会话结束时调用） */
  clear(sessionId: string): void {
    pendingMap.delete(sessionId);
  },
};

export default AskUserService;
