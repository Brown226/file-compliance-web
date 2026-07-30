/**
 * Agent 工具集汇总 — 工厂模式入口
 *
 * Task 4：实现 5 个核心工具（file×2 + review×3）。
 * 其他子模块（knowledge / pipeline / memory）暂为占位，Task 5+ 填充。
 *
 * 用法：
 *   import { createAllTools } from './tools';
 *   const tools = createAllTools({ userId, sessionId });
 *   streamText({ ..., tools, stopWhen: isStepCount(10) });
 */

import { createFileTools } from './file';
import { createReviewTools } from './review';
import type { ToolContext } from './file';

export type { ToolContext };
export { createFileTools, createReviewTools };

/**
 * 创建全部工具集（合并所有子模块）
 * @param context userId / sessionId，注入到每个工具
 * @returns 合并后的工具对象，key 为工具名
 */
export function createAllTools(context: ToolContext) {
  return {
    ...createFileTools(context),
    ...createReviewTools(context),
  };
}
