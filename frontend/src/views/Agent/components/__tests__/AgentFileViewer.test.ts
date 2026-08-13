/**
 * AgentFileViewer 单元测试（文件查看器：文本/页码锚点/行高亮/docx/xlsx）
 *
 * 覆盖：
 * - 文本加载：路径/元信息/内容渲染（markdown → v-html）
 * - 加载失败 → ElMessage.error + 错误态
 * - P0-⑨ 页码锚点定位：命中 → 提示已定位；未命中 → 未找到提示；filePath 不匹配 → 忽略
 * - P2-⑬ 原文关键字定位：命中/未命中
 * - P2-⑬ 行号区间定位：命中/超范围
 * - docx 分支：复用 DocxPreviewPanel（blob URL 传入，统一方案）
 * - xlsx 分支：复用 ExcelPreviewPanel（blob URL 传入，统一方案）
 *
 * mock：@/api/agent、useMarkdown（每行包 <p>，让定位函数可命中 DOM）、
 * element-plus；stub scrollIntoView / URL.createObjectURL（jsdom 未实现）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentFileViewer from '../AgentFileViewer.vue'
import DocxPreviewPanel from '@/views/TaskDetails/DocxPreviewPanel.vue'
import ExcelPreviewPanel from '@/views/TaskDetails/ExcelPreviewPanel.vue'

const { apiMock, mdMock, elMessageMock } = vi.hoisted(() => ({
  apiMock: { readAgentFileApi: vi.fn() },
  mdMock: { renderMarkdown: vi.fn() },
  elMessageMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/api/agent', () => apiMock)
vi.mock('@/composables/useMarkdown', () => ({ useMarkdown: () => ({ renderMarkdown: mdMock.renderMarkdown }) }))
vi.mock('element-plus', () => ({ ElMessage: elMessageMock }))

const TEXT_FILE = {
  filePath: '/uploads/agent_temp/u1/2026-08-05/a.txt',
  fileName: 'a.txt',
  ext: 'txt',
  size: 1024,
  kind: 'text',
  content: 'line1\nline2\n第3页\nline4',
  base64: '',
  mime: 'text/plain',
}

function mountViewer(props: Record<string, any> = {}) {
  // attachTo document.body：定位函数用 document.querySelector('.fv-content') 找 DOM
  return mount(AgentFileViewer, {
    props: { filePath: TEXT_FILE.filePath, locate: null, ...props },
    attachTo: document.body,
    global: {
      stubs: { 'el-icon': true },
    },
  })
}

beforeEach(() => {
  apiMock.readAgentFileApi.mockReset()
  mdMock.renderMarkdown.mockReset()
  elMessageMock.error.mockReset()
  apiMock.readAgentFileApi.mockResolvedValue({ data: { ...TEXT_FILE } })
  // 每行包 <p>：让页码/文本/行号定位能命中 DOM 块
  mdMock.renderMarkdown.mockImplementation((s: string) =>
    s.split('\n').map((l: string) => `<p>${l}</p>`).join(''),
  )
  // jsdom 未实现 scrollIntoView / URL.createObjectURL
  Element.prototype.scrollIntoView = vi.fn() as any
  URL.createObjectURL = vi.fn(() => 'blob:mock-url') as any
  URL.revokeObjectURL = vi.fn() as any
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadText(wrapper: ReturnType<typeof mountViewer>) {
  await flushPromises()
}

describe('文本加载', () => {
  it('渲染路径、元信息与内容', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    expect(apiMock.readAgentFileApi).toHaveBeenCalledWith(TEXT_FILE.filePath)
    expect(wrapper.text()).toContain('u1/2026-08-05/a.txt')
    expect(wrapper.text()).toContain('txt · 1.0KB · text')
    // 内容经 renderMarkdown 渲染为 <p>
    expect(wrapper.find('.fv-text-body').html()).toContain('<p>line1</p>')
  })

  it('加载失败 → ElMessage.error + 错误态', async () => {
    apiMock.readAgentFileApi.mockRejectedValue({ message: 'file not found' })
    const wrapper = mountViewer()
    await loadText(wrapper)
    expect(elMessageMock.error).toHaveBeenCalledWith('file not found')
    expect(wrapper.find('.fv-error-text').exists()).toBe(true)
  })
})

describe('P0-⑨ 页码锚点定位', () => {
  it('命中页码标记 → 已定位提示', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, page: 3 } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('已定位到第 3 页')
  })

  it('未命中页码标记 → 未找到提示（is-miss 样式）', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, page: 9 } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('未找到第 9 页')
    expect(wrapper.find('.fv-locate-notice.is-miss').exists()).toBe(true)
  })

  it('locate.filePath 与当前文件不符 → 忽略', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: '/other.txt', page: 3 } })
    expect(wrapper.find('.fv-locate-notice').exists()).toBe(false)
  })
})

describe('P2-⑬ 行级批注', () => {
  it('原文关键字定位：命中 → 已定位提示', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, highlight: 'line2' } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('已定位到「line2」')
  })

  it('原文关键字未命中 → 未找到提示', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, highlight: '不存在的词' } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('未找到文本')
  })

  it('行号区间定位：命中 → 已定位到第 N 行', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, highlightLines: [2, 2] } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('已定位到第 2 行')
  })

  it('行号超出范围 → 提示文件行数', async () => {
    const wrapper = mountViewer()
    await loadText(wrapper)
    await wrapper.setProps({ locate: { filePath: TEXT_FILE.filePath, highlightLines: [99, 99] } })
    expect(wrapper.find('.fv-locate-notice').text()).toContain('文件共 4 行，行号 99 超出范围')
  })
})

describe('docx 预览', () => {
  it('kind=docx → 复用 DocxPreviewPanel（blob URL 传入）', async () => {
    apiMock.readAgentFileApi.mockResolvedValue({
      data: { ...TEXT_FILE, kind: 'docx', ext: 'docx', base64: 'eA==', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    })
    const wrapper = mountViewer()
    await loadText(wrapper)
    const panel = wrapper.findComponent(DocxPreviewPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('fileUrl')).toBe('blob:mock-url')
    expect(panel.props('fileType')).toBe('docx')
  })
})

describe('xlsx 预览', () => {
  it('kind=xlsx → 复用 ExcelPreviewPanel（blob URL 传入）', async () => {
    apiMock.readAgentFileApi.mockResolvedValue({
      data: { ...TEXT_FILE, kind: 'xlsx', ext: 'xlsx', base64: 'eA==', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    })
    const wrapper = mountViewer()
    await loadText(wrapper)
    const panel = wrapper.findComponent(ExcelPreviewPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('fileUrl')).toBe('blob:mock-url')
  })
})
