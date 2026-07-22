/**
 * OPT-031: 认证状态 Store
 * 管理用户登录态、token、权限信息
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface UserInfo {
  id: string
  username: string
  name: string
  role: 'ADMIN' | 'MANAGER' | 'USER'
  departmentId?: string
  departmentName?: string
}

export const useAuthStore = defineStore('auth', () => {
  // ===== State =====
  const token = ref<string | null>(null)
  const user = ref<UserInfo | null>(null)

  // ===== Getters =====
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'ADMIN')
  const isManager = computed(() => user.value?.role === 'MANAGER' || user.value?.role === 'ADMIN')
  const userName = computed(() => user.value?.name || user.value?.username || '')

  // ===== Actions =====
  function setAuth(newToken: string, newUser: UserInfo) {
    token.value = newToken
    user.value = newUser
  }

  function logout() {
    token.value = null
    user.value = null
  }

  function updateUser(partial: Partial<UserInfo>) {
    if (user.value) {
      user.value = { ...user.value, ...partial }
    }
  }

  return {
    token,
    user,
    isLoggedIn,
    isAdmin,
    isManager,
    userName,
    setAuth,
    logout,
    updateUser,
  }
}, {
  persist: {
    key: 'auth',
    paths: ['token', 'user'],
  },
})
