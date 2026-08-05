/**
 * AgentMemoryPanel 单元测试（记忆管理面板：列表/删除/编辑）
 *
 * 覆盖：
 * - onMounted 加载记忆列表（类型标签/作用域/置信度/键/值渲染）
 * - 空列表 → 空态提示
 * - 加载失败 → ElMessage.error
 * - 删除：确认 → deleteMemoryApi + 列表移除；取消 → 不调用
 * - 编辑：点击编辑图标 → 弹窗显示 key → 保存调 updateMemoryApi
 *
 * mock：@/api/agent、element-plus；el-* 组件轻量 stub（el-input 支持 v-model）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentMemoryPanel from '../AgentMemoryPanel.vue'

const { apiMock, elMock } = vi.hoisted(() => ({
  apiMock: { listMemoriesApi: vi.fn(), updateMemoryApi: vi.fn(), deleteMemoryApi: vi.fn() },
  elMock: {
    ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('element-plus', () => elMock)

const memories = [
  { id: 'm1', type: 'preference', key: '报告格式', scope: 'global', confidence: 0.9, value: '使用 Markdown', source: '用户对话' },
  { id: 'm2', type: 'feedback', key: '审查偏好', scope: 'project', confidence: 0.7, value: '关注付款条款', source: '' },
]

function mountPanel() {
  return mount(AgentMemoryPanel, {
    global: {
      stubs: {
        'el-icon': true,
        'el-dialog': { template: '<div class="el-dialog-stub"><slot /></div>' },
        'el-select': { template: '<div class="el-select-stub" />' },
        'el-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<input class="el-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'el-button': { template: '<button class="el-btn-stub" @click="$emit(\'click\', $event)"><slot /></button>' },
      },
    },
  })
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  elMock.ElMessage.error.mockReset()
  elMock.ElMessage.warning.mockReset()
  elMock.ElMessageBox.confirm.mockReset()
  apiMock.listMemoriesApi.mockResolvedValue({ data: memories })
  apiMock.updateMemoryApi.mockResolvedValue({ data: { success: true } })
  apiMock.deleteMemoryApi.mockResolvedValue({ data: { success: true } })
})

describe('列表', () => {
  it('onMounted 加载记忆并渲染类型/作用域/置信度/值', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(apiMock.listMemoriesApi).toHaveBeenCalledWith({})
    const text = wrapper.text()
    expect(text).toContain('偏好')
    expect(text).toContain('报告格式')
    expect(text).toContain('全局')
    expect(text).toContain('90%')
    expect(text).toContain('使用 Markdown')
    expect(text).toContain('反馈')
    expect(text).toContain('项目')
  })

  it('空列表 → 空态提示', async () => {
    apiMock.listMemoriesApi.mockResolvedValue({ data: [] })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('暂无记忆')
  })

  it('加载失败 → ElMessage.error', async () => {
    apiMock.listMemoriesApi.mockRejectedValue(new Error('mem down'))
    const wrapper = mountPanel()
    await flushPromises()
    expect(elMock.ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('加载记忆失败'))
  })

  it('刷新按钮 → 重新加载', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('.btn-refresh').trigger('click')
    await flushPromises()
    expect(apiMock.listMemoriesApi).toHaveBeenCalledTimes(2)
  })
})

describe('删除', () => {
  it('确认后删除 → API 调用 + 列表移除', async () => {
    elMock.ElMessageBox.confirm.mockResolvedValue('confirm')
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.action-icon.danger')[0].trigger('click')
    await flushPromises()
    expect(apiMock.deleteMemoryApi).toHaveBeenCalledWith('m1')
    expect(wrapper.text()).not.toContain('报告格式')
    expect(wrapper.text()).toContain('审查偏好')
  })

  it('用户取消 → 不调用删除 API', async () => {
    elMock.ElMessageBox.confirm.mockRejectedValue('cancel')
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.action-icon.danger')[0].trigger('click')
    await flushPromises()
    expect(apiMock.deleteMemoryApi).not.toHaveBeenCalled()
  })
})

describe('编辑', () => {
  it('点击编辑图标 → 弹窗显示 key → 保存调 updateMemoryApi', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.action-icon')[0].trigger('click')
    // 弹窗出现，显示不可改的 key
    expect(wrapper.find('.edit-key').text()).toBe('报告格式')
    // 修改值后保存
    await wrapper.find('.el-input-stub').setValue('使用 Word')
    await wrapper.findAll('.el-btn-stub')[1].trigger('click')
    await flushPromises()
    expect(apiMock.updateMemoryApi).toHaveBeenCalledWith('m1', { value: '使用 Word', confidence: 0.9 })
  })

  it('记忆值为空 → ElMessage.warning 不保存', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.action-icon')[0].trigger('click')
    await wrapper.find('.el-input-stub').setValue('   ')
    await wrapper.findAll('.el-btn-stub')[1].trigger('click')
    await flushPromises()
    expect(elMock.ElMessage.warning).toHaveBeenCalledWith('记忆值不能为空')
    expect(apiMock.updateMemoryApi).not.toHaveBeenCalled()
  })
})
