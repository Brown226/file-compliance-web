/**
 * Agent 审查结果摘要服务 — 对 ReviewIssue[] 做统计汇总与 LLM 增强摘要
 *
 * 功能：
 * 1. computeStats(issues) — 纯统计计算（无 LLM 调用）
 * 2. generate(issues, level, context?) — 按级别生成摘要，支持 LLM 增强，
 *    LLM 失败时降级为纯统计
 *
 * 依赖：
 * - LlmService.chat（LLM 调用，返回 Promise<string>）
 */

import { LlmService } from '../../llm/llm.service';
import type { ReviewIssue } from '../../llm/llm.service';

// ─── 接口定义 ────────────────────────────────────────────────────────────────

/** 摘要级别 */
export type SummaryLevel = 'quick' | 'detailed' | 'executive';

/** 统计结果 */
export interface IssueStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  highSeverity: number;
}

/** 摘要结果 */
export interface SummaryResult {
  level: SummaryLevel;
  stats: IssueStats;
  /** LLM 生成的叙述性分析（仅 detailed/executive 级别且 LLM 调用成功时存在） */
  narrative?: string;
  generatedAt: string;
}

// ─── 服务实现 ────────────────────────────────────────────────────────────────

export class SummaryService {
  /**
   * 纯统计计算 — 对 ReviewIssue[] 做分组计数，无 LLM 调用
   *
   * @param issues 审查问题列表
   * @returns IssueStats
   */
  static computeStats(issues: ReviewIssue[]): IssueStats {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let highSeverity = 0;

    for (const issue of issues) {
      // 按 issueType 分组
      const type = issue.issueType || 'UNKNOWN';
      byType[type] = (byType[type] || 0) + 1;

      // 按 severity 分组
      const severity = issue.severity || 'unset';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;

      // 高严重度：severity='error' 或 riskLevel='HIGH'
      if (issue.severity === 'error' || issue.riskLevel === 'HIGH') {
        highSeverity++;
      }
    }

    return {
      total: issues.length,
      byType,
      bySeverity,
      highSeverity,
    };
  }

  /**
   * 按级别生成摘要 — 支持 LLM 增强，失败时降级为纯统计
   *
   * 级别说明：
   * - quick：仅返回纯统计（无 LLM 调用）
   * - detailed：统计 + LLM 生成问题分类分析
   * - executive：统计 + LLM 生成面向管理层的总结叙述
   *
   * @param issues 审查问题列表
   * @param level 摘要级别
   * @param context 额外上下文（如文件名、审查目标等，可选）
   * @returns SummaryResult
   */
  static async generate(
    issues: ReviewIssue[],
    level: SummaryLevel,
    context?: string,
  ): Promise<SummaryResult> {
    const stats = SummaryService.computeStats(issues);
    const generatedAt = new Date().toISOString();

    // quick 级别：纯统计，不调 LLM
    if (level === 'quick') {
      return { level, stats, generatedAt };
    }

    // detailed / executive：尝试 LLM 增强
    try {
      const narrative = await SummaryService.callLlmForSummary(issues, stats, level, context);
      return { level, stats, narrative, generatedAt };
    } catch (e) {
      // LLM 失败降级为纯统计
      console.warn(
        `[Summary] LLM 摘要生成失败，降级为纯统计: level=${level}`,
        (e as Error)?.message,
      );
      return { level, stats, generatedAt };
    }
  }

  /**
   * 调用 LLM 生成摘要叙事
   */
  private static async callLlmForSummary(
    issues: ReviewIssue[],
    stats: IssueStats,
    level: 'detailed' | 'executive',
    context?: string,
  ): Promise<string> {
    // 构建统计摘要输入
    const typeSummary = Object.entries(stats.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `  - ${type}: ${count} 项`)
      .join('\n');

    const severitySummary = Object.entries(stats.bySeverity)
      .sort((a, b) => b[1] - a[1])
      .map(([sev, count]) => `  - ${sev}: ${count} 项`)
      .join('\n');

    // 取前 20 个问题作为样本（避免超长 prompt）
    const sampleIssues = issues.slice(0, 20);
    const sampleText = sampleIssues
      .map((iss, i) => {
        const sev = iss.severity || iss.riskLevel || 'N/A';
        return `  #${i + 1} [${iss.issueType}] severity=${sev} 原文="${(iss.originalText || '').slice(0, 80)}" 描述="${(iss.description || '').slice(0, 100)}"`;
      })
      .join('\n');
    const sampleNote = issues.length > 20 ? `\n  ...（仅展示前 20 项，共 ${issues.length} 项）` : '';

    // 根据级别选择 systemPrompt
    const systemPrompts: Record<string, string> = {
      detailed: `你是文件审查结果分析专家。请根据提供的统计数据与问题样本，生成一份结构化的审查结果分析报告。

报告要求：
1. 按问题类型分类分析（VIOLATION/TYPO/FORMAT 等），指出主要问题类型
2. 指出严重程度分布特征
3. 对 highSeverity 问题给出重点关注建议
4. 语言简洁专业，中文字数不超过 500 字
5. 不要输出 JSON，用自然语言段落`,
      executive: `你是面向管理层的审查结果汇报专家。请根据统计数据和问题样本，生成一份简洁的执行摘要。

报告要求：
1. 一句话概括审查结论（问题数量/严重程度/总体质量评估）
2. 指出最关键的高风险问题类型
3. 给出明确的改进建议或下一步行动
4. 面向管理层，语言精炼，中文字数不超过 300 字
5. 不要输出 JSON，用自然语言段落`,
    };

    const systemPrompt = systemPrompts[level];

    // 构建用户 prompt
    let userPrompt = `# 审查结果统计摘要\n\n## 问题总数\n${stats.total} 项\n\n`;
    userPrompt += `## 按类型分布\n${typeSummary}\n\n`;
    userPrompt += `## 按严重程度分布\n${severitySummary}\n\n`;
    userPrompt += `## 高严重度问题\n${stats.highSeverity} 项\n\n`;
    userPrompt += `## 问题样本\n${sampleText}${sampleNote}\n`;

    if (context) {
      userPrompt += `\n## 额外上下文\n${context}\n`;
    }

    const result = await LlmService.chat(userPrompt, {
      systemPrompt,
      temperature: 0.3,
      timeout: 30,
    });

    return result.trim();
  }
}
