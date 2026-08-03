/**
 * knowledge 工具集 — 知识检索相关工具
 *
 * Task 9：3 个知识检索工具
 *   - search_knowledge: 调 MaxKB/RAGFlow 双源知识库做 RAG 检索（复用 RAGService.retrieve）
 *   - search_rule_library: 查询语义规则库 RuleLibrary（复用 RuleLibraryService）
 *   - search_standard_checkpoints: 查询审点库 StandardCheckpoint（复用 CheckpointService）
 */

import { createSearchMaxkbKnowledgeTool } from './search_maxkb_knowledge';
import { createSearchRuleLibraryTool } from './search_rule_library';
import { createSearchStandardCheckpointsTool } from './search_standard_checkpoints';
import type { ToolContext } from '../file/upload_file';

export {
  createSearchMaxkbKnowledgeTool,
  createSearchRuleLibraryTool,
  createSearchStandardCheckpointsTool,
};

/**
 * 创建知识检索工具集（3 个工具）
 */
export function createKnowledgeTools(context: ToolContext) {
  return {
    search_knowledge: createSearchMaxkbKnowledgeTool(context),
    search_rule_library: createSearchRuleLibraryTool(context),
    search_standard_checkpoints: createSearchStandardCheckpointsTool(context),
  };
}
