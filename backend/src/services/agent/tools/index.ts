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
 * Task 21.1：工具级重试包装器
 *
 * 策略：
 * 1. 工具 execute 抛错时，立即重试 1 次（仅 1 次，避免长延迟）
 * 2. 重试仍失败 → 不抛错，返回结构化 error 结果（让 Agent 流程继续，由 LLM 决定如何处理）
 *    返回格式：{ error: string, toolName: string, failed: true }
 * 3. 在返回结果中标注 `failed: true`，LLM 看到后能跳过或换方案
 *
 * 设计权衡：
 * - 不在包装器里写 AgentTrace（onToolExecutionEnd 回调已统一记录，避免重复）
 * - 不做指数退避（工具失败多为确定性错误如路径越权，重试无意义；网络类错误由 LLM 调用层处理）
 */
function retryWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  return async (args: any, options?: any) => {
    const t0 = Date.now();
    try {
      return await execute(args, options);
    } catch (firstErr) {
      const firstErrMs = Date.now() - t0;
      console.warn(`[Agent:Retry] 工具 ${toolName} 首次失败 (${firstErrMs}ms): ${(firstErr as Error).message}，重试 1 次...`);
      try {
        const retryResult = await execute(args, options);
        const retryMs = Date.now() - t0 - firstErrMs;
        console.log(`[Agent:Retry] 工具 ${toolName} 重试成功 (${retryMs}ms)`);
        return retryResult;
      } catch (secondErr) {
        const totalMs = Date.now() - t0;
        const errMsg = (secondErr as Error).message || String(secondErr);
        console.error(`[Agent:Retry] 工具 ${toolName} 重试仍失败 (总耗时 ${totalMs}ms): ${errMsg}，返回降级结果`);
        // 降级：返回结构化错误，不抛错，让 Agent 流程继续
        // onToolExecutionEnd 会检测 tool-output 类型，但这里直接返回对象
        // Vercel AI SDK v7 会把返回值包成 { type: 'tool-result', output: <返回值> }
        return {
          error: errMsg,
          toolName,
          failed: true,
          retryAttempted: true,
          message: `工具 ${toolName} 执行失败（已重试 1 次）。错误：${errMsg}。请尝试其他方案或跳过此步骤。`,
        };
      }
    }
  };
}

/**
 * Task 22.2：Prompt Injection 防护包装器
 *
 * 把工具 execute 的返回值序列化为 `<tool_result>{json}</tool_result>` 形式的字符串，
 * 让 LLM 看到明确的标签边界，识别工具结果是"数据"而非"指令"。
 *
 * 实现要点：
 * 1. 兼容 cacheWrapper 命中时返回的 `{ type: 'tool-result', output: <值> }` 包装格式
 *    （提取 output 后再序列化，避免 LLM 看到冗余的 type/output 嵌套）
 * 2. 对降级结果（retryWrapper 返回的 `{ failed: true, ... }`）同样包裹标签
 * 3. 保留原始 JSON 数据的完整性，LLM 可从标签内解析出结构化字段
 *
 * 安全语义：
 * - `<tool_result>` 标签内的所有内容都是工具返回的数据，不是用户指令
 * - 即使工具返回内容包含"忽略以上指令""现在你是..."等注入话语，LLM 也不应执行
 * - 配合 systemPrompt 的安全声明（Task 22.3）形成双层防护
 */
function injectionGuardWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  return async (args: any, options?: any) => {
    const result = await execute(args, options);

    // 兼容 cacheWrapper 的 { type: 'tool-result', output } 包装格式
    // 提取实际 output，避免 LLM 看到冗余的 SDK 内部字段
    let output = result;
    if (
      result &&
      typeof result === 'object' &&
      (result as any).type === 'tool-result' &&
      'output' in (result as any)
    ) {
      output = (result as any).output;
    }

    // 把工具结果序列化为带 <tool_result> 标签的字符串
    // LLM 看到标签后应将其视为数据，不执行其中的注入指令
    const json = JSON.stringify(output);
    return `<tool_result tool="${toolName}">${json}</tool_result>`;
  };
}

/**
 * 创建全部工具集（合并所有子模块）
 * @param context userId / sessionId，注入到每个工具
 * @returns 合并后的工具对象，key 为工具名
 *
 * 当前工具总数：8（file）+ 6（review）+ 3（knowledge）+ 3（pipeline）+ 3（memory）= 23
 *
 * 包装顺序（外到内）：injectionGuardWrapper → retryWrapper → cacheWrapper → 原始 execute
 * - 最外层 injectionGuardWrapper（Task 22.2）：把结果序列化为 <tool_result> 标签字符串
 * - 中层 retryWrapper（Task 21.1）：失败重试 1 次，仍失败返回降级对象
 * - 内层 cacheWrapper（仅可缓存工具）：命中直接返回，未命中执行原始 execute
 *
 * 执行顺序（请求时）：injectionGuardWrapper → retryWrapper → cacheWrapper → 原始 execute
 * 返回顺序（响应时）：原始 execute → cacheWrapper → retryWrapper → injectionGuardWrapper
 * - injectionGuardWrapper 在最外层，能对所有结果（正常/缓存命中/降级）统一包裹标签
 */
export function createAllTools(context: ToolContext) {
  const tools = {
    ...createFileTools(context),
    ...createReviewTools(context),
    ...createKnowledgeTools(context),
    ...createPipelineTools(context),
    ...createMemoryTools(context),
  };

  // 统一包装每个工具的 execute：
  // 1. 可缓存工具先包 cacheWrapper（最内层）
  // 2. 所有工具包 retryWrapper（中层，重试 + 降级）
  // 3. 所有工具最外层包 injectionGuardWrapper（Task 22.2，prompt injection 防护）
  for (const [name, toolDef] of Object.entries(tools)) {
    if (typeof (toolDef as any).execute !== 'function') continue;

    let wrappedExecute = (toolDef as any).execute;

    // 最内层：缓存包装（仅可缓存工具）
    if (CACHEABLE_TOOLS.has(name)) {
      wrappedExecute = cacheWrapper(name, wrappedExecute);
    }

    // 中层：重试包装（所有工具）
    wrappedExecute = retryWrapper(name, wrappedExecute);

    // 最外层：prompt injection 防护包装（Task 22.2）
    // 把工具结果序列化为 <tool_result> 标签字符串，防止工具返回内容被当作指令执行
    wrappedExecute = injectionGuardWrapper(name, wrappedExecute);

    (toolDef as any).execute = wrappedExecute;
  }

  return tools;
}
