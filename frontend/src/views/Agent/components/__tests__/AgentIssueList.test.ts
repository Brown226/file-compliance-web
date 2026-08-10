/**
 * AgentIssueList 单元测试（审查结果卡片：标准引用/误报反馈/定位原文/搜索）
 *
 * 覆盖：
 * - 渲染问题卡片：计数/类型标签/描述/ruleCode
 * - 空列表 → 「暂无审查结果」；筛选无匹配 → 「无匹配结果」
 * - 搜索过滤（按描述/原文）
 * - 展开/收起卡片
 * - P1-⑦ 查看条文：standardRef 可解析 → 按钮出现 → 标准树查找 → router.push
 * - P2-⑧ 标记误报：确认 → api 调用 → 已反馈标记；取消 → 不调用
 * - P2-⑬ 定位原文：emit('locate-issue', issue)
 *
 * mock：@/api/agent、@/api/standard、vue-router、element-plus（ElMessage/ElMessageBox），
 * el-* 组件用轻量 stub（el-input 支持 v-model 以测搜索）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentIssueList from '../AgentIssueList.vue'

const { apiMock, standardsMock, routerMock, elMock } = vi.hoisted(() => ({
  apiMock: { markAgentIssueFalsePositiveApi: vi.fn() },
  standardsMock: { getStandardsApi: vi.fn(), getCheckpointsApi: vi.fn() },
  routerMock: { push: vi.fn() },
  elMock: {
    ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('@/api/standard', () => standardsMock)
vi.mock('vue-router', () => ({ useRouter: () => routerMock }))
vi.mock('element-plus', () => elMock)

const issues = [
  {
    id: 'i1',
    severity: 'error',
    issueType: 'VIOLATION',
    ruleCode: 'TYPO_001',
    description: '缺少法定代表签字',
    originalText: '签字栏为空',
    suggestedText: '补充签字',
    standardRef: 'GB/T 50001-2017 房屋建筑制图统一标准 · 3.0.2',
  },
  {
    id: 'i2',
    severity: 'warning',
    issueType: 'TYPO',
    ruleCode: 'TYPO_002',
    description: '错别字',
    originalText: '帐号',
  },
]

function mountList(props: Record<string, any> = {}) {
  return mount(AgentIssueList, {
    props: { issues, ...props },
    global: {
      stubs: {
        'el-icon': true,
        'el-tag': { template: '<span class="el-tag-stub"><slot /></span>' },
        'el-button': { template: '<button class="el-btn-stub" @click="$emit(\'click\', $event)"><slot /></button>' },
        'el-select': { template: '<div class="el-select-stub" />' },
        'el-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<input class="el-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  })
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  for (const fn of Object.values(standardsMock)) fn.mockReset()
  routerMock.push.mockReset()
  elMock.ElMessage.error.mockReset()
  elMock.ElMessage.warning.mockReset()
  elMock.ElMessageBox.confirm.mockReset()
  apiMock.markAgentIssueFalsePositiveApi.mockResolvedValue({ added: true })
  standardsMock.getStandardsApi.mockResolvedValue({
    data: { items: [{ id: 'std-1', standardNo: 'GB/T 50001-2017' }] },
  })
  standardsMock.getCheckpointsApi.mockResolvedValue({
    data: { checkpoints: [{ id: 'cl-1', clauseCode: '3.0.2' }] },
  })
})

describe('渲染', () => {
  it('渲染卡片计数、类型标签、描述、ruleCode', () => {
    const wrapper = mountList()
    const text = wrapper.text()
    expect(text).toContain('共 2 项')
    expect(text).toContain('违规')
    expect(text).toContain('缺少法定代表签字')
    expect(text).toContain('TYPO_001')
  })

  it('空列表 → 「暂无审查结果」', () => {
    const wrapper = mountList({ issues: [] })
    expect(wrapper.text()).toContain('暂无审查结果')
  })
})

describe('搜索过滤', () => {
  it('按描述关键词过滤', async () => {
    const wrapper = mountList()
    await wrapper.find('.el-input-stub').setValue('签字')
    expect(wrapper.text()).toContain('缺少法定代表签字')
    expect(wrapper.text()).not.toContain('错别字')
  })

  it('无匹配 → 「无匹配结果」', async () => {
    const wrapper = mountList()
    await wrapper.find('.el-input-stub').setValue('不存在的关键词')
    expect(wrapper.text()).toContain('无匹配结果')
  })
})

describe('展开/收起', () => {
  it('点击卡片头展开显示原文与建议，再点收起', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[0].trigger('click')
    expect(wrapper.text()).toContain('签字栏为空')
    expect(wrapper.text()).toContain('补充签字')
    await wrapper.findAll('.card-header')[0].trigger('click')
    expect(wrapper.text()).not.toContain('签字栏为空')
  })
})

describe('P1-⑦ 查看条文', () => {
  it('standardRef 可解析 → 显示「查看条文」按钮 → 点击跳转 /knowledge', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[0].trigger('click')
    const btn = wrapper.find('.ref-jump-btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()
    expect(standardsMock.getStandardsApi).toHaveBeenCalled()
    expect(routerMock.push).toHaveBeenCalledWith({
      path: '/knowledge',
      query: { tab: 'clauses', standardId: 'std-1', clauseId: 'cl-1' },
    })
  })

  it('不可解析的 standardRef 不显示按钮', async () => {
    const wrapper = mountList({
      issues: [{ id: 'x', severity: 'warning', description: 'd', standardRef: '内部规定' }],
    })
    await wrapper.findAll('.card-header')[0].trigger('click')
    expect(wrapper.find('.ref-jump-btn').exists()).toBe(false)
  })

  it('标准树未找到 → ElMessage.warning', async () => {
    standardsMock.getStandardsApi.mockResolvedValue({ data: { items: [] } })
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[0].trigger('click')
    await wrapper.find('.ref-jump-btn').trigger('click')
    await flushPromises()
    expect(elMock.ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('未找到标准'))
    expect(routerMock.push).not.toHaveBeenCalled()
  })
})

describe('P2-⑧ 标记误报', () => {
  it('确认后调用误报 API 并显示已反馈标记', async () => {
    elMock.ElMessageBox.confirm.mockResolvedValue('confirm')
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[1].trigger('click')
    await wrapper.find('.fp-btn').trigger('click')
    await flushPromises()
    expect(apiMock.markAgentIssueFalsePositiveApi).toHaveBeenCalledWith(
      expect.objectContaining({ originalText: '帐号', issueType: 'TYPO', reason: expect.stringContaining('误报') }),
    )
    expect(wrapper.text()).toContain('已反馈误报库')
  })

  it('用户取消确认 → 不调用 API', async () => {
    elMock.ElMessageBox.confirm.mockRejectedValue(new Error('cancel'))
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[1].trigger('click')
    await wrapper.find('.fp-btn').trigger('click')
    await flushPromises()
    expect(apiMock.markAgentIssueFalsePositiveApi).not.toHaveBeenCalled()
  })

  it('标记失败 → ElMessage.error', async () => {
    elMock.ElMessageBox.confirm.mockResolvedValue('confirm')
    apiMock.markAgentIssueFalsePositiveApi.mockRejectedValue(new Error('api down'))
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[1].trigger('click')
    await wrapper.find('.fp-btn').trigger('click')
    await flushPromises()
    expect(elMock.ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('标记失败'))
  })
})

describe('P2-⑬ 定位原文', () => {
  it('点击「定位原文」emit locate-issue(issue)', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.card-header')[0].trigger('click')
    await wrapper.find('.locate-btn').trigger('click')
    expect(wrapper.emitted('locate-issue')?.[0][0]).toMatchObject({ id: 'i1', originalText: '签字栏为空' })
  })
})
