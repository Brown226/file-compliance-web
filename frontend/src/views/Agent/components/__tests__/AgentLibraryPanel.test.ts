/**
 * AgentLibraryPanel 单元测试（P2-⑭ 收藏列表 + 全局搜索）
 *
 * 覆盖：
 * - 打开弹窗自动加载收藏（watch modelValue）
 * - 收藏列表渲染（类型标签/标题/内容/日期）
 * - 空收藏 → 引导文案
 * - 删除收藏 → deleteAgentSaveApi + 列表移除
 * - 切换到搜索 tab → 回车/点击搜索 → searchAgentMessagesApi → 结果渲染
 * - 搜索结果「跳转」→ emit jump-to-session + 关闭弹窗
 * - 加载/搜索失败 → ElMessage.error
 *
 * mock：@/api/agent、element-plus；el-dialog 用渲染默认插槽的 stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentLibraryPanel from '../AgentLibraryPanel.vue'

const { apiMock, elMessageMock } = vi.hoisted(() => ({
  apiMock: {
    listAgentSavesApi: vi.fn(),
    deleteAgentSaveApi: vi.fn(),
    searchAgentMessagesApi: vi.fn(),
  },
  elMessageMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('element-plus', () => ({ ElMessage: elMessageMock }))

const saves = [
  { id: 'sv1', type: 'qa', title: '付款条款问答', content: '付款期限 30 日…', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'sv2', type: 'review', title: '合同审查报告', content: '发现 3 处问题…', createdAt: '2026-07-28T10:00:00Z' },
]

function mountPanel(props: Record<string, any> = {}) {
  return mount(AgentLibraryPanel, {
    // modelValue 默认 false，测试里 setProps 切换触发 watch 加载（与真实打开弹窗一致）
    props: { modelValue: false, currentSessionId: 's1', ...props },
    global: {
      stubs: {
        'el-dialog': { template: '<div class="el-dialog-stub"><slot /></div>' },
      },
    },
  })
}

/** 模拟打开弹窗：modelValue false → true 触发 watch 加载收藏 */
async function openPanel(wrapper: ReturnType<typeof mountPanel>) {
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  elMessageMock.error.mockReset()
  apiMock.listAgentSavesApi.mockResolvedValue({ data: saves })
  apiMock.deleteAgentSaveApi.mockResolvedValue({ data: { success: true } })
  apiMock.searchAgentMessagesApi.mockResolvedValue({
    data: [{ id: 'm1', sessionId: 'sess-1', role: 'assistant', sessionTitle: '会话A', content: '答案内容', createdAt: '2026-08-01T10:00:00Z' }],
  })
})

describe('收藏列表', () => {
  it('打开时自动加载收藏并渲染', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    expect(apiMock.listAgentSavesApi).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('付款条款问答')
    expect(text).toContain('问答')
    expect(text).toContain('审查')
    expect(text).toContain('2026-08-01')
  })

  it('空收藏 → 引导文案', async () => {
    apiMock.listAgentSavesApi.mockResolvedValue({ data: [] })
    const wrapper = mountPanel()
    await openPanel(wrapper)
    expect(wrapper.text()).toContain('暂无收藏')
  })

  it('删除收藏 → API 调用 + 列表移除', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.findAll('.lib-item')[0].findAll('button')[1].trigger('click')
    await flushPromises()
    expect(apiMock.deleteAgentSaveApi).toHaveBeenCalledWith('sv1')
    expect(wrapper.text()).not.toContain('付款条款问答')
    expect(wrapper.text()).toContain('合同审查报告')
  })

  it('删除失败 → ElMessage.error', async () => {
    apiMock.deleteAgentSaveApi.mockRejectedValue(new Error('del down'))
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.findAll('.lib-item')[0].findAll('button')[1].trigger('click')
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('删除失败'))
  })
})

describe('全局搜索', () => {
  it('输入关键词点击搜索 → searchAgentMessagesApi + 结果渲染', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    // 切到搜索 tab
    await wrapper.findAll('.lib-tab')[1].trigger('click')
    await wrapper.find('.lib-search-input').setValue('付款')
    await wrapper.find('.lib-btn.primary').trigger('click')
    await flushPromises()
    expect(apiMock.searchAgentMessagesApi).toHaveBeenCalledWith('付款')
    expect(wrapper.text()).toContain('答案内容')
    expect(wrapper.text()).toContain('回答')
  })

  it('搜索失败 → ElMessage.error', async () => {
    apiMock.searchAgentMessagesApi.mockRejectedValue(new Error('search down'))
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.findAll('.lib-tab')[1].trigger('click')
    await wrapper.find('.lib-search-input').setValue('x')
    await wrapper.find('.lib-btn.primary').trigger('click')
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('搜索失败'))
  })

  it('点击「跳转」→ emit jump-to-session + 关闭弹窗', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.findAll('.lib-tab')[1].trigger('click')
    await wrapper.find('.lib-search-input').setValue('付款')
    await wrapper.find('.lib-btn.primary').trigger('click')
    await flushPromises()
    await wrapper.find('button[title="跳转到该消息"]').trigger('click')
    expect(wrapper.emitted('jump-to-session')?.[0]).toEqual(['sess-1', 'm1'])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
})
