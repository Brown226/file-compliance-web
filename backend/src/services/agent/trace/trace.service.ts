/**
 * Agent 执行追踪服务 — 记录每次工具调用的 input/output/duration/status
 *
 * 功能：
 * 1. recordTrace(params) — 在工具执行结束时记录一条 trace（fire-and-forget，不阻塞流）
 * 2. listTraces(sessionId, userId) — 查询会话的 trace 列表（按 stepIndex 排序）
 * 3. getTraceWithLlmCallLog(traceId) — 查询单条 trace + 关联的 LlmCallLog
 *
 * 设计要点：
 * - AgentTrace.sessionId 是 QASession 外键，写入前需确保 QASession 存在
 *   （若 sessionId 不为空但 QASession 不存在，自动创建最小化 QASession 记录）
 * - sessionId 为空时跳过 trace 记录（best-effort，不阻断主流程）
 * - traceId 关联 LlmCallLog.traceId（非外键，仅用于跨表关联查询）
 * - 所有写入用 fire-and-forget 模式（与 LlmCallLog 写入一致），失败仅 warn 不 throw
 *
 * 依赖：
 * - prisma.agentTrace（AgentTrace 表）
 * - prisma.qaSession（确保外键约束满足）
 * - prisma.llmCallLog（关联查询）
 */

import prisma from '../../../config/db';
import { Prisma } from '@prisma/client';

/** Trace 记录项 */
export interface TraceItem {
  id: string;
  sessionId: string;
  stepIndex: number;
  toolName: string;
  input: any;
  output: any;
  durationMs: number | null;
  status: string;
  traceId: string | null;
  error: string | null;
  createdAt: string;
}

/** Trace + 关联的 LlmCallLog */
export interface TraceWithLlmCallLog extends TraceItem {
  llmCallLog?: {
    id: number;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: string;
  } | null;
}

/**
 * Agent 执行追踪服务
 */
export class TraceService {
  /**
   * 记录一条 trace（在工具执行结束时调用）
   *
   * @param params.sessionId 会话 ID（关联 QASession，为空时跳过）
   * @param params.userId 用户 ID（用于确保 QASession 存在）
   * @param params.stepIndex 步骤序号
   * @param params.toolName 工具名
   * @param params.input 输入参数
   * @param params.output 输出结果
   * @param params.durationMs 耗时毫秒
   * @param params.status success / failed / skipped
   * @param params.traceId 关联 LlmCallLog 的 traceId
   * @param params.error 错误信息
   * @returns trace ID，sessionId 为空或写入失败时返回 null
   */
  static async recordTrace(params: {
    sessionId: string;
    userId: string;
    stepIndex: number;
    toolName: string;
    input?: any;
    output?: any;
    durationMs?: number;
    status?: 'success' | 'failed' | 'skipped';
    traceId?: string;
    error?: string;
  }): Promise<string | null> {
    const {
      sessionId,
      userId,
      stepIndex,
      toolName,
      input,
      output,
      durationMs,
      status = 'success',
      traceId,
      error,
    } = params;

    // sessionId 为空时跳过（best-effort，不阻断主流程）
    if (!sessionId) {
      return null;
    }

    try {
      // 确保 QASession 存在（若不存在则创建最小化记录）
      // 这是 Task 14（会话历史持久化）的前置依赖，此处仅做最小化创建
      await TraceService.ensureQASession(sessionId, userId);

      // 写入 AgentTrace
      const trace = await prisma.agentTrace.create({
        data: {
          sessionId,
          stepIndex,
          toolName,
          input: input !== undefined ? TraceService.sanitizeForJson(input) : Prisma.JsonNull,
          output: output !== undefined ? TraceService.sanitizeForJson(output) : Prisma.JsonNull,
          durationMs: durationMs ?? null,
          status,
          traceId: traceId || null,
          error: error || null,
        },
      });

      console.log(`[Agent:Trace] 记录 trace: sessionId=${sessionId} step#${stepIndex} tool=${toolName} status=${status} ${durationMs}ms`);

      return trace.id;
    } catch (e) {
      // trace 写入失败不阻断 Agent 流程
      console.warn(`[Agent:Trace] 记录失败: sessionId=${sessionId} tool=${toolName}`, (e as Error).message);
      return null;
    }
  }

  /**
   * 查询会话的 trace 列表（按 stepIndex 排序）
   *
   * @param sessionId 会话 ID
   * @param userId 用户 ID（权限校验：只能查自己的会话）
   * @returns TraceItem[]
   */
  static async listTraces(sessionId: string, userId: string): Promise<TraceItem[]> {
    // 权限校验：确认会话属于该用户
    const session = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    const traces = await prisma.agentTrace.findMany({
      where: { sessionId },
      orderBy: { stepIndex: 'asc' },
    });

    return traces.map(t => TraceService.toTraceItem(t));
  }

  /**
   * 查询单条 trace + 关联的 LlmCallLog
   *
   * @param traceId AgentTrace.id（不是 LlmCallLog.traceId）
   * @returns TraceWithLlmCallLog（含关联的 LlmCallLog）
   */
  static async getTraceWithLlmCallLog(traceId: string): Promise<TraceWithLlmCallLog | null> {
    const trace = await prisma.agentTrace.findUnique({
      where: { id: traceId },
    });

    if (!trace) return null;

    // 通过 trace.traceId 关联 LlmCallLog（traceId 字段非外键，仅用于跨表关联）
    let llmCallLog: TraceWithLlmCallLog['llmCallLog'] = null;
    if (trace.traceId) {
      const log = await prisma.llmCallLog.findFirst({
        where: { traceId: trace.traceId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          model: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          latencyMs: true,
          status: true,
        },
      });
      if (log) {
        llmCallLog = {
          id: Number(log.id),
          model: log.model,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          totalTokens: log.totalTokens,
          latencyMs: log.latencyMs,
          status: log.status,
        };
      }
    }

    return {
      ...TraceService.toTraceItem(trace),
      llmCallLog,
    };
  }

  /**
   * 确保 QASession 存在（若不存在则创建最小化记录）
   *
   * Task 14 会补充 QASession 的 title/messages 等字段，
   * 此处仅确保外键约束满足。
   */
  private static async ensureQASession(sessionId: string, userId: string): Promise<void> {
    const exists = await prisma.qASession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!exists) {
      await prisma.qASession.create({
        data: {
          id: sessionId,
          userId,
          title: null,  // Task 14 会补充
        },
      });
      console.log(`[Agent:Trace] 自动创建 QASession: ${sessionId} userId=${userId}`);
    }
  }

  /**
   * 清理数据以适配 Prisma Json 类型（去除 undefined / BigInt / 函数）
   */
  private static sanitizeForJson(value: any): any {
    if (value === undefined) return null;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return null;
    if (Array.isArray(value)) {
      return value.map(v => TraceService.sanitizeForJson(v));
    }
    if (value && typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = TraceService.sanitizeForJson(v);
      }
      return result;
    }
    return value;
  }

  /** Prisma AgentTrace → TraceItem */
  private static toTraceItem(t: any): TraceItem {
    return {
      id: t.id,
      sessionId: t.sessionId,
      stepIndex: t.stepIndex,
      toolName: t.toolName,
      input: t.input,
      output: t.output,
      durationMs: t.durationMs,
      status: t.status,
      traceId: t.traceId,
      error: t.error,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
