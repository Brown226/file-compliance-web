/**
 * SessionStatsService — 会话 token 用量统计
 *
 * 聚合 QAMessage（消息计数）、AgentTrace（工具调用统计）、LlmCallLog（token 用量），
 * 供 GET /api/agent/sessions/:sessionId/stats 使用。
 *
 * 从 agent.routes.ts 抽出（2026-08-03），对齐其他 agent service 的分层。
 */
import prisma from '../../config/db';
import { QASessionService } from './qa-session.service';

/** GET /sessions/:sessionId/stats 返回的统计结构（与前端 SessionStats 类型对齐） */
export interface SessionStatsResult {
  sessionId: string;
  sessionName: string | null;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  };
}

export class SessionStatsService {
  /**
   * 查询会话统计。会话不存在或不属于该用户时返回 null（由路由层映射为 404）。
   */
  static async getSessionStats(
    sessionId: string,
    userId: string,
  ): Promise<SessionStatsResult | null> {
    // 权限校验：会话必须属于当前用户
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) return null;

    // 消息计数（按 role 分组）
    const messageCounts = await prisma.qAMessage.groupBy({
      by: ['role'],
      where: { sessionId },
      _count: { _all: true },
    });
    let userMessages = 0;
    let assistantMessages = 0;
    let totalMessages = 0;
    for (const g of messageCounts) {
      const n = g._count._all;
      totalMessages += n;
      if (g.role === 'user') userMessages = n;
      else if (g.role === 'assistant') assistantMessages = n;
    }

    // 工具调用统计：AgentTrace 即工具调用记录
    const traces = await prisma.agentTrace.findMany({
      where: { sessionId },
      select: { status: true, traceId: true },
    });
    const toolCalls = traces.length;
    const toolResults = traces.filter((t: any) => t.status === 'success').length;

    // token 聚合：LlmCallLog.traceId 关联 AgentTrace.traceId；
    // 部分 LLM 调用直接用 sessionId 作为 traceId（见 chat/stream 降级路径），一并纳入
    const traceIds = Array.from(
      new Set(traces.map((t: any) => t.traceId).filter(Boolean)),
    );
    const allTraceIds = Array.from(new Set([...traceIds, sessionId]));

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokensSum = 0;
    if (allTraceIds.length > 0) {
      const agg = await prisma.llmCallLog.aggregate({
        where: { traceId: { in: allTraceIds } },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
        },
      });
      inputTokens = agg._sum.promptTokens ?? 0;
      outputTokens = agg._sum.completionTokens ?? 0;
      totalTokensSum = agg._sum.totalTokens ?? 0;
    }

    return {
      sessionId,
      sessionName: session.title,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: 0,    // 当前 schema 无对应字段
        cacheWrite: 0,   // 当前 schema 无对应字段
        total: totalTokensSum,
      },
      cost: 0,
      contextUsage: {
        percent: null,
        contextWindow: 0,
        tokens: null,
      },
    };
  }
}
