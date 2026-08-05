/**
 * AgentSessionList 单元测试（会话列表：加载/复制/删除/重命名/新建）
 *
 * 覆盖：
 * - onMounted 加载会话列表（listSessionsApi(50)），标题/消息数渲染
 * - 加载失败 → ElMessage.error
 * - 空列表 → 「暂无历史会话」
 * - 复制会话：hover 出现操作按钮 → duplicateSessionApi → 刷新列表 + emit select(新会话)
 * - 删除流程：确认按钮出现 → deleteSessionApi → 列表移除
 * - 重命名：输入回车 commitRename → renameSessionApi
 * - 新建按钮 emit 'new-chat'；底部按钮 emit 'open-config'
 *
 * mock：@/api/agent（返回形状 { data: [...] }，与组件 res.data 读取一致）、element-plus 的 ElMessage。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentSessionList from '../AgentSessionList.vue'

const { apiMock, elMessageMock } = vi.hoisted(() => ({
  apiMock: {
    listSessionsApi: vi.fn(),
    deleteSessionApi: vi.fn(),
    renameSessionApi: vi.fn(),
    duplicateSessionApi: vi.fn(),
  },
  elMessageMock: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('element-plus', () => ({ ElMessage: elMessageMock }))

const sessions = [
  { id: 's1', title: '合同审查', messageCount: 5, updatedAt: '2026-08-01T10:00:00Z' },
  { id: 's2', title: '标书核对', messageCount: 2, updatedAt: '2026-07-30T10:00:00Z' },
]

function mountList(props: Record<string, any> = {}) {
  return mount(AgentSessionList, {
    props: { currentSessionId: null, ...props },
    global: { stubs: { 'el-icon': true } },
  })
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  elMessageMock.error.mockReset()
  apiMock.listSessionsApi.mockResolvedValue({ data: sessions })
  apiMock.duplicateSessionApi.mockResolvedValue({ data: { id: 's3', title: '合同审查（副本）' } })
  apiMock.deleteSessionApi.mockResolvedValue({ data: { success: true } })
  apiMock.renameSessionApi.mockResolvedValue({ data: { success: true } })
})

describe('加载', () => {
  it('onMounted 调用 listSessionsApi(50) 并渲染列表', async () => {
    const wrapper = mountList()
    await flushPromises()
    expect(apiMock.listSessionsApi).toHaveBeenCalledWith(50)
    expect(wrapper.text()).toContain('合同审查')
    expect(wrapper.text()).toContain('标书核对')
    expect(wrapper.text()).toContain('5 条消息')
  })

  it('加载失败 → ElMessage.error', async () => {
    apiMock.listSessionsApi.mockRejectedValue(new Error('network'))
    const wrapper = mountList()
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('加载会话列表失败'))
  })

  it('空列表 → 暂无历史会话', async () => {
    apiMock.listSessionsApi.mockResolvedValue({ data: [] })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.text()).toContain('暂无历史会话')
  })
})

describe('复制会话', () => {
  it('hover 出现复制按钮 → 复制成功刷新列表并 emit select 新会话', async () => {
    const wrapper = mountList()
    await flushPromises()
    // hover 第一个会话 → 出现操作按钮
    await wrapper.findAll('.session-item')[0].trigger('mouseenter')
    const duplicateBtn = wrapper.find('button[title="复制会话"]')
    expect(duplicateBtn.exists()).toBe(true)
    await duplicateBtn.trigger('click')

    expect(apiMock.duplicateSessionApi).toHaveBeenCalledWith('s1')
    await flushPromises()
    // 复制后重新加载列表（listSessionsApi 被再次调用）并 emit select
    expect(apiMock.listSessionsApi).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('select')?.[0]).toEqual(['s3'])
  })

  it('复制失败 → ElMessage.error', async () => {
    apiMock.duplicateSessionApi.mockRejectedValue(new Error('dup failed'))
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('.session-item')[0].trigger('mouseenter')
    await wrapper.find('button[title="复制会话"]').trigger('click')
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('复制会话失败'))
  })
})

describe('删除会话', () => {
  it('点击删除 → 确认按钮 → 确认后删除并移除列表项', async () => {
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('.session-item')[0].trigger('mouseenter')
    await wrapper.find('button[title="删除"]').trigger('click')
    // 确认态出现
    expect(wrapper.find('.confirm-btn.danger').text()).toBe('删除')
    await wrapper.find('.confirm-btn.danger').trigger('click')
    expect(apiMock.deleteSessionApi).toHaveBeenCalledWith('s1')
    await flushPromises()
    expect(wrapper.text()).not.toContain('合同审查')
    expect(wrapper.text()).toContain('标书核对')
  })

  it('删除失败 → ElMessage.error', async () => {
    apiMock.deleteSessionApi.mockRejectedValue(new Error('del failed'))
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('.session-item')[0].trigger('mouseenter')
    await wrapper.find('button[title="删除"]').trigger('click')
    await wrapper.find('.confirm-btn.danger').trigger('click')
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('删除失败'))
  })
})

describe('重命名', () => {
  it('点击重命名 → 输入新名回车 → renameSessionApi 并更新标题', async () => {
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('.session-item')[0].trigger('mouseenter')
    await wrapper.find('button[title="重命名"]').trigger('click')
    const input = wrapper.find('.rename-input')
    expect(input.exists()).toBe(true)
    await input.setValue('新标题')
    await input.trigger('keydown.enter')
    expect(apiMock.renameSessionApi).toHaveBeenCalledWith('s1', '新标题')
    await flushPromises()
    expect(wrapper.text()).toContain('新标题')
  })
})

describe('事件', () => {
  it('新建按钮 emit new-chat', async () => {
    const wrapper = mountList()
    await wrapper.find('.header-btn.primary').trigger('click')
    expect(wrapper.emitted('new-chat')).toBeTruthy()
  })

  it('底部按钮 emit open-config(models/skills/memory)', async () => {
    const wrapper = mountList()
    const footerBtns = wrapper.findAll('.footer-btn')
    await footerBtns[0].trigger('click')
    await footerBtns[1].trigger('click')
    await footerBtns[2].trigger('click')
    expect(wrapper.emitted('open-config')).toEqual([['models'], ['skills'], ['memory']])
  })

  it('点击会话项 emit select(sessionId)', async () => {
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('.session-item')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['s2'])
  })
})
