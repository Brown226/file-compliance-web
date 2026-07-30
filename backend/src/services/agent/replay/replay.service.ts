/**
 * Agent 会话回放服务 — 融合 Traces + Messages 生成回放，支持问题溯源
 *
 * 功能：
 * 1. getReplay(sessionId, userId) — 获取会话的完整回放（合并 traces + messages，计算 summary）
 * 2. traceRootCause(sessionId, userId, issueIndex) — 从 assistant 消息反向定位问题来源 LLM 调用
 *
 * 依赖：
 * - TraceService（trace 查询）
 * - QASessionService（会话和消息查询）
 * - prisma.llmCallLog（关联 LLM 调用日志）
 */

import prisma from '../../../config/db';
import { TraceService } from '../trace/trace.service';
import { QASessionService, type MessageItem } from '../qa-session.service';
import { LlmService, type ReviewIssue } from '../../llm/llm.service';

// ─── 接口定义 ────────────────────────────────────────────────────────────────

/** 回放中的单步（融合 trace + 关联 LlmCallLog） */
export interface ReplayStep {
  /** AgentTrace.id */
  id: string;
  stepIndex: number;
  toolName: string;
  input: any;
  output: any;
  durationMs: number | null;
  status: string;
  error: string | null;
  traceId: string | null;
  createdAt: string;
  /** 关联的 LLM 调用日志（仅 traceId 非空时查询） */
  llmCallLog?: {
    id: number;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: string;
    promptFull: string | null;
    completionFull: string | null;
  } | null;
}

/** 完整回放会话 */
export interface ReplaySession {
  sessionId: string;
  userId: string;
  title: string | null;
  messages: MessageItem[];
  steps: ReplayStep[];
  /** 计算摘要 */
  summary: {
    totalSteps: number;
    successSteps: number;
    failedSteps: number;
    skippedSteps: number;
    totalDurationMs: number;
    toolCallCounts: Record<string, number>;
    llmCallCount: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
  };
  createdAt: string;
  updatedAt: string;
}

/** 问题溯源结果 */
export interface RootCauseTrace {
  /** 对应的问题 */
  issue: ReviewIssue;
  /** 产生该问题的工具调用步骤（llm_review_chunk） */
  sourceStep: ReplayStep | null;
  /** 关联的 LLM 调用日志（含 prompt/completion 全文） */
  llmCallLog: {
    id: number;
    model: string;
    promptFull: string | null;
    completionFull: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: string;
    createdAt: string;
  } | null;
  /** 相关上下文步骤（该 trace 前后的其他步骤） */
  relatedSteps: ReplayStep[];
}

// ─── 服务实现 ────────────────────────────────────────────────────────────────

export class ReplayService {
  /**
   * 获取会话回放 — 合并 traces + messages，计算摘要
   *
   * @param sessionId 会话 ID
   * @param userId 用户 ID（权限校验）
   * @returns ReplaySession
   */
  static async getReplay(sessionId: string, userId: string): Promise<ReplaySession> {
    // 1. 权限校验 + 获取会话基本信息
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    // 2. 获取消息列表
    const messages = await QASessionService.listMessages(sessionId, userId);

    // 3. 获取 trace 列表
    const traces = await TraceService.listTraces(sessionId, userId);

    // 4. 为每条 trace 查询关联的 LlmCallLog（通过 trace.traceId 关联）
    const steps: ReplayStep[] = await Promise.all(
      traces.map(async (trace) => {
        let llmCallLog: ReplayStep['llmCallLog'] = null;
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
              promptFull: true,
              completionFull: true,
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
              promptFull: log.promptFull,
              completionFull: log.completionFull,
            };
          }
        }

        return {
          id: trace.id,
          stepIndex: trace.stepIndex,
          toolName: trace.toolName,
          input: trace.input,
          output: trace.output,
          durationMs: trace.durationMs,
          status: trace.status,
          error: trace.error,
          traceId: trace.traceId,
          createdAt: trace.createdAt,
          llmCallLog,
        };
      }),
    );

    // 5. 计算摘要统计
    const toolCallCounts: Record<string, number> = {};
    let totalDurationMs = 0;
    let successSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;
    let llmCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const step of steps) {
      // 按工具名计数
      toolCallCounts[step.toolName] = (toolCallCounts[step.toolName] || 0) + 1;

      // 耗时累计
      if (step.durationMs != null) {
        totalDurationMs += step.durationMs;
      }

      // 状态统计
      if (step.status === 'success') successSteps++;
      else if (step.status === 'failed') failedSteps++;
      else if (step.status === 'skipped') skippedSteps++;

      // LLM 调用统计
      if (step.llmCallLog) {
        llmCallCount++;
        totalPromptTokens += step.llmCallLog.promptTokens;
        totalCompletionTokens += step.llmCallLog.completionTokens;
      }
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      title: session.title,
      messages,
      steps,
      summary: {
        totalSteps: steps.length,
        successSteps,
        failedSteps,
        skippedSteps,
        totalDurationMs,
        toolCallCounts,
        llmCallCount,
        totalPromptTokens,
        totalCompletionTokens,
      },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * 问题溯源 — 从 assistant 消息中的 ReviewIssue 反向定位 LLM 调用来源
   *
   * 流程：
   * 1. 获取会话的所有 assistant 消息
   * 2. 用 LlmService.parseReviewResult 解析出 ReviewIssue[] 列表
   * 3. 按 issueIndex 定位目标问题
   * 4. 遍历 llm_review_chunk 工具调用的 trace，在 output 中匹配该问题
   * 5. 查关联的 LlmCallLog（含 prompt/completion 全文）
   *
   * @param sessionId 会话 ID
   * @param userId 用户 ID
   * @param issueIndex 问题在会话所有 ReviewIssue 中的索引（0-based）
   * @returns RootCauseTrace
   */
  static async traceRootCause(
    sessionId: string,
    userId: string,
    issueIndex: number,
  ): Promise<RootCauseTrace> {
    // 1. 权限校验
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    // 2. 获取所有消息并解析 ReviewIssue[]
    const messages = await QASessionService.listMessages(sessionId, userId);
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    // 扁平化所有 assistant 消息中的 ReviewIssue
    const allIssues: { issue: ReviewIssue; messageIndex: number }[] = [];
    for (const msg of assistantMessages) {
      const parsed = LlmService.parseReviewResult(msg.content);
      for (const issue of parsed) {
        allIssues.push({ issue, messageIndex: messages.indexOf(msg) });
      }
    }

    if (issueIndex < 0 || issueIndex >= allIssues.length) {
      throw new Error(`问题索引越界：共有 ${allIssues.length} 个问题，索引 ${issueIndex} 无效`);
    }

    const { issue } = allIssues[issueIndex];

    // 3. 获取所有 trace
    const traces = await TraceService.listTraces(sessionId, userId);

    // 4. 查找 llm_review_chunk 工具调用，尝试匹配问题
    /** llm_review_chunk 的 trace 中 stepIndex → 该 trace 产出的问题列表 */
    const chunkTraces: { trace: typeof traces[0]; issues: ReviewIssue[] }[] = [];

    for (const trace of traces) {
      if (trace.toolName === 'llm_review_chunk' && trace.output) {
        try {
          // output 可能是 ReviewIssue[] 或 { issues: ReviewIssue[] }
          const output = trace.output;
          let issues: ReviewIssue[] = [];
          if (Array.isArray(output)) {
            issues = output;
          } else if (output && typeof output === 'object' && Array.isArray(output.issues)) {
            issues = output.issues;
          }

          if (issues.length > 0) {
            chunkTraces.push({ trace, issues });
          }
        } catch {
          // 解析失败跳过
        }
      }
    }

    // 5. 在 llm_review_chunk 输出中匹配该问题
    // 匹配策略：优先 exact match originalText，其次 fuzzy match
    let matchedTrace: typeof traces[0] | null = null;

    for (const ct of chunkTraces) {
      for (let i = 0; i < ct.issues.length; i++) {
        const candidate = ct.issues[i];
        const isMatch =
          candidate.originalText === issue.originalText &&
          candidate.issueType === issue.issueType;
        if (isMatch) {
          matchedTrace = ct.trace;
          break;
        }
      }
      if (matchedTrace) break;
    }

    // 兜底：如果没有 exact match，尝试按顺序索引匹配
    if (!matchedTrace && chunkTraces.length > 0) {
      // 把所有 llm_review_chunk 的 output 扁平化，按顺序匹配索引
      const flatIssues: { trace: typeof traces[0]; index: number }[] = [];
      for (const ct of chunkTraces) {
        for (let i = 0; i < ct.issues.length; i++) {
          flatIssues.push({ trace: ct.trace, index: i });
        }
      }
      if (issueIndex < flatIssues.length) {
        matchedTrace = flatIssues[issueIndex].trace;
      }
    }

    // 6. 查关联 LlmCallLog
    let llmCallLog: RootCauseTrace['llmCallLog'] = null;
    if (matchedTrace && matchedTrace.traceId) {
      const log = await prisma.llmCallLog.findFirst({
        where: { traceId: matchedTrace.traceId },
        orderBy: { createdAt: 'desc' },
      });
      if (log) {
        llmCallLog = {
          id: Number(log.id),
          model: log.model,
          promptFull: log.promptFull,
          completionFull: log.completionFull,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          totalTokens: log.totalTokens,
          latencyMs: log.latencyMs,
          status: log.status,
          createdAt: log.createdAt.toISOString(),
        };
      }
    }

    // 7. 收集相关上下文步骤（匹配 trace 前后各 2 步）
    const relatedSteps: ReplayStep[] = [];
    if (matchedTrace) {
      const matchedStepIndex = traces.findIndex(t => t.id === matchedTrace!.id);
      if (matchedStepIndex !== -1) {
        const start = Math.max(0, matchedStepIndex - 2);
        const end = Math.min(traces.length, matchedStepIndex + 3);
        for (let i = start; i < end; i++) {
          if (i !== matchedStepIndex) {
            const trace = traces[i];
            let llmLog: ReplayStep['llmCallLog'] = null;
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
                  promptFull: true,
                  completionFull: true,
                },
              });
              if (log) {
                llmLog = {
                  id: Number(log.id),
                  model: log.model,
                  promptTokens: log.promptTokens,
                  completionTokens: log.completionTokens,
                  totalTokens: log.totalTokens,
                  latencyMs: log.latencyMs,
                  status: log.status,
                  promptFull: log.promptFull,
                  completionFull: log.completionFull,
                };
              }
            }
            relatedSteps.push({
              id: trace.id,
              stepIndex: trace.stepIndex,
              toolName: trace.toolName,
              input: trace.input,
              output: trace.output,
              durationMs: trace.durationMs,
              status: trace.status,
              error: trace.error,
              traceId: trace.traceId,
              createdAt: trace.createdAt,
              llmCallLog: llmLog,
            });
          }
        }
      }
    }

    // 8. 构建 sourceStep
    let sourceStep: ReplayStep | null = null;
    if (matchedTrace) {
      let matchedLlmLog: ReplayStep['llmCallLog'] = null;
      if (matchedTrace.traceId) {
        const log = await prisma.llmCallLog.findFirst({
          where: { traceId: matchedTrace.traceId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            model: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            latencyMs: true,
            status: true,
            promptFull: true,
            completionFull: true,
          },
        });
        if (log) {
          matchedLlmLog = {
            id: Number(log.id),
            model: log.model,
            promptTokens: log.promptTokens,
            completionTokens: log.completionTokens,
            totalTokens: log.totalTokens,
            latencyMs: log.latencyMs,
            status: log.status,
            promptFull: log.promptFull,
            completionFull: log.completionFull,
          };
        }
      }

      sourceStep = {
        id: matchedTrace.id,
        stepIndex: matchedTrace.stepIndex,
        toolName: matchedTrace.toolName,
        input: matchedTrace.input,
        output: matchedTrace.output,
        durationMs: matchedTrace.durationMs,
        status: matchedTrace.status,
        error: matchedTrace.error,
        traceId: matchedTrace.traceId,
        createdAt: matchedTrace.createdAt,
        llmCallLog: matchedLlmLog,
      };
    }

    return {
      issue,
      sourceStep,
      llmCallLog,
      relatedSteps,
    };
  }
}
