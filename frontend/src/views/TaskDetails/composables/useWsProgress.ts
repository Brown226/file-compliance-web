/**
 * WebSocket 实时审查进度 + 轮询兜底
 * 从 TaskResultsView.vue 提取
 */
import { ref, reactive, onUnmounted, type Ref } from 'vue'
import { useWebSocket, type WsMessage } from '@/composables/useWebSocket'
import { getTaskByIdApi } from '@/api/task'
import type { Task, TaskFile } from '@/types/models'

export interface ReviewProgressState {
  reviewing: boolean
  progress: number
  step: string
  message: string
  fileProgress: {
    fileName: string
    chunkIndex: number
    totalChunks: number
    issueCount: number
  }
  totalLiveIssueCount: number
}

export function useWsProgress(
  taskId: Ref<string>,
  task: Ref<Task | null>,
  files: Ref<TaskFile[]>,
  onCompleted: () => Promise<void>,
  onNewIssues: (msg: WsMessage) => void,
) {
  const { subscribeTask, connected: wsConnected } = useWebSocket()

  const reviewing = ref(false)
  const reviewProgress = ref(0)
  const reviewStep = ref('')
  const reviewMessage = ref('')
  const totalLiveIssueCount = ref(0)
  const runtimeFileStatus = ref<Record<string, 'completed' | 'failed' | 'skipped'>>({})

  const reviewFileProgress = reactive({
    fileName: '',
    chunkIndex: 0,
    totalChunks: 0,
    issueCount: 0,
  })

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribeWs: (() => void) | null = null

  // ===== 轮询兜底 =====
  const startPollFallback = () => {
    if (!reviewing.value || wsConnected.value || pollTimer) return
    pollTimer = setInterval(async () => {
      try {
        const res = await getTaskByIdApi(taskId.value)
        const status = res.data?.status
        if (status === 'COMPLETED' || status === 'FAILED') {
          task.value = res.data
          files.value = task.value?.files || []
          finishReview()
        }
      } catch (_) {
        // polling error — swallow, retry next tick
      }
    }, 3000)
  }

  const stopPollFallback = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ===== 审查完成 =====
  const finishReview = async () => {
    reviewing.value = false
    reviewProgress.value = 100
    reviewStep.value = '审查完成'
    reviewMessage.value = '正在加载最终结果...'
    stopPollFallback()
    if (unsubscribeWs) {
      unsubscribeWs()
      unsubscribeWs = null
    }
    setTimeout(async () => {
      await onCompleted()
    }, 800)
  }

  // ===== WS 消息处理 =====
  const handleWsMessage = (msg: WsMessage) => {
    switch (msg.type) {
      case 'task_progress':
        reviewProgress.value = msg.progress ?? reviewProgress.value
        reviewStep.value = msg.step ?? reviewStep.value
        reviewMessage.value = msg.message ?? reviewMessage.value

        if (msg.progressType === 'completed' || msg.progressType === 'failed') {
          finishReview()
        }
        break

      case 'chunk_result':
        reviewFileProgress.fileName = msg.fileName ?? reviewFileProgress.fileName
        reviewFileProgress.chunkIndex = (msg.chunkIndex ?? -1) + 1
        reviewFileProgress.totalChunks = msg.totalChunks ?? reviewFileProgress.totalChunks
        reviewFileProgress.issueCount += msg.issueCount ?? 0
        totalLiveIssueCount.value += msg.issueCount ?? 0
        reviewStep.value = 'AI 审查中'
        reviewMessage.value = `正在审查 ${msg.fileName}（分片 ${reviewFileProgress.chunkIndex}/${reviewFileProgress.totalChunks}）`
        onNewIssues(msg)
        break
    }
  }

  // ===== 启动 WS 订阅 =====
  const startSubscription = (isSelfCheck: boolean) => {
    reviewing.value = true
    reviewMessage.value = isSelfCheck ? '正在初始化自检...' : '正在初始化审查...'
    unsubscribeWs = subscribeTask(taskId.value, handleWsMessage)
    setTimeout(() => startPollFallback(), 10000)
  }

  // ===== 清理 =====
  const cleanup = () => {
    stopPollFallback()
    if (unsubscribeWs) {
      unsubscribeWs()
      unsubscribeWs = null
    }
  }

  onUnmounted(cleanup)

  return {
    reviewing,
    reviewProgress,
    reviewStep,
    reviewMessage,
    reviewFileProgress,
    totalLiveIssueCount,
    runtimeFileStatus,
    startSubscription,
    finishReview,
    cleanup,
  }
}
