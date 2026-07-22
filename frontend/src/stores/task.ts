/**
 * OPT-031: 审查任务状态 Store
 * 管理当前任务列表、WebSocket 实时进度、任务详情缓存
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface TaskProgress {
  taskId: string
  progress: number
  step: string
  message: string
  fileName?: string
  phase?: string
}

export const useTaskStore = defineStore('task', () => {
  // ===== State =====
  const activeProgress = ref<Map<string, TaskProgress>>(new Map())
  const degradedFiles = ref<string[]>([])  // RAG 降级文件
  const ocrDegradedFiles = ref<string[]>([])  // OCR 降级文件

  // ===== Getters =====
  const hasActiveTasks = computed(() => activeProgress.value.size > 0)
  const activeTaskCount = computed(() => activeProgress.value.size)

  // ===== Actions =====
  function updateProgress(taskId: string, progress: TaskProgress) {
    activeProgress.value.set(taskId, progress)
  }

  function removeProgress(taskId: string) {
    activeProgress.value.delete(taskId)
  }

  function clearAllProgress() {
    activeProgress.value.clear()
  }

  function addDegradedFile(fileName: string) {
    if (!degradedFiles.value.includes(fileName)) {
      degradedFiles.value.push(fileName)
    }
  }

  function addOcrDegradedFile(fileName: string) {
    if (!ocrDegradedFiles.value.includes(fileName)) {
      ocrDegradedFiles.value.push(fileName)
    }
  }

  function clearDegradedFiles() {
    degradedFiles.value = []
    ocrDegradedFiles.value = []
  }

  return {
    activeProgress,
    degradedFiles,
    ocrDegradedFiles,
    hasActiveTasks,
    activeTaskCount,
    updateProgress,
    removeProgress,
    clearAllProgress,
    addDegradedFile,
    addOcrDegradedFile,
    clearDegradedFiles,
  }
})
