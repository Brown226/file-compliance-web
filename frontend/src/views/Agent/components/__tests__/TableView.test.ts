/**
 * TableView 单元测试（P1-③ 表格提取结构化展示）
 *
 * 覆盖：
 * - 统计行（表格数 / 总行数 / CSV 提示）
 * - 表头 + 数据行渲染
 * - sheetName / 页码标签
 * - 空表格（rows=[]）→ （空表格）占位
 * - 无表格 → 「未提取到表格」
 * - result=null / 非数组 → 容错
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TableView from '../TableView.vue'

const sampleTable = {
  sheetName: 'Sheet1',
  page: 2,
  headers: ['名称', '数量'],
  rows: [['A', '1'], ['B', '2']],
}

describe('TableView', () => {
  it('统计行渲染表格数与总行数', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [sampleTable], count: 1, totalRows: 2 } },
    })
    const text = wrapper.text()
    expect(text).toContain('共 1 个表格')
    expect(text).toContain('合计 2 行')
  })

  it('有 csv 时显示提示', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [sampleTable], count: 1, totalRows: 2, csv: 'a,b' } },
    })
    expect(wrapper.text()).toContain('CSV 已生成')
  })

  it('渲染表头与全部数据行', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [sampleTable], count: 1, totalRows: 2 } },
    })
    const ths = wrapper.findAll('th').map((w) => w.text())
    expect(ths).toEqual(['名称', '数量'])
    const tds = wrapper.findAll('td').map((w) => w.text())
    expect(tds).toEqual(['A', '1', 'B', '2'])
  })

  it('展示 sheetName 与页码标签', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [sampleTable], count: 1, totalRows: 2 } },
    })
    expect(wrapper.text()).toContain('Sheet1')
    expect(wrapper.text()).toContain('第 2 页')
  })

  it('空表格（rows=[]）→ 显示（空表格）占位', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [{ headers: ['A'], rows: [] }], count: 1, totalRows: 0 } },
    })
    expect(wrapper.text()).toContain('（空表格）')
  })

  it('无表格 → 「未提取到表格」', () => {
    const wrapper = mount(TableView, {
      props: { result: { tables: [], count: 0, totalRows: 0 } },
    })
    expect(wrapper.text()).toContain('未提取到表格')
  })

  it('result=null / tables 非数组 → 容错显示未提取', () => {
    const wrapper = mount(TableView, { props: { result: null } })
    expect(wrapper.text()).toContain('未提取到表格')
  })
})
