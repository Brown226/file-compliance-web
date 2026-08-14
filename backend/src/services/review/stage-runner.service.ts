/**
 * 方案A：审查阶段状态机 — 阶段执行器（StageRunner）
 *
 * 设计文档：outputs/方案A-DEC阶段状态机设计.md（2026-08-13 定稿）
 *
 * 职责：
 * 1. 阶段注册表（COMMON_STAGES 通用 + DEC_STAGES 专属细粒度）；
 * 2. 阶段状态读写（review_stages 表，[taskId, fileId, stageKey] 唯一）；
 * 3. runStageWithResume 执行器：DONE 阶段跳过（断点续跑）、FAILED 阶段重跑（attemptCount+1）、
 *    失败显式 FAILED + 抛错（修假完成，rule_fallback 例外走 SKIPPED）；
 * 4. payload 裁剪（只存核心字段，512KB 防御上限）；
 * 5. WS stage_update 事件推送（阶段可观测）。
 *
 * 关键约束：
 * - 默认 no-op：ctx.stageRunner 未注入时（如单测直调 dec-review）不落库、纯执行，兼容现有测试；
 * - RUNNING 视为可重跑（幂等：DONE 阶段重跑无副作用，最终落库走 task_details 唯一约束）；
 * - withLock 保证同任务串行，本服务无需处理并发写。
 */

import prisma from '../../config/db';
import { WebSocketService } from '../system/websocket.service';
import { ReviewIssue } from '../llm/llm.service';

/** 阶段状态（与 prisma ReviewStageStatus 枚举一致） */
export type ReviewStageStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

/** 通用阶段（所有 AI 模式） */
export const COMMON_STAGES = ['preload', 'fast', 'ai'] as const;

/** DEC 专属细粒度阶段（替换通用 ai 单节点） */
export const DEC_STAGES = [
  'completeness',
  'compliance',
  'smart_judge',
  'image_text',
  'text_cross',
  'rule_fallback',
  'merge',
] as const;

export type StageKey = (typeof COMMON_STAGES)[number] | (typeof DEC_STAGES)[number];

/** payload 裁剪后保留的核心字段（不含 locateMeta / sourceReferences 等大字段，最终落库会重新生成） */
const PAYLOAD_CORE_FIELDS = [
  'issueType',
  'originalText',
  'suggestedText',
  'description',
  'ruleCode',
  'severity',
  'cadHandleId',
  'reviewSource',
  'confidence',
  'judgeReason',
  'recommendation',
  'riskLevel',
  'clauseType',
  'standardRef',
  'designSection',
] as const;

/** payload 防御上限（单文件） */
const PAYLOAD_MAX_BYTES = 512 * 1024;

/** 阶段句柄：由 review.service 注入 PipelineContext（ctx.stageRunner），undefined = 阶段记录关闭（no-op） */
export interface StageRunnerHandle {
  /** 是否启用阶段记录（生产路径恒为 true；测试可关） */
  enabled: boolean;
  /** reviewMode 快照 */
  mode: string;
  /**
   * 执行一个阶段（带续跑语义）：
   * - 已有 DONE 记录 → 跳过执行，直接返回裁剪后的 payload issues（断点续跑）
   * - 否则标记 RUNNING（attemptCount+1）→ 执行 → DONE + 裁剪 payload
   * - 执行抛错 → 标记 FAILED + error → 重新抛出（上层把任务置 FAILED，修假完成）
   * @param stageKey 阶段键
   * @param run 阶段执行器；(resumed) 为续跑恢复的上阶段产物（裁剪版 issues），无记录时 undefined
   * @param opts.alwaysRun 每次执行不跳过 DONE（用于 preload/fast 幂等阶段）
   * @param opts.allowSkip 业务跳过开关（rule_fallback：执行器返回 null 时标记 SKIPPED，不抛错）
   */
  runStage<T>(
    stageKey: string,
    run: (resumed?: ReviewIssue[]) => Promise<T>,
    opts?: { alwaysRun?: boolean; allowSkip?: boolean },
  ): Promise<T>;
  /** 业务跳过标记（无审点/无文本/无图纸时调用，不算失败） */
  markSkipped(stageKey: string, reason?: string): Promise<void>;
}

interface StageRow {
  id: string;
  taskId: string;
  fileId: string | null;
  mode: string;
  stageKey: string;
  status: string;
  attemptCount: number;
  payload: any;
  error: string | null;
}

/** 从产物数组中裁剪出核心字段（payload 落库用；issue 元素按核心字段裁剪，非 issue 元素原样保留） */
export function trimIssuesPayload(issues: any[] | undefined | null): Array<Record<string, any>> | null {
  if (!issues || issues.length === 0) return null;
  const trimmed: Array<Record<string, any>> = [];
  for (const issue of issues) {
    if (issue && typeof issue === 'object' && (issue.issueType || issue.originalText)) {
      const out: Record<string, any> = {};
      for (const field of PAYLOAD_CORE_FIELDS) {
        const v = (issue as any)[field];
        if (v !== undefined && v !== null) out[field] = v;
      }
      trimmed.push(out);
    } else {
      // 非 issue 元素（如 preload 的审点 id 列表），JSON 可序列化即可
      trimmed.push(issue);
    }
  }
  // 防御上限：超过 512KB 截断（保留前 100 条并标记截断，防 payload 膨胀）
  const json = JSON.stringify(trimmed);
  if (Buffer.byteLength(json, 'utf8') > PAYLOAD_MAX_BYTES) {
    const kept = trimmed.slice(0, 100);
    kept.push({ __truncated: true, total: trimmed.length });
    return kept;
  }
  return trimmed;
}

export class StageRunner {
  /** 复合唯一键 [taskId, fileId, stageKey] 的行查询（fileId 可空，Prisma 复合键 where 不接受 null，用 findFirst） */
  private static async findStageRow(taskId: string, fileId: string | undefined, stageKey: string): Promise<StageRow | null> {
    return prisma.reviewStage.findFirst({
      where: { taskId, fileId: fileId ?? null, stageKey },
    }) as Promise<StageRow | null>;
  }

  /** 落库（无行则创建，有行则更新；attemptCount 在更新时递增表示重试次数） */
  private static async saveStage(
    taskId: string, fileId: string | undefined, mode: string, stageKey: string,
    data: any,
  ): Promise<void> {
    const existing = await this.findStageRow(taskId, fileId, stageKey);
    const base = { taskId, fileId: fileId ?? null, mode, stageKey };
    if (existing) {
      const upd: any = { ...data };
      if (data.attemptCount !== undefined) upd.attemptCount = { increment: 1 };
      await prisma.reviewStage.update({ where: { id: existing.id }, data: upd });
    } else {
      await prisma.reviewStage.create({ data: { ...base, ...data } as any });
    }
  }

  /** 创建阶段句柄（注入 ctx.stageRunner；taskId 必填，fileId 为空表示任务级阶段） */
  static handle(taskId: string, fileId: string | undefined, mode: string): StageRunnerHandle {
    const h: StageRunnerHandle = {
      enabled: true,
      mode,
      async runStage<T>(stageKey: string, run: (resumed?: ReviewIssue[]) => Promise<T>, opts?: { alwaysRun?: boolean; allowSkip?: boolean }): Promise<T> {
        if (!h.enabled) return run() as Promise<T>;
        try {
          const row = await StageRunner.findStageRow(taskId, fileId, stageKey);

          // 断点续跑：已有 DONE 记录且非 alwaysRun → 跳过执行，返回裁剪 payload
          if (row && row.status === 'DONE' && !opts?.alwaysRun) {
            console.log(`[Stage] ${taskId} ${stageKey} 已 DONE（attempt=${row.attemptCount}），跳过续跑`);
            return (row.payload?.issues || null) as T;
          }

          // 标记 RUNNING（attemptCount+1）
          await StageRunner.saveStage(taskId, fileId, h.mode, stageKey, {
            status: 'RUNNING',
            attemptCount: 1,
            startedAt: new Date(),
            finishedAt: null,
            error: null,
          }).catch((e: any) => console.warn(`[Stage] ${taskId} ${stageKey} 状态落库失败（不影响主流程）:`, e.message));

          WebSocketService.emitTaskProgress(taskId, {
            type: 'stage_update',
            step: stageKey,
            progress: 0,
            message: `阶段开始: ${stageKey}`,
            fileName: fileId ?? undefined,
            timestamp: Date.now(),
          } as any);

          // 执行阶段（resumed 传上阶段产物，供续跑场景使用）
          const resumed: ReviewIssue[] | undefined = row?.payload?.issues || undefined;
          const value = await run(resumed);

          // 业务跳过（rule_fallback 例外）：执行器返回 null 且允许跳过 → SKIPPED，不抛错
          if (opts?.allowSkip && (value === null || value === undefined)) {
            await StageRunner.saveStage(taskId, fileId, h.mode, stageKey, {
              status: 'SKIPPED',
              error: '业务跳过',
              startedAt: new Date(),
              finishedAt: new Date(),
            }).catch(() => {});
            console.log(`[Stage] ${taskId} ${stageKey} 业务跳过（SKIPPED）`);
            return value as T;
          }

          // 成功：DONE + 裁剪 payload
          const payload = { issues: trimIssuesPayload(value as any) };
          await StageRunner.saveStage(taskId, fileId, h.mode, stageKey, {
            status: 'DONE',
            payload,
            startedAt: new Date(),
            finishedAt: new Date(),
            error: null,
          }).catch((e: any) => console.warn(`[Stage] ${taskId} ${stageKey} 结果落库失败:`, e.message));

          WebSocketService.emitTaskProgress(taskId, {
            type: 'stage_update',
            step: stageKey,
            progress: 0,
            message: `阶段完成: ${stageKey}`,
            fileName: fileId ?? undefined,
            timestamp: Date.now(),
          } as any);

          return value as T;
        } catch (e) {
          // 失败：显式 FAILED + error（message + 截断 stack），然后重新抛出（上层置任务 FAILED）
          const errMsg = e instanceof Error ? e.message : String(e);
          const stack = e instanceof Error ? (e.stack || '').slice(0, 500) : '';
          await StageRunner.saveStage(taskId, fileId, h.mode, stageKey, {
            status: 'FAILED',
            error: `${errMsg}${stack ? `\n${stack}` : ''}`.slice(0, 2000),
            startedAt: new Date(),
            finishedAt: new Date(),
          }).catch((dbErr: any) => console.warn(`[Stage] ${taskId} ${stageKey} 失败状态落库失败:`, dbErr.message));

          WebSocketService.emitTaskProgress(taskId, {
            type: 'stage_update',
            step: stageKey,
            progress: 0,
            message: `阶段失败: ${stageKey} — ${errMsg.slice(0, 120)}`,
            fileName: fileId ?? undefined,
            timestamp: Date.now(),
          } as any);

          throw e;
        }
      },
      async markSkipped(stageKey, reason) {
        await StageRunner.saveStage(taskId, fileId, h.mode, stageKey, {
          status: 'SKIPPED',
          error: reason || null,
          startedAt: new Date(),
          finishedAt: new Date(),
        }).catch((e: any) => console.warn(`[Stage] ${taskId} ${stageKey} SKIPPED 落库失败:`, e.message));
      },
    };
    return h;
  }

  /** 任务阶段摘要（前端轮询兜底：任务详情接口带 stages） */
  static async getTaskStageSummary(taskId: string): Promise<Array<{
    stageKey: string;
    status: string;
    attemptCount: number;
    error?: string | null;
    fileName?: string | null;
    updatedAt?: Date;
  }>> {
    try {
      const rows = await prisma.reviewStage.findMany({
        where: { taskId },
        select: { stageKey: true, fileId: true, status: true, attemptCount: true, error: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' },
      });
      return rows.map((r: any) => ({
        stageKey: r.stageKey,
        status: r.status,
        attemptCount: r.attemptCount,
        error: r.error,
        fileName: r.fileId,
        updatedAt: r.updatedAt,
      }));
    } catch {
      return [];
    }
  }

  /** 任务是否存在 FAILED 阶段（决定任务最终状态 FAILED，修假完成） */
  static async hasFailedStage(taskId: string): Promise<boolean> {
    try {
      const n = await prisma.reviewStage.count({ where: { taskId, status: 'FAILED' } });
      return n > 0;
    } catch {
      return false;
    }
  }
}
