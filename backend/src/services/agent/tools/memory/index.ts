/**
 * memory 工具集 — 用户长期记忆相关工具
 *
 * Task 12：3 个记忆工具
 *   - recall_memory: 语义检索用户长期记忆（pgvector L2 距离匹配 + scope 优先级排序）
 *   - save_memory: 保存用户偏好/反馈/例行习惯（含 embedding 向量）
 *   - extract_user_preferences: 从当前会话历史自动提取偏好（LLM 分析 + 批量 saveMemory）
 *
 * 设计意图：实现跨会话用户偏好记忆
 * - 审查开始前 recall_memory 召回用户偏好，注入审查上下文
 * - 用户表达偏好/纠正行为时 save_memory 主动保存
 * - 会话结束前 extract_user_preferences 批量提取沉淀
 */

import { createRecallMemoryTool } from './recall_memory';
import { createSaveMemoryTool } from './save_memory';
import { createExtractUserPreferencesTool } from './extract_user_preferences';
import type { ToolContext } from '../file/upload_file';

export {
  createRecallMemoryTool,
  createSaveMemoryTool,
  createExtractUserPreferencesTool,
};

/**
 * 创建记忆工具集（3 个工具）
 */
export function createMemoryTools(context: ToolContext) {
  return {
    recall_memory: createRecallMemoryTool(context),
    save_memory: createSaveMemoryTool(context),
    extract_user_preferences: createExtractUserPreferencesTool(context),
  };
}
