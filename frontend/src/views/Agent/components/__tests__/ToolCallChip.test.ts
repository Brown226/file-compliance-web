/**
 * ToolCallChip 单元测试（P1-⑫ 工具调用块展示）
 *
 * 覆盖：
 * - 默认折叠，点击展开/收起
 * - 工具名映射（中文标签 / type='tool-xxx' 前缀 / 未知兜底）
 * - 状态：running（执行中）/ success / error（data-status + 提示）
 * - compare_documents → DiffResultView 子组件接收 result
 * - extract_tables → TableView 子组件
 * - compare_knowledge → CompareResultView 子组件
 * - 普通结果文本渲染（对象 JSON 化 / issues 汇总）
 * - 输入参数展示 / 耗时展示
 *
 * 兄弟组件用 vi.mock 替换为轻量 stub（只透传 result prop）。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, defineComponent } from '@vue/test-utils'
import ToolCallChip from '../ToolCallChip.vue'

// —— Stub 兄弟组件：纯对象组件（vi.mock 工厂被提升，不能引用外部变量）——
vi.mock('../DiffResultView.vue', () => ({
  default: { name: 'DiffResultViewStub', props: ['result'], template: '<div class="stub-diff" />' },
}))
vi.mock('../TableView.vue', () => ({
  default: { name: 'TableViewStub', props: ['result'], template: '<div class="stub-table" />' },
}))
vi.mock('../CompareResultView.vue', () => ({
  default: { name: 'CompareResultViewStub', props: ['result'], template: '<div class="stub-compare" />' },
}))

function makePart(overrides: Record<string, any> = {}) {
  return {
    type: 'tool-search_knowledge',
    toolCallId: 'tc1',
    input: { query: '合同' },
    state: 'output-available',
    output: '结果文本',
    ...overrides,
  }
}

function mountChip(part: Record<string, any>) {
  return mount(ToolCallChip, { props: { part } })
}

describe('折叠/展开交互', () => {
  it('默认折叠：正文不显示', () => {
    const wrapper = mountChip(makePart())
    expect(wrapper.find('.tool-call-body').exists()).toBe(false)
  })

  it('点击头部展开，再点收起', async () => {
    const wrapper = mountChip(makePart())
    await wrapper.find('.tool-call-header').trigger('click')
    expect(wrapper.find('.tool-call-body').exists()).toBe(true)
    await wrapper.find('.tool-call-header').trigger('click')
    expect(wrapper.find('.tool-call-body').exists()).toBe(false)
  })
})

describe('工具名映射', () => {
  it('已知工具名映射为中文标签', () => {
    const wrapper = mountChip(makePart())
    expect(wrapper.find('.tool-name').text()).toBe('知识检索')
  })

  it('type=tool-xxx 前缀解析（无独立 toolName）', () => {
    const wrapper = mountChip(makePart({ type: 'tool-upload_file' }))
    expect(wrapper.find('.tool-name').text()).toBe('上传文件')
  })

  it('未知工具名原样展示', () => {
    const wrapper = mountChip(makePart({ type: 'tool-custom_tool' }))
    expect(wrapper.find('.tool-name').text()).toBe('custom_tool')
  })
})

describe('状态渲染', () => {
  it('running → data-status=running + 执行中提示', async () => {
    const wrapper = mountChip(makePart({ state: 'input-streaming' }))
    expect(wrapper.find('.tool-call-block').attributes('data-status')).toBe('running')
    await awaitExpand(wrapper)
    expect(wrapper.text()).toContain('执行中')
  })

  it('output-error → data-status=error', () => {
    const wrapper = mountChip(makePart({ state: 'output-error', errorText: 'llm down' }))
    expect(wrapper.find('.tool-call-block').attributes('data-status')).toBe('error')
  })

  it('output-available → data-status=success', () => {
    const wrapper = mountChip(makePart())
    expect(wrapper.find('.tool-call-block').attributes('data-status')).toBe('success')
  })
})

describe('结构化结果路由', () => {
  it('compare_documents 结果传给 DiffResultView', async () => {
    const output = { changes: [{ type: 'added' }], stats: { added: 1, removed: 0, modified: 0, unchanged: 0 }, totalChanges: 1 }
    const wrapper = mountChip(makePart({ type: 'tool-compare_documents', output }))
    await awaitExpand(wrapper)
    const stub = wrapper.findComponent({ name: 'DiffResultViewStub' })
    expect(stub.exists()).toBe(true)
    expect(stub.props('result')).toEqual(output)
  })

  it('extract_tables 结果传给 TableView', async () => {
    const output = { tables: [{ headers: ['A'], rows: [['1']] }], count: 1, totalRows: 1 }
    const wrapper = mountChip(makePart({ type: 'tool-extract_tables', output }))
    await awaitExpand(wrapper)
    const stub = wrapper.findComponent({ name: 'TableViewStub' })
    expect(stub.exists()).toBe(true)
    expect(stub.props('result')).toEqual(output)
  })

  it('compare_knowledge 结果传给 CompareResultView', async () => {
    const output = { conclusion: '不一致', items: [{ topic: 'x', status: 'inconsistent' }] }
    const wrapper = mountChip(makePart({ type: 'tool-compare_knowledge', output }))
    await awaitExpand(wrapper)
    const stub = wrapper.findComponent({ name: 'CompareResultViewStub' })
    expect(stub.exists()).toBe(true)
    expect(stub.props('result')).toEqual(output)
  })
})

describe('结果文本', () => {
  it('字符串结果直接展示', async () => {
    const wrapper = mountChip(makePart({ output: '提取完成' }))
    await awaitExpand(wrapper)
    expect(wrapper.find('.paired-result pre').text()).toBe('提取完成')
  })

  it('对象结果 JSON 化展示', async () => {
    const wrapper = mountChip(makePart({ output: { a: 1, b: 2 } }))
    await awaitExpand(wrapper)
    expect(wrapper.find('.paired-result pre').text()).toContain('"a": 1')
  })

  it('issues 数组汇总为条数', async () => {
    const wrapper = mountChip(makePart({ output: { issues: [{}, {}, {}] } }))
    await awaitExpand(wrapper)
    expect(wrapper.find('.paired-result pre').text()).toBe('共 3 条问题')
  })

  it('耗时展示（<1000ms 用 ms，≥1000ms 用 s）', () => {
    const wrapper = mountChip(makePart({ output: { durationMs: 500 } }))
    expect(wrapper.find('.tool-duration').text()).toBe('500ms')
    const wrapper2 = mountChip(makePart({ output: { durationMs: 2500 } }))
    expect(wrapper2.find('.tool-duration').text()).toBe('2.5s')
  })

  it('输入参数展示', async () => {
    const wrapper = mountChip(makePart({ input: { query: '合同', topK: 5 } }))
    await awaitExpand(wrapper)
    expect(wrapper.find('.input-pre').text()).toContain('合同')
  })
})

async function awaitExpand(wrapper: ReturnType<typeof mountChip>) {
  await wrapper.find('.tool-call-header').trigger('click')
}
