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
  const { isRetryable, calcBackoff } = require('../retry/retry-strategy');
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

/**
 * P1-⑫：工具结果截断包装器
 *
 * 对可截断工具（extract_text / chunk_document / read_file）统一做结果截断，
 * 防止大文件解析结果（text/markdown/chunks/read 内容）撑爆 LLM 上下文。
 *
 * 策略（按工具配置 maxChars）：
 * - 截断发生在「工具结果层」（原始 execute 返回后、cacheWrapper 缓存前）：
 *   缓存中存的即截断态结果（截断是确定性的），Redis 内存更省；
 *   cacheWrapper 命中返回的缓存结果天然已是截断态，行为一致。
 * - 超出上限的文本截断并追加「（已截断 N 字符）」标注，让 LLM 明确看到数据不完整；
 *   extract_text / read_file 的文本字段带 <file_content> 注入防护标签，
 *   截断时先解包再截断、再重新包回，保证标签完整闭合。
 * - chunk_document：单块文本先按 maxChars 截断（by_page 单页可能超大），
 *   再按总字符预算保留完整块，超出部分以「（已截断 N 字符）」标记块收尾。
 * - extract_text：text / markdown 字段截断；structure.paragraphs 是全文副本
 *   （纯文本文件直接 split 而来），也按总预算保护，防止结构字段二次撑爆。
 *
 * 包装位置（外 → 内）：injectionGuardWrapper → retryWrapper → cacheWrapper → truncateWrapper → execute
 * - truncateWrapper 最内层：只处理原始 execute 的正常结果，不碰 retryWrapper 的降级对象
 * - cacheWrapper 在其外层：缓存截断态结果，命中/未命中行为一致
 */
interface TruncateConfig {
  /** 单字段/总输出字符上限（约 200KB ≈ 20 万字符，UTF-16 长度） */
  maxChars: number;
}

/** 可截断工具及截断配置（P1-⑫） */
const TRUNCATABLE_TOOLS: Record<string, TruncateConfig> = {
  extract_text: { maxChars: 200_000 },
  chunk_document: { maxChars: 200_000 },
  read_file: { maxChars: 200_000 },
};

/**
 * 单条文本截断：超过 maxChars 时截断并追加「（已截断 N 字符）」标注
 *
 * 兼容 Task 22.1 的 <file_content> 包裹：先解包截断、再重新包回，
 * 保证标签完整闭合，LLM 侧看到的仍是合法包裹的数据 + 明确的截断标注。
 */
function truncateTextString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let inner = text;
  let isWrapped = false;
  if (text.startsWith('<file_content>') && text.endsWith('</file_content>')) {
    isWrapped = true;
    inner = text.slice('<file_content>'.length, text.length - '</file_content>'.length);
  }

  const removedChars = inner.length - maxChars;
  const truncated = `${inner.slice(0, maxChars)}\n（已截断 ${removedChars} 字符）`;
  return isWrapped ? `<file_content>${truncated}</file_content>` : truncated;
}

/** 取结构数组元素的文本（兼容 string 或 { text } 对象） */
function elementText(p: any): string {
  const t = typeof p === 'string' ? p : p?.text;
  return typeof t === 'string' ? t : '';
}

/**
 * extract_text 结果截断：
 * - text / markdown 字段按 maxChars 截断
 * - structure.paragraphs 按总字符预算保留，超出部分以截断标注元素收尾
 *   （纯文本文件的 paragraphs 是全文 split 副本，不保护会二次撑爆上下文）
 */
function truncateExtractTextResult(result: any, cfg: TruncateConfig): any {
  if (typeof result.text === 'string') {
    result.text = truncateTextString(result.text, cfg.maxChars);
  }
  if (typeof result.markdown === 'string') {
    result.markdown = truncateTextString(result.markdown, cfg.maxChars);
  }

  const paragraphs = result?.structure?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length > 0) {
    const totalChars = paragraphs.reduce((sum, p) => sum + elementText(p).length, 0);
    if (totalChars > cfg.maxChars) {
      let keptCount = 0;
      let keptChars = 0;
      for (const p of paragraphs) {
        const len = elementText(p).length;
        if (keptChars + len > cfg.maxChars) break;
        keptCount++;
        keptChars += len;
      }
      const marker =
        typeof paragraphs[0] === 'string'
          ? `（已截断 ${totalChars - keptChars} 字符）`
          : { text: `（已截断 ${totalChars - keptChars} 字符）` };
      result.structure = {
        ...result.structure,
        paragraphs: [...paragraphs.slice(0, keptCount), marker],
      };
    }
  }
  return result;
}

/**
 * chunk_document 结果截断：
 * - 按总字符预算保留完整块；预算耗尽后，若剩余预算仍足够（≥ 200 字符），
 *   把放不下的那一块截断进剩余预算（LLM 至少能看到开头内容，而非只有标记）
 * - 其余块丢弃，以「（已截断 N 字符）」标记块收尾；total 同步为实际返回块数
 * - 单块超大（如 by_page 单页 50 万字符）也只会被截断一次，标记准确
 */
function truncateChunkResult(result: any, cfg: TruncateConfig): any {
  const chunks = result?.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return result;

  /** 预算剩余不足该阈值时不再放截断块（避免塞入无意义残片） */
  const MIN_SLIVER = 200;

  let used = 0;
  const kept: any[] = [];
  let droppedChars = 0;
  let nextIndex = 0;
  for (const c of chunks) {
    const len = typeof c?.text === 'string' ? c.text.length : 0;
    if (used + len <= cfg.maxChars) {
      // 整块放得下：保留
      kept.push(c);
      used += len;
      nextIndex = (typeof c?.index === 'number' ? c.index : 0) + 1;
    } else if (len > 0) {
      const remaining = cfg.maxChars - used;
      if (remaining >= MIN_SLIVER) {
        // 放不下但预算还有余量：截断放入该块开头（截断文本带「（已截断 N 字符）」标记）
        const truncatedText = truncateTextString(c.text, remaining);
        kept.push({ ...c, text: truncatedText });
        used += truncatedText.length;
        nextIndex = (typeof c?.index === 'number' ? c.index : 0) + 1;
        droppedChars += Math.max(0, len - truncatedText.length);
      } else {
        droppedChars += len;
      }
    }
  }

  if (droppedChars > 0) {
    kept.push({ index: nextIndex, text: `（已截断 ${droppedChars} 字符）` });
    result.chunks = kept;
    result.total = kept.length;
  }
  return result;
}

/** read_file 结果截断：content 字段按 maxChars 截断（行窗口内单行可能超大） */
function truncateReadFileResult(result: any, cfg: TruncateConfig): any {
  if (typeof result?.content === 'string') {
    result.content = truncateTextString(result.content, cfg.maxChars);
  }
  return result;
}

/** 按工具名分发结果截断（未知工具/非对象结果原样返回） */
function truncateToolResult(toolName: string, result: any, cfg: TruncateConfig): any {
  if (!result || typeof result !== 'object') return result;
  switch (toolName) {
    case 'extract_text':
      return truncateExtractTextResult(result, cfg);
    case 'chunk_document':
      return truncateChunkResult(result, cfg);
    case 'read_file':
      return truncateReadFileResult(result, cfg);
    default:
      return result;
  }
}

/**
 * 工具结果截断包装器（P1-⑫）
 * 直接包在原始 execute 外层：执行完按工具配置截断结果，不抛错（截断是纯后处理）。
 * 仅对 TRUNCATABLE_TOOLS 中的工具启用，按工具名选择截断策略。
 */
function truncateWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  const cfg = TRUNCATABLE_TOOLS[toolName];
  return async (args: any, options?: any) => {
    const result = await execute(args, options);
    return truncateToolResult(toolName, result, cfg);
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
 * 当前工具总数：9（file）+ 6（review）+ 3（knowledge）+ 3（pipeline）+ 3（memory）= 24
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
  };

  // 统一包装每个工具的 execute：
  // 1. 可截断工具先包 truncateWrapper（最内层，P1-⑫ 大文本截断）
  // 2. 可缓存工具包 cacheWrapper（缓存截断态结果）
  // 3. 所有工具包 retryWrapper（中层，重试 + 降级）
  // 4. 所有工具最外层包 injectionGuardWrapper（Task 22.2，prompt injection 防护）
  for (const [name, toolDef] of Object.entries(tools)) {
    if (typeof (toolDef as any).execute !== 'function') continue;

    let wrappedExecute = (toolDef as any).execute;

    // 最内层：结果截断包装（P1-⑫，仅可截断工具）
    if (name in TRUNCATABLE_TOOLS) {
      wrappedExecute = truncateWrapper(name, wrappedExecute);
    }

    // 内层：缓存包装（仅可缓存工具）
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
