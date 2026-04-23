import { ref, onUnmounted } from 'vue'
import { useUserStore } from '@/stores/user'
import type { TaskDetail } from '@/types/models'

export interface WsMessage {
  type: string
  taskId?: string
  progressType?: string
  step?: string
  progress?: number
  message?: string
  fileName?: string
  result?: any
  timestamp?: number
  notificationType?: string
  title?: string
  // 分片增量审查结果（chunk_result 类型）
  chunkType?: string   // 'chunk_result'
  fileId?: string
  chunkIndex?: number
  totalChunks?: number
  issueCount?: number
  issues?: TaskDetail[]
  engine?: string
}

export interface WsTaskProgress {
  taskId: string
  type: string
  step: string
  progress: number
  message: string
  fileName?: string
  timestamp: number
}

class WebSocketManager {
  private ws: WebSocket | null = null
  private reconnectTimer: number | null = null
  private listeners: Map<string, Set<(msg: WsMessage) => void>> = new Map()
  private globalListeners: Set<(msg: WsMessage) => void> = new Set()
  private subscribedTasks: Set<string> = new Set()
  private connected = ref(false)

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return

    const userStore = useUserStore()
    const token = userStore.token
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/ws?token=${token}`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.connected.value = true
      console.log('[WS] Connected')
      this.resubscribeTasks()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        if (msg.type === 'ping') {
          this.ws?.send(JSON.stringify({ type: 'pong' }))
          return
        }
        if (msg.type === 'connected') return

        // 分发到全局监听器
        this.globalListeners.forEach(cb => cb(msg))

        // 分发到任务特定监听器
        if (msg.taskId) {
          const taskListeners = this.listeners.get(msg.taskId)
          if (taskListeners) {
            taskListeners.forEach(cb => cb(msg))
          }
        }
      } catch (e) {
        // ignore invalid messages
      }
    }

    this.ws.onclose = () => {
      this.connected.value = false
      console.log('[WS] Disconnected, reconnecting in 3s...')
      this.reconnectTimer = window.setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err)
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected.value = false
  }

  subscribe(taskId: string, callback: (msg: WsMessage) => void) {
    if (!this.listeners.has(taskId)) {
      this.listeners.set(taskId, new Set())
    }
    this.listeners.get(taskId)!.add(callback)

    if (!this.subscribedTasks.has(taskId) && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', taskId }))
      this.subscribedTasks.add(taskId)
    }

    return () => this.unsubscribe(taskId, callback)
  }

  unsubscribe(taskId: string, callback: (msg: WsMessage) => void) {
    const taskListeners = this.listeners.get(taskId)
    if (taskListeners) {
      taskListeners.delete(callback)
      if (taskListeners.size === 0) {
        this.listeners.delete(taskId)
      }
    }
  }

  onGlobalMessage(callback: (msg: WsMessage) => void) {
    this.globalListeners.add(callback)
    return () => this.globalListeners.delete(callback)
  }

  private resubscribeTasks() {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.subscribedTasks.forEach(taskId => {
      this.ws!.send(JSON.stringify({ type: 'subscribe', taskId }))
    })
  }

  get isConnected() {
    return this.connected.value
  }
}

export const wsManager = new WebSocketManager()

export function useWebSocket() {
  const connected = ref(wsManager.isConnected)

  function connect() {
    wsManager.connect()
  }

  function disconnect() {
    wsManager.disconnect()
  }

  function subscribeTask(taskId: string, callback: (msg: WsMessage) => void) {
    return wsManager.subscribe(taskId, callback)
  }

  function onMessage(callback: (msg: WsMessage) => void) {
    return wsManager.onGlobalMessage(callback)
  }

  onUnmounted(() => {
    // Don't disconnect on unmount - keep WS alive for the session
  })

  return { connect, disconnect, subscribeTask, onMessage, connected }
}
