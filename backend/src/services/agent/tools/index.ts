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
import { createBatchProcessTool } from './batch/batch_process';
import { createDocTools } from './doc';
import { createAskUserTool } from './user/ask_user';
import { ToolCacheService, CACHEABLE_TOOLS } from '../tool-cache/tool-cache.service';
import { runBeforeToolHooks, runAfterToolHooks } from '../tool-hook/tool-hook.service';
import { registerDefaultToolHooks } from '../tool-hook/register-tool-hooks';
import { TRUNCATABLE_TOOLS, truncateWrapper } from './truncate';
import { isRetryable, calcBackoff } from '../retry/retry-strategy';
import type { ToolContext } from './file';

// P1-⑫ 工具拦截钩子首用例：模块加载时注册默认钩子（llm_review_chunk 审查结果去重），
// 保证任何工具执行前钩子已就绪。注册幂等（进程内只加载一次本模块）。
registerDefaultToolHooks();

export type { ToolContext };

/**
 * 缓存包装器 — 对可缓存工具的 execute 做缓存拦截
 *
 * - 执行前调 ToolCacheService.get(toolName, args) → 命中直接返回 { type: 'tool-result', output: cached }
 * - 未命中 → 执行原始 execute → 结果返回前调 ToolCacheService.set(toolName, args, output)
 */
function cacheWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
  userId?: string,
): (args: any, options?: any) => Promise<any> {
  return async (args: any, options?: any) => {
    // 先查缓存（缓存键混入 userId，防止跨用户缓存命中泄露）
    const cached = await ToolCacheService.get(toolName, args ?? {}, userId);
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
    await ToolCacheService.set(toolName, args ?? {}, output, userId);

    return result;
  };
}

/**
 * Task 21.1：工具级重试包装器
 *
 * 策略：
 * 1. 工具 execute 抛错时，用 retry-strategy 的 isRetryable 判断错误是否值得重试
 *    （5xx/429/408 等服务端/限流错误重试，4xx 业务错误不重试）
 * 2. 可重试时按 calcBackoff 退避后重试 1 次（仅 1 次，避免长延迟）
 * 3. 重试仍失败 → 不抛错，返回结构化 error 结果（让 Agent 流程继续，由 LLM 决定如何处理）
 *    返回格式：{ error: string, toolName: string, failed: true }
 * 4. 在返回结果中标注 `failed: true`，LLM 看到后能跳过或换方案
 *
 * 设计权衡：
 * - 不在包装器里写 AgentTrace（onToolExecutionEnd 回调已统一记录，避免重复）
 * - 不做指数退避（工具失败多为确定性错误如路径越权，重试无意义；网络类错误由 LLM 调用层处理）
 *   —— P0 #1 修订：接入 retry-strategy（isRetryable + calcBackoff），网络类错误按退避重试，
 *   确定性业务错误（4xx）直接返回降级结果不浪费延迟。
 */
function retryWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  // P0 #1（接通纸面能力）：接入 retry-strategy 纯函数（isRetryable / calcBackoff）
  return async (args: any, options?: any) => {
    const t0 = Date.now();
    try {
      return await execute(args, options);
    } catch (firstErr) {
      const firstErrMs = Date.now() - t0;
      // 不可重试错误（业务 4xx / 路径越权等确定性错误）→ 直接降级，不浪费延迟
      if (!isRetryable(firstErr)) {
        const errMsg = (firstErr as Error).message || String(firstErr);
        console.warn(`[Agent:Retry] 工具 ${toolName} 失败且不可重试 (${firstErrMs}ms): ${errMsg}，返回降级结果`);
        return {
          error: errMsg,
          toolName,
          failed: true,
          retryAttempted: false,
          message: `工具 ${toolName} 执行失败。错误：${errMsg}。请尝试其他方案或跳过此步骤。`,
        };
      }
      // 可重试：按指数退避等待后重试 1 次
      const delayMs = calcBackoff(1);
      console.warn(`[Agent:Retry] 工具 ${toolName} 首次失败 (${firstErrMs}ms)，退避 ${delayMs}ms 后重试: ${(firstErr as Error).message}`);
      await new Promise(r => setTimeout(r, delayMs));
      try {
        const retryResult = await execute(args, options);
        const retryMs = Date.now() - t0;
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

// P1-⑫ 工具结果截断：独立模块（tools/truncate.ts）提供 TRUNCATABLE_TOOLS / truncateWrapper，
// 本文件只引用，不再内嵌实现（计划任务 6）。

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

    // 透传豁免（Task 44：ask_user 主动提问）：
    // ask_user 工具返回的 { status: 'awaiting_user', ... } 是"挂起"语义标记，
    // 必须原样透传——若被包成 <tool_result> 字符串，前端无法识别挂起，
    // 也无法在恢复注入时把用户回复回填到 tool-result。
    // 这是唯一被豁免的返回形态（其余工具结果一律包裹），安全边界清晰。
    if (
      result &&
      typeof result === 'object' &&
      (result as any).status === 'awaiting_user'
    ) {
      return result;
    }

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
 * P1-⑫：工具执行前后拦截钩子包装器
 *
 * 在工具 execute 执行前调用注册的 beforeToolCall 钩子（可改写 args），
 * 执行后调用 afterToolCall 钩子（可改写 result）。
 *
 * 包装位置（外 → 内）：
 * injectionGuardWrapper → retryWrapper → cacheWrapper → truncateWrapper → hookWrapper → 原始 execute
 *
 * - hookWrapper 最内层：只处理原始 execute 的输入输出，before 钩子改 args、
 *   after 钩子改 result，两者都发生在缓存/截断/重试/注入防护之前，
 *   因此钩子改写的输入会进入缓存键计算、改写的输出会进入缓存。
 * - 钩子抛错不阻断主流程（tool-hook.service 内部已 try/catch 降级）
 */
function hookWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
  context: ToolContext,
): (args: any, options?: any) => Promise<any> {
  return async (args: any, options?: any) => {
    const t0 = Date.now();
    // before 钩子链：可改写 args
    const finalArgs = await runBeforeToolHooks({
      toolName,
      args: args ?? {},
      userId: context.userId,
      sessionId: context.sessionId,
    });
    // 执行原始 execute
    const result = await execute(finalArgs, options);
    const durationMs = Date.now() - t0;
    // after 钩子链：可改写 result
    const finalResult = await runAfterToolHooks({
      toolName,
      args: finalArgs,
      result,
      userId: context.userId,
      sessionId: context.sessionId,
      durationMs,
    });
    return finalResult;
  };
}

/**
 * 创建全部工具集（合并所有子模块）
 * @param context userId / sessionId，注入到每个工具
 * @returns 合并后的工具对象，key 为工具名
 *
 * 当前工具总数：10（file）+ 6（review）+ 4（knowledge）+ 3（pipeline）+ 3（memory）+ 1（batch）+ 2（doc）+ 1（user/ask_user）= 30
 *
 * 包装顺序（外到内）：injectionGuardWrapper → retryWrapper → cacheWrapper → truncateWrapper → 原始 execute
 * - 最外层 injectionGuardWrapper（Task 22.2）：把结果序列化为 <tool_result> 标签字符串
 * - 中层 retryWrapper（Task 21.1）：失败重试 1 次，仍失败返回降级对象
 * - 内层 cacheWrapper（仅可缓存工具）：命中直接返回，未命中执行原始 execute
 * - 最内层 truncateWrapper（P1-⑫，仅可截断工具）：截断大文本结果并标注「（已截断 N 字符）」
 *
 * 执行顺序（请求时）：injectionGuardWrapper → retryWrapper → cacheWrapper → truncateWrapper → 原始 execute
 * 返回顺序（响应时）：原始 execute → truncateWrapper → cacheWrapper → retryWrapper → injectionGuardWrapper
 * - injectionGuardWrapper 在最外层，能对所有结果（正常/缓存命中/降级）统一包裹标签
 * - truncateWrapper 在 cacheWrapper 内侧：缓存中存的即截断态结果，命中/未命中行为一致
 */
export function createAllTools(context: ToolContext) {
  const tools = {
    ...createFileTools(context),
    ...createReviewTools(context),
    ...createKnowledgeTools(context),
    ...createPipelineTools(context),
    ...createMemoryTools(context),
    batch_process: createBatchProcessTool(context),
    ...createDocTools(context),
    ask_user: createAskUserTool(context),
  };

  // 统一包装每个工具的 execute：
  // 1. 最内层 hookWrapper（P1-⑫ 拦截钩子，改写输入输出）
  // 2. 可截断工具包 truncateWrapper（大文本截断）
  // 3. 可缓存工具包 cacheWrapper（缓存截断态结果）
  // 4. 所有工具包 retryWrapper（中层，重试 + 降级）
  // 5. 所有工具最外层包 injectionGuardWrapper（Task 22.2，prompt injection 防护）
  for (const [name, toolDef] of Object.entries(tools)) {
    if (typeof (toolDef as any).execute !== 'function') continue;

    let wrappedExecute = (toolDef as any).execute;

    // 最内层：拦截钩子包装（P1-⑫，所有工具）
    wrappedExecute = hookWrapper(name, wrappedExecute, context);

    // 次内层：结果截断包装（P1-⑫，仅可截断工具）
    if (name in TRUNCATABLE_TOOLS) {
      wrappedExecute = truncateWrapper(name, wrappedExecute);
    }

    // 内层：缓存包装（仅可缓存工具；缓存键混入 userId，防跨用户缓存泄露）
    if (CACHEABLE_TOOLS.has(name)) {
      wrappedExecute = cacheWrapper(name, wrappedExecute, context.userId);
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
