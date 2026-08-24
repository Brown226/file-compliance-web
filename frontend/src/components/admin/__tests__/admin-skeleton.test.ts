import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PageIntro from '../PageIntro.vue'
import AdminPanel from '../AdminPanel.vue'

/**
 * 后台骨架组件冒烟测试（2026-08-19 统一管理面板试点配套）。
 * 验证：页头骨架（竖条+标题+副语+操作位）、内容卡容器（卡头+内容+内边距开关）。
 */
describe('PageIntro 后台页头骨架', () => {
  it('渲染标题与副语', () => {
    const w = mount(PageIntro, { props: { title: '运行状态一览', description: '后端 API 实时健康度' } })
    expect(w.get('.page-intro__title').text()).toBe('运行状态一览')
    expect(w.get('.page-intro__desc').text()).toBe('后端 API 实时健康度')
    // 品牌蓝竖条签名元素必须存在
    expect(w.find('.page-intro__bar').exists()).toBe(true)
  })

  it('未提供副语时省略 desc 元素', () => {
    const w = mount(PageIntro, { props: { title: '仅标题' } })
    expect(w.find('.page-intro__desc').exists()).toBe(false)
  })

  it('操作位插槽不渲染时空缺、提供时渲染', () => {
    const w1 = mount(PageIntro, { props: { title: 't' } })
    expect(w1.find('.page-intro__actions').exists()).toBe(false)

    const w2 = mount(PageIntro, {
      props: { title: 't' },
      slots: { actions: '<button>刷新</button>' },
    })
    expect(w2.get('.page-intro__actions').text()).toContain('刷新')
  })
})

describe('AdminPanel 内容卡容器', () => {
  it('渲染卡头标题与默认内容区', () => {
    const w = mount(AdminPanel, {
      props: { title: '服务状态' },
      slots: { default: '<span class="inner">内容</span>' },
    })
    expect(w.get('.admin-panel__title').text()).toBe('服务状态')
    expect(w.get('.admin-panel__body').classes()).toContain('padded')
    expect(w.get('.inner').text()).toBe('内容')
  })

  it('无标题与操作时不渲染卡头', () => {
    const w = mount(AdminPanel, { slots: { default: '<span>x</span>' } })
    expect(w.find('.admin-panel__header').exists()).toBe(false)
  })

  it('padded=false 时移除内容区内边距标记', () => {
    const w = mount(AdminPanel, { props: { padded: false }, slots: { default: '<span>x</span>' } })
    expect(w.get('.admin-panel__body').classes()).not.toContain('padded')
  })

  it('卡头操作位插槽渲染', () => {
    const w = mount(AdminPanel, {
      props: { title: '关键指标' },
      slots: { actions: '<button>刷新</button>', default: '<span>x</span>' },
    })
    expect(w.get('.admin-panel__actions').text()).toContain('刷新')
  })
})
