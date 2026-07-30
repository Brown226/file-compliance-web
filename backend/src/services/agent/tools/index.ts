/**
 * Agent 工具集汇总 — 工厂模式入口
 *
 * Task 4：实现 5 个核心工具（file×2 + review×3）
 * Task 8：扩展 file 工具到 8 个（+ chunk/read/list/delete/write_report/download_report）
 * Task 9：新增 knowledge 工具集 3 个（maxkb/rule_library/standard_checkpoints）
 *
 * 用法：
 *   import { createAllTools } from './tools';
 *   const tools = createAllTools({ userId, sessionId });
 *   streamText({ ..., tools, stopWhen: isStepCount(10) });
 */

import { createFileTools } from './file';
import { createReviewTools } from './review';
import { createKnowledgeTools } from './knowledge';
import type { ToolContext } from './file';

export type { ToolContext };
export { createFileTools, createReviewTools, createKnowledgeTools };

/**
 * 创建全部工具集（合并所有子模块）
 * @param context userId / sessionId，注入到每个工具
 * @returns 合并后的工具对象，key 为工具名
 *
 * 当前工具总数：8（file）+ 6（review）+ 3（knowledge）= 17
 */
export function createAllTools(context: ToolContext) {
  return {
    ...createFileTools(context),
    ...createReviewTools(context),
    ...createKnowledgeTools(context),
  };
}
