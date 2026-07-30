/**
 * pipeline 工具集 — 任务委托相关工具
 *
 * Task 11：3 个任务委托工具
 *   - create_pipeline_task: 委托复杂审查给 pipeline（创建 Task + TaskFile + 入 Bull 队列）
 *   - get_task_status: 查询任务状态和进度
 *   - get_task_results: 获取任务审查结果（ReviewIssue[]）
 *
 * 设计意图：实现 Agent 双模式（C 路线）
 * - 简单审查：Agent 自己用 extract_text + llm_review_chunk 完成（快速反馈）
 * - 复杂审查：Agent 调 create_pipeline_task 委托给 pipeline（重度任务）
 */

import { createCreatePipelineTaskTool } from './create_pipeline_task';
import { createGetTaskStatusTool } from './get_task_status';
import { createGetTaskResultsTool } from './get_task_results';
import type { ToolContext } from '../file/upload_file';

export {
  createCreatePipelineTaskTool,
  createGetTaskStatusTool,
  createGetTaskResultsTool,
};

/**
 * 创建任务委托工具集（3 个工具）
 */
export function createPipelineTools(context: ToolContext) {
  return {
    create_pipeline_task: createCreatePipelineTaskTool(context),
    get_task_status: createGetTaskStatusTool(context),
    get_task_results: createGetTaskResultsTool(context),
  };
}
