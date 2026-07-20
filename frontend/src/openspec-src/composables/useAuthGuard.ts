/**
 * 懒认证 Composable
 * 管理登录弹窗状态和待执行操作队列
 * 用于支持游客访问，仅在需要用户相关功能时才要求登录
 */
import { ref } from 'vue'
import { authStorage } from '@openspec/utils/auth'

export function useAuthGuard() {
  const showLoginDialog = ref(false)
  const pendingAction = ref<(() => void) | null>(null)

  const isAuthenticated = () => authStorage.isAuthenticated()

  /**
   * 需要登录时：已登录直接执行，未登录弹出登录框并缓存操作
   */
  function requireAuth(action: () => void): void {
    if (isAuthenticated()) {
      action()
    } else {
      pendingAction.value = action
      showLoginDialog.value = true
    }
  }

  /**
   * 登录成功后：关闭弹窗，执行缓存的操作
   */
  function onLoginSuccess(): void {
    showLoginDialog.value = false
    if (pendingAction.value) {
      const action = pendingAction.value
      pendingAction.value = null
      action()
    }
  }

  /**
   * 取消登录：关闭弹窗，清除缓存操作
   */
  function onLoginCancel(): void {
    showLoginDialog.value = false
    pendingAction.value = null
  }

  return {
    showLoginDialog,
    isAuthenticated,
    requireAuth,
    onLoginSuccess,
    onLoginCancel,
  }
}
