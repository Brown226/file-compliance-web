import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface UserInfo {
  username: string
  role?: string
}

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

  return { token, userInfo, setToken, setUserInfo, logout }
}, {
  persist: true
})
