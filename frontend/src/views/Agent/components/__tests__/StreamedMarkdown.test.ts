/**
 * StreamedMarkdown 单测：流式节流渲染契约
 * - 非流式：props.text 变化立即渲染
 * - 流式：150ms 窗口期内合并更新，尾随定时器补渲染最终态
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import StreamedMarkdown from '../StreamedMarkdown.vue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function setText(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.setProps({ text })
  await nextTick()
}

describe('StreamedMarkdown', () => {
  it('初始渲染 text', () => {
    const w = mount(StreamedMarkdown, { props: { text: '# 标题' } })
    expect(w.html()).toContain('标题')
  })

  it('非流式：text 更新立即渲染（历史回看行为不变）', async () => {
    const w = mount(StreamedMarkdown, { props: { text: 'a', streaming: false } })
    await setText(w, 'b-new')
    expect(w.html()).toContain('b-new')
  })

  it('流式：窗口期内的连续更新合并，尾随补渲染拿到最终态', async () => {
    const w = mount(StreamedMarkdown, { props: { text: 'v1', streaming: true } })
    await nextTick()
    // 距初始渲染 <150ms → 进入节流窗口，不立即渲染
    await setText(w, 'v2-longer')
    expect(w.html()).not.toContain('v2-longer')
    vi.advanceTimersByTime(150)
    await nextTick()
    // 尾随定时器用最新 props 补渲染
    expect(w.html()).toContain('v2-longer')
  })

  it('流式：窗口过期后的更新立即渲染', async () => {
    vi.advanceTimersByTime(1000) // 拉开与初始渲染的时间差
    const w = mount(StreamedMarkdown, { props: { text: 'a', streaming: true } })
    await nextTick()
    vi.advanceTimersByTime(200) // 超过节流窗口
    await setText(w, 'fresh')
    expect(w.html()).toContain('fresh')
  })

  it('卸载时清理挂起的尾随定时器（不抛错）', async () => {
    const w = mount(StreamedMarkdown, { props: { text: 'x', streaming: true } })
    await nextTick()
    await setText(w, 'y')
    w.unmount()
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  })
})
