/**
 * AgentChat KeepAlive 回归测试（修复「切出对话页即中断对话」）
 *
 * 背景：Agent 对话的 SSE 流与全部状态绑定在 AgentChat 组件实例上，
 * AppLayout 的 router-view 用 <keep-alive include="AgentChat"> 缓存该页，
 * 切出路由时组件停用而非卸载，流与状态持续存活。
 *
 * 本文件验证三件事：
 * 1. AgentChat 显式注册了名字 'AgentChat'（keep-alive include 的匹配契约）；
 * 2. 在 AppLayout 真实模板结构（含真实 <transition mode="out-in"> 与真实
 *    <keep-alive>）下，/agent 路由正常渲染对话页；
 * 3. 路由切出/切回后组件实例被复用（同一实例 = 从未卸载）。
 *
 * 为什么 /agent 路由用「同名 stub」而非真实 AgentChat.vue：
 * KeepAlive 缓存行为是 AppLayout + Vue 框架层的关注点，stub 组件同样携带名字
 * 'AgentChat' 参与 include 匹配；真实 AgentChat 内部数十个子组件依赖完整后端
 * 数据形状，浅 mock 下渲染抛错反而会让 out-in 的 afterLeave 永不回调（假阴性）。
 * 真实组件的名字契约由测试 1 静态锁定，两测互为补充。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { createPinia, type Pinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import AgentChat from '../AgentChat.vue'

const { userStoreMock } = vi.hoisted(() => ({
  userStoreMock: {
    token: 'test-token',
    isAdmin: () => true,
    isManager: () => true,
    isAdminOrManager: () => true,
    userInfo: { id: 1, name: '测试用户', username: 'tester', roles: ['ADMIN'] },
    isLoggedIn: true,
  },
}))

/** 在真实模块基础上把所有函数导出替换为返回空数据的 mock（避免 vitest 对未知具名导出抛错） */
async function mockApiModule(importOriginal: () => Promise<Record<string, unknown>>) {
  const mod = await importOriginal()
  const wrapped: Record<string, unknown> = { ...mod }
  for (const k of Object.keys(wrapped)) {
    if (typeof wrapped[k] === 'function') {
      wrapped[k] = vi.fn().mockResolvedValue({ data: {}, success: true })
    }
  }
  return wrapped
}

vi.mock('@/api/agent', (importOriginal) => mockApiModule(importOriginal))
vi.mock('@/api/standard', (importOriginal) => mockApiModule(importOriginal))
vi.mock('@/api/system', (importOriginal) => mockApiModule(importOriginal))
vi.mock('@/api/announcement', (importOriginal) => mockApiModule(importOriginal))
vi.mock('@/stores/user', () => ({ useUserStore: () => userStoreMock }))
// 快捷键帮助弹窗与被测对象无关，且内部 el-table 插槽在 jsdom 下会崩（Cannot destructure 'row'）——模块级替换为空壳
vi.mock('@/components/layout/dialogs/ShortcutHelpDialog.vue', () => ({
  default: defineComponent({ name: 'ShortcutHelpDialog', template: '<div class="shortcut-dialog-stub" />' }),
}))

/** jsdom 没有 ResizeObserver（ChatMinimap 等 onMounted 用）——桩掉即可 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const Home = defineComponent({ name: 'Home', template: '<div class="home-page">home</div>' })
/** 与真实 AgentChat 同名的 stub：参与 keep-alive include 匹配，验证 AppLayout 侧缓存契约 */
const AgentChatStub = defineComponent({
  name: 'AgentChat',
  template: '<div class="agent-layout">agent</div>',
})

/** 等待路由守卫/微任务/transition 的 rAF→rAF 链全部沉淀 */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 30))
    await nextTick()
  }
}

let router: Router
let pinia: Pinia
let wrapper: VueWrapper<any> | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/agent', component: AgentChatStub },
    ],
  })
  pinia = createPinia()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function mountLayout() {
  wrapper = mount(AppLayout, {
    attachTo: document.body,
    global: {
      plugins: [router, pinia],
      // AppSidebar/AppHeader/AnnouncementPopup 各自挂载即拉接口，与被测对象无关，stub 掉；
      // transition 与 keep-alive 均保留真实实现（缓存行为正是被测对象）。
      stubs: {
        AppSidebar: true,
        AppHeader: true,
        AnnouncementPopup: true,
        ShortcutHelpDialog: true,
      },
    },
  })
  await router.isReady()
  await settle()
  return wrapper
}

describe('AgentChat keep-alive 缓存（切页不中断对话）', () => {
  it('AgentChat 组件显式名为 AgentChat（keep-alive include 匹配契约）', () => {
    expect((AgentChat as any).name).toBe('AgentChat')
  })

  it('路由 /agent 渲染对话页（真实 transition out-in + keep-alive 下正常插入）', async () => {
    const w = await mountLayout()
    expect(w.find('.home-page').exists()).toBe(true)

    await router.push('/agent')
    await settle()
    expect(w.find('.home-page').exists()).toBe(false)
    expect(w.find('.agent-layout').exists()).toBe(true)
  })

  it('切出再切回：组件实例被缓存复用（同一实例 = 从未卸载，流与状态存活）', async () => {
    const w = await mountLayout()
    await router.push('/agent')
    await settle()
    const vm1 = w.getComponent({ name: 'AgentChat' }).vm
    expect(vm1).toBeTruthy()

    // 切出到首页：DOM 移除，但实例不应卸载
    await router.push('/')
    await settle()
    expect(w.find('.agent-layout').exists()).toBe(false)

    // 切回：必须是同一个实例（若曾被卸载，这里会是全新实例）
    await router.push('/agent')
    await settle()
    expect(w.find('.agent-layout').exists()).toBe(true)
    const vm2 = w.getComponent({ name: 'AgentChat' }).vm
    expect(vm2).toBe(vm1)
  })
})
