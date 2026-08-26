import prisma from '../../config/db';
import { ParserService } from '../file/parser.service';
import { LlmService } from '../llm/llm.service';
import { PipelineContext, ReviewModeType } from '../review-pipeline';
import { REVIEW_HANDLERS, getModeScene, getModeDisplayName } from '../review-pipeline/review-handlers';
import { TextExtractionService } from '../review-pipeline/text-extraction.service';
import { runAllRules } from '../rules';
import { CrossFileConsistencyService } from './cross-file-consistency.service';
import { IntraFileConsistencyService } from './intra-file-consistency.service';
import { SectionAggregationService } from './section-aggregation.service';
import { WebSocketService } from '../system/websocket.service';
import { resolveFilePath } from '../../config/upload';
import { ConcurrencyService } from '../system/concurrency.service';
import { withLock } from '../../utils/redis-lock';
import { RuleLibraryService } from '../llm/rule-library.service';
import { validateSeverity } from './severity-rules';
import { validateOriginalText } from '../knowledge/text-fidelity.service';
import { ReviewPlan } from '../../types/review-plan';
import { TaskService } from '../system/task.service';
import { DwgHandlerService } from '../file/dwg-handler.service';
import { StandardRefCheckService } from '../review-pipeline/standard-ref-check.service';
import { getModeCapabilitiesConfig } from '../review-pipeline/mode-config.service';
import { getMaxConcurrentReviews } from '../../utils/system-config';
import { normalizeText } from './falsePositiveLibrary.service';
import { StageRunner, StageRunnerHandle } from './stage-runner.service';
import { levenshteinDistance } from '../../utils/issue-dedup';

/**
 * P1-2: 误报命中判定 —— (归一化文本, ruleCode) 二元组，未命中时对 warning 及以下 severity 增加 Levenshtein 模糊匹配
 * fpMap: 归一化文本 → ruleCode 集合（集合含 null 表示该文本任意规则上下文均命中）
 * 与误报库写入侧（normalizedText 列）同口径，消除"同名文本不同规则上下文互相误伤"
 *
 * 模糊匹配：当 fpMap 条目数 ≤ 1000 时，对 warning 及以下 severity 的 issue，
 * 若原文长度 ≥ 6 且与某条 fpMap key 的 Levenshtein 距离 ≤ 2，视为命中。
 */
function isFpRuleHit(
  fpMap: Map<string, Set<string | null>> | null | undefined,
  originalText: string,
  ruleCode?: string | null,
  severity?: string | null,
): boolean {
  if (!fpMap || fpMap.size === 0) return false;
  const normalized = normalizeText(originalText || '');

  // 第一步：精确匹配（(归一化文本, ruleCode) 二元组）
  const codes = fpMap.get(normalized);
  if (codes) {
    if (codes.has(null) || (ruleCode != null && codes.has(ruleCode))) {
      return true;
    }
  }

  // 第二步：对 warning 及以下 severity 的 issue 启用 Levenshtein 模糊匹配
  // 性能保护：fpMap 超过 1000 条时不启用模糊匹配
  if (severity === 'warning' || severity === 'info' || severity === 'prompt') {
    if (fpMap.size <= 1000 && normalized.length >= 6) {
      for (const fpKey of fpMap.keys()) {
        if (fpKey.length >= 6 && levenshteinDistance(normalized, fpKey) <= 2) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * P1-3: AI 产出与已落库确定性规则产出的归一化碰撞判定（相等或互相包含——AI 复制的原文片段
 * 可能比规则匹配段长）。命中即丢弃 AI 条目，保证"规则优先"语义跨模式成立。
 */
function collidesWithRule(norm: string, ruleNormSet: Set<string>): boolean {
  if (!norm) return false;
  if (ruleNormSet.has(norm)) return true;
  for (const rn of ruleNormSet) {
    if (norm.includes(rn) || rn.includes(norm)) return true;
  }
  return false;
}

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
  static adaptReviewPlanForExecution(task: any): {
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
    // 优先采用已落库的 task.reviewMode（前端 entryModule 经 mapEntryModule 写入），
    // 避免 resolvePipelineSelector 把 CONSISTENCY 等模式重推导为 LIBRARY_REVIEW（主业缺陷：模式被吞）；
    // 仅当任务无 reviewMode 或值非法时才回退到 plan 推导（兼容旧数据）。
    const validModes = Object.keys(REVIEW_HANDLERS) as string[];
    const reviewMode = (task?.reviewMode && validModes.includes(task.reviewMode))
      ? task.reviewMode
      : TaskService.resolvePipelineSelector(plan);
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
    _sourceDowngraded?: boolean;
  }): { confidence: string; confidenceSource: string } {
    if (issue.ruleCode?.startsWith('STD_')) {
      return { confidence: 'STD_MATCH', confidenceSource: 'standard_ref' };
    }
    if (issue.ruleCode) {
      return { confidence: 'RULE_EXACT', confidenceSource: 'rule_engine' };
    }
    // P0-2 修复（OPT-016 接通）：validateSources 判为"来源全部未验证"的 issue，
    // 降级为 AI_INFERRED（落库 reviewStatus=PENDING_REVIEW 转人工复核），
    // 防止 LLM 编造来源仍伪装 AI_WITH_SOURCES → CONFIRMED。
    if ((issue as any)._sourceDowngraded) {
      return { confidence: 'AI_INFERRED', confidenceSource: 'ai_unverified_sources' };
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
    if (!originalText || !extractedText) return undefined;
    return LlmService.findTextPosition(extractedText, originalText) ?? undefined;
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
    _userId: string,
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
    const { acquired, error } = await withLock(
      `review:task:${taskId}`,
      async () => { await ReviewService._processTaskImpl(taskId); },
      300, // 5 分钟超时（长任务）
      true, // 自动续期
    );

    if (!acquired) {
      if (error) {
        // 锁服务故障 ≠ 并发冲突：此处静默返回会让任务永久卡 PROCESSING（Bull job 却记 completed）。
        // 显式置 FAILED，让用户与运维可感知、可重试（修复 P1：Redis 故障任务假死）。
        console.error(`[Review] task ${taskId} 获取分布式锁失败（Redis 异常），显式置为 FAILED`, error);
        try {
          await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
          WebSocketService.emitTaskProgress(taskId, {
            type: 'error',
            step: '锁服务异常',
            progress: 0,
            message: '系统锁服务暂时不可用（Redis 异常），任务未执行，请稍后重试。',
            timestamp: Date.now(),
          });
        } catch (markErr) {
          console.error(`[Review] task ${taskId} 置 FAILED 失败:`, markErr);
        }
        return;
      }
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
      let reviewMode = executionPlan.reviewMode;
      const maxkbKnowledgeId = (task as any).maxkbKnowledgeId || undefined;
      const ruleLibraryId = executionPlan.ruleLibraryId;
      const directPrefixes = executionPlan.enabledPrefixes;

      // ===== ģʽ��Ϊ���ã��̶�ģʽֱ�Ӳ�������贴�� Pipeline�� =====
      const needsAI = reviewMode !== 'RULE_ONLY';
      const modeDisplayName = getModeDisplayName(reviewMode as ReviewModeType);
      // ����ʹ��ǰ�˴��������ǰ׺����������淶��/��������
      let ruleExecutionPlan = directPrefixes && directPrefixes.length > 0
        ? { enabledPrefixes: directPrefixes, executableItems: [] as any[] }
        : null;
      if (!ruleExecutionPlan && ruleLibraryId) {
        ruleExecutionPlan = await RuleLibraryService.getExecutionPlan(ruleLibraryId).catch((): null => null);
        if (!ruleExecutionPlan) {
          console.warn('[Review] �����ִ�мƻ�����ʧ��, ID:', ruleLibraryId);
        }
      }

      const intraFileConsistency = !!executionPlan.intraFileConsistency;

      // ������֪ʶ�ӿ� ID
      let maxkbKnowledgeIds: string[] | undefined;
      if (executionPlan.maxkbKnowledgeIds.length > 0) {
        maxkbKnowledgeIds = executionPlan.maxkbKnowledgeIds;
      } else if (maxkbKnowledgeId) {
        maxkbKnowledgeIds = [maxkbKnowledgeId];
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
            // ===== DEC_REVIEW 专用：预加载审点（V3.2 单源）=====
      // 审点与文件无关（任务级共享），在 fileContexts 构建前一次性加载
      // V3.2 合并：审点统一从 rule_library_items 加载（唯一审查点载体）
      //   - 任务挂标准 → 经 rule_libraries.standardId 找到关联审点库
      //   - 任务直挂规则库 → 直接加载
      let decCheckpoints: PipelineContext['checkpoints'] = undefined;
      if (reviewMode === 'DEC_REVIEW' || reviewMode === 'LIBRARY_REVIEW') {
        const decStdIds = task.taskStandards.map((item: any) => item.standardId);
        const effectiveRuleLibId = executionPlan.ruleLibraryId || (task as any).ruleLibraryId;
        const sources: string[] = [];

        // 单源：标准关联审点库（rule_libraries.standardId）+ 直挂规则库，统一从 rule_library_items 加载
        const libraryIds = new Set<string>();
        if (decStdIds.length > 0) {
          try {
            const linkedLibs = await prisma.ruleLibrary.findMany({
              where: { standardId: { in: decStdIds } },
              select: { id: true, name: true },
            });
            linkedLibs.forEach((l: any) => libraryIds.add(l.id));
            if (linkedLibs.length > 0) sources.push(`标准关联审点库 ${linkedLibs.length} 个`);
          } catch (e) {
            console.warn('[Review] 标准→审点库关联查询失败:', e);
          }
        }
        if (effectiveRuleLibId) libraryIds.add(effectiveRuleLibId);

        if (libraryIds.size > 0) {
          try {
            const ruleItems = await prisma.ruleLibraryItem.findMany({
              where: { libraryId: { in: [...libraryIds] }, enabled: true, clauseText: { not: null } },
              select: {
                id: true, ruleCode: true, clauseText: true, checkPrompt: true,
                auditDimension: true, mandatory: true, severity: true,
                ruleName: true, description: true, clauseHash: true,
              },
            });
            // 适配成 ctx.checkpoints 格式（按 id 去重，避免标准关联库与直挂库重复）
            const adapted = ruleItems.map((item: any) => ({
              id: item.id,
              clauseCode: item.ruleCode || item.ruleName || null,
              clauseText: item.clauseText || item.description || '',
              mandatory: item.mandatory || (item.severity === 'error' ? 'mandatory' : 'guidance'),
              auditDimension: item.auditDimension || 'compliance',
              checkPrompt: item.checkPrompt || '',
            })).filter((c: any) => c.clauseText && c.clauseText.length >= 10);  // 过滤过短条目
            const seenIds = new Set<string>();
            const deduped = adapted.filter((c: any) => {
              if (c.id && seenIds.has(c.id)) return false;
              if (c.id) seenIds.add(c.id);
              return true;
            });
            if (deduped.length > 0) {
              decCheckpoints = [...(decCheckpoints || []), ...deduped];
              sources.push(`RuleLibraryItem ${deduped.length} 条（库 ${[...libraryIds].map((id) => id.slice(0, 8)).join(',')}…）`);
            }
          } catch (e) {
            console.warn('[Review] RuleLibraryItem 审点加载失败:', e);
          }
        }

        if (decCheckpoints && decCheckpoints.length > 0) {
          console.log(`[Review] DEC_REVIEW 预加载审点 ${decCheckpoints.length} 条：${sources.join(' + ')}`);
          if (reviewMode === 'LIBRARY_REVIEW') {
            reviewMode = 'DEC_REVIEW';
            console.log(`[Review] LIBRARY_REVIEW 自动升级为 DEC_REVIEW：双分支增强已启用`);
          }
        } else {
          // P1-7: 空库显式告警 — 用户必须能区分「真合规」与「没审到」
          const hints: string[] = [];
          if (decStdIds.length === 0 && !effectiveRuleLibId) {
            hints.push('任务未关联标准也未挂规则库');
          } else {
            if (decStdIds.length > 0) hints.push('标准未关联审点库或库内无审点');
            if (effectiveRuleLibId) hints.push('规则库无审点字段（clauseText 为空，请用审点模式 /parse-checkpoints-async 重新生成）');
          }
          const libEmptyMsg = hints.join('，');
          console.warn(`[Review] DEC_REVIEW: ${libEmptyMsg}`);
          // 通过 WebSocket 显式告警：本次审查未加载任何审点，返回「无问题」不代表真合规
          WebSocketService.emitTaskProgress(taskId, {
            type: 'lib_empty',
            step: '审点库为空',
            progress: 5,
            message: libEmptyMsg,
            phase: 'preload',
            timestamp: Date.now(),
          });
          // 落库到 stats.warnings，供任务完成后的详情页展示（轮询兜底时也能看到）
          try {
            const curStats = (task.stats as any) || {};
            const warnings = Array.isArray(curStats.warnings) ? [...curStats.warnings] : [];
            warnings.push(`审点库为空：${libEmptyMsg}`);
            await prisma.task.update({
              where: { id: taskId },
              data: { stats: { ...curStats, warnings } },
            });
          } catch (e) {
            console.warn('[Review] 空库告警落库失败（不影响主流程）:', e);
          }
        }
      }

      // ===== 方案A：任务级 preload 阶段标记（DEC_REVIEW 审点预加载；alwaysRun 每次执行保证审点新鲜） =====
      if (reviewMode === 'DEC_REVIEW') {
        await StageRunner.handle(taskId, undefined, reviewMode).runStage('preload', async () => {
          return (decCheckpoints || []).map(c => c.id);
        }, { alwaysRun: true }).catch((e: any) => console.warn('[Stage] preload 标记失败:', e.message));
      }

      // ===== 加载条文库条目（供 LIBRARY_REVIEW 语义路径使用） =====
      // 仅当未升级为 DEC_REVIEW（审点库为空/无审点字段）时才需要；
      // 已升级场景由 DEC 双分支消费 checkpoints，此处跳过避免重复查询。
      let semanticItems: PipelineContext['semanticItems'] = undefined;
      if (reviewMode === 'LIBRARY_REVIEW') {
        const semanticSpecId = executionPlan.ruleLibraryId || (task as any).ruleLibraryId;
        if (semanticSpecId) {
          try {
            const specItems = await prisma.ruleLibraryItem.findMany({
              where: { libraryId: semanticSpecId, enabled: true },
              select: { ruleCode: true, ruleName: true, category: true, description: true, severity: true },
            });
            if (specItems.length > 0) {
              semanticItems = specItems as any;
            }
          } catch (e) {
            console.warn('[Review] 加载条文库条目失败:', e);
          }
        }
      }
      // Task 14: 生成全链路 traceId，关联本次任务处理的所有 LLM 调用（Phase A 分片 + Phase C 比对等）
      const traceId = `${taskId}-${reviewMode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const fileContexts = task.files.map(file => {
        const absolutePath = resolveFilePath(file.filePath);

        const ctx: PipelineContext = {
          taskId,
          traceId,
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
          checkpoints: decCheckpoints,
          intraFileConsistency,
          userId: (task as any).creatorId,
          // 方案A：阶段状态机句柄（文件级；DEC 内部 7 细粒度阶段，其他模式 fast/ai）
          stageRunner: StageRunner.handle(taskId, file.id, reviewMode as string),
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

      // 获取阶段2的并发限制（从 basic_settings 读取，默认 3）
      const maxConcurrent = await getMaxConcurrentReviews();

      // P1-1（整改报告）：误报库任务级预加载移到 fast 阶段前，对所有模式生效——
      // 此前在 needsAI 分支内，规则引擎/标准引用/DWG 产出不消费误报库（标记规则类误报后下次照报）
      // P1-2：映射结构升级为 (归一化文本 → ruleCode 集合)，过滤按二元组匹配，不跨规则上下文误伤
      let fpLibraryMap: Map<string, Set<string | null>> | null = null;
      try {
        const allFps = await prisma.falsePositiveLibrary.findMany({ select: { originalText: true, ruleCode: true, normalizedText: true } });
        fpLibraryMap = new Map<string, Set<string | null>>();
        for (const fp of allFps) {
          const key = (fp as any).normalizedText || normalizeText(fp.originalText);
          if (!fpLibraryMap.has(key)) fpLibraryMap.set(key, new Set());
          fpLibraryMap.get(key)!.add((fp as any).ruleCode || null);
        }
        // 方案A：任务级 preload 阶段标记（非 DEC 模式；DEC 的 preload 在审点预加载段已标记）
        if (reviewMode !== 'DEC_REVIEW') {
          await StageRunner.handle(taskId, undefined, reviewMode as string).runStage('preload', async () => {
            return fpLibraryMap && fpLibraryMap.size > 0 ? [...fpLibraryMap.keys()].slice(0, 50) : [];
          }, { alwaysRun: true }).catch((e: any) => console.warn('[Stage] preload 标记失败:', e.message));
        }
        if (fpLibraryMap && fpLibraryMap.size > 0) {
          for (const { ctx } of fileContexts) {
            (ctx as any).fpLibraryMap = fpLibraryMap;
          }
        }
      } catch (e) {
        console.warn('[Review] preload false positive library failed, continue:', e);
        fpLibraryMap = null;
      }

      // P1-D: 流水线化 — 删除原 fastPhasePromises + Promise.all 硬同步点
      // 每文件阶段1完成立即进入阶段2（同一 worker 内顺序执行，不同文件并行）
      // 长尾 PDF 不再阻塞其他文件启动 AI 审查

      // ===== �������: �׶�1��� =====
      // ===== P1-D: pipeline - phase1+phase2 sequential in same worker =====
      // LLM config precheck (only when needsAI)
      if (needsAI) {
        try {
          const llmConfig = await LlmService.getLlmConfig();
          if (!llmConfig) {
            console.warn('[Review] LLM not configured, AI review cannot run');
            WebSocketService.emitTaskProgress(taskId, {
              type: 'llm_warning', step: 'AI warning', progress: 45,
              message: 'LLM not configured, AI review cannot run. Please configure LLM API in system settings.',
              timestamp: Date.now(),
            });
          }
        } catch (e) {
          console.warn('[Review] LLM config check error:', e);
        }
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start', step: 'AI review phase', progress: 45,
          message: `Start AI review (${fileContexts.length} files, user concurrency limit ${maxConcurrent})`,
          timestamp: Date.now(),
        });
      } else {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start', step: 'AI review phase', progress: 45,
          message: `${modeDisplayName} mode does not need AI review, finishing directly`,
          timestamp: Date.now(),
        });
      }

      // Pipeline: each file phase1 complete -> immediately enter phase2 (same worker sequential, different files parallel)
      const pipelineResults = await this.runUserLevelConcurrency(
        task.creatorId,
        fileContexts,
        maxConcurrent,
        async ({ file, ctx }, index) => {
          // Phase 1: fast review
          let fastResult;
          try {
            fastResult = await this.runFileFastPhase(taskId, file, ctx, index, totalFiles);
            // WS push fast_phase_complete (moved inside worker)
            WebSocketService.emitTaskProgress(taskId, {
              type: 'fast_phase_complete', step: 'fast review complete', progress: 40,
              message: `fast review complete: ${fastResult.ruleIssues.length} rule issues, ${fastResult.stdRefIssues.length} std ref issues`,
              fileName: file.fileName, phase: 'phase1',
              ruleCount: fastResult.ruleIssues.length, stdRefCount: fastResult.stdRefIssues.length,
              timestamp: Date.now(),
            });
          } catch (error) {
            // Phase 1 failed: log error + mark file FAILED + return (skip phase 2)
            await this.createErrorDetail(taskId, file.id, file.fileName, error);
            await prisma.taskFile.update({
              where: { id: file.id }, data: { status: 'FAILED' },
            }).catch((e) => { console.warn(`[Review] update file status failed (${file.id}):`, e); });
            return { error, fileId: file.id, fileName: file.fileName, aiIssues: [] as any[], ruleIssues: [] as any[], stdRefIssues: [] as any[] };
          }

          // Phase 1 success, check if phase 2 needed
          if (!needsAI) {
            await prisma.taskFile.update({
              where: { id: file.id }, data: { status: 'COMPLETED' },
            }).catch((e) => { console.warn(`[Review] update file status failed (${file.id}):`, e); });
            return { ...fastResult, fileId: file.id, fileName: file.fileName };
          }

          // Phase 2: AI review (same worker sequential, does not wait for other files phase 1)
          try {
            const slowRes = await this.runFileSlowPhase(taskId, file, ctx, index, totalFiles);
            return { ...slowRes, fileId: file.id, fileName: file.fileName };
          } catch (error) {
            await this.createErrorDetail(taskId, file.id, file.fileName, error);
            return { error, fileId: file.id, fileName: file.fileName, aiIssues: [] as any[] };
          }
        },
      );

      // pipelineResults is the new slowPhaseResults
      const slowPhaseResults = pipelineResults;

      // Derive phase1 stats from pipeline results (for downstream task summary at L822+).
      // Phase 1 failed results carry both `error` and `ruleIssues` placeholder (see worker return above);
      // phase 2 failed results carry `error` without `ruleIssues`.
      let fastFailedCount = 0;
      for (const r of pipelineResults) {
        if ('error' in r && 'ruleIssues' in r) {
          fastFailedCount++;
        }
      }
      const fastSuccessCount = pipelineResults.length - fastFailedCount;

      // ===== intra-file consistency check (started after pipeline complete, because it depends on extractedText being fully populated) =====
      let intraConsistencyPromise: Promise<Array<{ fileId: string; issueCount: number }>> | null = null;
      if (intraFileConsistency) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'intra_consistency_check', step: 'intra-file consistency check', progress: 42,
          message: 'running intra-file consistency check...', timestamp: Date.now(),
        });
        const filesWithText = fileContexts.filter(({ ctx }) => ctx.extractedText && ctx.extractedText.trim().length > 0);
        // CONSISTENCY 容差口径统一：文件内检查复用模式配置的 paramTolerance（含 byUnit），
        // 与跨文件检查一致；读取失败时回退 undefined（intra 内部恒用默认 1%）
        let intraParamTolerance: any = undefined;
        try {
          const { getModeCapabilitiesConfig } = await import('../review-pipeline/mode-config.service');
          intraParamTolerance = (await getModeCapabilitiesConfig()).CONSISTENCY?.paramTolerance;
        } catch (e) {
          console.warn('[Review] 读取 paramTolerance 配置失败，文件内检查使用默认 1% 容差:', e);
        }
        intraConsistencyPromise = Promise.all(
          filesWithText.map(async ({ file, ctx }) => {
            try {
              const issueCount = await IntraFileConsistencyService.check(
                taskId, file.id, file.fileName, ctx.extractedText, intraParamTolerance,
              );
              return { fileId: file.id, issueCount };
            } catch (e) {
              console.warn(`[Review] ${file.fileName} intra-file consistency check failed:`, e);
              return { fileId: file.id, issueCount: 0 };
            }
          }),
        );
      }

      // ===== �������: �׶�2��� =====
      let slowSuccessCount = 0;
      let slowFailedCount = 0;
      const enginesUsed = new Set<string>(); // �ռ������ļ�ʵ��ʹ�õ� AI ����
      const degradedReasons: string[] = []; // P0-4: 收集各文件降级原因（落库 task.degradedReason）
      for (const result of slowPhaseResults) {
        const isError = 'error' in result;
        if (isError) {
          slowFailedCount++;
          console.error(`[Review] �ļ� ${result.fileName} �׶�2ʧ��:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          slowSuccessCount++;
          // 类型守卫：区分阶段1（ruleIssues）与阶段2（aiIssues/usedEngine）结果
          const usedEngine = 'usedEngine' in result ? result.usedEngine : undefined;
          const aiIssues = 'aiIssues' in result ? (result.aiIssues || []) : [];
          if (usedEngine) enginesUsed.add(usedEngine);
          // OPT-027: RAG 降级时发送 WebSocket 告警事件
          if ((result as any).degraded) {
            const reason = (result as any).degradedReason || 'RAG 不可用，已切换为 LLM 直审';
            degradedReasons.push(`${result.fileName}: ${reason}`);
            WebSocketService.emitTaskProgress(taskId, {
              type: 'rag_degraded',
              step: 'AI审查降级',
              progress: 80,
              message: reason,
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
            message: `AI审查完成: ${aiIssues.length} 个问题 (${usedEngine || 'unknown'})`,
            fileName: result.fileName,
            phase: 'phase2',
            aiCount: aiIssues.length,
            usedEngine: usedEngine,
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
      // Task 15: 校验 mode-config 的 crossFile 能力，避免用户请求与模式能力不一致
      let crossFileNeeded = executionPlan.crossFileConsistency && totalFiles >= 2;
      if (crossFileNeeded) {
        try {
          const modeCaps = await getModeCapabilitiesConfig();
          const modeCfg = (modeCaps as Record<string, { crossFile?: boolean }>)[reviewMode as string];
          if (modeCfg && modeCfg.crossFile === false) {
            console.warn(
              `[Review] Task ${taskId}: crossFileConsistency requested but mode "${reviewMode}" has crossFile=false in mode-config, skipping cross-file check`,
            );
            crossFileNeeded = false;
          }
        } catch (e) {
          console.warn(`[Review] Task ${taskId}: load mode-config failed, fallback to original crossFileNeeded decision:`, e);
        }
      }
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

        // OPT-024: 章节级语义聚合（LLM 提取系统描述 + 语义比对）
        try {
          WebSocketService.emitTaskProgress(taskId, {
            type: 'semantic_aggregation',
            step: '语义聚合检查',
            progress: 97,
            message: '正在执行章节级语义聚合...',
            timestamp: Date.now(),
          });
          const semanticIssueCount = await SectionAggregationService.check(taskId, task.files);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'semantic_aggregation_done',
            step: '语义聚合完成',
            progress: 98,
            message: `发现 ${semanticIssueCount} 个语义不一致`,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error(`[Review] 章节级语义聚合失败: ${taskId}`, error);
        }
      }

      // ===== ��������״̬ =====
      // AI ģʽ���׶�1ʧ�� + �׶�2ʧ�� = ��ʧ����
      // �� AI ģʽ��ֱ��ʹ�ý׶�1����
      const phase1FailedCount = fastFailedCount;
      const successCount = needsAI ? slowSuccessCount : fastSuccessCount;
      const failedCount = needsAI ? (phase1FailedCount + slowFailedCount) : fastFailedCount;
      // 方案A：阶段状态机 — 存在 FAILED 阶段记录（DEC 细粒度阶段 / ai 阶段失败）→ 任务 FAILED（修假完成）
      const hasStageFailed = await StageRunner.hasFailedStage(taskId);
      const newStatus = (hasStageFailed || failedCount >= totalFiles) ? 'FAILED' : 'COMPLETED';

      // �־û�ʵ��ʹ�õ� AI ������Ϣ�������¼
      const primaryEngine = enginesUsed.size > 0 ? Array.from(enginesUsed).join('+') : (needsAI ? 'none' : undefined);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: newStatus,
          ...(primaryEngine ? { aiEngineUsed: primaryEngine } : {}),
          // P0-4: 降级原因落库（结果页/任务列表可追溯"本次审查哪些环节没审到"，刷新后不丢失）
          ...(degradedReasons.length > 0 ? { degradedReason: degradedReasons.join('; ') } : {}),
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

        // ===== 学习闭环：审查完成后写入用户偏好到长期记忆 =====
        // 迁移自 OpenSpecAgentService.saveMemory（2026-08-03，统一到 Node MemoryService/agent_memories 表）
        try {
          const { MemoryService } = await import('../agent/memory/memory.service');
          const fileNames = task.files.map((f: any) => f.fileName).join('、').slice(0, 100);
          await MemoryService.saveMemory({
            userId: task.creatorId,
            key: `review_behavior:${task.id}`,
            value: `用户完成审查任务「${task.title}」，涉及文件：${fileNames}；审查模式：${task.reviewMode}；成功 ${successCount} 个文件，失败 ${failedCount} 个。`,
            type: 'preference',
            scope: 'global',
            confidence: 0.7,
            source: 'review_behavior',
          });
        } catch (e) {
          console.warn('[Memory] 学习闭环写入失败（不影响主流程）:', (e as Error).message);
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
          // P2-E: 同步写回 ctx.parseResult，避免阶段2 extractPdfPages 二次解析
          if (parseResultFromPreExtract && !ctx.parseResult) {
            ctx.parseResult = parseResultFromPreExtract;
          }
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

    // 阶段2

    // ��������
    let ruleIssues: any[] = [];
    if (ctx.reviewMode === 'RULE_ONLY' || ctx.reviewMode === 'CONSISTENCY') {
      const rulesEnabled = ctx.executionOverrides?.stages?.rules !== false;
      if (rulesEnabled) {
        // ����ʹ�� rulePlan �е�ǰ׺���ˣ�RULE_ONLY ģʽ�û�ѡ���Ĺ���ǰ׺��
        const prefixes = ctx.rulePlan?.enabledPrefixes?.length
          ? ctx.rulePlan.enabledPrefixes
          : [];
        // CONSISTENCY 模式：无前缀时不跑规则（避免跑全部规则产生噪音）；
        // RULE_ONLY 模式：无前缀则跑全部规则（保留原行为）
        if (ctx.reviewMode === 'RULE_ONLY' || prefixes.length > 0) {
          const baseIssues = await runAllRules(
            {
              fileName: ctx.fileName, filePath: ctx.filePath, fileType: ctx.fileType,
              extractedText: ctx.extractedText, pdfPages: ctx.pdfPages,
              reviewMode: ctx.reviewMode, parseResult: ctx.parseResult,
            },
            prefixes.length > 0 ? { enabledRulePrefixes: new Set(prefixes) } : undefined,
          );
          ruleIssues = baseIssues;
        }
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

    // P1-1/P1-2（整改报告）：规则/标准引用产出同样消费误报库（此前仅 AI 路径过滤，
    // 用户标记规则类误报后下次审查原样重现）；按 (归一化文本, ruleCode) 二元组匹配
    let ruleIssuesToWrite = fastResult.ruleIssues;
    let stdRefIssuesToWrite = fastResult.stdRefIssues;
    let fpFilteredFastCount = 0;
    if (ctx.fpLibraryMap && ctx.fpLibraryMap.size > 0) {
      const filterByFp = (issues: any[]) => issues.filter((issue: any) => {
        const hit = isFpRuleHit(ctx.fpLibraryMap, issue.originalText, issue.ruleCode, issue.severity);
        if (hit) fpFilteredFastCount++;
        return !hit;
      });
      ruleIssuesToWrite = filterByFp(ruleIssuesToWrite);
      stdRefIssuesToWrite = filterByFp(stdRefIssuesToWrite);
      if (fpFilteredFastCount > 0) {
        console.log(`[Review] ${file.fileName} 规则/标准引用产出被误报库过滤 ${fpFilteredFastCount} 条`);
      }
    }

    if (ruleIssuesToWrite.length > 0) {
      const ruleData = ruleIssuesToWrite.map((issue) => {
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

    if (stdRefIssuesToWrite.length > 0) {
      const stdRefData = stdRefIssuesToWrite.map((issue) => {
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

    // ===== 方案A：fast 阶段标记（幂等，每次执行；规则+标准引用结果已写库，skipDuplicates 保护） =====
    try {
      await (ctx as any).stageRunner?.runStage('fast', async () => {
        return allFastIssues as any[];
      }, { alwaysRun: true });
    } catch (e: any) {
      console.warn(`[Stage] ${taskId} fast 阶段标记失败（不影响主流程）:`, e.message);
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
            ? 'DWG 图纸未能提取到文本内容（前端 WASM 解析未成功返回图签文本，图纸可能不含文字层），无法执行规则与标准引用检查，请人工检查。'
            : '文件内容无法提取（可能为扫描件或图片型 PDF，且 OCR 识别未能成功提取文字），无法执行规则与标准引用检查，请人工检查。',
        },
      }).catch((e) => { console.warn(`[Review] ���ı�����д��ʧ��:`, e); });
    } else if (fastResult.textLength > 0 && allFastIssues.length === 0) {
      await this.createNoResultDetail(
        taskId,
        file.id,
        file.fileName,
        '规则引擎与标准引用检查均未发现问题。该文件看起来完全合规；同时提示：当前启用的规则集/标准库可能未覆盖该文件的内容类型，建议结合 AI 审查结果综合判断。',
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
  ): Promise<{ aiIssues: any[]; usedEngine?: string; skippedNoText?: boolean; degraded?: boolean; degradedReason?: string }> {
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);

    // P1-3：加载本文件已落库的确定性产出（规则引擎/标准引用）原文集合，
    // AI 产出落库前与其归一化碰撞去重——"规则优先"语义从仅 TYPO/CONTRACT 两个 handler
    // 扩展到所有模式（此前 CONSISTENCY 等模式规则与 AI 对同一缺陷各报一条）
    let ruleNormSet: Set<string> | null = null;
    try {
      const ruleDetails = await prisma.taskDetail.findMany({
        where: {
          taskId,
          fileId: file.id,
          reviewSource: { in: ['RULE_ENGINE', 'RULE_LIBRARY', 'STANDARD_REF'] },
        },
        select: { originalText: true },
      });
      ruleNormSet = new Set<string>();
      for (const d of ruleDetails) {
        const t = (d.originalText || '').trim();
        if (t) ruleNormSet.add(normalizeText(t));
      }
    } catch (e) {
      console.warn('[Review] 加载已落库规则结果失败（跳过跨源去重）:', e);
      ruleNormSet = null;
    }

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
    // P0 修复（漏报）：跟踪各分片实际已落库的条目键（taskId|fileId|issueType|ruleCode|originalText），
    // 阶段末尾兜底写入改为"增量落库"——handler 层合并产出中未被分片覆盖的部分补写入库。
    // 旧实现用 anyChunkWritten 布尔门控：只要有一个分片写过，handler 层额外产出
    // （TYPO 规则字典问题、OCR_DEGRADED、分片失败提示等）全部静默丢失。
    const writtenDetailKeys = new Set<string>();

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
        // P0-1/P1-2: 过滤误报库中的 issue（(归一化文本, ruleCode) 二元组），减少 LLM 幻觉风险
        let filteredByFp = 0;
        if (ctx.fpLibraryMap && ctx.fpLibraryMap.size > 0) {
          const beforeCount = issues.length;
          issues = issues.filter((issue: any) => !isFpRuleHit(ctx.fpLibraryMap, issue.originalText, issue.ruleCode, issue.severity));
          filteredByFp = beforeCount - issues.length;
          if (filteredByFp > 0) {
            console.log(`[Review] 分片 ${chunkIndex} 过滤 ${filteredByFp} 条误报 (${file.fileName})`);
          }
        }

        // P1-3: 与已落库规则/标准引用结果碰撞去重（规则优先，跨模式生效）
        if (ruleNormSet && ruleNormSet.size > 0) {
          const beforeCount = issues.length;
          issues = issues.filter((issue: any) => !collidesWithRule(normalizeText(issue.originalText || ''), ruleNormSet!));
          if (issues.length < beforeCount) {
            console.log(`[Review] 分片 ${chunkIndex} 与规则结果去重 ${beforeCount - issues.length} 条 (${file.fileName})`);
          }
        }

        let quoteNotFoundCount = 0;
        const aiData = issues.map((issue) => {
          // OPT-029: originalText fidelity check
          // P0 修复（漏报）：引用原文未命中不再一律按幻觉静默丢弃——
          // 完整性/缺失类发现的 originalText 天然不在正文中，PDF 提取质量差时也会
          // 大面积失配；一律丢弃会造成系统性漏报。改为保留 + 强制转人工复核。
          let quoteNotFound = false;
          if (issue.originalText && ctx.extractedText) {
            const fidelity = validateOriginalText(issue.originalText, ctx.extractedText, { enableFuzzy: ctx.extractedText.length < 100000 });
            if (fidelity.confidence === 'not_found') {
              quoteNotFound = true;
              quoteNotFoundCount++;
            } else if (fidelity.confidence === 'fuzzy' && fidelity.correctedText) {
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
            // 人工复核状态：AI_INFERRED 纯推断、合同 HIGH 风险、判标 LOW 置信度（疑似误报但不丢弃）均需人工复核
            riskLevel: issue.riskLevel || null,
            judgeConfidence: issue.confidence || null,
            judgeReason: issue.confidenceReason || null,
            reviewStatus: ((confidence) => {
              return (quoteNotFound || confidence === 'AI_INFERRED' || issue.riskLevel === 'HIGH' || issue.confidence === 'LOW')
                ? 'PENDING_REVIEW'
                : 'CONFIRMED';
            })(this.getConfidence(issue).confidence),
            clauseType: issue.clauseType || null,
            recommendation: issue.recommendation || null,
            // DEC-1 修复：透传 handler 层的 reviewSource 标记（DEC 的 COMPLETENESS/COMPLIANCE/RULE_FALLBACK），
            // 无标记时保持 'AI'。此前写死 'AI' 导致前端 DEC 双清单按 reviewSource 过滤永远为空。
            reviewSource: (issue as any).reviewSource || 'AI',
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        if (quoteNotFoundCount > 0) {
          console.warn(`[Review] 分片 ${chunkIndex}: ${quoteNotFoundCount} 条 AI 发现的引用原文未能在文档中定位（已保留并转人工复核，不再按幻觉丢弃） (${file.fileName})`);
        }

        // ��ǿ�棺���񱣻� + ���Ի��� + ʧ��ʱ�ӳ�����
        let dbWriteSuccess = false;
        const strippedData = aiData.map((item) => this.stripDbUnsupportedFields(item));
        // 中危修复：DB 唯一约束 [taskId,fileId,issueType,ruleCode,originalText] 对 fileId=NULL
        // 失效（Postgres 中 NULL != NULL），代码层按完整键去重兜底，双保险
        const seenDetailKeys = new Set<string>();
        const dedupedData = strippedData.filter((d: any) => {
          const key = [d.taskId, d.fileId ?? '', d.issueType, d.ruleCode ?? '', d.originalText ?? ''].join('|');
          if (seenDetailKeys.has(key)) return false;
          seenDetailKeys.add(key);
          return true;
        });
        try {
          await prisma.$transaction(async (tx) => {
            await tx.taskDetail.createMany({
              data: dedupedData,
              skipDuplicates: true,
            });
          });
          dbWriteSuccess = true;
          for (const d of dedupedData) {
            writtenDetailKeys.add([d.taskId, d.fileId ?? '', d.issueType, d.ruleCode ?? '', d.originalText ?? ''].join('|'));
          }
        } catch (txError) {
          console.error(`[Review] ? ��Ƭ ${chunkIndex}/${totalChunks} ����д��ʧ��: ${file.fileName}`, txError);

          // ����һ��
          try {
            await prisma.taskDetail.createMany({
              data: dedupedData,
              skipDuplicates: true,
            });
            dbWriteSuccess = true;
            for (const d of dedupedData) {
              writtenDetailKeys.add([d.taskId, d.fileId ?? '', d.issueType, d.ruleCode ?? '', d.originalText ?? ''].join('|'));
            }
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
    const stageRunner = (ctx as any).stageRunner as StageRunnerHandle | undefined;
    try {
      if (stageRunner && ctx.reviewMode !== 'DEC_REVIEW') {
        // 方案A：ai 阶段（断点续跑：已有 DONE 记录 → 跳过 handler，直接复用裁剪产物）
        const issues = await stageRunner.runStage('ai', async (resumed) => {
          if (resumed) return resumed;
          const r = await handler(ctx);
          return r.aiIssues || [];
        });
        aiResult = {
          aiIssues: issues || [],
          usedEngine: 'resumed',
          degraded: false,
        };
      } else {
        // DEC_REVIEW：内部 7 细粒度阶段由 DecReviewService 管理（替代 ai 单节点）
        aiResult = await handler(ctx);
      }
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
    // P0 修复（漏报）：不再用 !anyChunkWritten 整块门控兜底写入——只要有一个分片
    // 成功写过，handler 层合并产出中未被分片覆盖的条目（如 TYPO 规则字典问题、
    // OCR_DEGRADED、分片失败提示）此前会被整体丢弃。改为始终进入，靠
    // writtenDetailKeys 增量过滤，只补写尚未落库的部分。
    if (slowResult.aiIssues.length > 0) {
      try {
        // P0-1/P1-2: 过滤误报库中的 issue（兜底路径，二元组匹配）
        if (ctx.fpLibraryMap && ctx.fpLibraryMap.size > 0) {
          const beforeCount = slowResult.aiIssues.length;
          slowResult.aiIssues = slowResult.aiIssues.filter(
            (issue: any) => !isFpRuleHit(ctx.fpLibraryMap, issue.originalText, issue.ruleCode, issue.severity)
          );
          const fallbackFiltered = beforeCount - slowResult.aiIssues.length;
          if (fallbackFiltered > 0) {
            console.log(`[Review] 兜底路径过滤 ${fallbackFiltered} 条误报 (${file.fileName})`);
          }
        }
        // P1-3: 兜底路径同样与已落库规则结果碰撞去重
        if (ruleNormSet && ruleNormSet.size > 0) {
          const beforeCount = slowResult.aiIssues.length;
          slowResult.aiIssues = slowResult.aiIssues.filter(
            (issue: any) => !collidesWithRule(normalizeText(issue.originalText || ''), ruleNormSet!)
          );
          if (slowResult.aiIssues.length < beforeCount) {
            console.log(`[Review] 兜底路径与规则结果去重 ${beforeCount - slowResult.aiIssues.length} 条 (${file.fileName})`);
          }
        }

        console.warn(`[Review] ����д��: ${slowResult.aiIssues.length} �� (${file.fileName})`);
        let quoteNotFoundCount = 0;
        const aiData = slowResult.aiIssues.map((issue) => {
          // OPT-029: originalText fidelity check (fallback path)
          // P0 修复（漏报）：与分片路径同口径——not_found 保留并转人工复核，不再静默丢弃
          let quoteNotFound = false;
          if (issue.originalText && ctx.extractedText) {
            const fidelity = validateOriginalText(issue.originalText, ctx.extractedText, { enableFuzzy: ctx.extractedText.length < 100000 });
            if (fidelity.confidence === 'not_found') {
              quoteNotFound = true;
              quoteNotFoundCount++;
            } else if (fidelity.confidence === 'fuzzy' && fidelity.correctedText) {
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
            riskLevel: issue.riskLevel || null,
            // 判标层字段（P1-6）：兜底路径与分片路径保持一致——LOW 置信度/AI 纯推断/HIGH 风险转人工复核
            judgeConfidence: issue.confidence || null,
            judgeReason: issue.confidenceReason || null,
            reviewStatus: ((confidence) => {
              return (quoteNotFound || confidence === 'AI_INFERRED' || issue.riskLevel === 'HIGH' || issue.confidence === 'LOW')
                ? 'PENDING_REVIEW'
                : 'CONFIRMED';
            })(this.getConfidence(issue).confidence),
            clauseType: issue.clauseType || null,
            recommendation: issue.recommendation || null,
            // DEC-1 修复：透传 handler 层 reviewSource 标记（DEC 的 COMPLETENESS/COMPLIANCE/RULE_FALLBACK），无标记保持 'AI'
            reviewSource: (issue as any).reviewSource || 'AI',
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        if (quoteNotFoundCount > 0) {
          console.warn(`[Review] 兜底路径: ${quoteNotFoundCount} 条 AI 发现的引用原文未能在文档中定位（已保留并转人工复核，不再按幻觉丢弃） (${file.fileName})`);
        }
        // 增量落库：过滤已随分片写库的条目（键口径与分片路径一致），避免重复
        const strippedFallbackData = aiData.map((item) => this.stripDbUnsupportedFields(item)) as any[];
        const pendingFallbackData = strippedFallbackData.filter((d: any) => {
          const key = [d.taskId, d.fileId ?? '', d.issueType, d.ruleCode ?? '', d.originalText ?? ''].join('|');
          return !writtenDetailKeys.has(key);
        });
        if (pendingFallbackData.length > 0) {
          await prisma.taskDetail.createMany({ data: pendingFallbackData });
        }
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


    return {
      aiIssues: slowResult.aiIssues,
      usedEngine: slowResult.usedEngine,
      skippedNoText,
      // P0-4: 透传降级标记（此前缺失导致任务级 degraded 收集/WS 告警是死代码）
      degraded: slowResult.degraded,
      degradedReason: slowResult.degradedReason,
    };
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

}

