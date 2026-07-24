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
import { TextCrossCheckService } from './cross-review/text-cross-check.service';

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
      ...complianceResult.issues.map(i => ({ ...i, reviewSource: 'COMPLIANCE' as any })),
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
    // ② 图文复核：复用现有 MULTIMODAL，此处简化（如有图纸则触发）
    // ③ 文本复核
    allComplianceIssues = await TextCrossCheckService.check(allComplianceIssues, ctx);

    console.log(`[DecReview] 第二层交叉复核后: ${allComplianceIssues.length} 条`);

    // ===== 第三层：规则兜底 =====
    const ruleIssues = await this.runRuleFallback(text, ctx);
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
    checkpoints: Array<{ id: string; clauseCode: string | null; clauseText: string; auditDimension: string }>,
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    if (checkpoints.length === 0) return [];
    // 适配 StandardClause 类型：id/code/title/content/category
    const clauses = checkpoints.map(c => ({
      id: c.id,
      code: c.clauseCode || c.id,
      title: c.clauseCode || '',
      content: c.clauseText,
      category: c.auditDimension,
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
   * 第三层：规则兜底（从 rules/index.ts 抽取的 runRules）
   *
   * TODO: 阶段 2.5 实现——抽取 runRules 可复用函数
   * 当前返回空数组，不影响主流程。规则兜底的完整实现需要适配 rules/index.ts 的
   * runAllRules(ctx: FileContext) 签名（与 PipelineContext 不同）。
   */
  private static async runRuleFallback(_text: string, _ctx: PipelineContext): Promise<ReviewIssue[]> {
    return [];
  }
}
