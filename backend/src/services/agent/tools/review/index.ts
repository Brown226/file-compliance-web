/**
 * review 工具集 — 审查相关工具的工厂入口
 *
 * 工厂模式：context 携带 userId / sessionId（当前 review 工具未直接使用，
 * 但保留签名一致性，便于后续 AgentMemory/AgentTrace 关联）。
 */

import { createLlmReviewChunkTool } from './llm_review_chunk';
import { createSummarizeIssuesTool } from './summarize_issues';
import { createFormatIssuesTool } from './format_issues';
import { createListAvailableRulesTool } from './list_available_rules';
import { createApplyRuleTool } from './apply_rule';
import { createLlmCrossCheckTool } from './llm_cross_check';
import type { ToolContext } from '../file/upload_file';

export {
  createLlmReviewChunkTool,
  createSummarizeIssuesTool,
  createFormatIssuesTool,
  createListAvailableRulesTool,
  createApplyRuleTool,
  createLlmCrossCheckTool,
};

/**
 * 创建审查相关工具集
 * @param context userId / sessionId
 * @returns { llm_review_chunk, summarize_issues, format_issues }
 */
export function createReviewTools(context: ToolContext) {
  return {
    llm_review_chunk: createLlmReviewChunkTool(context),
    summarize_issues: createSummarizeIssuesTool(context),
    format_issues: createFormatIssuesTool(context),
    list_available_rules: createListAvailableRulesTool(context),
    apply_rule: createApplyRuleTool(context),
    llm_cross_check: createLlmCrossCheckTool(context),
  };
}
