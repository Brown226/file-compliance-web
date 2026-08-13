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
  static async runDecStrategy(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<DecReviewResult> {
    console.log(`[DecReview] 开始 DEC 双分支审查，审点数: ${ctx.checkpoints?.length || 0}`);

    // ===== 双分支并行 =====
    const [completenessResult, complianceResult] = await Promise.all([
      this.runCompletenessBranch(text, ctx, config),
      this.runComplianceBranch(text, ctx, config),
    ]);

    console.log(`[DecReview] 完整性: ${completenessResult.issues.length} 条，遵从性: ${complianceResult.issues.length} 条`);

    // ===== 合并结果 =====
    const allIssues: ReviewIssue[] = [
      ...completenessResult.issues.map(i => ({ ...i, reviewSource: 'COMPLETENESS' as any })),
      // DEC-1 修复：不覆盖已有的 RULE_FALLBACK 标记（runComplianceBranch 已打标），仅无标记时补 COMPLIANCE
      ...complianceResult.issues.map(i => ({ ...i, reviewSource: (i as any).reviewSource || 'COMPLIANCE' as any })),
    ];

    return {
      issues: allIssues,
      engine: 'dec-review',
      sources: [...(completenessResult.sources || []), ...(complianceResult.sources || [])],
    };
  }

  /**
   * 分支A：完整性审核（骨架级，5min）
   */
  private static async runCompletenessBranch(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; sources?: SourceReference[] }> {
    try {
      return await CompletenessReviewService.check(text, ctx, config);
    } catch (e) {
      console.error('[DecReview] 完整性审核失败:', e);
      return { issues: [] };
    }
  }

  /**
   * 分支B：遵从性审核（内容级，30min，3 分支并行 + 3 层交叉复核 + 规则兜底）
   */
  private static async runComplianceBranch(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; sources?: SourceReference[] }> {
    // ===== 第一层：3 分支并行 =====
    const complianceCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'compliance');
    const factCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'fact');
    const textCheckpoints = (ctx.checkpoints || []).filter(c => c.auditDimension === 'text');

    console.log(`[DecReview] 遵从性 3 分支: 合规${complianceCheckpoints.length}/事实${factCheckpoints.length}/文本${textCheckpoints.length}`);

    const [complianceIssues, factIssues, textIssues] = await Promise.all([
      this.runClauseCheck(text, ctx, complianceCheckpoints, config),
      this.runFactCheck(text, ctx, factCheckpoints, config),
      this.runTextStyleCheck(text, ctx, textCheckpoints, config),
    ]);

    let allComplianceIssues = [...complianceIssues, ...factIssues, ...textIssues];
    console.log(`[DecReview] 第一层 3 分支合计: ${allComplianceIssues.length} 条`);

    // ===== 第二层：3 层交叉复核 =====
    // ① 智能判标
    allComplianceIssues = await SmartJudgeService.judge(allComplianceIssues, ctx);
    // ② 图文复核（结构化先行：图纸标准引用/关键参数 vs 设计文本；视觉模型扩展点见 ImageTextCheckService）
    allComplianceIssues = await ImageTextCheckService.check(allComplianceIssues, ctx, text);
    // ③ 文本复核
    allComplianceIssues = await TextCrossCheckService.check(allComplianceIssues, ctx);

    console.log(`[DecReview] 第二层交叉复核后: ${allComplianceIssues.length} 条`);

    // ===== 第三层：规则兜底 =====
    const ruleIssues = await this.runRuleFallback(text, ctx, allComplianceIssues);
    console.log(`[DecReview] 第三层规则兜底: ${ruleIssues.length} 条`);

    return {
      issues: [...allComplianceIssues, ...ruleIssues.map(i => ({ ...i, reviewSource: 'RULE_FALLBACK' as any }))],
    };
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
  ): Promise<ReviewIssue[]> {
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
      console.error('[DecReview] 规则兜底执行失败，返回空:', e);
      return [];
    }
  }
}
