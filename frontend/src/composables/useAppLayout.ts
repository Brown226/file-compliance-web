/**
 * 应用外壳布局状态 Composable（模块级单例，AppSidebar / AppHeader / AppLayout 共享）
 *
 * - sidebarCollapsed：主侧边栏折叠（localStorage 持久化）
 * - sidebarOpen：移动端抽屉开合（临时状态）
 * - isMobile：视口宽度 < 1024 判定（resize 自动更新）
 * - warningDismissed：顶栏安全警告关闭记忆（sessionStorage，刷新保持、关闭标签页后恢复）
 */
import { ref, watch } from 'vue'

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'
const WARNING_DISMISSED_KEY = 'security_warning_dismissed'

// 模块级单例状态 —— 所有调用 useAppLayout() 的组件共享同一份引用
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'false')
const sidebarOpen = ref(false)
const isMobile = ref(false)
const warningDismissed = ref(sessionStorage.getItem(WARNING_DISMISSED_KEY) === 'true')

let initialized = false

function initLayoutState() {
  if (initialized) return
  initialized = true

  isMobile.value = window.innerWidth < 1024
  window.addEventListener('resize', handleResize)
  window.addEventListener('storage', handleStorage)

  watch(sidebarCollapsed, (val) => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(val))
  })
  watch(warningDismissed, (val) => {
    // 安全警告：会话内记忆，关闭标签页后恢复展示，避免永久关闭合规提示
    sessionStorage.setItem(WARNING_DISMISSED_KEY, String(val))
  })
}

function handleResize() {
  isMobile.value = window.innerWidth < 1024
  if (!isMobile.value) sidebarOpen.value = false
}

// 监听其他页面通过 localStorage 发出的侧边栏控制信号
function handleStorage(e: StorageEvent) {
  if (e.key === SIDEBAR_COLLAPSED_KEY && e.newValue !== null) {
    sidebarCollapsed.value = e.newValue === 'true'
  }
}

export function useAppLayout() {
  return { sidebarCollapsed, sidebarOpen, isMobile, warningDismissed, initLayoutState }
}
