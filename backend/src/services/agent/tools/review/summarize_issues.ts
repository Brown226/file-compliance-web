/**
 * summarize_issues 工具 — 汇总多步审查发现的问题
 *
 * 对 Agent 在多步工具调用中累积的 ReviewIssue[] 做聚合统计：
 * - 按 issueType 分组计数
 * - 统计高严重度问题数（severity='error' 或 riskLevel='HIGH'）
 *
 * format 选项：
 * - 'summary'（默认）：只返回统计数字，token 开销小
 * - 'detailed'：附带完整 issues 列表，便于后续 format_issues 处理或调试
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 汇总结果（summary 模式） */
interface SummaryResult {
  total: number;
  byType: Record<string, number>;
  highSeverity: number;
}

/** 汇总结果（detailed 模式） */
interface DetailedResult extends SummaryResult {
  issues: any[];
}

/**
 * 创建 summarize_issues 工具
 *
 * 参数：
 * - issues: 多步审查发现的问题列表（ReviewIssue[] 或任意对象数组）
 * - format: 'summary'（默认，只返回统计）| 'detailed'（附带完整列表）
 */
export function createSummarizeIssuesTool(_context: ToolContext) {
  return tool({
    description: '汇总多步审查发现的问题。按 issueType 分组统计，并统计高严重度问题数（severity=error 或 riskLevel=HIGH）。format=summary 只返回统计数字，format=detailed 附带完整列表。',
    inputSchema: z.object({
      issues: z.array(z.any()).describe('多步审查发现的问题列表'),
      format: z.enum(['summary', 'detailed']).optional().default('summary').describe('输出格式：summary 只返回统计，detailed 附带完整列表'),
    }),
    execute: async ({ issues, format }): Promise<SummaryResult | DetailedResult> => {
      const total = issues.length;
      const byType: Record<string, number> = {};
      let highSeverity = 0;

      for (const issue of issues) {
        // 按 issueType 分组计数
        const issueType = issue?.issueType || 'UNKNOWN';
        byType[issueType] = (byType[issueType] || 0) + 1;

        // 高严重度：severity='error' 或 riskLevel='HIGH'
        if (issue?.severity === 'error' || issue?.riskLevel === 'HIGH') {
          highSeverity++;
        }
      }

      if (format === 'detailed') {
        return { total, byType, highSeverity, issues };
      }

      return { total, byType, highSeverity };
    },
  });
}
