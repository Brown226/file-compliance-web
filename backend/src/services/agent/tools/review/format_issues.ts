/**
 * format_issues 工具 — 规范化原始审查结果为合法 ReviewIssue[]
 *
 * 处理逻辑：
 * 1. 校验每个 issue 的 issueType，不在 13 种合法枚举内的归为 'VIOLATION'
 *    （保守策略：保留问题数据，避免丢失审查发现）
 * 2. 确保 originalText 字段存在（没有的用空字符串，避免前端定位崩溃）
 * 3. 过滤掉不是对象或 null 的非法条目
 *
 * 13 种合法 issueType（与 utils/issue-types.ts 权威枚举一致）：
 *   TYPO / VIOLATION / FORMAT / COMPLETENESS / CONSISTENCY / LAYOUT /
 *   NAMING / ENCODING / ATTRIBUTE / HEADER / PAGE / FLUENCY / CROSS_REFERENCE
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { VALID_ISSUE_TYPES_SET } from '../../../../utils/issue-types';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/**
 * 创建 format_issues 工具
 *
 * 参数：
 * - rawIssues: 原始审查结果（任意对象数组）
 * - fileType: 文件类型（可选，用于确定附加字段；当前预留，不影响核心逻辑）
 */
export function createFormatIssuesTool(_context: ToolContext) {
  return tool({
    description: '规范化原始审查结果为合法 ReviewIssue[]。校验 issueType（非法值归为 VIOLATION），确保 originalText 字段存在，过滤非法条目。返回可直接用于前端展示的结构化问题列表。',
    inputSchema: z.object({
      rawIssues: z.array(z.any()).describe('原始审查结果（LLM 输出或多步审查累积的问题列表）'),
      fileType: z.string().optional().describe('文件类型，用于确定附加字段（预留）'),
    }),
    execute: async ({ rawIssues }): Promise<any[]> => {
      const result: any[] = [];

      for (const raw of rawIssues) {
        // 过滤非对象 / null
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          continue;
        }

        // 校验 issueType：非法值归为 VIOLATION（保守策略，保留问题数据）
        let issueType = raw.issueType;
        if (typeof issueType !== 'string' || !VALID_ISSUE_TYPES_SET.has(issueType)) {
          issueType = 'VIOLATION';
        }

        // 确保 originalText 存在（前端高亮定位依赖此字段）
        const originalText = typeof raw.originalText === 'string' ? raw.originalText : '';

        // 保留原对象所有字段，覆盖 issueType / originalText
        result.push({
          ...raw,
          issueType,
          originalText,
        });
      }

      return result;
    },
  });
}
