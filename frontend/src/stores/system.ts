/**
 * OPT-031: 系统配置状态 Store
 * 管理 LLM 配置状态、OCR 状态、队列状态等全局系统信息
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSystemStore = defineStore('system', () => {
  // ===== State =====
  const llmConfigured = ref<boolean | null>(null)  // null = 未检测
  const ocrAvailable = ref<boolean | null>(null)
  const queueHealthy = ref<boolean | null>(null)
  const maxkbReachable = ref<boolean | null>(null)

  // ===== Actions =====
  function setLlmStatus(configured: boolean) {
    llmConfigured.value = configured
  }

  function setOcrStatus(available: boolean) {
    ocrAvailable.value = available
  }

  function setQueueStatus(healthy: boolean) {
    queueHealthy.value = healthy
  }

  function setMaxkbStatus(reachable: boolean) {
    maxkbReachable.value = reachable
  }

  function resetAll() {
    llmConfigured.value = null
    ocrAvailable.value = null
    queueHealthy.value = null
    maxkbReachable.value = null
  }

  return {
    llmConfigured,
    ocrAvailable,
    queueHealthy,
    maxkbReachable,
    setLlmStatus,
    setOcrStatus,
    setQueueStatus,
    setMaxkbStatus,
    resetAll,
  }
})
