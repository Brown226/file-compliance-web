import { ref } from 'vue'
import { getEnabledFeatureFlagsApi } from '@/api/system'

/**
 * 功能开关全局状态（单例）
 * 启动时调用 load() 一次，各组件通过 isEnabled() 读
 */
const enabledKeys = ref<Set<string>>(new Set())
const loaded = ref(false)
const loadingPromise = ref<Promise<void> | null>(null)

/** 拉取启用的功能 key 集合（幂等，重复调用只发一次请求） */
export async function loadFeatureFlags(): Promise<void> {
  if (loaded.value) return
  if (loadingPromise.value) {
    await loadingPromise.value
    return
  }
  loadingPromise.value = (async () => {
    try {
      const res = await getEnabledFeatureFlagsApi()
      enabledKeys.value = new Set(res.data || [])
    } catch (e) {
      // 拉取失败时默认全部启用，避免用户看不到入口
      console.warn('[FeatureFlags] 加载失败，默认全部启用:', e)
      enabledKeys.value = new Set()
    }
    loaded.value = true
  })()
  await loadingPromise.value
  loadingPromise.value = null
}

/** 检查功能是否启用（未加载完成时默认启用，避免闪烁） */
export function isFeatureEnabled(key: string): boolean {
  // 未加载完成时默认启用，避免页面初始化时入口被隐藏后又被显示（闪烁）
  if (!loaded.value) return true
  // 已加载但集合为空（拉取失败）也默认启用
  if (enabledKeys.value.size === 0) return true
  return enabledKeys.value.has(key)
}

/** 重置状态（登出时调用） */
export function resetFeatureFlags() {
  enabledKeys.value = new Set()
  loaded.value = false
  loadingPromise.value = null
}

/**
 * 强制重新拉取开关（管理员在「功能管理」切换开关后调用）
 *
 * 背景：本模块是「加载一次即缓存」的单例（loadFeatureFlags 有 `if (loaded) return`）。
 * 而 FeatureFlags.vue 切换开关只更新 DB 与自身行内状态，原先没有任何刷新入口，
 * 导致同一会话内切换开关后界面纹丝不动，必须 F5 硬刷新才生效——
 * 表现为「功能开关不能真实控制模块展示」。
 */
export async function refreshFeatureFlags(): Promise<void> {
  loaded.value = false
  loadingPromise.value = null
  await loadFeatureFlags()
}
