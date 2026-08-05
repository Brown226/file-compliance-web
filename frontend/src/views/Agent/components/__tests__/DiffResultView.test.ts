/**
 * DiffResultView 单元测试（P0-① 文档对比 diff 双栏视图）
 *
 * 覆盖：
 * - 统计条渲染（新增/删除/修改/未变/总变更数）
 * - LLM 变更摘要展示
 * - 变更块列表：added/removed/modified 三种类型渲染
 * - <file_content> 防注入标签剥离（只给 LLM 看的标签不展示给用户）
 * - sectionTitle 章节标签展示
 * - 空结果（totalChanges=0）→ 一致提示
 * - 无 changes 但有 totalChanges → 不误显示空态
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DiffResultView from '../DiffResultView.vue'

function makeResult(overrides: Record<string, any> = {}) {
  return {
    changes: [],
    stats: { added: 0, removed: 0, modified: 0, unchanged: 0 },
    summary: undefined,
    totalChanges: 0,
    ...overrides,
  }
}

describe('DiffResultView', () => {
  it('统计条渲染各项数字', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          stats: { added: 2, removed: 1, modified: 3, unchanged: 10 },
          totalChanges: 6,
        }),
      },
    })
    const text = wrapper.text()
    expect(text).toContain('＋新增 2')
    expect(text).toContain('－删除 1')
    expect(text).toContain('～修改 3')
    expect(text).toContain('＝未变 10')
    expect(text).toContain('共 6 处变更')
  })

  it('展示 LLM 变更摘要', () => {
    const wrapper = mount(DiffResultView, {
      props: { result: makeResult({ summary: '付款条款有实质修改' }) },
    })
    expect(wrapper.text()).toContain('变更摘要')
    expect(wrapper.text()).toContain('付款条款有实质修改')
  })

  it('added 变更块渲染新增文本与「新增」徽标', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          changes: [{ type: 'added', index: 0, newText: '第三条 新增条款' }],
          totalChanges: 1,
        }),
      },
    })
    expect(wrapper.find('.badge-added').text()).toBe('新增')
    expect(wrapper.find('.added-text').text()).toBe('第三条 新增条款')
  })

  it('removed 变更块渲染删除文本', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          changes: [{ type: 'removed', index: 0, oldText: '旧条款内容' }],
          totalChanges: 1,
        }),
      },
    })
    expect(wrapper.find('.badge-removed').text()).toBe('删除')
    expect(wrapper.find('.removed-text').text()).toBe('旧条款内容')
  })

  it('modified 变更块同时渲染旧/新文本', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          changes: [{ type: 'modified', index: 0, oldText: '旧条款内容', newText: '新条款内容' }],
          totalChanges: 1,
        }),
      },
    })
    const texts = wrapper.findAll('.change-text').map((w) => w.text())
    expect(texts.some((t) => t.includes('旧条款内容'))).toBe(true)
    expect(texts.some((t) => t.includes('新条款内容'))).toBe(true)
  })

  it('剥离 <file_content> 防注入标签（不展示给用户）', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          changes: [{ type: 'added', index: 0, newText: '<file_content>新增内容</file_content>' }],
          totalChanges: 1,
        }),
      },
    })
    expect(wrapper.text()).toContain('新增内容')
    expect(wrapper.text()).not.toContain('file_content')
  })

  it('sectionTitle 章节标签展示', () => {
    const wrapper = mount(DiffResultView, {
      props: {
        result: makeResult({
          changes: [{ type: 'added', index: 0, newText: 'x', sectionTitle: '第三章 违约责任' }],
          totalChanges: 1,
        }),
      },
    })
    expect(wrapper.text()).toContain('第三章 违约责任')
  })

  it('完全相同文档（totalChanges=0）→ 显示一致提示', () => {
    const wrapper = mount(DiffResultView, {
      props: { result: makeResult() },
    })
    expect(wrapper.text()).toContain('两份文档内容一致，无差异')
    expect(wrapper.find('.diff-empty').exists()).toBe(true)
  })

  it('changes 缺失但有 totalChanges 时不显示「一致」空态（防误导）', () => {
    // 后端兜底异常场景：totalChanges>0 但 changes 为空 → 不显示「两份文档一致」
    const wrapper = mount(DiffResultView, {
      props: { result: makeResult({ totalChanges: 3 }) },
    })
    expect(wrapper.find('.diff-empty').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('无差异')
  })
})
