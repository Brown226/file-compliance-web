import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadFailAlert from '../LoadFailAlert.vue'

/**
 * 测试环境不解析 el-*（见 vitest.config.ts 注释）：el-alert/el-button 按未知元素渲染，
 * el-alert 的命名插槽 #title 不输出，故文案经 props 断言、交互经父组件监听（onRetry）
 * 断言，不依赖 wrapper.emitted()（AGENTS.md vitest 环境坑）。
 */
describe('LoadFailAlert 加载失败横幅', () => {
  it('show=false 时完全不渲染', () => {
    const w = mount(LoadFailAlert, { props: { show: false } })
    expect(w.find('.load-fail-alert').exists()).toBe(false)
  })

  it('show=true 渲染横幅与重试按钮', () => {
    const w = mount(LoadFailAlert, { props: { show: true } })
    expect(w.find('.load-fail-alert').exists()).toBe(true)
    expect(w.find('.load-fail-alert__actions').exists()).toBe(true)
    expect(w.text()).toContain('重试')
  })

  it('message 默认文案与 prop 覆盖', () => {
    const def = mount(LoadFailAlert, { props: { show: true } })
    expect(def.props('message')).toBe('数据加载失败，当前显示的可能不是最新内容')
    const over = mount(LoadFailAlert, { props: { show: true, message: '基础设置读取失败' } })
    expect(over.props('message')).toBe('基础设置读取失败')
  })

  it('点击重试触发父组件 retry 监听', () => {
    let calls = 0
    const w = mount(LoadFailAlert, {
      props: { show: true },
      attrs: { onRetry: () => { calls++ } },
    })
    const btn = w.element.querySelector('.load-fail-alert__actions el-button')
    expect(btn).not.toBeNull()
    ;(btn as HTMLElement).click()
    expect(calls).toBe(1)
  })
})