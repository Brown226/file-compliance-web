/**
 * 传输层历史瘦身（口径与后端 agent.service.ts trimStaleToolOutputs 一致）
 *
 * 背景：前端每轮把完整 messages history 原样上传，旧轮工具结果（extract_text 全文、
 * llm_review_chunk 结果等）随会话线性增长直到撞后端 200 万字符上限。后端在收到之后
 * 才做截断——序列化/上传/网关解析这些运输成本并没有省。这里在发送前对「最近 6 条
 * 以外」消息中 tool-* part 的 output 做同样口径的截断。
 *
 * 关键约束：只克隆被修改的消息/分片，绝不改动 useChat 内部的消息对象（该数组同时
 * 驱动 UI 渲染与历史回看），截断只作用于本次请求体。
 */

export const KEEP_RECENT_MESSAGES = 6
export const STALE_OUTPUT_MAX_CHARS = 2000

/** 单条输出截断：字符串直接切；对象超限时退化处理（与后端行为一致） */
function truncateOutput(output: any): any {
  if (typeof output === 'string' && output.length > STALE_OUTPUT_MAX_CHARS) {
    return output.slice(0, STALE_OUTPUT_MAX_CHARS) +
      `\n…（旧工具输出已截断，原 ${output.length} 字符）`
  }
  if (output != null && typeof output === 'object') {
    let raw: string
    try {
      raw = JSON.stringify(output)
    } catch {
      return output
    }
    if (raw.length > STALE_OUTPUT_MAX_CHARS) {
      // 截断后的 JSON 几乎必然非法，按约定退化为纯字符串（后端同样如此）
      try {
        return JSON.parse(raw.slice(0, STALE_OUTPUT_MAX_CHARS) + '…')
      } catch {
        return raw.slice(0, STALE_OUTPUT_MAX_CHARS) + '…'
      }
    }
  }
  return output
}

/**
 * 返回可用于请求体的瘦身副本：
 * - 总数 ≤ KEEP_RECENT_MESSAGES 时原样返回（同一引用，零开销）
 * - 最近 KEEP_RECENT_MESSAGES 条保持完整（LLM 刚消费过，可能与当前问题相关）
 * - 更早消息中 tool-* part 的 output 截断到 STALE_OUTPUT_MAX_CHARS
 */
export function trimHistoryForTransport<T extends { parts?: any[] }>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length <= KEEP_RECENT_MESSAGES) return messages
  const keepFrom = messages.length - KEEP_RECENT_MESSAGES
  return messages.map((m, i) => {
    const parts = (m as any)?.parts
    // 最近 KEEP_RECENT_MESSAGES 条保持原样；更早的（stale）才做截断
    if (i >= keepFrom || !Array.isArray(parts)) return m
    let cloned: any = m
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]
      const type = String(part?.type || '')
      if (!type.startsWith('tool-') || part.output === undefined) continue
      const trimmed = truncateOutput(part.output)
      if (trimmed === part.output) continue
      if (cloned === m) {
        cloned = { ...m, parts: [...parts] }
      }
      cloned.parts[pi] = { ...part, output: trimmed }
    }
    return cloned
  })
}
