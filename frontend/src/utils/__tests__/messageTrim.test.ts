/**
 * trimHistoryForTransport 单测（传输层历史瘦身，口径对齐后端 trimStaleToolOutputs）
 */
import { describe, it, expect } from 'vitest'
import { trimHistoryForTransport, KEEP_RECENT_MESSAGES, STALE_OUTPUT_MAX_CHARS } from '../messageTrim'

function msg(role: string, parts: any[]): any {
  return { id: Math.random().toString(36).slice(2), role, parts }
}

describe('trimHistoryForTransport', () => {
  it('总数 ≤ 6 条时原样返回（同一引用，零开销）', () => {
    const msgs = [msg('user', [{ type: 'text', text: 'hi' }])]
    expect(trimHistoryForTransport(msgs)).toBe(msgs)
  })

  it('旧消息长字符串 output 截断并加标注；最近 6 条原引用保持完整', () => {
    const big = 'x'.repeat(STALE_OUTPUT_MAX_CHARS + 5000)
    const old = msg('assistant', [
      { type: 'tool-extract_text', output: big },
      { type: 'text', text: 'done' },
    ])
    const recent = Array.from({ length: KEEP_RECENT_MESSAGES }, (_, i) =>
      msg('user', [{ type: 'text', text: `m${i}` }]),
    )
    // 最近区内的大 output 必须保持完整（LLM 刚消费过）
    recent[0].parts[0] = { type: 'tool-read_file', output: big }
    const all = [old, ...recent]

    const out = trimHistoryForTransport(all) as any[]

    // 原始消息对象不被修改（useChat 内部状态安全）
    expect(all[0].parts[0].output).toBe(big)
    expect(out).not.toBe(all)
    // 旧消息被克隆并截断
    expect(out[0]).not.toBe(old)
    expect(String(out[0].parts[0].output).length).toBeLessThan(big.length)
    expect(String(out[0].parts[0].output)).toContain('已截断')
    // 文本 part 不受影响
    expect(out[0].parts[1].text).toBe('done')
    // 最近 6 条整条保持原引用
    for (let i = 1; i <= KEEP_RECENT_MESSAGES; i++) {
      expect(out[i]).toBe(all[i])
    }
  })

  it('旧消息超限对象 output 退化为字符串（与后端一致）；未超限对象不克隆', () => {
    const bigObj = { content: 'y'.repeat(STALE_OUTPUT_MAX_CHARS + 100) }
    const smallObj = { total: 3 }
    const old = msg('assistant', [
      { type: 'tool-extract_text', output: bigObj },
      { type: 'tool-list_uploads', output: smallObj },
    ])
    const filler = Array.from({ length: KEEP_RECENT_MESSAGES }, () => msg('user', []))

    const out = trimHistoryForTransport([old, ...filler]) as any[]

    expect(typeof out[0].parts[0].output).toBe('string')
    expect(out[0].parts[0].output).toContain('…')
    // 小对象无需截断 → 该 part 保持原引用
    expect(out[0].parts[1]).toBe(old.parts[1])
  })

  it('无可截断项的旧消息整条保持原引用', () => {
    const longText = 'z'.repeat(STALE_OUTPUT_MAX_CHARS + 10)
    const old = msg('assistant', [{ type: 'text', text: longText }])
    const filler = Array.from({ length: KEEP_RECENT_MESSAGES }, () => msg('user', []))
    const out = trimHistoryForTransport([old, ...filler]) as any[]
    expect(out[0]).toBe(old)
  })
})
