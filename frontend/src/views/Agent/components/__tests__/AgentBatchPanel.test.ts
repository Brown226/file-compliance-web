/**
 * AgentBatchPanel 单元测试（P1-② 批量文档处理面板）
 *
 * 覆盖：
 * - 无可用文件 → 提示 + 提交禁用
 * - 选择文件/任务 → 提交启用 → submitBatchApi 载荷正确
 * - 提交后启动轮询：进度渲染 → COMPLETED 停止轮询并显示结果摘要
 * - 提交失败 → ElMessage.error
 * - 取消任务：cancelBatchApi 调用
 * - 最多选 10 个文件警告
 *
 * mock：@/api/agent；el-dialog 用渲染默认插槽的 stub；轮询用 fake timers 控制。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentBatchPanel from '../AgentBatchPanel.vue'

const { apiMock, elMessageMock } = vi.hoisted(() => ({
  apiMock: {
    submitBatchApi: vi.fn(), getBatchApi: vi.fn(), cancelBatchApi: vi.fn(),
    listBatchApi: vi.fn().mockResolvedValue({ data: { records: [], total: 0 } }),
  },
  elMessageMock: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('element-plus', () => ({ ElMessage: elMessageMock }))

const files = [
  { name: '合同.docx', size: 1024, path: '/uploads/agent_temp/u1/2026-08-05/合同.docx' },
  { name: '标书.pdf', size: 2048, path: '/uploads/agent_temp/u1/2026-08-05/标书.pdf' },
]

function mountPanel(props: Record<string, any> = {}) {
  return mount(AgentBatchPanel, {
    props: { modelValue: true, uploadedFiles: files, ...props },
    global: {
      stubs: {
        'el-dialog': { template: '<div class="el-dialog-stub"><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  elMessageMock.error.mockReset()
  elMessageMock.warning.mockReset()
  apiMock.submitBatchApi.mockResolvedValue({ data: { id: 'job-1' } })
  apiMock.getBatchApi.mockResolvedValue({
    data: { id: 'job-1', status: 'PENDING', progress: 0, result: null },
  })
  apiMock.cancelBatchApi.mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('文件与任务选择', () => {
  it('无可用文件 → 提示且提交按钮禁用', () => {
    const wrapper = mountPanel({ uploadedFiles: [] })
    expect(wrapper.text()).toContain('还没有可处理的文件')
    expect((wrapper.find('.batch-submit').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('选择文件与任务后提交按钮启用', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.batch-file-check')[0].setValue(true)
    await wrapper.findAll('.batch-task-item input')[0].setValue(true)
    expect((wrapper.find('.batch-submit').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('超过 10 个文件 → ElMessage.warning', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}.txt`, size: 1, path: `/p/${i}.txt`,
    }))
    const wrapper = mountPanel({ uploadedFiles: many })
    for (const box of wrapper.findAll('.batch-file-check')) {
      await box.setValue(true)
    }
    expect(elMessageMock.warning).toHaveBeenCalledWith(expect.stringContaining('最多选择 10 个'))
  })
})

describe('提交与轮询', () => {
  it('提交 → submitBatchApi 载荷为所选文件+任务 → 开始轮询 → COMPLETED 显示结果', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const wrapper = mountPanel()
    await wrapper.findAll('.batch-file-check')[0].setValue(true)
    await wrapper.findAll('.batch-file-check')[1].setValue(true)
    await wrapper.findAll('.batch-task-item input')[0].setValue(true)
    await wrapper.findAll('.batch-task-item input')[3].setValue(true)

    await wrapper.find('.batch-submit').trigger('click')
    await flushPromises()

    // 载荷：两个文件 × {extract, review} 子任务
    expect(apiMock.submitBatchApi).toHaveBeenCalledTimes(1)
    const payload = apiMock.submitBatchApi.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toEqual({ filePath: files[0].path, tasks: ['extract', 'review'] })

    // 轮询第一拍：PENDING
    await vi.advanceTimersByTimeAsync(2000)
    expect(apiMock.getBatchApi).toHaveBeenCalledWith('job-1')

    // 轮询第二拍：COMPLETED → 停止轮询 + 摘要
    apiMock.getBatchApi.mockResolvedValue({
      data: {
        id: 'job-1',
        status: 'COMPLETED',
        progress: 100,
        result: { total: 2, succeeded: 2, failed: 0, results: [{ fileName: '合同.docx', ok: true, extract: { textLength: 100 } }] },
      },
    })
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(wrapper.text()).toContain('成功 2')
    expect(wrapper.text()).toContain('100%')
  })

  it('提交失败 → ElMessage.error', async () => {
    apiMock.submitBatchApi.mockRejectedValue(new Error('submit down'))
    const wrapper = mountPanel()
    await wrapper.findAll('.batch-file-check')[0].setValue(true)
    await wrapper.findAll('.batch-task-item input')[0].setValue(true)
    await wrapper.find('.batch-submit').trigger('click')
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('提交失败'))
  })

  it('任务 FAILED → 停止轮询并提示', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const wrapper = mountPanel()
    await wrapper.findAll('.batch-file-check')[0].setValue(true)
    await wrapper.findAll('.batch-task-item input')[0].setValue(true)
    await wrapper.find('.batch-submit').trigger('click')
    await flushPromises()
    apiMock.getBatchApi.mockResolvedValue({
      data: { id: 'job-1', status: 'FAILED', progress: 50, error: 'parse error' },
    })
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith('批量任务失败')
    expect(wrapper.text()).toContain('parse error')
  })
})

describe('取消', () => {
  it('PENDING 时可取消 → cancelBatchApi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const wrapper = mountPanel()
    await wrapper.findAll('.batch-file-check')[0].setValue(true)
    await wrapper.findAll('.batch-task-item input')[0].setValue(true)
    await wrapper.find('.batch-submit').trigger('click')
    await flushPromises()
    // 取消按钮在 PENDING 时出现
    await wrapper.find('.batch-cancel').trigger('click')
    await flushPromises()
    expect(apiMock.cancelBatchApi).toHaveBeenCalledWith('job-1')
  })
})
