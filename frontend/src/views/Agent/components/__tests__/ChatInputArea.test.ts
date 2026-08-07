/**
 * ChatInputArea 单元测试（Agent 对话输入区）
 *
 * 覆盖：
 * - 输入文本 → emit update:inputValue
 * - 发送：空输入且无图片时禁用；有内容时点击/回车 → emit send
 * - isLoading → 显示停止按钮 → emit stop
 * - 模型选择：无选中时兜底显示第一个可用模型 → 打开下拉 → 选择 → emit model-change
 * - 图片移除 → emit update:attachedImages
 *
 * el-upload 用 stub（上传走父组件，这里不测）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatInputArea from '../ChatInputArea.vue'

const modelOptions = [
  { key: 'p1::model-a', label: '模型A' },
  { key: 'p1::model-b', label: '模型B' },
]

function mountInput(props: Record<string, any> = {}) {
  return mount(ChatInputArea, {
    props: {
      modelOptions,
      modelKey: null,
      thinkingLevel: null,
      toolPreset: 'full',
      isLoading: false,
      inputValue: '',
      attachedImages: [],
      uploading: false,
      compacting: false,
      canCompact: false,
      ...props,
    },
    global: { stubs: { 'el-upload': { template: '<div class="el-upload-stub"><slot /></div>' }, 'el-icon': true } },
  })
}

describe('输入与发送', () => {
  it('输入文本 → emit update:inputValue', async () => {
    const wrapper = mountInput()
    const ta = wrapper.find('.chat-textarea')
    await ta.setValue('合同审查')
    expect(wrapper.emitted('update:inputValue')?.[0]).toEqual(['合同审查'])
  })

  it('空输入且无图片 → 发送按钮禁用', () => {
    const wrapper = mountInput()
    expect((wrapper.find('.send-btn-inline').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('有输入 → 点击发送 emit send', async () => {
    const wrapper = mountInput({ inputValue: '你好' })
    await wrapper.find('.send-btn-inline').trigger('click')
    expect(wrapper.emitted('send')).toBeTruthy()
  })

  it('有输入 → 回车 emit send', async () => {
    const wrapper = mountInput({ inputValue: '你好' })
    await wrapper.find('.chat-textarea').trigger('keydown.enter')
    expect(wrapper.emitted('send')).toBeTruthy()
  })

  it('isLoading → 显示停止按钮并 emit stop', async () => {
    const wrapper = mountInput({ isLoading: true })
    expect(wrapper.find('.send-btn-inline').exists()).toBe(false)
    const stopBtn = wrapper.find('.stop-btn-inline')
    expect(stopBtn.exists()).toBe(true)
    await stopBtn.trigger('click')
    expect(wrapper.emitted('stop')).toBeTruthy()
  })
})

describe('模型选择', () => {
  it('modelKey 为空 → 兜底显示第一个可用模型', () => {
    const wrapper = mountInput()
    expect(wrapper.find('.model-current').text()).toBe('模型A')
  })

  it('无任何模型 → 显示「选择模型」', () => {
    const wrapper = mountInput({ modelOptions: [] })
    expect(wrapper.find('.model-current').text()).toBe('选择模型')
  })

  it('modelKey 命中选项 → 显示模型标签', () => {
    const wrapper = mountInput({ modelKey: 'p1::model-a' })
    expect(wrapper.find('.model-current').text()).toBe('模型A')
  })

  it('打开下拉选择模型 → emit model-change', async () => {
    const wrapper = mountInput()
    await wrapper.find('.model-select-btn').trigger('click')
    expect(wrapper.find('.model-dropdown-panel').exists()).toBe(true)
    const options = wrapper.findAll('.model-option')
    expect(options.length).toBe(2)
    await options[1].trigger('click')
    expect(wrapper.emitted('model-change')?.[0]).toEqual(['p1::model-b'])
    // 选择后下拉关闭
    expect(wrapper.find('.model-dropdown-panel').exists()).toBe(false)
  })

  it('模型按 provider 分组展示（多 provider 时显示组标题）', async () => {
    const wrapper = mountInput({ modelOptions: [
      { key: 'p1::model-a', label: '模型A' },
      { key: 'p2::model-b', label: '模型B' },
    ] })
    await wrapper.find('.model-select-btn').trigger('click')
    expect(wrapper.text()).toContain('p1')
    expect(wrapper.text()).toContain('p2')
  })
})

describe('图片附件', () => {
  const images = [{ dataUrl: 'data:image/png;base64,AAA', previewUrl: 'preview1', fileName: 'a.png' }]

  it('有图片时显示预览并可移除 → emit update:attachedImages', async () => {
    const wrapper = mountInput({ attachedImages: images })
    expect(wrapper.findAll('.img-preview').length).toBe(1)
    await wrapper.find('.img-remove').trigger('click')
    expect(wrapper.emitted('update:attachedImages')?.[0]).toEqual([[]])
  })

  it('有图片但无输入时发送按钮启用', () => {
    const wrapper = mountInput({ attachedImages: images })
    expect((wrapper.find('.send-btn-inline').element as HTMLButtonElement).disabled).toBe(false)
  })
})
