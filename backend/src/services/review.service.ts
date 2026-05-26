import prisma from '../config/db';
import { ParserService } from './parser.service';
import { LlmService, ReviewIssue } from './llm.service';
import { PipelineContext, ReviewModeType, createPipelineAsync } from './review-pipeline';
import { TextExtractionService } from './review-pipeline/text-extraction.service';
import { AiReviewService } from './review-pipeline/ai-review.service';
import { RuleEngineService } from './rule-engine.service';
import { StandardRefCheckService } from './review-pipeline/standard-ref-check.service';
import { getEffectiveConfig } from './review-pipeline/pipeline-config';
import { CrossFileConsistencyService } from './cross-file-consistency.service';
import { IntraFileConsistencyService } from './intra-file-consistency.service';
import { WebSocketService } from './websocket.service';
import { ConcurrencyService } from './concurrency.service';
import { ReviewSpecificationService } from './review-specification.service';
import { RuleLibraryService } from './rule-library.service';
import { TableExtractionService } from './table-extraction.service';
import { FormulaOcrService } from './formula-ocr.service';
import { TerminologyService } from './terminology.service';
import path from 'path';
import { ReviewPlan } from '../types/review-plan';
import { TaskService } from './task.service';

/**
 * 固定模式行为配置 — 每种审查模式的硬编码行为声明
 * 这些模式的行为已固化，不会发生变化，无需通过流水线工厂动态分派
 *
 * CUSTOM_RULE 模式仍走流水线（行为由用户配置的规则前缀动态决定）
 */
interface ModeBehavior {
  rules: boolean;
  standardRef: boolean;
  ai: boolean;
  scene: string;
}

const MODE_BEHAVIOR: Record<ReviewModeType, ModeBehavior> = {
  LIBRARY_REVIEW: { rules: false, standardRef: false, ai: true, scene: 'library_review' },
  CONSISTENCY:    { rules: false, standardRef: false, ai: true, scene: 'consistency' },
  TYPO_GRAMMAR:   { rules: false, standardRef: false, ai: true, scene: 'typo_grammar' },
  DOC_REVIEW:     { rules: false, standardRef: false, ai: true, scene: 'doc_review' },
  MULTIMODAL:     { rules: false, standardRef: false, ai: true, scene: 'multimodal' },
  CUSTOM_RULE:    { rules: true,  standardRef: false, ai: false, scene: 'library_review' },
};

const MODE_DISPLAY_NAMES: Record<ReviewModeType, string> = {
  LIBRARY_REVIEW: '以库审文',
  CONSISTENCY: '全文一致性',
  TYPO_GRAMMAR: '错别字/语法',
  DOC_REVIEW: '以文审文',
  MULTIMODAL: '多模态识别',
  CUSTOM_RULE: '自定义规则',
};

function getModeBehavior(mode: string): ModeBehavior {
  return MODE_BEHAVIOR[mode as ReviewModeType] || MODE_BEHAVIOR.LIBRARY_REVIEW;
}

/**
 * 审查编排服务 - 两阶段分批并发编排
 * 阶段1（规则审查）：分批并行规则审查 → 立即入库推送
 * 阶段2（AI审查）：规则全部完成后，分批并行 AI 审查 → 批量入库推送
 * 并发数由 pipelineConfig.maxConcurrentReviews 控制（用户级别限制）
 *
 * 【用户级别并发控制机制】
 * - 每个用户同时最多处理 maxConcurrentReviews 个文件的 AI 审查
 * - 不同用户之间互不影响，实现多用户公平的资源分配
 * - 使用内存 Map 追踪：Map<userId, { processingCount, pendingQueue }>
 */
export class ReviewService {
  private static adaptReviewPlanForExecution(task: any): {
    plan: ReviewPlan;
    reviewMode: string;
    ruleSource: ('STANDARD' | 'REVIEW_SPECIFICATION')[];
    reviewSpecificationId?: string;
    enabledPrefixes?: string[];
    knowledgeCategoryIds: string[];
    refFileGroupRequired: boolean;
    intraFileConsistency: boolean;
    crossFileConsistency: boolean;
    executionOverrides?: {
      crossFileConsistency?: boolean;
      stages?: {
        rules?: boolean;
        ai?: boolean;
        stdRef?: boolean;
      };
    };
  } {
    const plan = TaskService.normalizeReviewPlan(task?.reviewPlan);
    const reviewMode = TaskService.resolvePipelineSelector(plan);
    // 支持同时选择知识库(STANDARD)和语义规范库(REVIEW_SPECIFICATION)
    const ruleSource: ('STANDARD' | 'REVIEW_SPECIFICATION')[] = [];
    if (plan.evidence.sources.includes('STANDARD')) ruleSource.push('STANDARD');
    if (plan.evidence.sources.includes('REVIEW_SPECIFICATION') || plan.evidence.sources.includes('RULE_LIBRARY')) {
      ruleSource.push('REVIEW_SPECIFICATION');
    }
    const hasStandard = ruleSource.includes('STANDARD');
    const hasReviewSpec = ruleSource.includes('REVIEW_SPECIFICATION');
    // DOC_REVIEW 和 CONSISTENCY 模式强制启用 AI（即使前端误传 RULE_ONLY）
    const effectiveProfile = (reviewMode === 'DOC_REVIEW' || reviewMode === 'CONSISTENCY')
      ? 'HYBRID'
      : plan.execution.profile;
    const stages =
      effectiveProfile === 'RULE_ONLY'
        ? { ai: false, rules: true, stdRef: false }
        : undefined;
    const crossFileConsistency = !!plan.enhancements.crossFileConsistency;

    const hasDirectPrefixes = Array.isArray(plan.evidence.enabledPrefixes) && plan.evidence.enabledPrefixes.length > 0;

    return {
      plan,
      reviewMode,
      ruleSource,
      // 语义规范库：有 REVIEW_SPECIFICATION 源且无直接规则前缀时传递
      reviewSpecificationId: hasReviewSpec && !hasDirectPrefixes ? plan.evidence.reviewSpecificationId || plan.evidence.ruleLibraryId || undefined : undefined,
      enabledPrefixes: hasDirectPrefixes ? plan.evidence.enabledPrefixes : undefined,
      // 知识库：有 STANDARD 源时传递 knowledgeCategoryIds
      knowledgeCategoryIds: hasStandard ? (Array.isArray(plan.evidence.knowledgeCategoryIds) ? plan.evidence.knowledgeCategoryIds : []) : [],
      refFileGroupRequired: plan.objective === 'COMPARE' || plan.evidence.sources.includes('REFERENCE'),
      intraFileConsistency: !!plan.enhancements.intraFileConsistency,
      crossFileConsistency,
      executionOverrides: stages || plan.enhancements.intraFileConsistency || crossFileConsistency
        ? {
            crossFileConsistency,
            stages,
          }
        : undefined,
    };
  }

  private static getConfidence(issue: {
    ruleCode?: string | null;
    issueType?: string;
    sourceReferences?: any;
  }): { confidence: string; confidenceSource: string } {
    if (issue.ruleCode?.startsWith('STD_')) {
      return { confidence: 'STD_MATCH', confidenceSource: 'standard_ref' };
    }
    if (issue.ruleCode) {
      return { confidence: 'RULE_EXACT', confidenceSource: 'rule_engine' };
    }
    return {
      confidence: issue.sourceReferences ? 'AI_INFERRED' : 'AI_INFERRED',
      confidenceSource: issue.sourceReferences ? 'ai_with_sources' : 'ai_only',
    };
  }

  private static stripDbUnsupportedFields<T extends Record<string, any>>(data: T): T {
    const { confidence, confidenceSource, ...rest } = data;
    return rest as T;
  }

  private static async createNoResultDetail(taskId: string, fileId: string, fileName: string, reason: string) {
    await prisma.taskDetail.create({
      data: this.stripDbUnsupportedFields({
        taskId,
        fileId,
        issueType: 'VIOLATION',
        ruleCode: 'NO_RESULT',
        severity: 'info',
        originalText: fileName,
        description: reason,
        confidence: 'NO_RESULT',
        confidenceSource: 'system_summary',
      } as any),
    }).catch(() => { /* ignore */ });
  }

  // 用户级别并发控制：追踪每个用户正在进行的 AI 审查文件数量
  private static userConcurrencyMap = new Map<string, number>();

  private static buildLocateMeta(
    extractedText: string,
    issue: {
      originalText?: string;
      textPosition?: any;
      locateMeta?: any;
      cadHandleId?: string | null;
    },
    extra?: {
      fileId?: string;
      pageHint?: number;
      lineHint?: number;
    },
  ) {
    if (issue.locateMeta) return issue.locateMeta;

    if (issue.cadHandleId) {
      return LlmService.buildLocateMeta('', '', {
        cadHandleId: issue.cadHandleId,
        fileId: extra?.fileId,
        pageHint: extra?.pageHint,
        lineHint: extra?.lineHint,
      });
    }

    if (!issue.originalText || !extractedText) return null;
    const legacyPos = issue.textPosition || {};
    return LlmService.buildLocateMeta(extractedText, issue.originalText, {
      chunkIndex: legacyPos.chunkIndex,
      chunkStartIndex: typeof legacyPos.charOffset === 'number' ? legacyPos.charOffset : undefined,
      totalChunks: legacyPos.totalChunks,
      fileId: extra?.fileId,
      pageHint: extra?.pageHint,
      lineHint: extra?.lineHint,
    });
  }

  private static buildLegacyTextPosition(locateMeta: any, extractedText: string, originalText?: string) {
    if (locateMeta?.absolute?.start != null) {
      return {
        chunkIndex: locateMeta.chunk?.index ?? Math.floor(locateMeta.absolute.start / 4000),
        charOffset: locateMeta.absolute.start,
        totalChunks: locateMeta.chunk?.total ?? Math.max(1, Math.ceil((extractedText || '').length / 4000)),
      };
    }
    if (!originalText || !extractedText) return null;
    return LlmService.findTextPosition(extractedText, originalText);
  }

  /**
   * 获取用户当前正在进行的 AI 审查文件数量
   */
  static getUserProcessingCount(userId: string): number {
    return this.userConcurrencyMap.get(userId) || 0;
  }

  /**
   * 等待用户可用配额
   * @param userId 用户ID
   * @param maxConcurrent 最大并发数
   * @param checkIntervalMs 检查间隔（毫秒）
   */
  private static async waitForUserQuota(
    userId: string,
    maxConcurrent: number,
    checkIntervalMs: number = 1000
  ): Promise<void> {
    while (this.getUserProcessingCount(userId) >= maxConcurrent) {
      console.log(`[Review] 用户 ${userId} 并发配额已满 (${this.getUserProcessingCount(userId)}/${maxConcurrent})，等待中...`);
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }

  /**
   * 递增用户处理计数
   */
  private static incrementUserCount(userId: string): void {
    const current = this.userConcurrencyMap.get(userId) || 0;
    this.userConcurrencyMap.set(userId, current + 1);
    console.log(`[Review] 用户 ${userId} 并发计数: ${current + 1}`);
  }

  /**
   * 递减用户处理计数
   */
  private static decrementUserCount(userId: string): void {
    const current = this.userConcurrencyMap.get(userId) || 0;
    if (current > 0) {
      this.userConcurrencyMap.set(userId, current - 1);
      console.log(`[Review] 用户 ${userId} 并发计数: ${current - 1}`);
    }
  }

  /**
   * 用户级别并发控制执行
   * - 每个用户同时最多处理 limit 个文件
   * - 不同用户之间互不影响
   *
   * @param userId 用户ID
   * @param items 待处理项列表
   * @param limit 单用户最大并发数
   * @param fn 处理函数
   */
  private static async runUserLevelConcurrency<T, R>(
    userId: string,
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];

    // 按用户分组控制并发
    for (let i = 0; i < items.length; i++) {
      // 等待该用户获得配额
      await this.waitForUserQuota(userId, limit);

      // 启动任务（不等待完成）
      const promise = fn(items[i], i).finally(() => {
        // 任务完成后递减计数
        this.decrementUserCount(userId);
      });

      // 递增计数
      this.incrementUserCount(userId);

      // 等待该任务完成
      const result = await promise;
      results.push(result);
    }

    return results;
  }

  /**
   * 主入口: 两阶段分批并发处理任务
   *
   * 流程:
   *  1. 加载任务/文件/配置（一次性）
   *  2. 阶段1: 分批并发规则审查（受 maxConcurrentReviews 限制）
   *  3. 批量入库: 所有规则结果 + WebSocket 推送
   *  4. 阶段2: 分批并发 AI 审查（受 maxConcurrentReviews 限制）
   *  5. 批量入库: 所有 AI 结果 + WebSocket 推送
   *  6. 跨文件一致性检查（CONSISTENCY）
   *  7. 更新任务状态 + 最终推送
   */
  static async processTask(taskId: string): Promise<void> {
    console.log(`[Review] 开始处理任务: ${taskId}`);

    // 全局并发控制：等待获取槽位
    let slotAcquired = false;
    try {
      // 先获取任务信息以拿到 userId
      const taskForQueue = await prisma.task.findUnique({ where: { id: taskId }, select: { creatorId: true } });
      if (taskForQueue) {
        await ConcurrencyService.waitForSlot(taskId, taskForQueue.creatorId);
        slotAcquired = true;
      }
    } catch (e) {
      console.warn(`[Review] 全局并发控制异常，继续执行: ${e}`);
    }

    try {
      // ===== 一次性加载所有数据 =====
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          files: { orderBy: { createdAt: 'asc' } },
          standard: true,
          taskStandards: { include: { standard: true } },
          creator: true,
        },
      });

      if (!task) {
        console.error(`[Review] 任务不存在: ${taskId}`);
        return;
      }

      const totalFiles = task.files.length;

      // 推送任务开始
      WebSocketService.emitTaskProgress(taskId, {
        type: 'started',
        step: '初始化',
        progress: 0,
        message: '任务开始处理',
        timestamp: Date.now(),
      });

      const executionPlan = this.adaptReviewPlanForExecution(task);
      const reviewMode = executionPlan.reviewMode;
      const knowledgeCategoryId = (task as any).knowledgeCategoryId || undefined;
      const reviewSpecificationId = executionPlan.reviewSpecificationId;
      const directPrefixes = executionPlan.enabledPrefixes;

      // ===== 模式行为配置（固定模式直接查表，无需创建 Pipeline） =====
      const behavior = getModeBehavior(reviewMode);
      const needsAI = behavior.ai;
      const modeDisplayName = MODE_DISPLAY_NAMES[reviewMode as ReviewModeType] || reviewMode;
      // 优先使用前端传入的启用前缀，否则从审查规范集/规则库加载
      let ruleExecutionPlan = directPrefixes && directPrefixes.length > 0
        ? { enabledPrefixes: directPrefixes, executableItems: [] }
        : null;
      if (!ruleExecutionPlan && reviewSpecificationId) {
        ruleExecutionPlan = await ReviewSpecificationService.getExecutionPlan(reviewSpecificationId).catch(() => null)
          || await RuleLibraryService.getExecutionPlan(reviewSpecificationId).catch(() => null) as any;
        if (!ruleExecutionPlan) {
          console.warn('[Review] 审查规范集/规则库执行计划加载失败, ID:', reviewSpecificationId);
        }
      }

      const intraFileConsistency = !!executionPlan.intraFileConsistency;
      const reviewPoints: string[] = [];
      const corePurposes: string[] = [];

      // 解析多知识子库 ID
      let knowledgeCategoryIds: string[] | undefined;
      if (executionPlan.knowledgeCategoryIds.length > 0) {
        knowledgeCategoryIds = executionPlan.knowledgeCategoryIds;
      } else if (knowledgeCategoryId) {
        knowledgeCategoryIds = [knowledgeCategoryId];
      }

      // ===== 加载语义规范库/规则库条目（用于 AI 语义审查） =====
      let semanticItems: PipelineContext['semanticItems'] = undefined;
      const effectiveSpecId = executionPlan.reviewSpecificationId || (task as any).reviewSpecificationId || (task as any).ruleLibraryId;
      if (effectiveSpecId) {
        try {
          // 先尝试 review_specification_items，再尝试 rule_library_items
          let specItems = await prisma.reviewSpecificationItem.findMany({
            where: { specificationId: effectiveSpecId, enabled: true },
            select: { ruleCode: true, ruleName: true, category: true, description: true, severity: true },
          });
          if (specItems.length === 0) {
            specItems = await prisma.ruleLibraryItem.findMany({
              where: { libraryId: effectiveSpecId, enabled: true },
              select: { ruleCode: true, ruleName: true, category: true, description: true, severity: true },
            });
          }
          if (specItems.length > 0) {
            semanticItems = specItems;
            console.log(`[Review] 加载语义规范库条目: ${specItems.length} 条`);
          }
        } catch (e) {
          console.warn('[Review] 加载语义规范库条目失败:', e);
        }
      }

      // 标记所有文件为 PENDING
      await prisma.taskFile.updateMany({
        where: { taskId },
        data: { status: 'PENDING' },
      });

      // ===== 一次性加载 pipeline 配置 =====
      let pipelineConfig: any = {};
      try {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
        if (cfg?.value) pipelineConfig = cfg.value;
      } catch (e) { /* 使用默认值 */ }

      // ===== 一次性加载参照文件（以文审文模式） =====
      let refFileGroupCtx: PipelineContext['refFileGroup'] | undefined;
      if (executionPlan.refFileGroupRequired) {
        const groups = await prisma.refFileGroup.findMany({
          where: { taskId },
          include: { refFiles: true },
        });
        if (groups.length > 0) {
          const uploadsDir = path.join(__dirname, '../../uploads');
          refFileGroupCtx = {
            groupId: groups[0].id,
            groupName: groups[0].groupName,
            refFiles: groups[0].refFiles.map((rf: any) => ({
              id: rf.id,
              fileName: rf.fileName,
              filePath: path.join(uploadsDir, path.basename(rf.filePath)),
              fileType: rf.fileType,
              extractedText: rf.extractedText || undefined,
            })),
          };
        }
      }

      // ===== 为每个文件构建 PipelineContext（不含阶段结果） =====
      const fileContexts = task.files.map(file => {
        const uploadsDir = path.join(__dirname, '../../uploads');
        const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

        const ctx: PipelineContext = {
          taskId,
          fileId: file.id,
          fileName: file.fileName,
          filePath: absolutePath,
          fileType: file.fileType,
          extractedText: '',
          reviewMode: reviewMode as any,
          ruleSource: executionPlan.ruleSource,
          reviewSpecificationId: executionPlan.reviewSpecificationId,
          rulePlan: ruleExecutionPlan ? {
            enabledPrefixes: ruleExecutionPlan.enabledPrefixes,
            itemIds: ruleExecutionPlan.executableItems.map((item) => item.id),
          } : undefined,
          standardIds: executionPlan.ruleSource.includes('STANDARD')
            ? task.taskStandards.map((item: any) => item.standardId)
            : [],
          knowledgeCategoryId: executionPlan.ruleSource.includes('STANDARD') ? (knowledgeCategoryId || undefined) : undefined,
          knowledgeCategoryIds: executionPlan.ruleSource.includes('STANDARD') ? (knowledgeCategoryIds || undefined) : undefined,
          pipelineConfig,
          executionOverrides: executionPlan.executionOverrides,
          refFileGroup: refFileGroupCtx,
          semanticItems,
          intraFileConsistency,
          reviewPoints,
          corePurposes,
        };

        // ★ DWG 前端 WASM 数据：如果 taskFile 已有 dwg_wasm_parsed 标记，
        //   直接填充 ctx.extractedText 和 ctx.parseResult，跳过后端 Python 解析
        const dwgMeta = (file as any).dwgMetadata as any;
        const wasmText = ((file as any).extractedText || '').trim();
        if (file.fileType.toLowerCase() === 'dwg' && dwgMeta?.dwg_wasm_parsed && wasmText.length > 0) {
          // 用前端 WASM 提取的文本预填充
          ctx.extractedText = wasmText;

          // ★ 从 WASM 数据动态计算 layer_stats（解锁 DWG_DIM_001 / DWG_OVERLAP_001 规则）
          const textEntities: any[] = dwgMeta.dwg_text_entities || [];
          const dimEntities: any[] = dwgMeta.dwg_dimensions || [];
          const allLayers: string[] = dwgMeta.dwg_layers || [];
          const totalEntityCount: number = dwgMeta.dwg_entity_count || 0;
          const layerStatsMap: Record<string, { text: number; dimension: number; other: number }> = {};
          for (const layer of allLayers) {
            layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
          }
          for (const e of textEntities) {
            const layer = e.layer || '0';
            if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
            layerStatsMap[layer].text++;
          }
          for (const d of dimEntities) {
            const layer = d.layer || '0';
            if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
            layerStatsMap[layer].dimension++;
          }
          // other = 总图元 - text - dimension（按比例分配到各层）
          const countedEntities = textEntities.length + dimEntities.length;
          const otherTotal = Math.max(0, totalEntityCount - countedEntities);
          if (allLayers.length > 0 && otherTotal > 0) {
            const otherPerLayer = Math.ceil(otherTotal / allLayers.length);
            for (const layer of allLayers) {
              layerStatsMap[layer].other = otherPerLayer;
            }
          }

          // ★ 从文本实体中尝试提取标题栏信息（解锁 DWG_TITLE_001 / DWG_SCALE_001）
          let titleBlock: any = undefined;
          const titleKeywords = ['图名', '图号', '比例', '设计', '审核', '校对', '批准'];
          const titleRelatedEntities = textEntities.filter(e =>
            titleKeywords.some(kw => e.text?.includes(kw))
          );
          if (titleRelatedEntities.length > 0) {
            titleBlock = { found: true };
            // 尝试从标题栏相关实体中提取字段值
            for (const e of titleRelatedEntities) {
              const t = e.text || '';
              if (t.includes('图名')) titleBlock.drawingName = t.replace(/图名[：:]\s*/, '').trim() || null;
              if (t.includes('图号')) titleBlock.drawingNo = t.replace(/图号[：:]\s*/, '').trim() || null;
              if (t.includes('设计')) titleBlock.designer = t.replace(/设计[：:]\s*/, '').trim() || null;
              if (t.includes('校对')) titleBlock.checker = t.replace(/校对[：:]\s*/, '').trim() || null;
              if (t.includes('审核') || t.includes('批准')) titleBlock.approver = t.replace(/[审核批准][：:]\s*/, '').trim() || null;
              if (t.includes('比例')) {
                const scaleMatch = t.match(/1\s*[:：]\s*\d+|\d+\s*[:：]\s*1/i);
                titleBlock.scale = scaleMatch ? scaleMatch[0] : t.replace(/比例[：:]\s*/, '').trim() || null;
              }
            }
          }

          // 构建 parseResult 供 Pipeline 消费
          ctx.parseResult = {
            text: ctx.extractedText,
            pages: [],
            metadata: {
              page_count: 0,
              has_tables: false,
              has_images: false,
              dwg_layers: allLayers,
              dwg_text_count: dwgMeta.dwg_text_count || 0,
              dwg_dimension_count: dwgMeta.dwg_dimension_count || 0,
              dwg_entity_count: totalEntityCount,
              dwg_converted: dwgMeta.dwg_converted ?? true,
              layer_stats: layerStatsMap,
              title_block: titleBlock,
            } as any,
            structure: {
              paragraphs: textEntities.map((e: any) => ({
                text: e.text,
                style: e.layer,
                page: null,
                handle: e.handle,
                entityType: e.entityType,  // ★ 修复: 传递 entityType 以正确区分 TEXT/MTEXT
              })),
              tables: [],
              headers: [],
              dimensions: dimEntities,
              standardRefs: dwgMeta.dwg_standard_refs || [],
            },
            markdown: ctx.extractedText,
          };
          console.log(`[Review] DWG WASM 数据已预填充: ${file.fileName}, 文本${ctx.extractedText.length}字符, 标注${dwgMeta.dwg_dimension_count || 0}个, 图层统计${Object.keys(layerStatsMap).length}层${titleBlock ? ', 标题栏已识别' : ''}`);
        }

        return { file, ctx };
      });

      // ===== 阶段1: 所有文件并行规则审查（快速，毫秒~秒级，无需限流） =====
      console.log(`[Review] 阶段1开始: ${totalFiles} 个文件并行规则审查`);
      WebSocketService.emitTaskProgress(taskId, {
        type: 'phase1_start',
        step: '规则审查',
        progress: 5,
        message: `开始并行规则审查（${totalFiles} 个文件）`,
        timestamp: Date.now(),
      });

      // 阶段1：规则审查全部并行（资源消耗低，快速响应）
      const fastPhasePromises = fileContexts.map(({ file, ctx }, index) =>
        this.runFileFastPhase(taskId, file, ctx, index, totalFiles)
          .then(res => ({ ...res, fileId: file.id, fileName: file.fileName }))
          .catch(error => ({ error, fileId: file.id, fileName: file.fileName, ruleIssues: [] as any[], stdRefIssues: [] as any[] }))
      );
      const fastPhaseResults = await Promise.all(fastPhasePromises);

      // 获取阶段2的并发限制（默认 3，AI审查耗资源，需要限流）
      const maxConcurrent = pipelineConfig.maxConcurrentReviews || 3;

      // ===== 批量入库: 阶段1结果 =====
      let fastSuccessCount = 0;
      let fastFailedCount = 0;
      for (const result of fastPhaseResults) {
        if ('error' in result) {
          fastFailedCount++;
          console.error(`[Review] 文件 ${result.fileName} 阶段1失败:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          fastSuccessCount++;
          // 阶段1结果已在 runFileFastPhase 中入库，此处仅推送 WebSocket
          WebSocketService.emitTaskProgress(taskId, {
            type: 'fast_phase_complete',
            step: '规则审查完成',
            progress: 40,
            message: `规则审查完成: ${result.ruleIssues.length} 个规则问题, ${result.stdRefIssues.length} 个标准引用问题`,
            fileName: result.fileName,
            phase: 'phase1',
            ruleCount: result.ruleIssues.length,
            stdRefCount: result.stdRefIssues.length,
            timestamp: Date.now(),
          });
        }
      }

      console.log(`[Review] 阶段1完成: 成功 ${fastSuccessCount}, 失败 ${fastFailedCount}`);

      // ===== 文件内一致性检查（启动后与阶段2并行，最后 await 汇总） =====
      let intraConsistencyPromise: Promise<Array<{ fileId: string; issueCount: number }>> | null = null;
      if (intraFileConsistency) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'intra_consistency_check',
          step: '文件内一致性检查',
          progress: 42,
          message: '正在进行文件内一致性检查...',
          timestamp: Date.now(),
        });

        // 收集已成功提取文本的文件上下文
        const filesWithText = fileContexts.filter(({ ctx }) => ctx.extractedText && ctx.extractedText.trim().length > 0);

        // 启动但不立即 await，与阶段2并行执行
        intraConsistencyPromise = Promise.all(
          filesWithText.map(async ({ file, ctx }) => {
            try {
              const issueCount = await IntraFileConsistencyService.check(
                taskId, file.id, file.fileName, ctx.extractedText,
              );
              if (issueCount > 0) {
                console.log(`[Review] ${file.fileName} 文件内一致性: 发现 ${issueCount} 个不一致`);
              }
              return { fileId: file.id, issueCount };
            } catch (e) {
              console.warn(`[Review] ${file.fileName} 文件内一致性检查失败:`, e);
              return { fileId: file.id, issueCount: 0 };
            }
          }),
        );
      }

      // ===== 阶段2: 用户级别并发 AI 审查 =====
      // 使用统一创建的 pipeline 判断是否需要 AI 审查
      let slowPhaseResults: any[] = [];
      if (!needsAI) {
        // 不需要 AI 审查的模式，根据阶段1结果标记文件状态
        console.log(`[Review] 阶段2跳过: ${reviewMode} 模式不需要 AI 审查`);
        const failedFileIds = new Set(
          fastPhaseResults.filter(r => 'error' in r).map(r => r.fileId)
        );
        for (const { file } of fileContexts) {
          const status = failedFileIds.has(file.id) ? 'FAILED' : 'COMPLETED';
          await prisma.taskFile.update({
            where: { id: file.id },
            data: { status },
          }).catch((e) => { console.warn(`[Review] 更新文件状态失败 (${file.id}):`, e); });
        }
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI 深度审查',
          progress: 45,
          message: `${modeDisplayName}模式无需 AI 审查，直接完成`,
          timestamp: Date.now(),
        });
      } else {
        // 过滤掉阶段1失败的文件，避免对它们执行无意义的 AI 审查
        const failedFileIds = new Set(
          fastPhaseResults.filter(r => 'error' in r).map(r => r.fileId)
        );
        const eligibleForAI = fileContexts.filter(({ file }) => !failedFileIds.has(file.id));
        const skippedCount = fileContexts.length - eligibleForAI.length;

        // 标记阶段1失败的文件状态
        for (const fileId of failedFileIds) {
          await prisma.taskFile.update({
            where: { id: fileId },
            data: { status: 'FAILED' },
          }).catch((e) => { console.warn(`[Review] 更新阶段1失败文件状态 (${fileId}):`, e); });
        }

        console.log(`[Review] 阶段2开始: ${eligibleForAI.length} 个文件 AI 审查 (跳过 ${skippedCount} 个阶段1失败文件, 用户 ${task.creatorId} 并发上限 ${maxConcurrent})`);
        console.log(`[Review] 用户 ${task.creatorId} 当前并发数: ${this.getUserProcessingCount(task.creatorId)}`);
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI 深度审查',
          progress: 45,
          message: `开始 AI 审查（${eligibleForAI.length} 个文件，用户并发上限 ${maxConcurrent}）`,
          timestamp: Date.now(),
        });

        // 用户级别并发执行阶段2（每个用户独立限流，跳过阶段1失败的文件）
        slowPhaseResults = await this.runUserLevelConcurrency(
          task.creatorId,
          eligibleForAI,
          maxConcurrent,
          ({ file, ctx }, index) =>
            this.runFileSlowPhase(taskId, file, ctx, index, totalFiles)
              .then(res => ({ ...res, fileId: file.id, fileName: file.fileName }))
              .catch(error => ({ error, fileId: file.id, fileName: file.fileName, aiIssues: [] as any[] }))
        );
      } // end of needsAI else

      // ===== 批量入库: 阶段2结果 =====
      let slowSuccessCount = 0;
      let slowFailedCount = 0;
      for (const result of slowPhaseResults) {
        const isError = 'error' in result;
        if (isError) {
          slowFailedCount++;
          console.error(`[Review] 文件 ${result.fileName} 阶段2失败:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          slowSuccessCount++;
          // 推送阶段2完成事件
          WebSocketService.emitTaskProgress(taskId, {
            type: 'slow_phase_complete',
            step: 'AI审查完成',
            progress: 80,
            message: `AI审查完成: ${result.aiIssues.length} 个问题 (${result.usedEngine || 'unknown'})`,
            fileName: result.fileName,
            phase: 'phase2',
            aiCount: result.aiIssues.length,
            usedEngine: result.usedEngine,
            timestamp: Date.now(),
          });
        }
        // 更新文件状态
        const fileStatus = isError ? 'FAILED' : 'COMPLETED';
        await prisma.taskFile.update({
          where: { id: result.fileId },
          data: { status: fileStatus },
        }).catch((e) => { console.warn(`[Review] 更新文件状态失败 (${result.fileId}):`, e); });
      }

      console.log(`[Review] 阶段2完成: 成功 ${slowSuccessCount}, 失败 ${slowFailedCount}`);

      // ===== 跨文件一致性检查 =====
      // 使用 capabilities.crossFile 判断（能力驱动，替代原先硬编码模式列表）
      // ===== 等待文件内一致性检查完成（与阶段2并行启动，此处汇总结果） =====
      if (intraConsistencyPromise) {
        try {
          const intraResults = await intraConsistencyPromise;
          const totalIntraIssues = intraResults.reduce((sum, r) => sum + r.issueCount, 0);
          console.log(`[Review] 文件内一致性检查完成: 发现 ${totalIntraIssues} 个不一致`);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'intra_consistency_done',
            step: '文件内一致性检查完成',
            progress: 92,
            message: `文件内一致性检查完成: 发现 ${totalIntraIssues} 个不一致问题`,
            timestamp: Date.now(),
          });
        } catch (e) {
          console.warn(`[Review] 文件内一致性检查异常:`, e);
        }
      }

      // ===== 跨文件一致性检查 =====
      const crossFileNeeded = executionPlan.crossFileConsistency && totalFiles >= 2;
      if (crossFileNeeded) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'cross_file_check',
          step: '跨文件一致性检查',
          progress: 90,
          message: '正在进行跨文件一致性检查...',
          timestamp: Date.now(),
        });

        try {
          const crossIssueCount = await CrossFileConsistencyService.check(taskId, task.files);
          console.log(`[Review] 跨文件一致性检查完成: 发现 ${crossIssueCount} 个不一致`);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'cross_file_done',
            step: '一致性检查完成',
            progress: 95,
            message: `发现 ${crossIssueCount} 个不一致问题`,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error(`[Review] 跨文件一致性检查失败: ${taskId}`, error);
        }
      }

      // ===== 更新任务状态 =====
      // AI 模式：阶段1失败 + 阶段2失败 = 总失败数
      // 非 AI 模式：直接使用阶段1计数
      const phase1FailedCount = fastFailedCount;
      const successCount = needsAI ? slowSuccessCount : fastSuccessCount;
      const failedCount = needsAI ? (phase1FailedCount + slowFailedCount) : fastFailedCount;
      const newStatus = (failedCount >= totalFiles) ? 'FAILED' : 'COMPLETED';

      await prisma.task.update({
        where: { id: taskId },
        data: { status: newStatus },
      });

      // ===== 最终推送 =====
      WebSocketService.emitTaskProgress(taskId, {
        type: newStatus === 'COMPLETED' ? 'completed' : 'failed',
        step: newStatus === 'COMPLETED' ? '全部完成' : '任务失败',
        progress: 100,
        message: newStatus === 'COMPLETED'
          ? `审查完成，成功 ${successCount} 个文件，失败 ${failedCount} 个`
          : `所有 ${failedCount} 个文件审查失败`,
        result: { successCount, failedCount, fastSuccessCount, fastFailedCount },
        timestamp: Date.now(),
      });

      WebSocketService.emitToUser(task.creatorId, {
        type: 'task_complete',
        title: newStatus === 'COMPLETED' ? '审查任务完成' : '审查任务失败',
        message: newStatus === 'COMPLETED'
          ? `任务「${task.title}」已完成，${successCount} 个文件审查完成`
          : `任务「${task.title}」审查失败，所有文件处理均未成功`,
        taskId,
        status: newStatus,
      });

      console.log(`[Review] 任务处理完成: ${taskId}, 阶段1成功=${fastSuccessCount}, 阶段2成功=${successCount}, 失败=${failedCount}`);
    } catch (error) {
      console.error(`[Review] 任务处理异常: ${taskId}`, error);
      try {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
        WebSocketService.emitTaskProgress(taskId, {
          type: 'error',
          step: '任务异常',
          progress: 0,
          message: `任务处理异常: ${error instanceof Error ? error.message : '未知错误'}`,
          timestamp: Date.now(),
        });
      } catch (e) { /* ignore */ }
    } finally {
      // 释放全局并发槽位
      if (slotAcquired) {
        try {
          await ConcurrencyService.releaseSlot(taskId);
        } catch (e) {
          console.warn(`[Review] 释放全局槽位失败: ${e}`);
        }
      }
    }
  }

  // ==================== 两阶段文件处理方法 ====================

  /**
   * 阶段1: 规则审查 + 标准引用检查
   * - 文本提取（Parser + OCR）
   * - PDF 逐页解析 / Word 结构化
   * - 规则引擎检查
   * - 标准引用规范性检查
   *
   * 完成后立即入库并返回结果（不含 AI 结果）
   */
  static async runFileFastPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ ruleIssues: any[]; stdRefIssues: any[] }> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

    // 推送文件阶段1开始
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_fast_start',
      step: `规则审查 ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `开始规则审查: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase1',
      timestamp: Date.now(),
    });

    // 标记文件为处理中
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { status: 'PROCESSING' },
    }).catch((e) => { console.warn(`[Review] 标记文件处理中失败 (${file.fileName}):`, e); });

    const behavior = getModeBehavior(ctx.reviewMode);

    // 预提取文本（用于进度分母计算）
    // ★ 如果 ctx.extractedText 已有前端 WASM 数据，跳过 Python 解析
    let parseResultFromPreExtract: import('./python-parser.service').ParseResult | null = null;
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const parsed = await ParserService.parseFileWithResult(absolutePath, file.fileType);
        if (parsed.text && parsed.text.trim().length > 0) {
          ctx.extractedText = parsed.text;
          parseResultFromPreExtract = parsed.result;
          console.log(`[Review] 预提取成功: ${file.fileName}, ${parsed.text.length} 字符`);
        } else {
          console.warn(`[Review] 预提取返回空文本: ${file.fileName}, fileType=${file.fileType}`);
        }
      } catch (e) {
        console.warn(`[Review] 预提取异常: ${file.fileName}, fileType=${file.fileType}, error=${(e as Error).message || e}`);
      }
    }

    const textLength = ctx.extractedText?.length || 0;
    // WASM 路径下 extractedMarkdown 使用 ctx.extractedText；其他路径使用预提取的 markdown
    const extractedMarkdown = (ctx.fileType.toLowerCase() === 'dwg' && ctx.extractedText)
      ? ctx.extractedText
      : (parseResultFromPreExtract?.markdown || parseResultFromPreExtract?.text || null);
    // DWG 元数据：保存图层、图元统计等
    const dwgMetadata = (ctx.parseResult?.metadata && ctx.fileType.toLowerCase() === 'dwg')
      ? {
          dwg_layers: ctx.parseResult.metadata.dwg_layers,
          dwg_text_count: ctx.parseResult.metadata.dwg_text_count,
          dwg_dimension_count: ctx.parseResult.metadata.dwg_dimension_count,
          dwg_entity_count: ctx.parseResult.metadata.dwg_entity_count,
          dwg_converted: ctx.parseResult.metadata.dwg_converted,
          title_block: ctx.parseResult.metadata.title_block,
          layer_stats: ctx.parseResult.metadata.layer_stats,
        }
      : undefined;
    await prisma.taskFile.update({
      where: { id: file.id },
      data: {
        textLength, processedLength: 0,
        extractedText: ctx.extractedText || null,
        extractedMarkdown,
        ...(dwgMetadata ? { dwgMetadata } : {}),
      },
    }).catch((e) => { console.warn(`[Review] 保存提取文本失败 (${file.fileName}):`, e); });

    // ===== 阶段1：文本提取 + 规则引擎 + 标准引用检查（直接调用子服务） =====

    // 文本提取（DWG WASM 已预填充时跳过）
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      ctx.extractedText = await TextExtractionService.ensureText(ctx);
    }

    // PDF 逐页解析 + Word/DWG 结构化
    const pdfPages = await TextExtractionService.extractPdfPages(ctx);
    ctx.pdfPages = pdfPages;
    await TextExtractionService.ensureWordStructure(ctx);
    TextExtractionService.ensureDwgStructure(ctx);

    // 多模态模式：表格提取 + 公式检测
    let extraRuleIssues: any[] = [];
    if (ctx.reviewMode === 'MULTIMODAL') {
      const tables = TableExtractionService.extractTablesFromText(ctx.extractedText);
      for (const table of tables) {
        extraRuleIssues.push(...TableExtractionService.validateTableData(table));
      }
      if (['xlsx', 'xls'].includes(ctx.fileType.toLowerCase())) {
        const excelTables = await TableExtractionService.extractFromExcel(ctx.filePath);
        for (const table of excelTables) {
          extraRuleIssues.push(...TableExtractionService.validateTableData(table));
        }
      }
      const formulaRegions = FormulaOcrService.detectFormulaRegions(ctx.extractedText);
      for (const region of formulaRegions) {
        extraRuleIssues.push({
          issueType: 'FORMAT', ruleCode: 'FORMULA_001', severity: 'info',
          originalText: region.text,
          description: '检测到可能的公式内容，建议人工确认公式正确性。',
        });
      }
    }
    // ★ MULTIMODAL 模式：立即保存表格/公式检测结果（不依赖 behavior.rules 门控）
    if (extraRuleIssues.length > 0 && ctx.reviewMode === 'MULTIMODAL') {
      const extraData = extraRuleIssues.map((issue) => ({
        ...this.getConfidence(issue),
        taskId, fileId: file.id,
        issueType: issue.issueType, ruleCode: issue.ruleCode,
        severity: issue.severity,
        reviewSource: 'RULE_ENGINE',
        originalText: issue.originalText,
        suggestedText: issue.suggestedText || null,
        description: issue.description,
        cadHandleId: (issue as any).cadHandleId || null,
        textPosition: this.buildLegacyTextPosition(
          this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
          ctx.extractedText,
          issue.originalText,
        ),
        locateMeta: this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
      }));
      const strippedExtra = extraData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.taskDetail.createMany({ data: strippedExtra, skipDuplicates: true });
        console.log(`[Review] ✅ MULTIMODAL 前置检测写入成功: ${extraData.length}条 (${file.fileName})`);
      } catch (e) {
        console.error(`[Review] ❌ MULTIMODAL 前置检测写入失败: ${file.fileName}`, e);
      }
    }

    // 规则引擎
    let ruleIssues: any[] = [];
    if (behavior.rules) {
      const stagesOverride = ctx.executionOverrides?.stages;
      const rulesEnabled = stagesOverride?.rules !== false;
      if (rulesEnabled) {
        // 优先使用 rulePlan 中的前缀过滤（CUSTOM_RULE 模式用户选定的规则前缀）
        const prefixes = ctx.rulePlan?.enabledPrefixes?.length
          ? ctx.rulePlan.enabledPrefixes
          : [];
        const baseIssues = await RuleEngineService.runAllRules(
          {
            fileName: ctx.fileName, filePath: ctx.filePath, fileType: ctx.fileType,
            extractedText: ctx.extractedText, pdfPages: ctx.pdfPages,
            reviewMode: ctx.reviewMode, parseResult: ctx.parseResult,
          },
          prefixes.length > 0 ? { enabledRulePrefixes: new Set(prefixes) } : undefined,
        );
        ruleIssues = [...baseIssues, ...extraRuleIssues];
      }
    }

    // 标准引用检查
    let stdRefIssues: any[] = [];
    if (behavior.standardRef && !ctx.ruleSource?.includes('REVIEW_SPECIFICATION') && ctx.extractedText?.trim()) {
      const stagesOverride = ctx.executionOverrides?.stages;
      if (stagesOverride?.stdRef !== false) {
        stdRefIssues = await StandardRefCheckService.runStandardRefCheck(ctx, ctx.extractedText);
      }
    }

    const fastResult = { ruleIssues, stdRefIssues, textLength: ctx.extractedText?.length || 0 };

    // 批量写入规则结果
    const allFastIssues: any[] = [];

    if (fastResult.ruleIssues.length > 0) {
      const ruleData = fastResult.ruleIssues.map((issue) => ({
        ...this.getConfidence(issue),
        taskId, fileId: file.id,
        issueType: issue.issueType, ruleCode: issue.ruleCode,
        severity: issue.severity,
        reviewSource: ctx.ruleSource?.includes('REVIEW_SPECIFICATION') ? 'RULE_LIBRARY' : 'RULE_ENGINE',
        originalText: issue.originalText,
        suggestedText: issue.suggestedText || null,
        description: issue.description,
        cadHandleId: (issue as any).cadHandleId || null,
        textPosition: this.buildLegacyTextPosition(
          this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
          ctx.extractedText,
          issue.originalText,
        ),
        locateMeta: this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
      }));

      // 增强版：事务保护 + 重试机制
      const strippedRuleData = ruleData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.$transaction(async (tx) => {
          await tx.taskDetail.createMany({
            data: strippedRuleData,
            skipDuplicates: true,
          });
          console.log(`[Review] ✅ 规则结果事务写入成功: ${ruleData.length}条 (${file.fileName})`);
        });
      } catch (txError) {
        console.error(`[Review] ❌ 规则结果事务写入失败: ${file.fileName}`, txError);

        // 重试一次（网络瞬时故障或锁冲突常见）
        try {
          await prisma.taskDetail.createMany({
            data: strippedRuleData,
            skipDuplicates: true,
          });
          console.log(`[Review] ✅ 规则结果重试写入成功: ${ruleData.length}条 (${file.fileName})`);
        } catch (retryError) {
          console.error(`[Review] ❌ 规则结果重试也失败，数据将丢失: ${file.fileName}`, retryError);

          // 创建错误记录以便追踪
          await this.createErrorDetail(taskId, file.id, file.fileName, `规则结果保存失败(重试后): ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      allFastIssues.push(...ruleData);
    }

    if (fastResult.stdRefIssues.length > 0) {
      const stdRefData = fastResult.stdRefIssues.map((issue) => ({
        ...this.getConfidence(issue),
        taskId, fileId: file.id,
        issueType: issue.issueType,
        ruleCode: issue.ruleCode || null,
        severity: issue.severity || 'warning',
        reviewSource: 'STANDARD_REF',
        originalText: issue.originalText,
        suggestedText: issue.suggestedText || null,
        description: issue.description || null,
        matchLevel: (issue as any).matchLevel || null,
        similarity: (issue as any).similarity || null,
        diffRanges: issue.diffRanges || null,
        textPosition: this.buildLegacyTextPosition(
          this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
          ctx.extractedText,
          issue.originalText,
        ),
        locateMeta: this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
      }));

      // 增强版：事务保护 + 重试机制
      const strippedStdRefData = stdRefData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.$transaction(async (tx) => {
          await tx.taskDetail.createMany({
            data: strippedStdRefData,
            skipDuplicates: true,
          });
          console.log(`[Review] ✅ 标准引用结果事务写入成功: ${stdRefData.length}条 (${file.fileName})`);
        });
      } catch (txError) {
        console.error(`[Review] ❌ 标准引用结果事务写入失败: ${file.fileName}`, txError);

        // 重试一次
        try {
          await prisma.taskDetail.createMany({
            data: strippedStdRefData,
            skipDuplicates: true,
          });
          console.log(`[Review] ✅ 标准引用结果重试写入成功: ${stdRefData.length}条 (${file.fileName})`);
        } catch (retryError) {
          console.error(`[Review] ❌ 标准引用结果重试也失败，数据将丢失: ${file.fileName}`, retryError);
          await this.createErrorDetail(taskId, file.id, file.fileName, `标准引用保存失败(重试后): ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      allFastIssues.push(...stdRefData);
    }

    // 无文本时写入警告
    if (!fastResult.textLength && allFastIssues.length === 0) {
      const isDwg = file.fileType.toLowerCase() === 'dwg';
      await prisma.taskDetail.create({
        data: {
          taskId, fileId: file.id,
          issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
          originalText: file.fileName,
          description: isDwg
            ? 'DWG 文件未能提取文本内容（前端 WASM 解析可能未成功）。图纸审查可能不完整，建议人工检查。'
            : '文件内容无法提取。可能是扫描件或图片型 PDF，且 OCR 识别未能成功获取文字。建议人工审查。',
        },
      }).catch((e) => { console.warn(`[Review] 无文本警告写入失败:`, e); });
    } else if (fastResult.textLength > 0 && allFastIssues.length === 0) {
      await this.createNoResultDetail(
        taskId,
        file.id,
        file.fileName,
        '规则审查和标准引用检查均未命中问题。该结果不代表完全合规，仅表示当前规则库与标准库未发现明确问题。',
      );
    }

    // DWG 文件特殊处理：保存尺寸标注和标准引用（含 cadHandleId）
    if (file.fileType.toLowerCase() === 'dwg') {
      // 优先使用 ctx.parseResult（WASM 或预提取的结果）
      const parseResult = ctx.parseResult;
      if (parseResult && ctx.extractedText && ctx.extractedText.trim().length > 0) {
        const dwgDetails: any[] = [];

        // 尺寸标注
        if (parseResult.structure.dimensions && parseResult.structure.dimensions.length > 0) {
          for (const dim of parseResult.structure.dimensions) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: null, severity: 'info' as const,
              originalText: dim.text || dim.measurement || '',
              suggestedText: null,
              description: `图层: ${dim.layer}, 类型: ${dim.entity_type}`,
              cadHandleId: dim.handle || null,
            });
          }
        }

        // 标准引用（从 DWG 解析器提取，含 cadHandleId）
        if ((parseResult.structure as any).standardRefs && (parseResult.structure as any).standardRefs.length > 0) {
          for (const ref of (parseResult.structure as any).standardRefs) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: 'DWG_STDREF_001' as const,
              severity: 'info' as const,
              originalText: ref.fullMatch || ref.standardNo,
              suggestedText: null,
              description: `DWG 标准引用: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
              cadHandleId: ref.cadHandleId || null,
            });
          }
        }

        if (dwgDetails.length > 0) {
          await prisma.taskDetail.createMany({ data: dwgDetails }).catch((e) => { console.warn(`[Review] DWG详情写入失败 (${file.fileName}):`, e); });
        }
      }
    }

    // 更新错误计数
    await this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] 更新错误计数失败 (${file.id}):`, e); });

    console.log(`[Review] 文件 ${file.fileName} 阶段1完成: 规则=${fastResult.ruleIssues.length}, 标准引用=${fastResult.stdRefIssues.length}`);

    return { ruleIssues: fastResult.ruleIssues, stdRefIssues: fastResult.stdRefIssues };
  }

  /**
   * 阶段2: AI 深度审查
   * - 使用阶段1已提取的 ctx.extractedText 和 ctx.pdfPages
   * - 执行 AI/LLM 审查
   * - 完成后写入数据库并返回结果
   */
  static async runFileSlowPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ aiIssues: any[]; usedEngine?: string; skippedNoText?: boolean }> {
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);

    // 推送文件阶段2开始
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_slow_start',
      step: `AI 审查 ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `开始 AI 深度审查: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase2',
      timestamp: Date.now(),
    });

    // 内存标记：追踪是否有分片成功写入 DB（避免兜底写入的竞态条件）
    let anyChunkWritten = false;

    // 进度回调（每个 AI 分片审查完成后立即写入 DB 并推送 WebSocket）
    ctx.onChunkProgress = async (chunkLength: number, issues: any[], chunkIndex: number, totalChunks: number, engine: string) => {
      // 1. 更新已处理字符数
      try {
        await prisma.taskFile.update({
          where: { id: file.id },
          data: { processedLength: { increment: chunkLength } },
        });
      } catch (e) { /* 忽略进度更新失败 */ }

      // 2. 该分片有问题时立即写入 DB
      if (issues && issues.length > 0) {
        const aiData = issues.map((issue) => ({
          ...this.getConfidence(issue),
          taskId,
          fileId: file.id,
          issueType: issue.issueType,
          ruleCode: issue.ruleCode || null,
          severity: issue.severity || (['TYPO', 'FORMAT', 'NAMING', 'ENCODING', 'HEADER', 'PAGE'].includes(issue.issueType) ? 'warning' : 'error'),
          reviewSource: 'AI',
            originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description || null,
          plainLanguage: issue.plainLanguage || null,
          cadHandleId: issue.cadHandleId || null,
          standardRef: issue.standardRef || null,
          sourceReferences: issue.sourceReferences || null,
          matchLevel: issue.matchLevel || null,
          similarity: issue.similarity || null,
          diffRanges: issue.diffRanges || null,
          textPosition: this.buildLegacyTextPosition(
            issue.locateMeta || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
            ctx.extractedText,
            issue.originalText,
          ),
          locateMeta: issue.locateMeta
            || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
        }));

        // 增强版：事务保护 + 重试机制 + 失败时延迟推送
        let dbWriteSuccess = false;
        const strippedData = aiData.map((item) => this.stripDbUnsupportedFields(item));
        try {
          await prisma.$transaction(async (tx) => {
            await tx.taskDetail.createMany({
              data: strippedData,
              skipDuplicates: true,
            });
          });
          dbWriteSuccess = true;
          anyChunkWritten = true;
          console.log(`[Review] ✅ 分片 ${chunkIndex}/${totalChunks} 事务写入成功: ${aiData.length}条 (${file.fileName})`);
        } catch (txError) {
          console.error(`[Review] ❌ 分片 ${chunkIndex}/${totalChunks} 事务写入失败: ${file.fileName}`, txError);

          // 重试一次
          try {
            await prisma.taskDetail.createMany({
              data: strippedData,
              skipDuplicates: true,
            });
            dbWriteSuccess = true;
            anyChunkWritten = true;
            console.log(`[Review] ✅ 分片 ${chunkIndex}/${totalChunks} 重试写入成功: ${aiData.length}条 (${file.fileName})`);
          } catch (retryError) {
            console.error(`[Review] ❌ 分片 ${chunkIndex}/${totalChunks} 重试也失败: ${file.fileName}`, retryError);

            // 创建错误记录（不阻塞主流程）
            this.createErrorDetail(taskId, file.id, file.fileName, `AI分片${chunkIndex}保存失败(重试后): ${retryError instanceof Error ? retryError.message : String(retryError)}`).catch(() => {});
          }
        }

        // 3. 仅在数据库写入成功后才推送WebSocket（避免前端显示但DB没有）
        if (dbWriteSuccess) {
          WebSocketService.emitChunkResult(taskId, {
          fileId: file.id,
          fileName: file.fileName,
          chunkIndex,
          totalChunks,
          issueCount: issues.length,
          issues: aiData,
          engine,
        });
        } // end if (dbWriteSuccess)

        // 4. 更新文件错误计数（仅在写入成功时）
        this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] 更新错误计数失败:`, e); });
      }

      // 5. 所有分片完成后更新错误计数（包含0问题的情况）
      if (chunkIndex === totalChunks - 1) {
        this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] 最终错误计数更新失败:`, e); });
      }
    };

    // ===== 阶段2：AI 深度审查（按模式直接分派，不走流水线） =====
    const behavior = getModeBehavior(ctx.reviewMode);
    const scene = behavior.scene;
    const config = getEffectiveConfig(ctx);
    const text = ctx.extractedText || '';

    let aiResult: { issues: ReviewIssue[]; engine: string };
    switch (ctx.reviewMode) {
      case 'TYPO_GRAMMAR':
        aiResult = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);
        // 术语白名单过滤：避免正确术语被误报为错别字
        aiResult.issues = await TerminologyService.filterTerminologyIssues(text, aiResult.issues);
        break;
      case 'DOC_REVIEW':
        aiResult = await AiReviewService.runRefCompareStrategy(text, ctx, scene, config);
        break;
      case 'MULTIMODAL':
        aiResult = await AiReviewService.runLLMDirect(text, ctx, scene, config);
        break;
      case 'LIBRARY_REVIEW':
      case 'CONSISTENCY':
      default: {
        // 方案 B：双轨并行 — 知识库 RAG + 语义规范库逐条匹配
        const hasKnowledge = ctx.ruleSource?.includes('STANDARD')
          && (ctx.knowledgeCategoryIds?.length || ctx.knowledgeCategoryId);
        const hasSemanticSpec = ctx.semanticItems && ctx.semanticItems.length > 0;

        if (hasKnowledge && hasSemanticSpec) {
          // 双轨并行
          console.log(`[Review] 双轨审查: 知识库RAG + 语义规范库(${ctx.semanticItems!.length}条)`);
          const [ragResult, specResult] = await Promise.all([
            AiReviewService.runAIReview(text, ctx, scene, config),
            AiReviewService.runSemanticSpecReview(text, ctx, config),
          ]);

          // 合并去重
          const mergedIssues = [...ragResult.issues];
          const ragKeys = new Set(ragResult.issues.map(i => (i.originalText || '').slice(0, 60).trim()));
          for (const issue of specResult.issues) {
            const key = (issue.originalText || '').slice(0, 60).trim();
            if (key && !ragKeys.has(key)) {
              mergedIssues.push(issue);
            }
          }
          aiResult = {
            issues: mergedIssues,
            engine: `${ragResult.engine}+${specResult.engine}`,
          };
        } else if (hasKnowledge) {
          // 仅知识库 RAG
          aiResult = await AiReviewService.runAIReview(text, ctx, scene, config);
        } else if (hasSemanticSpec) {
          // 仅语义规范库逐条匹配
          aiResult = await AiReviewService.runSemanticSpecReview(text, ctx, config);
        } else {
          // 都没选，降级到普通 LLM 审查
          aiResult = await AiReviewService.runAIReview(text, ctx, scene, config);
        }
        break;
      }
    }
    const slowResult = { aiIssues: aiResult.issues, usedEngine: aiResult.engine };

    // AI 结果已通过 ctx.onChunkProgress 增量写入（每个分片审查完成后立即入库 + 推送 WebSocket）
    // 此处仅做兜底：使用内存标记检查，若无分片成功写入则一次性写入（极端情况下 onChunkProgress 全部失败时的保底）
    console.log(`[Review] AI 审查完成，slowResult.aiIssues.length=${slowResult.aiIssues.length}, anyChunkWritten=${anyChunkWritten}`);
    if (slowResult.aiIssues.length > 0 && !anyChunkWritten) {
      try {
        console.warn(`[Review] 兜底写入: ${slowResult.aiIssues.length} 条 (${file.fileName})`);
        const aiData = slowResult.aiIssues.map((issue) => ({
          ...this.getConfidence(issue),
          taskId,
          fileId: file.id,
          issueType: issue.issueType,
          ruleCode: issue.ruleCode || null,
          severity: issue.severity || (['TYPO', 'FORMAT', 'NAMING', 'ENCODING', 'HEADER', 'PAGE'].includes(issue.issueType) ? 'warning' : 'error'),
          reviewSource: 'AI',
            originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description || null,
          plainLanguage: issue.plainLanguage || null,
          cadHandleId: issue.cadHandleId || null,
          standardRef: issue.standardRef || null,
          sourceReferences: issue.sourceReferences || null,
          matchLevel: (issue as any).matchLevel || null,
          similarity: (issue as any).similarity || null,
          diffRanges: issue.diffRanges || null,
          textPosition: this.buildLegacyTextPosition(
            issue.locateMeta || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
            ctx.extractedText,
            issue.originalText,
          ),
          locateMeta: issue.locateMeta
            || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id }),
        }));
        await prisma.taskDetail.createMany({
          data: aiData.map((item) => this.stripDbUnsupportedFields(item)) as any,
        });
        console.log(`[Review] 兜底写入 ${aiData.length} 条`);
      } catch (e) {
        console.error(`[Review] 兜底写入失败:`, e);
      }
    }

    const skippedNoText = !ctx.extractedText || ctx.extractedText.trim().length === 0;
    if (!skippedNoText && slowResult.aiIssues.length === 0) {
      const existingIssueCount = await prisma.taskDetail.count({
        where: {
          taskId,
          fileId: file.id,
          ruleCode: { not: 'NO_RESULT' },
        },
      }).catch(() => 0);

      if (existingIssueCount === 0) {
        await this.createNoResultDetail(
          taskId,
          file.id,
          file.fileName,
          'AI 审查未发现明确问题；当前文件未命中规则、标准引用或 AI 风险项。请结合规则覆盖范围和标准库覆盖情况人工复核。',
        );
      }
    }
    if (skippedNoText) {
      WebSocketService.emitTaskProgress(taskId, {
        type: 'file_skipped_no_text',
        step: 'AI 审查跳过',
        progress: fileProgress + Math.round(50 / totalFiles),
        message: `文件无可用文本，已跳过 AI 审查: ${file.fileName}`,
        fileName: file.fileName,
        phase: 'phase2',
        timestamp: Date.now(),
      });
    }

    // 推送文件阶段2完成
    WebSocketService.emitTaskProgress(taskId, {
      type: 'slow_phase_complete',
      step: 'AI 审查完成',
      progress: fileProgress + Math.round(50 / totalFiles),
      message: `AI 审查完成: ${slowResult.aiIssues.length} 个问题 (engine: ${slowResult.usedEngine || 'none'})`,
      fileName: file.fileName,
      phase: 'phase2',
      aiCount: slowResult.aiIssues.length,
      usedEngine: slowResult.usedEngine,
      timestamp: Date.now(),
    });

    console.log(`[Review] 文件 ${file.fileName} 阶段2完成: AI=${slowResult.aiIssues.length}, engine=${slowResult.usedEngine}`);

    return { aiIssues: slowResult.aiIssues, usedEngine: slowResult.usedEngine, skippedNoText };
  }

  /**
   * 创建错误详情记录
   */
  private static async createErrorDetail(
    taskId: string,
    fileId: string,
    fileName: string,
    error: any,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await prisma.taskDetail.create({
        data: {
          taskId, fileId,
          issueType: 'VIOLATION', ruleCode: null, severity: 'error',
          originalText: fileName,
          description: `审查过程中发生错误: ${errorMessage}`,
        },
      });
      await this.updateFileErrorCount(fileId);
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 更新文件的错误计数
   */
  private static async updateFileErrorCount(fileId: string): Promise<void> {
    const count = await prisma.taskDetail.count({
      where: {
        fileId,
        ruleCode: { not: 'NO_RESULT' },
      },
    });
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { errorCount: count },
    });
  }

  // ==================== 以下为遗留方法（保留兼容性） ====================

  /**
   * @deprecated 使用 runFileFastPhase + runFileSlowPhase 替代
   */
  static async processFile(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    reviewMode: string = 'LIBRARY_REVIEW',
    knowledgeCategoryId?: string,
    knowledgeCategoryIds?: string[],
    onProgress?: (chunkProgress: number) => void,
  ): Promise<void> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

    const ctx: PipelineContext = {
      taskId,
      fileId: file.id,
      fileName: file.fileName,
      filePath: absolutePath,
      fileType: file.fileType,
      extractedText: '',
      reviewMode: reviewMode as any,
      knowledgeCategoryId: knowledgeCategoryId || undefined,
      knowledgeCategoryIds: knowledgeCategoryIds || undefined,
      onChunkProgress: onProgress,
    };

    // 预提取文本（如果已有 WASM 数据则跳过）
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const parsed = await ParserService.parseFileWithResult(absolutePath, file.fileType);
        if (parsed.text?.trim()) ctx.extractedText = parsed.text;
        if (parsed.result) ctx.parseResult = parsed.result;
      } catch (e) { /* ignore */ }
    }

    // 加载配置
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
      if (cfg?.value) ctx.pipelineConfig = cfg.value as any;
    } catch (e) { /* ignore */ }

    // 加载参照文件
    if (reviewMode === 'DOC_REVIEW') {
      const groups = await prisma.refFileGroup.findMany({ where: { taskId }, include: { refFiles: true } });
      if (groups.length > 0) {
        ctx.refFileGroup = {
          groupId: groups[0].id,
          groupName: groups[0].groupName,
          refFiles: groups[0].refFiles.map((rf: any) => ({
            id: rf.id,
            fileName: rf.fileName,
            filePath: path.join(uploadsDir, path.basename(rf.filePath)),
            fileType: rf.fileType,
            extractedText: rf.extractedText || undefined,
          })),
        };
      }
    }

    // 写入文本长度
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { textLength: ctx.extractedText?.length || 0, processedLength: 0 },
    }).catch(() => { /* ignore */ });

    // 使用 pipeline（等同于原有逻辑）
    try {
      const pipeline = await createPipelineAsync(reviewMode as any);
      const result = await pipeline.execute(ctx);

      // 写 AI 结果
      if (result.aiIssues.length > 0) {
        await prisma.taskDetail.createMany({
          data: result.aiIssues.map((issue) => ({
            taskId, fileId: file.id,
            issueType: issue.issueType,
            ruleCode: issue.ruleCode || null,
            severity: issue.severity || 'warning',
            originalText: issue.originalText,
            suggestedText: issue.suggestedText || null,
            description: issue.description || null,
            plainLanguage: issue.plainLanguage || null,
            cadHandleId: issue.cadHandleId || null,
            standardRef: issue.standardRef || null,
            sourceReferences: issue.sourceReferences ? JSON.stringify(issue.sourceReferences) : null,
            matchLevel: (issue as any).matchLevel || null,
            similarity: (issue as any).similarity || null,
            diffRanges: issue.diffRanges ? JSON.stringify(issue.diffRanges) : null,
          })) as any,
        });
      }

      // 无文本警告
      if (!ctx.extractedText && result.ruleIssues.length === 0 && result.aiIssues.length === 0) {
        await prisma.taskDetail.create({
          data: {
            taskId, fileId: file.id,
            issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
            originalText: file.fileName,
            description: '文件内容无法提取。可能是扫描件或图片型 PDF，建议人工审查。',
          },
        });
      }

      // DWG 处理：保存尺寸标注和标准引用（含 cadHandleId）
      if (file.fileType.toLowerCase() === 'dwg') {
        const parseResult = ctx.parseResult;
        if (parseResult && ctx.extractedText?.trim()) {
          const dwgDetails: any[] = [];

          if (parseResult.structure.dimensions?.length) {
            for (const dim of parseResult.structure.dimensions) {
              dwgDetails.push({
                taskId, fileId: file.id,
                issueType: 'VIOLATION' as const,
                ruleCode: null, severity: 'info' as const,
                originalText: dim.text || dim.measurement || '',
                suggestedText: null,
                description: `图层: ${dim.layer}, 类型: ${dim.entity_type}`,
                cadHandleId: dim.handle || null,
              });
            }
          }

          if ((parseResult.structure as any).standardRefs?.length) {
            for (const ref of (parseResult.structure as any).standardRefs) {
              dwgDetails.push({
                taskId, fileId: file.id,
                issueType: 'VIOLATION' as const,
                ruleCode: 'DWG_STDREF_001' as const,
                severity: 'info' as const,
                originalText: ref.fullMatch || ref.standardNo,
                suggestedText: null,
                description: `DWG 标准引用: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
                cadHandleId: ref.cadHandleId || null,
              });
            }
          }

          if (dwgDetails.length > 0) {
            await prisma.taskDetail.createMany({ data: dwgDetails });
          }
        }
      }

      await this.updateFileErrorCount(file.id);
    } catch (error) {
      console.error(`[Review] Pipeline 执行失败: ${file.fileName}`, error);
      await this.createErrorDetail(taskId, file.id, file.fileName, error);
    }
  }
}

