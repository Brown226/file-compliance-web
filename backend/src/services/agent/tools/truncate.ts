/**
 * 工具结果截断模块（P1-⑫）
 *
 * 对可截断工具（extract_text / chunk_document / read_file）统一做结果截断，
 * 防止大文件解析结果（text/markdown/chunks/read 内容）撑爆 LLM 上下文。
 *
 * 独立模块导出 TRUNCATABLE_TOOLS + truncateWrapper，由 tools/index.ts 引用。
 * 计划任务 6：把内嵌在 tools/index.ts 的截断逻辑抽出为独立模块，行为保持一致。
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
 */

interface TruncateConfig {
  /** 单字段/总输出字符上限（约 200KB ≈ 20 万字符，UTF-16 长度） */
  maxChars: number;
}

/** 可截断工具及截断配置（P1-⑫） */
export const TRUNCATABLE_TOOLS: Record<string, TruncateConfig> = {
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
export function truncateTextString(text: string, maxChars: number): string {
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
export function truncateToolResult(toolName: string, result: any, cfg: TruncateConfig): any {
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
export function truncateWrapper(
  toolName: string,
  execute: (args: any, options?: any) => Promise<any>,
): (args: any, options?: any) => Promise<any> {
  const cfg = TRUNCATABLE_TOOLS[toolName];
  return async (args: any, options?: any) => {
    const result = await execute(args, options);
    return truncateToolResult(toolName, result, cfg);
  };
}
