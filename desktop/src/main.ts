import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { wsManager } from './composables/useWebSocket'
// 导入 store 以确保打包时注册
import { useUserStore } from './stores/user'

const app = createApp(App)

// Pinia
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
app.use(pinia)

// Router
app.use(router)

// WebSocket 全局初始化（登录成功后由 userStore 自动连接）
router.afterEach(() => {
  const userStore = useUserStore()
  if (userStore.token) {
    wsManager.connect()
  }
})

app.mount('#app')
