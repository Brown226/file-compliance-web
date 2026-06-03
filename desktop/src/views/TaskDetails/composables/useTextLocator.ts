import { ref, computed, type Ref } from 'vue'
import type { TaskDetail } from '@/types/models'

export interface LocateOptions {
  originalText: string
  locateCandidates?: string[]
  textPosition: any
  locateMeta?: any
  cadHandleId?: string
  locateHint?: string
}

export interface LocateTarget extends LocateOptions {
  triggerId?: string
}

export function useTextLocator(
  files: Ref<any[]>,
  selectedFileId: Ref<string | null>,
  switchToFileContext: (fileId: string, options?: { locate?: LocateOptions }) => void
) {
  // ===== 状态 =====
  const locateTarget = ref<LocateTarget | null>(null)
  const locateFeedback = ref<{ type: 'success' | 'warning'; message: string } | null>(null)
  const locateStatusMap = ref<Record<string, 'direct' | 'fallback'>>({})
  const locatingIssueId = ref<string | null>(null)

  // ===== DWG 定位目标（计算属性）=====
  const dwgLocateTarget = computed(() => {
    if (!locateTarget.value) return null
    return {
      cadHandleId: locateTarget.value.cadHandleId,
      originalText: locateTarget.value.originalText,
      description: locateTarget.value.locateHint || '',
    }
  })

  // ===== 获取定位状态 =====
  const getLocateStatus = (item: TaskDetail): 'direct' | 'fallback' => {
    const key = item.id || ''
    return locateStatusMap.value[key] || 'fallback'
  }

  // ===== 处理定位结果 =====
  const handleLocateResult = (payload: { success: boolean; mode: 'direct' | 'fallback'; hint?: string }) => {
    if (locatingIssueId.value) {
      locateStatusMap.value[locatingIssueId.value] = payload.success && payload.mode === 'direct' ? 'direct' : 'fallback'
    }

    if (payload.success && payload.mode === 'direct') {
      locateFeedback.value = { type: 'success', message: '已定位到原文位置并高亮显示' }
      locatingIssueId.value = null
      return
    }

    const fallbackHint = payload.hint || '未能直接定位，请按"页/段/句"提示快速查找。'
    locateFeedback.value = { type: 'warning', message: `未能直接定位：${fallbackHint}` }
    locatingIssueId.value = null
  }

  // ===== 构建定位载荷 =====
  const buildLocatePayload = (item: TaskDetail): LocateOptions => ({
    originalText: item.originalText || '',
    locateCandidates: (item as any).locateCandidates,
    textPosition: item.textPosition || null,
    locateMeta: (item as any).locateMeta || null,
    cadHandleId: item.cadHandleId || undefined,
    locateHint: (item as any).locateHint || undefined,
  })

  // ===== 执行文本定位 =====
  const handleLocateText = (item: TaskDetail) => {
    locateFeedback.value = null

    if (!item.fileId) {
      locateFeedback.value = { type: 'warning', message: '该问题缺少文件归属，无法自动定位，请先切换到对应文件后手动检索。' }
      return
    }

    const locate = buildLocatePayload(item)
    if (!locate.originalText.trim()) {
      locateFeedback.value = { type: 'warning', message: '该问题缺少可检索原文，建议结合问题描述手动定位。' }
      return
    }

    locatingIssueId.value = item.id

    // 统一文件上下文切换，保持预览与列表一致
    switchToFileContext(item.fileId, { locate })
  }

  // ===== 清除定位反馈 =====
  const clearLocateFeedback = () => {
    locateFeedback.value = null
  }

  return {
    // 状态
    locateTarget,
    locateFeedback,
    locateStatusMap,
    locatingIssueId,

    // 计算属性
    dwgLocateTarget,

    // 方法
    getLocateStatus,
    handleLocateResult,
    handleLocateText,
    clearLocateFeedback,
    buildLocatePayload,
  }
}
