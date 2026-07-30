/**
 * Agent 工具集汇总 — 工厂模式入口
 *
 * Task 4：实现 5 个核心工具（file×2 + review×3）
 * Task 8：扩展 file 工具到 8 个（+ chunk/read/list/delete/write_report/download_report）
 * Task 9：新增 knowledge 工具集 3 个（maxkb/rule_library/standard_checkpoints）
 * Task 11：新增 pipeline 工具集 3 个（create_pipeline_task/get_task_status/get_task_results）
 * Task 12：新增 memory 工具集 3 个（recall_memory/save_memory/extract_user_preferences）
 *
 * 用法：
 *   import { createAllTools } from './tools';
 *   const tools = createAllTools({ userId, sessionId });
 *   streamText({ ..., tools, stopWhen: isStepCount(10) });
 */

import { createFileTools } from './file';
import { createReviewTools } from './review';
import { createKnowledgeTools } from './knowledge';
import { createPipelineTools } from './pipeline';
import { createMemoryTools } from './memory';
import { ToolCacheService, CACHEABLE_TOOLS } from '../tool-cache/tool-cache.service';
import type { ToolContext } from './file';

export type { ToolContext };
export { createFileTools, createReviewTools, createKnowledgeTools, createPipelineTools, createMemoryTools };

/**
 * 缓存包装器 — 对可缓存工具的 execute 做缓存拦截
 *
 * - 执行前调 ToolCacheService.get(toolName, args) → 命中直接返回 { type: 'tool-result', output: cached }
 * - 未命中 → 执行原始 execute → 结果返回前调 ToolCacheService.set(toolName, args, output)
 */
function cacheWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  return async (args: any, options?: any) => {
    // 先查缓存
    const cached = await ToolCacheService.get(toolName, args ?? {});
    if (cached !== null) {
      return { type: 'tool-result', output: cached };
    }

    // 未命中，执行原始 execute
    const result = await execute(args, options);

    // 提取实际输出并写入缓存
    const output =
      result && typeof result === 'object' && 'output' in result
        ? result.output
        : result;
    await ToolCacheService.set(toolName, args ?? {}, output);

    return result;
  };
}

/**
 * 创建全部工具集（合并所有子模块）
 * @param context userId / sessionId，注入到每个工具
 * @returns 合并后的工具对象，key 为工具名
 *
 * 当前工具总数：8（file）+ 6（review）+ 3（knowledge）+ 3（pipeline）+ 3（memory）= 23
 */
export function createAllTools(context: ToolContext) {
  const tools = {
    ...createFileTools(context),
    ...createReviewTools(context),
    ...createKnowledgeTools(context),
    ...createPipelineTools(context),
    ...createMemoryTools(context),
  };

  // 对 CACHEABLE_TOOLS 中的工具用 cacheWrapper 包装 execute
  for (const [name, toolDef] of Object.entries(tools)) {
    if (CACHEABLE_TOOLS.has(name) && typeof (toolDef as any).execute === 'function') {
      (toolDef as any).execute = cacheWrapper(name, (toolDef as any).execute);
    }
  }

  return tools;
}
