import axios from 'axios'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import router from '../router'

const request = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// ===== 全局请求取消机制 =====
// 仅在路由切换时统一取消，不再在请求拦截器中按 key 去重（避免相同 URL 不同参数的请求互相取消）
// 兼容性：AbortController 需要 Chrome 66+，旧浏览器降级为不使用取消机制
const hasAbortController = typeof AbortController !== 'undefined'
let currentControllers: AbortController[] = []

// 请求拦截器：自动附加 Token
request.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }

    // 为每个请求创建独立的 AbortController，支持路由切换时统一取消
    // 旧浏览器（Chrome < 66）不支持 AbortController，降级跳过
    if (hasAbortController) {
      const controller = new AbortController()
      config.signal = controller.signal
      currentControllers.push(controller)
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器：统一处理 { code, message, data } 格式
request.interceptors.response.use(
  (response) => {
    const data = response.data
    // 统一格式: { code: 200, message: 'success', data: {...} }
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 200) {
        // 提取 data 字段，兼容现有前端逻辑
        response.data = data.data
      } else {
        const msg = data.message || '请求失败'
        ElMessage.error(msg)
        return Promise.reject(new Error(msg))
      }
    }
    return response
  },
  (error) => {
    // 取消的请求不报错
    if (axios.isCancel(error)) {
      return Promise.reject(error)
    }

    if (error.response) {
      const { status, data } = error.response
      if (status === 401) {
        const userStore = useUserStore()
        userStore.logout()
        router.push('/login')
        ElMessage.error('登录已过期，请重新登录')
      } else if (status === 403) {
        ElMessage.error('没有操作权限')
      } else if (status === 404) {
        ElMessage.error('请求的资源不存在')
      } else {
        const msg = data?.message || data?.error || '请求失败'
        ElMessage.error(msg)
      }
    } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      ElMessage.error('请求超时，请检查网络')
    } else {
      ElMessage.error('网络连接失败，请检查网络')
    }
    return Promise.reject(error)
  }
)

/**
 * 取消所有 pending 的 API 请求（路由切换时调用）
 */
export function cancelAllPendingRequests() {
  currentControllers.forEach((controller) => {
    controller.abort()
  })
  currentControllers = []
}

export default request
