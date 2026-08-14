// backend/src/services/review/dec-review.service.ts
/**
 * DEC 规范审查策略 — 双分支并行 + 多层容错
 *
 * 架构：
 *   阶段0 预处理（已在 ctx 中：审点库 + 设计 chunks 预绑定）
 *     ↓
 *   阶段1 双分支并行
 *     ├─ 分支A：完整性审核（completeness-review.service，5min 级）
 *     └─ 分支B：遵从性审核（30min 级）
 *       ├─ 第一层：3 分支并行（分项合规 / 事实维度 / 文本表述）
 *       ├─ 第二层：3 层交叉复核（智能判标 / 图文 / 文本）
 *       └─ 第三层：规则兜底
 *     ↓
 *   合并结果，用 reviewSource 区分完整性/遵从性/交叉复核
 *
 * 适配说明（vs 计划文档）：
 * - StandardClauseCheckService.checkClausesWithAudit → checkClauses（实际方法名）
 * - StandardClause 字段名：code/title/content（不是 clauseCode/clauseTitle/clauseContent）
 */

import { PipelineContext, PipelineReviewConfig } from '../review-pipeline/types';
import { ReviewIssue, SourceReference } from '../llm/llm.service';
import { StageRunnerHandle } from './stage-runner.service';
import { CompletenessReviewService } from './completeness-review.service';
import { FactCheckService } from './fact-check.service';
import { TextStyleCheckService } from './text-style-check.service';
import { StandardClauseCheckService } from '../standard/standard-clause-check.service';
import { SmartJudgeService } from './cross-review/smart-judge.service';
import { ImageTextCheckService } from './cross-review/image-text-check.service';
import { TextCrossCheckService } from './cross-review/text-cross-check.service';
import { runAllRules } from '../rules';

export interface DecReviewResult {
  issues: ReviewIssue[];
  engine: string;
  sources?: SourceReference[];
}

export class DecReviewService {
  /**
   * DEC 双分支审查编排（方案A：7 阶段状态机）
   *
   * 阶段：completeness → compliance（3 分支并行）→ smart_judge → image_text → text_cross
   *       → rule_fallback（SKIPPED 例外）→ merge
   * 阶段记录开关：ctx.stageRunner 注入时启用（生产路径，review.service 注入）；
   * 未注入时纯执行不落库（默认 no-op，兼容现有测试）。
   */
  static async runDecStrategy(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<DecReviewResult> {
    const runner = (ctx as any).stageRunner as StageRunnerHandle | undefined;
    const stage = <T extends ReviewIssue[] | null | undefined>(
      key: string,
      fn: (resumed?: ReviewIssue[]) => Promise<T>,
      opts?: { allowSkip?: boolean },
    ): Promise<T> => {
      if (!runner) return fn() as Promise<T>;
      return runner.runStage(key, fn, opts);
    };

    console.log(`[DecReview] 开始 DEC 双分支审查，审点数: ${ctx.checkpoints?.length || 0}`);

    // ===== 阶段 1：完整性分支（骨架级） =====
    let completenessSources: SourceReference[] | undefined;
    const completenessIssues = await stage('completeness', async () => {
      const r = await this.runCompletenessBranch(text, ctx, config);
      completenessSources = r.sources;
      return r.issues;
    });
    const completenessResult = { issues: completenessIssues, sources: completenessSources };

    // ===== 阶段 2：遵从性-第一层 3 分支并行（合规/事实/文本） =====
    const complianceIssues = await stage('compliance', async () => {
      return this.runComplianceFirstLayer(text, ctx, config);
    });
    console.log(`[DecReview] 第一层 3 分支合计: ${complianceIssues.length} 条`);

    // ===== 阶段 3：智能判标（第二层 ①） =====
    let allComplianceIssues = await stage('smart_judge', async (resumed) => {
      const base = resumed || complianceIssues;
      return SmartJudgeService.judge(base, ctx);
    });

    // ===== 阶段 4：图文复核（第二层 ②，无图纸零噪音） =====
    allComplianceIssues = await stage('image_text', async (resumed) => {
      const base = resumed || allComplianceIssues;
      return ImageTextCheckService.check(base, ctx, text);
    });

    // ===== 阶段 5：文本交叉复核（第二层 ③） =====
    allComplianceIssues = await stage('text_cross', async (resumed) => {
      const base = resumed || allComplianceIssues;
      return TextCrossCheckService.check(base, ctx);
    });

    console.log(`[DecReview] 第二层交叉复核后: ${allComplianceIssues.length} 条`);

    // ===== 阶段 6：规则兜底（第三层；失败/无产出 → SKIPPED，不阻塞主流程） =====
    const ruleIssues = await stage('rule_fallback', async (resumed) => {
      const base = resumed || allComplianceIssues;
      const issues = await this.runRuleFallback(text, ctx, base);
      return issues;
    }, { allowSkip: true });
    console.log(`[DecReview] 第三层规则兜底: ${(ruleIssues || []).length} 条`);

    // ===== 阶段 7：合并（reviewSource 标记） =====
    const mergedIssues = await stage('merge', async () => {
      const merged: ReviewIssue[] = [
        ...(completenessResult?.issues || []).map(i => ({ ...i, reviewSource: 'COMPLETENESS' as any })),
        // DEC-1 修复：不覆盖已有的 RULE_FALLBACK 标记，仅无标记时补 COMPLIANCE
        ...allComplianceIssues.map(i => ({ ...i, reviewSource: (i as any).reviewSource || 'COMPLIANCE' as any })),
        ...(ruleIssues || []).map(i => ({ ...i, reviewSource: 'RULE_FALLBACK' as any })),
      ];
      return merged;
    });

    console.log(`[DecReview] 完整性: ${completenessResult?.issues?.length || 0} 条，遵从性: ${mergedIssues.length} 条`);

    return {
      issues: mergedIssues,
      engine: 'dec-review',
      sources: [...(completenessResult?.sources || [])],
    };
  }

  /**
   * 分支A：完整性审核（骨架级，5min）
   *
   * 失败语义：注入 stage runner（生产）时抛错 → 阶段 FAILED（修假完成）；
   * 未注入（单测/无状态场景）时返回空，保持兼容。
   */
  private static async runCompletenessBranch(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; sources?: SourceReference[] }> {
    const runner = (ctx as any).stageRunner as StageRunnerHandle | undefined;
    try {
      return await CompletenessReviewService.check(text, ctx, config);
    } catch (e) {
      if (runner) throw e;
      console.error('[DecReview] 完整性审核失败:', e);
      return { issues: [] };
    }
  }

  /**
   * 分支B 第一层：遵从性 3 分支并行（合规/事实/文本）
   */
  private static async runComplianceFirstLayer(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    const complianceCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'compliance');
    const factCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'fact');
    const textCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'text');

    console.log(`[DecReview] 遵从性 3 分支: 合规${complianceCheckpoints.length}/事实${factCheckpoints.length}/文本${textCheckpoints.length}`);

    const [complianceIssues, factIssues, textIssues] = await Promise.all([
      this.runClauseCheck(text, ctx, complianceCheckpoints, config),
      this.runFactCheck(text, ctx, factCheckpoints, config),
      this.runTextStyleCheck(text, ctx, textCheckpoints, config),
    ]);

    return [...complianceIssues, ...factIssues, ...textIssues];
  }

  /**
   * 分支B-1：分项合规校验（复用 StandardClauseCheckService）
   *
   * 适配：StandardClause 类型用 code/title/content（不是 clauseCode/clauseTitle/clauseContent）
   * 适配：方法名是 checkClauses（不是 checkClausesWithAudit）
   */
  private static async runClauseCheck(
    text: string,
    _ctx: PipelineContext,
    checkpoints: Array<{ id: string; clauseCode: string | null; clauseText: string; auditDimension: string; checkPrompt?: string | null }>,
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    if (checkpoints.length === 0) return [];
    // 适配 StandardClause 类型：id/code/title/content/category
    // DEC-2 修复：透传 checkPrompt（审点工程化字段），由 checkSingleClause 注入用户 prompt
    const clauses = checkpoints.map(c => ({
      id: c.id,
      code: c.clauseCode || c.id,
      title: c.clauseCode || '',
      content: c.clauseText,
      category: c.auditDimension,
      checkPrompt: c.checkPrompt || '',
    }));
    const { results } = await StandardClauseCheckService.checkClauses(clauses, text, {
      temperature: 0.1,
      timeout: config.llmTimeout || 60,
      concurrency: 3,
    });
    const issues: ReviewIssue[] = [];
    for (const result of results) {
      const issue = StandardClauseCheckService.toReviewIssue(result);
      if (issue) issues.push(issue);
    }
    return issues;
  }

  /**
   * 分支B-2：事实维度校验
   */
  private static async runFactCheck(
    text: string,
    ctx: PipelineContext,
    checkpoints: any[],
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    if (checkpoints.length === 0) return [];
    return FactCheckService.check(text, ctx, checkpoints, config);
  }

  /**
   * 分支B-3：文本表述校验
   */
  private static async runTextStyleCheck(
    text: string,
    ctx: PipelineContext,
    checkpoints: any[],
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    if (checkpoints.length === 0) return [];
    return TextStyleCheckService.check(text, ctx, checkpoints, config);
  }

  /**
   * 第三层：规则兜底 — 独立于大模型的工程规则，约束幻觉
   *
   * 执行 rules/index.ts 的 runAllRules，将 RuleIssue 转为 ReviewIssue，
   * 并过滤掉 AI 已发现的问题（originalText 去重）。
   */
  private static async runRuleFallback(
    text: string,
    ctx: PipelineContext,
    existingIssues: ReviewIssue[],
  ): Promise<ReviewIssue[] | null> {
    try {
      // 构建规则引擎需要的 FileContext
      const ruleIssues = await runAllRules({
        fileName: ctx.fileName,
        filePath: ctx.filePath,
        fileType: ctx.fileType,
        extractedText: text || ctx.extractedText,
        pdfPages: ctx.pdfPages,
        reviewMode: ctx.reviewMode,
        parseResult: ctx.parseResult ?? null,
      });

      // RuleIssue → ReviewIssue 转换
      const reviewIssues: ReviewIssue[] = ruleIssues.map(ri => ({
        issueType: ri.issueType,
        originalText: ri.originalText,
        suggestedText: ri.suggestedText,
        description: ri.description,
        ruleCode: ri.ruleCode,
        severity: ri.severity,
        cadHandleId: ri.cadHandleId,
      }));

      // 去重：过滤掉 AI 已发现的问题（originalText 相同）
      const existingTexts = new Set(
        existingIssues.map(i => (i.originalText || '').trim()).filter(Boolean),
      );
      const newIssues = reviewIssues.filter(i => {
        const t = (i.originalText || '').trim();
        return !t || !existingTexts.has(t);
      });

      console.log(`[DecReview] 规则兜底: 规则检出 ${ruleIssues.length} 条，去重后新增 ${newIssues.length} 条`);
      return newIssues;
    } catch (e) {
      // 返回 null 表示"执行失败"（stage runner 记 SKIPPED，不阻塞主流程）；调用方以空数组兜底
      console.error('[DecReview] 规则兜底执行失败，降级跳过:', e);
      return null;
    }
  }
}
