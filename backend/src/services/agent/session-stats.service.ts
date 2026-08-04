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

    // 工具/调用统计：AgentTrace 链路已移除（2026-08-03），
    // 改为统计 LlmCallLog 中本会话（sessionId 作 traceId）的 LLM 调用次数
    const tokenAgg = await prisma.llmCallLog.aggregate({
      where: { traceId: sessionId },
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    });
    const llmCalls = tokenAgg._count._all;

    // token 聚合：Agent 调用以 sessionId 作为 traceId 写入 LlmCallLog（见 chatStream onFinish）
    const inputTokens = tokenAgg._sum.promptTokens ?? 0;
    const outputTokens = tokenAgg._sum.completionTokens ?? 0;
    const totalTokensSum = tokenAgg._sum.totalTokens ?? 0;
    const cacheReadTokens = tokenAgg._sum.cacheReadTokens ?? 0;
    const cacheWriteTokens = tokenAgg._sum.cacheWriteTokens ?? 0;

    // 费用：按会话模型在 llm_profiles 中配置的 cost（每百万 token 美元）计算
    // 上下文占用：取会话模型的 capabilities.contextWindowTokens
    const { profile } = await resolveSessionModel(session);
    const costPrices = profile?.cost as
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
      | undefined;
    let cost = 0;
    if (costPrices && (costPrices.input || costPrices.output)) {
      cost =
        (inputTokens / 1e6) * (costPrices.input || 0) +
        (outputTokens / 1e6) * (costPrices.output || 0) +
        (cacheReadTokens / 1e6) * (costPrices.cacheRead || 0) +
        (cacheWriteTokens / 1e6) * (costPrices.cacheWrite || 0);
    }
    const contextWindow = profile?.capabilities?.contextWindowTokens ?? 0;

    return {
      sessionId,
      sessionName: session.title,
      userMessages,
      assistantMessages,
      toolCalls: llmCalls,
      toolResults: llmCalls,
      totalMessages,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
        total: totalTokensSum,
      },
      cost: Number(cost.toFixed(4)),
      contextUsage: {
        percent: contextWindow > 0
          ? Number(((totalTokensSum / contextWindow) * 100).toFixed(1))
          : null,
        contextWindow,
        tokens: totalTokensSum > 0 ? totalTokensSum : null,
      },
    };
  }
}

/**
 * 解析会话使用的模型 Profile（llm_profiles 中的一条）。
 * 优先级：会话 modelKey（<providerId>::<modelName>）> 系统默认 llm_chat_model。
 * 用于计算费用（cost）与上下文窗口（contextWindowTokens）。
 */
async function resolveSessionModel(session: any): Promise<{ profile?: any; modelName?: string }> {
  try {
    let providerId: string | undefined;
    let modelName: string | undefined;
    if (session.modelKey) {
      const sep = session.modelKey.indexOf('::');
      if (sep > 0) {
        providerId = session.modelKey.slice(0, sep);
        modelName = session.modelKey.slice(sep + 2);
      }
    }
    if (!providerId) {
      const chatCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_chat_model' } });
      const v = chatCfg?.value && typeof chatCfg.value === 'object' ? chatCfg.value as any : null;
      providerId = v?.providerId;
    }
    if (!providerId) return {};
    const profilesCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    if (!profilesCfg?.value) return {};
    const raw = typeof profilesCfg.value === 'string' ? JSON.parse(profilesCfg.value) : profilesCfg.value;
    const profiles = Array.isArray(raw) ? raw : [];
    const profile = profiles.find((p: any) => p.id === providerId);
    return { profile, modelName };
  } catch {
    return {};
  }
}
