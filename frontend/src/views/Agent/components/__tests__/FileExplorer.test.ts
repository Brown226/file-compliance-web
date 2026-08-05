/**
 * FileExplorer 单元测试（⑳ 文件树/目录浏览）
 *
 * 覆盖：
 * - onMounted 加载根目录并自动浏览第一个根
 * - 目录/文件条目渲染（文件名 + 文件大小）
 * - 点击目录 → 浏览子目录；点击文件 → emit select-file
 * - 返回上级 → 浏览父目录
 * - 空目录 → （空目录）提示
 * - 加载失败 → ElMessage.error
 *
 * mock：@/api/agent；el-select 用 stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileExplorer from '../FileExplorer.vue'

const { apiMock, elMessageMock } = vi.hoisted(() => ({
  apiMock: { browseDirectoriesApi: vi.fn() },
  elMessageMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('element-plus', () => ({ ElMessage: elMessageMock }))

const roots = [
  { name: '我的文件', path: '/root' },
  { name: '共享目录', path: '/shared' },
]
const rootEntries = [
  { type: 'dir', name: '合同', path: '/root/合同', size: 0 },
  { type: 'file', name: '标书.pdf', path: '/root/标书.pdf', size: 2048 },
]

function mountExplorer() {
  return mount(FileExplorer, {
    global: { stubs: { 'el-select': { template: '<div class="el-select-stub" />' } } },
  })
}

beforeEach(() => {
  apiMock.browseDirectoriesApi.mockReset()
  elMessageMock.error.mockReset()
  apiMock.browseDirectoriesApi.mockImplementation((path?: string) =>
    Promise.resolve({
      data: path === undefined
        ? { roots, root: '/root', entries: rootEntries }
        : { root: path, entries: rootEntries },
    }),
  )
})

describe('加载', () => {
  it('onMounted 加载根目录并自动浏览第一个根', async () => {
    const wrapper = mountExplorer()
    await flushPromises()
    // browseDirectoriesApi 调两次：无参(roots) + 第一个根路径
    expect(apiMock.browseDirectoriesApi).toHaveBeenNthCalledWith(1)
    expect(apiMock.browseDirectoriesApi).toHaveBeenNthCalledWith(2, '/root')
    expect(wrapper.text()).toContain('合同')
    expect(wrapper.text()).toContain('标书.pdf')
    expect(wrapper.text()).toContain('2.0 KB')
  })

  it('加载根目录失败 → ElMessage.error', async () => {
    apiMock.browseDirectoriesApi.mockRejectedValue(new Error('browse down'))
    const wrapper = mountExplorer()
    await flushPromises()
    expect(elMessageMock.error).toHaveBeenCalledWith(expect.stringContaining('加载目录失败'))
  })

  it('空目录 → （空目录）提示', async () => {
    apiMock.browseDirectoriesApi.mockResolvedValue({ data: { roots, root: '/root', entries: [] } })
    const wrapper = mountExplorer()
    await flushPromises()
    expect(wrapper.text()).toContain('（空目录）')
  })
})

describe('条目交互', () => {
  it('点击目录 → 浏览子目录', async () => {
    const wrapper = mountExplorer()
    await flushPromises()
    await wrapper.findAll('.entry-item')[0].trigger('click')
    expect(apiMock.browseDirectoriesApi).toHaveBeenCalledWith('/root/合同')
  })

  it('点击文件 → emit select-file(path, name)', async () => {
    const wrapper = mountExplorer()
    await flushPromises()
    await wrapper.findAll('.entry-item')[1].trigger('click')
    expect(wrapper.emitted('select-file')?.[0]).toEqual(['/root/标书.pdf', '标书.pdf'])
  })

  it('返回上级 → 浏览父目录', async () => {
    apiMock.browseDirectoriesApi.mockImplementation((path?: string) =>
      Promise.resolve({
        data: path === undefined
          ? { roots, root: '/root', entries: rootEntries }
          : { root: path, entries: rootEntries },
      }),
    )
    const wrapper = mountExplorer()
    await flushPromises()
    // 进入子目录
    await wrapper.findAll('.entry-item')[0].trigger('click')
    expect(apiMock.browseDirectoriesApi).toHaveBeenCalledWith('/root/合同')
    // 返回上级
    await wrapper.find('.path-btn').trigger('click')
    expect(apiMock.browseDirectoriesApi).toHaveBeenCalledWith('/root')
  })
})
