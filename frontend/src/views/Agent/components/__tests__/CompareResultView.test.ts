/**
 * CompareResultView 单元测试（P2-⑩ 多文档对比问答结果展示）
 *
 * 覆盖：
 * - 结论渲染（缺省「未生成结论」）
 * - 命中统计（A 命中 / B 命中 / 比对项数）
 * - 主题级对比表：主题/状态/双方表述
 * - 三种状态着色 class（consistent/inconsistent/missing）与中文标签
 * - 空表述 → 占位符 —
 * - 无对比条目 → 「无对比条目」提示
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CompareResultView from '../CompareResultView.vue'

const sampleResult = {
  conclusion: '接地电阻要求不一致',
  items: [
    { topic: '接地电阻', status: 'inconsistent', docAText: '1 欧姆', docBText: '4 欧姆' },
    { topic: '消防疏散距离', status: 'missing', docAText: '有表述', docBText: '' },
    { topic: '防水等级', status: 'consistent', docAText: 'IP65', docBText: 'IP65' },
  ],
  docAHits: 3,
  docBHits: 2,
  totalCompared: 3,
}

describe('CompareResultView', () => {
  it('渲染结论与命中统计', () => {
    const wrapper = mount(CompareResultView, { props: { result: sampleResult } })
    const text = wrapper.text()
    expect(text).toContain('接地电阻要求不一致')
    expect(text).toContain('A 命中 3 段')
    expect(text).toContain('B 命中 2 段')
    expect(text).toContain('比对 3 项')
  })

  it('渲染主题/状态/双方表述', () => {
    const wrapper = mount(CompareResultView, { props: { result: sampleResult } })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(wrapper.text()).toContain('接地电阻')
    expect(wrapper.text()).toContain('1 欧姆')
    expect(wrapper.text()).toContain('4 欧姆')
  })

  it('三种状态的中文标签与着色 class', () => {
    const wrapper = mount(CompareResultView, { props: { result: sampleResult } })
    const statuses = wrapper.findAll('.crv-status').map((w) => ({
      text: w.text(),
      cls: w.classes().find((c) => String(c).startsWith('st-')),
    }))
    expect(statuses).toEqual([
      { text: '不一致', cls: 'st-inconsistent' },
      { text: '缺失', cls: 'st-missing' },
      { text: '一致', cls: 'st-consistent' },
    ])
  })

  it('空表述显示占位符 —', () => {
    const wrapper = mount(CompareResultView, { props: { result: sampleResult } })
    // missing 项 docBText 为空 → —
    expect(wrapper.findAll('.crv-text').map((w) => w.text())).toContain('—')
  })

  it('result 缺省结论 → 「未生成结论」', () => {
    const wrapper = mount(CompareResultView, { props: { result: null } })
    expect(wrapper.text()).toContain('未生成结论')
  })

  it('无对比条目 → 提示', () => {
    const wrapper = mount(CompareResultView, {
      props: { result: { conclusion: '未检索到可比对内容', items: [] } },
    })
    expect(wrapper.text()).toContain('无对比条目')
    expect(wrapper.text()).toContain('未检索到可比对内容')
  })
})
