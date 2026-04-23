import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserInfo } from '@/types/models'

export const useUserStore = defineStore('user', () => {
  const token = ref('')
  const userInfo = ref<UserInfo | null>(null)

  function setToken(newToken: string) {
    token.value = newToken
  }

  function setUserInfo(info: UserInfo | null) {
    userInfo.value = info
  }

  function logout() {
    token.value = ''
    userInfo.value = null
  }

  /** 判断是否为管理员 */
  function isAdmin(): boolean {
    const role = userInfo.value?.role
    if (!role) return false
    if (typeof role === 'string') return role === 'ADMIN'
    if (Array.isArray(role)) return role.includes('ADMIN')
    return false
  }

  /** 判断是否为经理 */
  function isManager(): boolean {
    const role = userInfo.value?.role
    if (!role) return false
    if (typeof role === 'string') return role === 'MANAGER'
    if (Array.isArray(role)) return role.includes('MANAGER')
    return false
  }

  /** 判断是否为管理员或经理 */
  function isAdminOrManager(): boolean {
    return isAdmin() || isManager()
  }

  return { token, userInfo, setToken, setUserInfo, logout, isAdmin, isManager, isAdminOrManager }
}, {
  persist: true
})
