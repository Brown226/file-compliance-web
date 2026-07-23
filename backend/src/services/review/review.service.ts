import prisma from '../../config/db';
import { ParserService } from '../file/parser.service';
import { LlmService, ReviewIssue } from '../llm/llm.service';
import { PipelineContext, ReviewModeType } from '../review-pipeline';
import { REVIEW_HANDLERS, getModeScene, getModeDisplayName } from '../review-pipeline/review-handlers';
import { TextExtractionService } from '../review-pipeline/text-extraction.service';
import { RuleEngineService } from '../llm/rule-engine.service';
import { CrossFileConsistencyService } from './cross-file-consistency.service';
import { IntraFileConsistencyService } from './intra-file-consistency.service';
import { WebSocketService } from '../system/websocket.service';
import { resolveFilePath } from '../../config/upload';
import { ConcurrencyService } from '../system/concurrency.service';
import { withLock } from '../../utils/redis-lock';
import { RuleLibraryService } from '../llm/rule-library.service';
import { TableExtractionService } from '../file/table-extraction.service';
import { validateSeverity } from './severity-rules';
import { validateOriginalText } from '../knowledge/text-fidelity.service';
import { FormulaOcrService } from '../file/formula-ocr.service';
import path from 'path';
import { ReviewPlan } from '../../types/review-plan';
import { TaskService } from '../system/task.service';
import { DwgHandlerService } from '../file/dwg-handler.service';
import { StandardRefCheckService } from '../review-pipeline/standard-ref-check.service';
import { getModeCapabilitiesConfig } from '../review-pipeline/mode-config.service';
import { getMaxConcurrentReviews } from '../../utils/system-config';
import { normalizeText } from './falsePositiveLibrary.service';

/**
 * �����ŷ��� - ���׶η�����������
 * �׶�1��������飩���������й������ �� �����������
 * �׶�2��AI��飩������ȫ����ɺ󣬷������� AI ��� �� �����������
 * �������� pipelineConfig.maxConcurrentReviews ���ƣ��û��������ƣ�
 *
 * ���û����𲢷����ƻ��ơ�
 * - ÿ���û�ͬʱ��ദ�� maxConcurrentReviews ���ļ��� AI ���
 * - ��ͬ�û�֮�以��Ӱ�죬ʵ�ֶ��û���ƽ����Դ����
 * - ʹ���ڴ� Map ׷�٣�Map<userId, { processingCount, pendingQueue }>
 */
export class ReviewService {
  private static adaptReviewPlanForExecution(task: any): {
    plan: ReviewPlan;
    reviewMode: string;
    ruleSource: ('STANDARD' | 'RULE_LIBRARY')[];
    ruleLibraryId?: string;
    enabledPrefixes?: string[];
    maxkbKnowledgeIds: string[];
    refFileGroupRequired: boolean;
    intraFileConsistency: boolean;
    crossFileConsistency: boolean;
    contractStance?: string;
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
    // ֧��ͬʱѡ��֪ʶ��(STANDARD)����������(RULE_LIBRARY)
    const ruleSource: ('STANDARD' | 'RULE_LIBRARY')[] = [];
    if (plan.evidence.sources.includes('STANDARD')) ruleSource.push('STANDARD');
    if (plan.evidence.sources.includes('RULE_LIBRARY')) {
      ruleSource.push('RULE_LIBRARY');
    }
    const hasStandard = ruleSource.includes('STANDARD');
    const hasReviewSpec = ruleSource.includes('RULE_LIBRARY');
    const effectiveProfile = plan.execution.profile;
    const stages =
      effectiveProfile === 'RULE_ONLY'
        ? { ai: false, rules: true, stdRef: false }
        : effectiveProfile === 'AI_ONLY'
          ? { ai: true, rules: false, stdRef: false }
          : undefined;
    const crossFileConsistency = !!plan.enhancements.crossFileConsistency;

    const hasDirectPrefixes = Array.isArray(plan.evidence.enabledPrefixes) && plan.evidence.enabledPrefixes.length > 0;

    return {
      plan,
      reviewMode,
      ruleSource,
      // �������⣺�� RULE_LIBRARY Դ����ֱ�ӹ���ǰ׺ʱ����
      ruleLibraryId: hasReviewSpec && !hasDirectPrefixes ? plan.evidence.ruleLibraryId || undefined : undefined,
      enabledPrefixes: hasDirectPrefixes ? plan.evidence.enabledPrefixes : undefined,
      // ֪ʶ�⣺�� STANDARD Դʱ���� maxkbKnowledgeIds
      maxkbKnowledgeIds: hasStandard ? (Array.isArray(plan.evidence.maxkbKnowledgeIds) ? plan.evidence.maxkbKnowledgeIds : []) : [],
      // ��ͬ���ģʽ���ο��ļ���ѡ����Ҫ�������
      refFileGroupRequired: (plan.objective === 'COMPARE' && (plan as any).entryModule !== 'CONTRACT') || (plan.evidence.sources.includes('REFERENCE') && (plan as any).entryModule !== 'CONTRACT'),
      intraFileConsistency: !!plan.enhancements.intraFileConsistency,
      crossFileConsistency,
      contractStance: plan.contractStance,
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
      confidence: issue.sourceReferences ? 'AI_WITH_SOURCES' : 'AI_INFERRED',
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
        reviewSource: 'SYSTEM',
        originalText: fileName,
        description: reason,
        confidence: 'NO_RESULT',
        confidenceSource: 'system_summary',
      } as any),
    }).catch(() => { /* ignore */ });
  }

  // �û����𲢷����ƣ�׷��ÿ���û����ڽ��е� AI ����ļ�����
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
   * �� locateMeta ���ַ�λ���Ƶ�����ҳ��
   *
   * PDF: ������ҳ�ı���������ַ�ƫ�� �� ҳ��
   * DOCX/PPTX: ���� parseResult.structure.paragraphs �� page ��Ϣ
   * ����: ���� undefined
   */
  /**
   * DWG �ļ��ڷ� DWG ���ģʽ�£�AI ��� text ���� cadHandleId��
   * �� ctx.dwgStructure.textEntities �а��ı�ƥ�䣬���� cadHandleId��
   * ʹǰ���ܾ�ȷ��ת�� CAD ʵ�塣
   */
  private static enrichDwgHandle(
    issue: { originalText?: string; cadHandleId?: string | null },
    meta: any,
    ctx: PipelineContext,
  ): void {
    if (ctx.fileType?.toLowerCase() !== 'dwg') return;
    if (issue.cadHandleId || meta?.hint?.cadHandleId) return;
    const entities = ctx.dwgStructure?.textEntities;
    if (!entities || entities.length === 0) return;

    const searchText = (issue.originalText || '').trim();
    if (!searchText) return;

    for (const entity of entities) {
      if (entity.text && entity.text.trim() === searchText) {
        if (!meta.hint) meta.hint = {};
        meta.hint.cadHandleId = entity.handle;
        meta.mode = 'dwg';
        meta.confidence = 'exact';
        return;
      }
    }
  }

  private static resolvePageHint(
    locateMeta: any,
    pdfPages?: string[],
    parseResult?: any,
  ): number | undefined {
    const absStart = locateMeta?.absolute?.start;
    if (absStart == null || absStart < 0) return undefined;

    // PDF: ��ҳ�ۻ��ַ�ƫ��
    if (pdfPages && pdfPages.length > 0) {
      let offset = 0;
      for (let i = 0; i < pdfPages.length; i++) {
        offset += pdfPages[i].length + 1; // +1 for newline between pages
        if (absStart < offset) return i + 1; // 1-indexed
      }
    }

    // DOCX/PPTX: ������ page �ֶι���
    const paragraphs = parseResult?.structure?.paragraphs;
    if (paragraphs && paragraphs.length > 0) {
      let accumulated = 0;
      for (const para of paragraphs) {
        accumulated += (para.text?.length || 0) + 1;
        if (absStart < accumulated && typeof para.page === 'number') {
          return para.page;
        }
      }
    }

    return undefined;
  }

  /**
   * 用户级并发执行（每任务内的 worker 池）
   * - 同一任务内同时最多处理 limit 个文件（真正的并发闸门）
   * - 每个任务整体在单个 Worker 进程内执行，故该限制天然多进程安全
   *
   * @param userId 用户ID（仅用于日志/语义）
   * @param items 待处理项列表
   * @param limit 单任务内最大并发文件数
   * @param fn 处理函数
   */
  private static async runUserLevelConcurrency<T, R>(
    userId: string,
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    // 工作函数：从队列中取任务执行（并发上限由 worker 数量控制）
    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        const item = items[currentIndex];
        results[currentIndex] = await fn(item, currentIndex);
      }
    };

    // 启动 limit 个并发 worker
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    return results;
  }

  /**
   * �����: ���׶η���������������
   *
   * ����:
   *  1. ��������/�ļ�/���ã�һ���ԣ�
   *  2. �׶�1: ��������������飨�� maxConcurrentReviews ���ƣ�
   *  3. �������: ���й����� + WebSocket ����
   *  4. �׶�2: �������� AI ��飨�� maxConcurrentReviews ���ƣ�
   *  5. �������: ���� AI ��� + WebSocket ����
   *  6. ���ļ�һ���Լ�飨CONSISTENCY��
   *  7. ��������״̬ + ��������
   */
  static async processTask(taskId: string): Promise<void> {
    // 防重复提交锁：同一 taskId 不能同时被处理
    const { acquired } = await withLock(
      `review:task:${taskId}`,
      async () => { await ReviewService._processTaskImpl(taskId); },
      300, // 5 分钟超时（长任务）
      true, // 自动续期
    );

    if (!acquired) {
      console.warn(`[Review] task ${taskId} already being processed by another worker, skipping`);
      return;
    }
  }

  private static async _processTaskImpl(taskId: string): Promise<void> {

    // ȫ�ֲ������ƣ��ȴ���ȡ��λ
    let slotAcquired = false;
    try {
      // �Ȼ�ȡ������Ϣ���õ� userId
      const taskForQueue = await prisma.task.findUnique({ where: { id: taskId }, select: { creatorId: true } });
      if (taskForQueue) {
        await ConcurrencyService.waitForSlot(taskId, taskForQueue.creatorId);
        slotAcquired = true;
      }
    } catch (e) {
      console.warn(`[Review] ȫ�ֲ��������쳣������ִ��: ${e}`);
    }

    try {
      // ===== һ���Լ����������� =====
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
        console.error(`[Review] ���񲻴���: ${taskId}`);
        return;
      }

      const totalFiles = task.files.length;

      // ��������ʼ
      WebSocketService.emitTaskProgress(taskId, {
        type: 'started',
        step: '��ʼ��',
        progress: 0,
        message: '����ʼ����',
        timestamp: Date.now(),
      });

      const executionPlan = this.adaptReviewPlanForExecution(task);
      const reviewMode = executionPlan.reviewMode;
      const maxkbKnowledgeId = (task as any).maxkbKnowledgeId || undefined;
      const ruleLibraryId = executionPlan.ruleLibraryId;
      const directPrefixes = executionPlan.enabledPrefixes;

      // ===== ģʽ��Ϊ���ã��̶�ģʽֱ�Ӳ�������贴�� Pipeline�� =====
      const needsAI = reviewMode !== 'RULE_ONLY';
      const modeDisplayName = getModeDisplayName(reviewMode as ReviewModeType);
      // ����ʹ��ǰ�˴��������ǰ׺����������淶��/��������
      let ruleExecutionPlan = directPrefixes && directPrefixes.length > 0
        ? { enabledPrefixes: directPrefixes, executableItems: [] }
        : null;
      if (!ruleExecutionPlan && ruleLibraryId) {
        ruleExecutionPlan = await RuleLibraryService.getExecutionPlan(ruleLibraryId).catch(() => null);
        if (!ruleExecutionPlan) {
          console.warn('[Review] �����ִ�мƻ�����ʧ��, ID:', ruleLibraryId);
        }
      }

      const intraFileConsistency = !!executionPlan.intraFileConsistency;
      const reviewPoints: string[] = [];
      const corePurposes: string[] = [];

      // ������֪ʶ�ӿ� ID
      let maxkbKnowledgeIds: string[] | undefined;
      if (executionPlan.maxkbKnowledgeIds.length > 0) {
        maxkbKnowledgeIds = executionPlan.maxkbKnowledgeIds;
      } else if (maxkbKnowledgeId) {
        maxkbKnowledgeIds = [maxkbKnowledgeId];
      }

      // ===== ���ع������Ŀ������ AI ������飩 =====
      let semanticItems: PipelineContext['semanticItems'] = undefined;
      const effectiveSpecId = executionPlan.ruleLibraryId || (task as any).ruleLibraryId;
      if (effectiveSpecId) {
        try {
          const specItems = await prisma.ruleLibraryItem.findMany({
            where: { libraryId: effectiveSpecId, enabled: true },
            select: { ruleCode: true, ruleName: true, category: true, description: true, severity: true },
          });
          if (specItems.length > 0) {
            semanticItems = specItems;
          }
        } catch (e) {
          console.warn('[Review] ���ع������Ŀʧ��:', e);
        }
      }

      // ��������ļ�Ϊ PENDING
      await prisma.taskFile.updateMany({
        where: { taskId },
        data: { status: 'PENDING' },
      });

      // ===== һ���Լ��� pipeline ���� =====
      let pipelineConfig: any = {};
      try {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
        if (cfg?.value) pipelineConfig = cfg.value;
      } catch (e) { /* ʹ��Ĭ��ֵ */ }

      // ===== һ���Լ��ز����ļ�����������ģʽ�� =====
      let refFileGroupCtx: PipelineContext['refFileGroup'] | undefined;
      if (executionPlan.refFileGroupRequired) {
        const groups = await prisma.refFileGroup.findMany({
          where: { taskId },
          include: { refFiles: true },
        });
        if (groups.length > 0) {
          refFileGroupCtx = {
            groupId: groups[0].id,
            groupName: groups[0].groupName,
            refFiles: groups[0].refFiles.map((rf: any) => ({
              id: rf.id,
              fileName: rf.fileName,
              filePath: resolveFilePath(rf.filePath),
              fileType: rf.fileType,
              extractedText: rf.extractedText || undefined,
            })),
          };
        }
      }

      // ===== Ϊÿ���ļ����� PipelineContext�������׶ν���� =====
      const fileContexts = task.files.map(file => {
        const absolutePath = resolveFilePath(file.filePath);

        const ctx: PipelineContext = {
          taskId,
          fileId: file.id,
          fileName: file.fileName,
          filePath: absolutePath,
          fileType: file.fileType,
          extractedText: '',
          reviewMode: reviewMode as any,
          ruleSource: executionPlan.ruleSource,
          ruleLibraryId: executionPlan.ruleLibraryId,
          rulePlan: ruleExecutionPlan ? {
            enabledPrefixes: ruleExecutionPlan.enabledPrefixes,
            itemIds: ruleExecutionPlan.executableItems.map((item) => item.id),
          } : undefined,
          standardIds: executionPlan.ruleSource.includes('STANDARD')
            ? task.taskStandards.map((item: any) => item.standardId)
            : [],
          maxkbKnowledgeId: executionPlan.ruleSource.includes('STANDARD') ? (maxkbKnowledgeId || undefined) : undefined,
          maxkbKnowledgeIds: executionPlan.ruleSource.includes('STANDARD') ? (maxkbKnowledgeIds || undefined) : undefined,
          contractStance: executionPlan.contractStance as any,
          pipelineConfig,
          executionOverrides: executionPlan.executionOverrides,
          refFileGroup: refFileGroupCtx,
          semanticItems,
          intraFileConsistency,
          reviewPoints,
          corePurposes,
          userId: (task as any).creatorId,
        };

        // �� DWG ǰ�� WASM ���ݣ�ʹ�� DwgHandlerService ͳһ����
        const dwgMeta = (file as any).dwgMetadata as any;
        const wasmText = ((file as any).extractedText || '').trim();
        DwgHandlerService.populateContextFromWasm(ctx, dwgMeta, wasmText);

        return { file, ctx };
      });

      // ===== �׶�1: �����ļ����й�����飨���٣�����~�뼶������������ =====
      WebSocketService.emitTaskProgress(taskId, {
        type: 'phase1_start',
        step: '�������',
        progress: 5,
        message: `��ʼ���й�����飨${totalFiles} ���ļ���`,
        timestamp: Date.now(),
      });

      // �׶�1���������ȫ�����У���Դ���ĵͣ�������Ӧ��
      const fastPhasePromises = fileContexts.map(({ file, ctx }, index) =>
        this.runFileFastPhase(taskId, file, ctx, index, totalFiles)
          .then(res => ({ ...res, fileId: file.id, fileName: file.fileName }))
          .catch(error => ({ error, fileId: file.id, fileName: file.fileName, ruleIssues: [] as any[], stdRefIssues: [] as any[] }))
      );
      const fastPhaseResults = await Promise.all(fastPhasePromises);

      // ��ȡ�׶�2�Ĳ������ƣ��� basic_settings ��ȡ��Ĭ�� 3��
      const maxConcurrent = await getMaxConcurrentReviews();

      // ===== �������: �׶�1��� =====
      let fastSuccessCount = 0;
      let fastFailedCount = 0;
      for (const result of fastPhaseResults) {
        if ('error' in result) {
          fastFailedCount++;
          console.error(`[Review] �ļ� ${result.fileName} �׶�1ʧ��:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          fastSuccessCount++;
          // �׶�1������� runFileFastPhase ����⣬�˴������� WebSocket
          WebSocketService.emitTaskProgress(taskId, {
            type: 'fast_phase_complete',
            step: '����������',
            progress: 40,
            message: `����������: ${result.ruleIssues.length} ����������, ${result.stdRefIssues.length} ����׼��������`,
            fileName: result.fileName,
            phase: 'phase1',
            ruleCount: result.ruleIssues.length,
            stdRefCount: result.stdRefIssues.length,
            timestamp: Date.now(),
          });
        }
      }


      // ===== �ļ���һ���Լ�飨��������׶�2���У���� await ���ܣ� =====
      let intraConsistencyPromise: Promise<Array<{ fileId: string; issueCount: number }>> | null = null;
      if (intraFileConsistency) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'intra_consistency_check',
          step: '�ļ���һ���Լ��',
          progress: 42,
          message: '���ڽ����ļ���һ���Լ��...',
          timestamp: Date.now(),
        });

        // �ռ��ѳɹ���ȡ�ı����ļ�������
        const filesWithText = fileContexts.filter(({ ctx }) => ctx.extractedText && ctx.extractedText.trim().length > 0);

        // ������������ await����׶�2����ִ��
        intraConsistencyPromise = Promise.all(
          filesWithText.map(async ({ file, ctx }) => {
            try {
              const issueCount = await IntraFileConsistencyService.check(
                taskId, file.id, file.fileName, ctx.extractedText,
              );
              if (issueCount > 0) {
              }
              return { fileId: file.id, issueCount };
            } catch (e) {
              console.warn(`[Review] ${file.fileName} �ļ���һ���Լ��ʧ��:`, e);
              return { fileId: file.id, issueCount: 0 };
            }
          }),
        );
      }

      // ===== �׶�2: �û����𲢷� AI ��� =====
      // ʹ��ͳһ������ pipeline �ж��Ƿ���Ҫ AI ���
      let slowPhaseResults: any[] = [];
      if (!needsAI) {
        // ����Ҫ AI ����ģʽ�����ݽ׶�1�������ļ�״̬
        const failedFileIds = new Set(
          fastPhaseResults.filter(r => 'error' in r).map(r => r.fileId)
        );
        for (const { file } of fileContexts) {
          const status = failedFileIds.has(file.id) ? 'FAILED' : 'COMPLETED';
          await prisma.taskFile.update({
            where: { id: file.id },
            data: { status },
          }).catch((e) => { console.warn(`[Review] �����ļ�״̬ʧ�� (${file.id}):`, e); });
        }
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI ������',
          progress: 45,
          message: `${modeDisplayName}ģʽ���� AI ��飬ֱ�����`,
          timestamp: Date.now(),
        });
      } else {
        // ���˵��׶�1ʧ�ܵ��ļ������������ִ��������� AI ���
        const failedFileIds = new Set(
          fastPhaseResults.filter(r => 'error' in r).map(r => r.fileId)
        );
        const eligibleForAI = fileContexts.filter(({ file }) => !failedFileIds.has(file.id));
        const skippedCount = fileContexts.length - eligibleForAI.length;

        if (skippedCount > 0) {
          console.warn(`[Review] �7�2�1�5 ${skippedCount} ���ļ��׶�1ʧ�ܣ������׶�2:`,
            fileContexts.filter(({ file }) => failedFileIds.has(file.id)).map(({ file }) => file.fileName));
        }

        // ��ǽ׶�1ʧ�ܵ��ļ�״̬
        for (const fileId of failedFileIds) {
          await prisma.taskFile.update({
            where: { id: fileId },
            data: { status: 'FAILED' },
          }).catch((e) => { console.warn(`[Review] ���½׶�1ʧ���ļ�״̬ (${fileId}):`, e); });
        }

        // �� LLM ����Ԥ�죺�׶�2��ʼǰ��� LLM �Ƿ���ã�������ȷ״̬
        let llmConfigAvailable = true;
        try {
          const llmConfig = await LlmService.getLlmConfig();
          if (!llmConfig) {
            llmConfigAvailable = false;
            console.warn('[Review] ?? LLM δ���ã�AI ��齫�޷�����ִ��');
            WebSocketService.emitTaskProgress(taskId, {
              type: 'llm_warning',
              step: 'AI ��龯��',
              progress: 45,
              message: '?? LLM δ���ã�AI ��齫�޷�ִ�С�����ϵͳ���������� LLM API��',
              timestamp: Date.now(),
            });
          } else {
          }
        } catch (e) {
          console.warn('[Review] LLM ���ü���쳣:', e);
        }

        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI ������',
          progress: 45,
          message: llmConfigAvailable
            ? `��ʼ AI ��飨${eligibleForAI.length} ���ļ����û��������� ${maxConcurrent}��`
            : `��ʼ AI ��飨${eligibleForAI.length} ���ļ����� ?? LLM δ���ã�������ʧ��`,
          timestamp: Date.now(),
        });

        // P0-1: 任务级预加载误报库到内存，供各文件上下文共享
        try {
          const allFps = await prisma.falsePositiveLibrary.findMany({ select: { originalText: true } });
          const fpLibrarySet = new Set<string>();
          for (const fp of allFps) {
            fpLibrarySet.add(normalizeText(fp.originalText));
          }
          if (fpLibrarySet.size > 0) {
            for (const { ctx } of eligibleForAI) {
              (ctx as any).fpLibrarySet = fpLibrarySet;
            }
          }
        } catch (e) {
          console.warn('[Review] 预加载误报库失败，继续执行审查:', e);
        }

        // �û����𲢷�ִ�н׶�2��ÿ���û����������������׶�1ʧ�ܵ��ļ���
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

      // ===== �������: �׶�2��� =====
      let slowSuccessCount = 0;
      let slowFailedCount = 0;
      const enginesUsed = new Set<string>(); // �ռ������ļ�ʵ��ʹ�õ� AI ����
      for (const result of slowPhaseResults) {
        const isError = 'error' in result;
        if (isError) {
          slowFailedCount++;
          console.error(`[Review] �ļ� ${result.fileName} �׶�2ʧ��:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          slowSuccessCount++;
          if (result.usedEngine) enginesUsed.add(result.usedEngine);
          // OPT-027: RAG 降级时发送 WebSocket 告警事件
          if ((result as any).degraded) {
            WebSocketService.emitTaskProgress(taskId, {
              type: 'rag_degraded',
              step: 'AI审查降级',
              progress: 80,
              message: (result as any).degradedReason || 'RAG 不可用，已切换为 LLM 直审',
              fileName: result.fileName,
              phase: 'phase2',
              timestamp: Date.now(),
            });
          }
          // ���ͽ׶�2����¼�
          WebSocketService.emitTaskProgress(taskId, {
            type: 'slow_phase_complete',
            step: 'AI������',
            progress: 80,
            message: `AI������: ${result.aiIssues.length} ������ (${result.usedEngine || 'unknown'})`,
            fileName: result.fileName,
            phase: 'phase2',
            aiCount: result.aiIssues.length,
            usedEngine: result.usedEngine,
            timestamp: Date.now(),
          });
        }
        // �����ļ�״̬
        const fileStatus = isError ? 'FAILED' : 'COMPLETED';
        await prisma.taskFile.update({
          where: { id: result.fileId },
          data: { status: fileStatus },
        }).catch((e) => { console.warn(`[Review] �����ļ�״̬ʧ�� (${result.fileId}):`, e); });
      }


      // ===== ���ļ�һ���Լ�� =====
      // ʹ�� capabilities.crossFile �жϣ��������������ԭ��Ӳ����ģʽ�б���
      // ===== �ȴ��ļ���һ���Լ����ɣ���׶�2�����������˴����ܽ���� =====
      if (intraConsistencyPromise) {
        try {
          const intraResults = await intraConsistencyPromise;
          const totalIntraIssues = intraResults.reduce((sum, r) => sum + r.issueCount, 0);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'intra_consistency_done',
            step: '�ļ���һ���Լ�����',
            progress: 92,
            message: `�ļ���һ���Լ�����: ���� ${totalIntraIssues} ����һ������`,
            timestamp: Date.now(),
          });
        } catch (e) {
          console.warn(`[Review] �ļ���һ���Լ���쳣:`, e);
        }
      }

      // ===== ���ļ�һ���Լ�� =====
      const crossFileNeeded = executionPlan.crossFileConsistency && totalFiles >= 2;
      if (crossFileNeeded) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'cross_file_check',
          step: '���ļ�һ���Լ��',
          progress: 90,
          message: '���ڽ��п��ļ�һ���Լ��...',
          timestamp: Date.now(),
        });

        try {
          const crossIssueCount = await CrossFileConsistencyService.check(taskId, task.files);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'cross_file_done',
            step: 'һ���Լ�����',
            progress: 95,
            message: `���� ${crossIssueCount} ����һ������`,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error(`[Review] ���ļ�һ���Լ��ʧ��: ${taskId}`, error);
        }
      }

      // ===== ��������״̬ =====
      // AI ģʽ���׶�1ʧ�� + �׶�2ʧ�� = ��ʧ����
      // �� AI ģʽ��ֱ��ʹ�ý׶�1����
      const phase1FailedCount = fastFailedCount;
      const successCount = needsAI ? slowSuccessCount : fastSuccessCount;
      const failedCount = needsAI ? (phase1FailedCount + slowFailedCount) : fastFailedCount;
      const newStatus = (failedCount >= totalFiles) ? 'FAILED' : 'COMPLETED';

      // �־û�ʵ��ʹ�õ� AI ������Ϣ�������¼
      const primaryEngine = enginesUsed.size > 0 ? Array.from(enginesUsed).join('+') : (needsAI ? 'none' : undefined);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: newStatus,
          ...(primaryEngine ? { aiEngineUsed: primaryEngine } : {}),
        },
      });

      // ===== �������� =====
      WebSocketService.emitTaskProgress(taskId, {
        type: newStatus === 'COMPLETED' ? 'completed' : 'failed',
        step: newStatus === 'COMPLETED' ? 'ȫ�����' : '����ʧ��',
        progress: 100,
        message: newStatus === 'COMPLETED'
          ? `�����ɣ��ɹ� ${successCount} ���ļ���ʧ�� ${failedCount} ��`
          : `���� ${failedCount} ���ļ����ʧ��`,
        result: { successCount, failedCount, fastSuccessCount, fastFailedCount },
        timestamp: Date.now(),
      });

      WebSocketService.emitToUser(task.creatorId, {
        type: 'task_complete',
        title: newStatus === 'COMPLETED' ? '����������' : '�������ʧ��',
        message: newStatus === 'COMPLETED'
          ? `����${task.title}������ɣ�${successCount} ���ļ�������`
          : `����${task.title}�����ʧ�ܣ������ļ�������δ�ɹ�`,
        taskId,
        status: newStatus,
      });

      // ===== 可观测性 P2：任务级 LLM 调用汇总 =====
      if (newStatus === 'COMPLETED') {
        try {
          const logs = await prisma.llmCallLog.findMany({
            where: { taskId },
            select: { totalTokens: true, costEstimate: true, latencyMs: true, status: true },
          });
          const totalTokens = logs.reduce((s, l) => s + (l.totalTokens || 0), 0);
          const totalCost = logs.reduce((s, l) => s + (l.costEstimate || 0), 0);
          const avgLatency = logs.length > 0
            ? Math.round(logs.reduce((s, l) => s + (l.latencyMs || 0), 0) / logs.length)
            : 0;
          const failedCalls = logs.filter(l => l.status === 'failed').length;
          await prisma.task.update({
            where: { id: taskId },
            data: {
              stats: {
                ...((task.stats as any) || {}),
                llm: {
                  callCount: logs.length,
                  totalTokens,
                  totalCost: Number(totalCost.toFixed(4)),
                  avgLatencyMs: avgLatency,
                  failedCalls,
                },
              },
            },
          });
          console.log(`[Observability] 任务 ${taskId} LLM 汇总: ${logs.length} 次调用, ${totalTokens} tokens, ¥${totalCost.toFixed(4)}`);
        } catch (e) {
          console.warn('[Observability] 任务级 LLM 汇总失败（不影响主流程）:', (e as Error).message);
        }
      }

    } catch (error) {
      console.error(`[Review] �������쳣: ${taskId}`, error);
      try {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
        WebSocketService.emitTaskProgress(taskId, {
          type: 'error',
          step: '�����쳣',
          progress: 0,
          message: `�������쳣: ${error instanceof Error ? error.message : 'δ֪����'}`,
          timestamp: Date.now(),
        });
      } catch (e) { /* ignore */ }
    } finally {
      // �ͷ�ȫ�ֲ�����λ
      if (slotAcquired) {
        try {
          await ConcurrencyService.releaseSlot(taskId);
        } catch (e) {
          console.warn(`[Review] �ͷ�ȫ�ֲ�λʧ��: ${e}`);
        }
      }
    }
  }

  // ==================== ���׶��ļ��������� ====================

  /**
   * �׶�1: ������� + ��׼���ü��
   * - �ı���ȡ��Parser + OCR��
   * - PDF ��ҳ���� / Word �ṹ��
   * - ����������
   * - ��׼���ù淶�Լ��
   *
   * ��ɺ�������Ⲣ���ؽ�������� AI �����
   */
  static async runFileFastPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ ruleIssues: any[]; stdRefIssues: any[] }> {
    const absolutePath = resolveFilePath(file.filePath);

    // �����ļ��׶�1��ʼ
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_fast_start',
      step: `������� ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `��ʼ�������: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase1',
      timestamp: Date.now(),
    });

    // ����ļ�Ϊ������
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { status: 'PROCESSING' },
    }).catch((e) => { console.warn(`[Review] ����ļ�������ʧ�� (${file.fileName}):`, e); });

    // Ԥ��ȡ�ı������ڽ��ȷ�ĸ���㣩
    // �� ��� ctx.extractedText ����ǰ�� WASM ���ݣ����� Python ����
    let parseResultFromPreExtract: import('../file/python-parser.service').ParseResult | null = null;
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const parsed = await ParserService.parseFileWithResult(absolutePath, file.fileType);
        if (parsed.text && parsed.text.trim().length > 0) {
          ctx.extractedText = parsed.text;
          parseResultFromPreExtract = parsed.result;
        } else {
          console.warn(`[Review] Ԥ��ȡ���ؿ��ı�: ${file.fileName}, fileType=${file.fileType}`);
        }
      } catch (e) {
        console.warn(`[Review] Ԥ��ȡ�쳣: ${file.fileName}, fileType=${file.fileType}, error=${(e as Error).message || e}`);
      }
    }

    const textLength = ctx.extractedText?.length || 0;
    // WASM ·���� extractedMarkdown ʹ�� ctx.extractedText������·��ʹ��Ԥ��ȡ�� markdown
    const extractedMarkdown = (ctx.fileType.toLowerCase() === 'dwg' && ctx.extractedText)
      ? ctx.extractedText
      : (parseResultFromPreExtract?.markdown || parseResultFromPreExtract?.text || null);
    // DWG Ԫ���ݣ�����ͼ�㡢ͼԪͳ�Ƶ�
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
    // OPT-011: 提取封面结构化信息（PDF 图片封面页 OCR 识别结果）
    const coverInfo = ctx.parseResult?.metadata?.cover_info || null;
    if (coverInfo) ctx.coverInfo = coverInfo;
    await prisma.taskFile.update({
      where: { id: file.id },
      data: {
        textLength, processedLength: 0,
        extractedText: ctx.extractedText || null,
        extractedMarkdown,
        ...(dwgMetadata ? { dwgMetadata } : {}),
        ...(coverInfo ? { coverInfo: coverInfo as any } : {}),
      },
    }).catch((e) => { console.warn(`[Review] ������ȡ�ı�ʧ�� (${file.fileName}):`, e); });

    // ===== �׶�1���ı���ȡ + �������� + ��׼���ü�飨ֱ�ӵ����ӷ��� =====

    // �ı���ȡ��DWG WASM ��Ԥ���ʱ������
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      ctx.extractedText = await TextExtractionService.ensureText(ctx);
    }

    // PDF ��ҳ���� + Word/DWG �ṹ��
    const pdfPages = await TextExtractionService.extractPdfPages(ctx);
    ctx.pdfPages = pdfPages;
    await TextExtractionService.ensureWordStructure(ctx);
    TextExtractionService.ensureDwgStructure(ctx);

    // ��ģ̬ģʽ��������ȡ + ��ʽ���
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
          issueType: 'VIOLATION', ruleCode: 'FORMULA_001', severity: 'info',
          originalText: region.text,
          description: '��⵽���ܵĹ�ʽ���ݣ������˹�ȷ�Ϲ�ʽ��ȷ�ԡ�',
        });
      }
    }
    // �� MULTIMODAL ģʽ�������������/��ʽ������������� behavior.rules �ſأ�
    if (extraRuleIssues.length > 0 && ctx.reviewMode === 'MULTIMODAL') {
      const extraData = extraRuleIssues.map((issue) => {
        const meta = this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id });
        if (meta) this.enrichDwgHandle(issue, meta, ctx);
        if (meta && meta.absolute && !meta.hint?.pageHint) {
          const pageHint = this.resolvePageHint(meta, ctx.pdfPages, ctx.parseResult);
          if (pageHint != null) meta.hint = { ...(meta.hint || {}), pageHint };
        }
        return {
          ...this.getConfidence(issue),
          taskId, fileId: file.id,
          issueType: issue.issueType, ruleCode: issue.ruleCode,
          severity: issue.severity,
          reviewSource: 'RULE_ENGINE',
          originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description,
          cadHandleId: (issue as any).cadHandleId || null,
          textPosition: this.buildLegacyTextPosition(meta, ctx.extractedText, issue.originalText),
          locateMeta: meta,
        };
      });
      const strippedExtra = extraData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.taskDetail.createMany({ data: strippedExtra, skipDuplicates: true });
      } catch (e) {
        console.error(`[Review] ? MULTIMODAL ǰ�ü��д��ʧ��: ${file.fileName}`, e);
      }
    }

    // ��������
    let ruleIssues: any[] = [];
    if (ctx.reviewMode === 'RULE_ONLY') {
      const rulesEnabled = ctx.executionOverrides?.stages?.rules !== false;
      if (rulesEnabled) {
        // ����ʹ�� rulePlan �е�ǰ׺���ˣ�RULE_ONLY ģʽ�û�ѡ���Ĺ���ǰ׺��
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

    // ��׼���ü�飺����ģʽ������ standardRef=true ������
    let stdRefIssues: any[] = [];
    if (ctx.extractedText?.trim() && ctx.reviewMode) {
      try {
        const modeConfigs = await getModeCapabilitiesConfig();
        const modeCfg = modeConfigs[ctx.reviewMode as keyof typeof modeConfigs];
        if (modeCfg?.standardRef) {
          stdRefIssues = await StandardRefCheckService.runStandardRefCheck(ctx, ctx.extractedText);
        }
      } catch (e) {
        console.warn(`[Review] ��׼���ü��ʧ��: ${ctx.fileName}`, e);
      }
    }

    const fastResult = { ruleIssues, stdRefIssues, textLength: ctx.extractedText?.length || 0 };

    // ����д�������
    const allFastIssues: any[] = [];

    if (fastResult.ruleIssues.length > 0) {
      const ruleData = fastResult.ruleIssues.map((issue) => {
        const meta = this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id });
        if (meta) this.enrichDwgHandle(issue, meta, ctx);
        if (meta && meta.absolute && !meta.hint?.pageHint) {
          const pageHint = this.resolvePageHint(meta, ctx.pdfPages, ctx.parseResult);
          if (pageHint != null) meta.hint = { ...(meta.hint || {}), pageHint };
        }
        return {
          ...this.getConfidence(issue),
          taskId, fileId: file.id,
          issueType: issue.issueType, ruleCode: issue.ruleCode,
          severity: issue.severity,
          reviewSource: ctx.ruleSource?.includes('RULE_LIBRARY') ? 'RULE_LIBRARY' : 'RULE_ENGINE',
          originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description,
          cadHandleId: (issue as any).cadHandleId || null,
          textPosition: this.buildLegacyTextPosition(meta, ctx.extractedText, issue.originalText),
          locateMeta: meta,
        };
      });

      // ��ǿ�棺���񱣻� + ���Ի���
      const strippedRuleData = ruleData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.$transaction(async (tx) => {
          await tx.taskDetail.createMany({
            data: strippedRuleData,
            skipDuplicates: true,
          });
        });
      } catch (txError) {
        console.error(`[Review] ? ����������д��ʧ��: ${file.fileName}`, txError);

        // ����һ�Σ�����˲ʱ���ϻ�����ͻ������
        try {
          await prisma.taskDetail.createMany({
            data: strippedRuleData,
            skipDuplicates: true,
          });
        } catch (retryError) {
          console.error(`[Review] ? ����������Ҳʧ�ܣ����ݽ���ʧ: ${file.fileName}`, retryError);

          // ���������¼�Ա�׷��
          await this.createErrorDetail(taskId, file.id, file.fileName, `����������ʧ��(���Ժ�): ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      allFastIssues.push(...ruleData);
    }

    if (fastResult.stdRefIssues.length > 0) {
      const stdRefData = fastResult.stdRefIssues.map((issue) => {
        const meta = this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id });
        if (meta) this.enrichDwgHandle(issue, meta, ctx);
        if (meta && meta.absolute && !meta.hint?.pageHint) {
          const pageHint = this.resolvePageHint(meta, ctx.pdfPages, ctx.parseResult);
          if (pageHint != null) meta.hint = { ...(meta.hint || {}), pageHint };
        }
        return {
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
          textPosition: this.buildLegacyTextPosition(meta, ctx.extractedText, issue.originalText),
          locateMeta: meta,
        };
      });

      // ��ǿ�棺���񱣻� + ���Ի���
      const strippedStdRefData = stdRefData.map((item) => this.stripDbUnsupportedFields(item));
      try {
        await prisma.$transaction(async (tx) => {
          await tx.taskDetail.createMany({
            data: strippedStdRefData,
            skipDuplicates: true,
          });
        });
      } catch (txError) {
        console.error(`[Review] ? ��׼���ý������д��ʧ��: ${file.fileName}`, txError);

        // ����һ��
        try {
          await prisma.taskDetail.createMany({
            data: strippedStdRefData,
            skipDuplicates: true,
          });
        } catch (retryError) {
          console.error(`[Review] ? ��׼���ý������Ҳʧ�ܣ����ݽ���ʧ: ${file.fileName}`, retryError);
          await this.createErrorDetail(taskId, file.id, file.fileName, `��׼���ñ���ʧ��(���Ժ�): ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      allFastIssues.push(...stdRefData);
    }

    // ���ı�ʱд�뾯��
    if (!fastResult.textLength && allFastIssues.length === 0) {
      const isDwg = file.fileType.toLowerCase() === 'dwg';
      await prisma.taskDetail.create({
        data: {
          taskId, fileId: file.id,
          issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
          reviewSource: 'SYSTEM',
          originalText: file.fileName,
          description: isDwg
            ? 'DWG �ļ�δ����ȡ�ı����ݣ�ǰ�� WASM ��������δ�ɹ�����ͼֽ�����ܲ������������˹���顣'
            : '�ļ������޷���ȡ��������ɨ�����ͼƬ�� PDF���� OCR ʶ��δ�ܳɹ���ȡ���֡������˹���顣',
        },
      }).catch((e) => { console.warn(`[Review] ���ı�����д��ʧ��:`, e); });
    } else if (fastResult.textLength > 0 && allFastIssues.length === 0) {
      await this.createNoResultDetail(
        taskId,
        file.id,
        file.fileName,
        '�������ͱ�׼���ü���δ�������⡣�ý����������ȫ�Ϲ棬����ʾ��ǰ��������׼��δ������ȷ���⡣',
      );
    }

    // DWG �ļ����⴦��������ߴ��ע�ͱ�׼���ã��� cadHandleId��
    if (file.fileType.toLowerCase() === 'dwg') {
      // ����ʹ�� ctx.parseResult��WASM ��Ԥ��ȡ�Ľ����
      const parseResult = ctx.parseResult;
      if (parseResult && ctx.extractedText && ctx.extractedText.trim().length > 0) {
        const dwgDetails: any[] = [];

        // �ߴ��ע
        if (parseResult.structure.dimensions && parseResult.structure.dimensions.length > 0) {
          for (const dim of parseResult.structure.dimensions) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: null, severity: 'info' as const,
              originalText: dim.text || dim.measurement || '',
              suggestedText: null,
              description: `ͼ��: ${dim.layer}, ����: ${dim.entity_type}`,
              cadHandleId: dim.handle || null,
            });
          }
        }

        // ��׼���ã��� DWG ��������ȡ���� cadHandleId��
        if ((parseResult.structure as any).standardRefs && (parseResult.structure as any).standardRefs.length > 0) {
          for (const ref of (parseResult.structure as any).standardRefs) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: 'DWG_STDREF_001' as const,
              severity: 'info' as const,
              originalText: ref.fullMatch || ref.standardNo,
              suggestedText: null,
              description: `DWG ��׼����: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
              cadHandleId: ref.cadHandleId || null,
            });
          }
        }

        if (dwgDetails.length > 0) {
          await prisma.taskDetail.createMany({ data: dwgDetails }).catch((e) => { console.warn(`[Review] DWG����д��ʧ�� (${file.fileName}):`, e); });
        }
      }
    }

    // ���´������
    await this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] ���´������ʧ�� (${file.id}):`, e); });


    return { ruleIssues: fastResult.ruleIssues, stdRefIssues: fastResult.stdRefIssues };
  }

  /**
   * �׶�2: AI ������
   * - ʹ�ý׶�1����ȡ�� ctx.extractedText �� ctx.pdfPages
   * - ִ�� AI/LLM ���
   * - ��ɺ�д�����ݿⲢ���ؽ��
   */
  static async runFileSlowPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ aiIssues: any[]; usedEngine?: string; skippedNoText?: boolean }> {
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);

    // �����ļ��׶�2��ʼ
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_slow_start',
      step: `AI ��� ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `��ʼ AI ������: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase2',
      timestamp: Date.now(),
    });

    // �ڴ��ǣ�׷���Ƿ��з�Ƭ�ɹ�д�� DB�����ⶵ��д��ľ�̬������
    let anyChunkWritten = false;

    // ���Ȼص���ÿ�� AI ��Ƭ�����ɺ�����д�� DB ������ WebSocket��
    ctx.onChunkProgress = async (chunkLength: number, issues: any[], chunkIndex: number, totalChunks: number, engine: string) => {
      // 1. �����Ѵ����ַ���
      try {
        await prisma.taskFile.update({
          where: { id: file.id },
          data: { processedLength: { increment: chunkLength } },
        });
      } catch (e) { /* ���Խ��ȸ���ʧ�� */ }

      // 2. �÷�Ƭ������ʱ����д�� DB
      if (issues && issues.length > 0) {
        // P0-1: 过滤误报库中的 issue，减少 LLM 幻觉风险
        let filteredByFp = 0;
        if (ctx.fpLibrarySet && ctx.fpLibrarySet.size > 0) {
          const beforeCount = issues.length;
          issues = issues.filter((issue: any) => !ctx.fpLibrarySet!.has(normalizeText(issue.originalText)));
          filteredByFp = beforeCount - issues.length;
          if (filteredByFp > 0) {
            console.log(`[Review] 分片 ${chunkIndex} 过滤 ${filteredByFp} 条误报 (${file.fileName})`);
          }
        }

        const aiData = issues.map((issue) => {
          // OPT-029: originalText fidelity check
          if (issue.originalText && ctx.extractedText) {
            const fidelity = validateOriginalText(issue.originalText, ctx.extractedText, { enableFuzzy: ctx.extractedText.length < 100000 });
            if (fidelity.confidence === 'fuzzy' && fidelity.correctedText) {
              issue.originalText = fidelity.correctedText;
            }
          }
          // ͳһ���� locateMeta��ֻ��һ�Σ����� textPosition �� locateMeta �ֶθ���һ�飩
          const meta = issue.locateMeta
            || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id });
          // DWG �ļ��� cadHandleId��AI ģʽ�¶�ʧ Handle���� dwgStructure ���飩
          if (meta) this.enrichDwgHandle(issue, meta, ctx);
          // ���ַ�λ�÷���ҳ��
          if (meta && meta.absolute && !meta.hint?.pageHint) {
            const pageHint = this.resolvePageHint(meta, ctx.pdfPages, ctx.parseResult);
            if (pageHint != null) {
              meta.hint = { ...(meta.hint || {}), pageHint };
            }
          }
          return {
            ...this.getConfidence(issue),
            taskId,
            fileId: file.id,
            issueType: issue.issueType,
            ruleCode: issue.ruleCode || null,
            severity: validateSeverity(issue.issueType, issue.severity),
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
            textPosition: this.buildLegacyTextPosition(meta, ctx.extractedText, issue.originalText),
            locateMeta: meta,
            // 人工复核状态：AI_INFERRED 纯推断结果或合同 HIGH 风险需要人工复核
            riskLevel: (issue as any).riskLevel || null,
            reviewStatus: ((confidence) => { return (confidence === 'AI_INFERRED' || (issue as any).riskLevel === 'HIGH') ? 'PENDING_REVIEW' : 'CONFIRMED'; })(this.getConfidence(issue).confidence),
            clauseType: (issue as any).clauseType || null,
            recommendation: (issue as any).recommendation || null,
          };
        });

        // ��ǿ�棺���񱣻� + ���Ի��� + ʧ��ʱ�ӳ�����
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
        } catch (txError) {
          console.error(`[Review] ? ��Ƭ ${chunkIndex}/${totalChunks} ����д��ʧ��: ${file.fileName}`, txError);

          // ����һ��
          try {
            await prisma.taskDetail.createMany({
              data: strippedData,
              skipDuplicates: true,
            });
            dbWriteSuccess = true;
            anyChunkWritten = true;
          } catch (retryError) {
            console.error(`[Review] ? ��Ƭ ${chunkIndex}/${totalChunks} ����Ҳʧ��: ${file.fileName}`, retryError);

            // ���������¼�������������̣�
            this.createErrorDetail(taskId, file.id, file.fileName, `AI��Ƭ${chunkIndex}����ʧ��(���Ժ�): ${retryError instanceof Error ? retryError.message : String(retryError)}`).catch(() => {});
          }
        }

        // 3. �������ݿ�д��ɹ��������WebSocket������ǰ����ʾ��DBû�У�
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

        // P0-1: 推送误报过滤统计
        if (filteredByFp > 0) {
          WebSocketService.emitTaskProgress(taskId, {
            type: 'fp_filtered',
            step: 'AI 审查过滤',
            message: `误报库自动过滤 ${filteredByFp} 条问题 (${file.fileName})`,
            fileName: file.fileName,
            phase: 'phase2',
            timestamp: Date.now(),
          });
        }

        // 4. �����ļ��������������д��ɹ�ʱ��
        this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] ���´������ʧ��:`, e); });
      }

      // 5. ���з�Ƭ��ɺ���´������������0����������
      if (chunkIndex === totalChunks - 1) {
        this.updateFileErrorCount(file.id).catch((e) => { console.warn(`[Review] ���մ����������ʧ��:`, e); });
      }
    };

    // ===== �׶�2��AI ������ �� ͨ�� handler �ַ� =====
    const handler = REVIEW_HANDLERS[ctx.reviewMode];
    if (!handler) {
      console.error(`[Review] δ֪���ģʽ: ${ctx.reviewMode}`);
      return { aiIssues: [], usedEngine: 'none' };
    }

    ctx.scene = ctx.scene || getModeScene(ctx.reviewMode);

    let aiResult;
    try {
      aiResult = await handler(ctx);
    } catch (e) {
      console.error(`[Review] handler ִ��ʧ��: ${ctx.fileName}`, e);
      throw e;
    }

    if (aiResult.usedEngine === 'none' && aiResult.aiIssues.length === 0) {
    }
    const slowResult = { aiIssues: aiResult.aiIssues || [], usedEngine: aiResult.usedEngine || 'unknown', degraded: (aiResult as any).degraded || false, degradedReason: (aiResult as any).degradedReason || undefined };

    // P0-4: OCR 降级告警 — 生成告警 issue
    if (ctx.ocrDegradedReason) {
      const ocrIssue: any = {
        issueType: 'COMPLETENESS',
        ruleCode: 'OCR_DEGRADED',
        severity: 'warning',
        originalText: file.fileName || ctx.fileName || '',
        description: ctx.ocrDegradedReason.includes('未配置')
          ? 'OCR服务不可用（未配置视觉模型），扫描件内容未能提取，本次审查可能遗漏图片中的问题'
          : 'OCR服务执行失败，扫描件内容未能提取，本次审查可能遗漏图片中的问题',
        plainLanguage: `文件 "${file.fileName}" 为扫描件或图片，但 OCR 无法识别内容。请手动检查该文件中可能的合规问题。`,
        suggestedText: null,
      };
      slowResult.aiIssues.push(ocrIssue);

      // 推送 OCR 降级 WebSocket 事件
      WebSocketService.emitTaskProgress(taskId, {
        type: 'ocr_degraded',
        step: 'OCR 降级告警',
        message: `OCR 服务不可用: ${file.fileName}`,
        fileName: file.fileName,
        phase: 'phase2',
        timestamp: Date.now(),
      });
    }

    // AI �����ͨ�� ctx.onChunkProgress ����д�루ÿ����Ƭ�����ɺ�������� + ���� WebSocket��
    // �˴��������ף�ʹ���ڴ��Ǽ�飬���޷�Ƭ�ɹ�д����һ����д�루��������� onChunkProgress ȫ��ʧ��ʱ�ı��ף�
    if (slowResult.aiIssues.length > 0 && !anyChunkWritten) {
      try {
        // P0-1: 过滤误报库中的 issue（兜底路径）
        if (ctx.fpLibrarySet && ctx.fpLibrarySet.size > 0) {
          const beforeCount = slowResult.aiIssues.length;
          slowResult.aiIssues = slowResult.aiIssues.filter(
            (issue: any) => !ctx.fpLibrarySet!.has(normalizeText(issue.originalText))
          );
          const fallbackFiltered = beforeCount - slowResult.aiIssues.length;
          if (fallbackFiltered > 0) {
            console.log(`[Review] 兜底路径过滤 ${fallbackFiltered} 条误报 (${file.fileName})`);
          }
        }

        console.warn(`[Review] ����д��: ${slowResult.aiIssues.length} �� (${file.fileName})`);
        const aiData = slowResult.aiIssues.map((issue) => {
          // OPT-029: originalText fidelity check (fallback path)
          if (issue.originalText && ctx.extractedText) {
            const fidelity = validateOriginalText(issue.originalText, ctx.extractedText, { enableFuzzy: ctx.extractedText.length < 100000 });
            if (fidelity.confidence === 'fuzzy' && fidelity.correctedText) {
              issue.originalText = fidelity.correctedText;
            }
          }
          const meta = issue.locateMeta
            || this.buildLocateMeta(ctx.extractedText, issue, { fileId: file.id });
          if (meta) this.enrichDwgHandle(issue, meta, ctx);
          if (meta && meta.absolute && !meta.hint?.pageHint) {
            const pageHint = this.resolvePageHint(meta, ctx.pdfPages, ctx.parseResult);
            if (pageHint != null) meta.hint = { ...(meta.hint || {}), pageHint };
          }
          return {
            ...this.getConfidence(issue),
            taskId,
            fileId: file.id,
            issueType: issue.issueType,
            ruleCode: issue.ruleCode || null,
            severity: validateSeverity(issue.issueType, issue.severity),
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
            textPosition: this.buildLegacyTextPosition(meta, ctx.extractedText, issue.originalText),
            locateMeta: meta,
            // ��ͬ���ר���ֶ�
            riskLevel: (issue as any).riskLevel || null,
            clauseType: (issue as any).clauseType || null,
            recommendation: (issue as any).recommendation || null,
          };
        });
        await prisma.taskDetail.createMany({
          data: aiData.map((item) => this.stripDbUnsupportedFields(item)) as any,
        });
      } catch (e) {
        console.error(`[Review] ����д��ʧ��:`, e);
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
          'AI ���δ������ȷ���⣻��ǰ�ļ�δ���й��򡢱�׼���û� AI ��������Ϲ��򸲸Ƿ�Χ�ͱ�׼�⸲������˹����ˡ�',
        );
      }
    }
    if (skippedNoText) {
      WebSocketService.emitTaskProgress(taskId, {
        type: 'file_skipped_no_text',
        step: 'AI �������',
        progress: fileProgress + Math.round(50 / totalFiles),
        message: `�ļ��޿����ı��������� AI ���: ${file.fileName}`,
        fileName: file.fileName,
        phase: 'phase2',
        timestamp: Date.now(),
      });
    }

    // �����ļ��׶�2���
    WebSocketService.emitTaskProgress(taskId, {
      type: 'slow_phase_complete',
      step: 'AI ������',
      progress: fileProgress + Math.round(50 / totalFiles),
      message: `AI ������: ${slowResult.aiIssues.length} ������ (engine: ${slowResult.usedEngine || 'none'})`,
      fileName: file.fileName,
      phase: 'phase2',
      aiCount: slowResult.aiIssues.length,
      usedEngine: slowResult.usedEngine,
      timestamp: Date.now(),
    });


    return { aiIssues: slowResult.aiIssues, usedEngine: slowResult.usedEngine, skippedNoText };
  }

  /**
   * �������������¼
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
          description: `�������з�������: ${errorMessage}`,
        },
      });
      await this.updateFileErrorCount(fileId);
    } catch (e) { /* ���� */ }
  }

  /**
   * �����ļ��Ĵ������
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

  // ==================== ����Ϊ�������������������ԣ� ====================

  /**
   * @deprecated ʹ�� runFileFastPhase + runFileSlowPhase ���
   */
  static async processFile(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    reviewMode: string = 'LIBRARY_REVIEW',
    maxkbKnowledgeId?: string,
    maxkbKnowledgeIds?: string[],
    onProgress?: (chunkLength: number, issues: any[], chunkIndex: number, totalChunks: number, engine: string) => Promise<void>,
  ): Promise<void> {
    const absolutePath = resolveFilePath(file.filePath);

    const ctx: PipelineContext = {
      taskId,
      fileId: file.id,
      fileName: file.fileName,
      filePath: absolutePath,
      fileType: file.fileType,
      extractedText: '',
      reviewMode: reviewMode as any,
      maxkbKnowledgeId: maxkbKnowledgeId || undefined,
      maxkbKnowledgeIds: maxkbKnowledgeIds || undefined,
      onChunkProgress: onProgress,
    };

    // Ԥ��ȡ�ı���������� WASM ������������
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const parsed = await ParserService.parseFileWithResult(absolutePath, file.fileType);
        if (parsed.text?.trim()) ctx.extractedText = parsed.text;
        if (parsed.result) ctx.parseResult = parsed.result;
      } catch (e) { /* ignore */ }
    }

    // ��������
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
      if (cfg?.value) ctx.pipelineConfig = cfg.value as any;
    } catch (e) { /* ignore */ }

    // ���ز����ļ�
    if (reviewMode === 'DOC_REVIEW') {
      const groups = await prisma.refFileGroup.findMany({ where: { taskId }, include: { refFiles: true } });
      if (groups.length > 0) {
        ctx.refFileGroup = {
          groupId: groups[0].id,
          groupName: groups[0].groupName,
          refFiles: groups[0].refFiles.map((rf: any) => ({
            id: rf.id,
            fileName: rf.fileName,
            filePath: resolveFilePath(rf.filePath),
            fileType: rf.fileType,
            extractedText: rf.extractedText || undefined,
          })),
        };
      }
    }

    // д���ı�����
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { textLength: ctx.extractedText?.length || 0, processedLength: 0 },
    }).catch(() => { /* ignore */ });

    // ʹ�� handler ִ�� AI ���
    try {
      const handler = REVIEW_HANDLERS[reviewMode as any];
      if (!handler) throw new Error(`δ֪���ģʽ: ${reviewMode}`);
      ctx.scene = ctx.scene || getModeScene(reviewMode as any);
      const aiResult = await handler(ctx);
      const result = { ruleIssues: [], aiIssues: aiResult.aiIssues || [], stdRefIssues: undefined };

      // д AI ���
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

      // ���ı�����
      if (!ctx.extractedText && result.ruleIssues.length === 0 && result.aiIssues.length === 0) {
        await prisma.taskDetail.create({
          data: {
            taskId, fileId: file.id,
            issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
            originalText: file.fileName,
            description: '�ļ������޷���ȡ��������ɨ�����ͼƬ�� PDF�������˹���顣',
          },
        });
      }

      // DWG ����������ߴ��ע�ͱ�׼���ã��� cadHandleId��
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
                description: `ͼ��: ${dim.layer}, ����: ${dim.entity_type}`,
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
                description: `DWG ��׼����: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
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
      console.error(`[Review] Handler ִ��ʧ��: ${file.fileName}`, error);
      await this.createErrorDetail(taskId, file.id, file.fileName, error);
    }
  }
}

