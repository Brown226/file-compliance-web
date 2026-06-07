/**
 * 误报标记相关的响应式状态和操作
 * 从 TaskResultsView.vue 提取
 */
import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { toggleFalsePositiveApi } from '@/api/task'
import type { TaskDetail } from '@/types/models'

export function useFalsePositive(allDetails: Ref<TaskDetail[]>) {
  const fpDialogVisible = ref(false)
  const fpSubmitting = ref(false)
  const fpTargetDetail = ref<TaskDetail | null>(null)

  const handleFalsePositive = (item: TaskDetail) => {
    fpTargetDetail.value = item
    fpDialogVisible.value = true
  }

  const handleConfirmFalsePositive = async (reason: string) => {
    if (!fpTargetDetail.value) return
    fpSubmitting.value = true
    try {
      await toggleFalsePositiveApi(fpTargetDetail.value.id, {
        isFalsePositive: true,
        reason: reason || undefined,
      })
      const detail = allDetails.value.find((d: any) => d.id === fpTargetDetail.value!.id)
      if (detail) {
        detail.isFalsePositive = true
      }
      ElMessage.success('已标记为误报')
      fpDialogVisible.value = false
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '标记误报失败')
    } finally {
      fpSubmitting.value = false
    }
  }

  const handleBatchFalsePositiveFromIssueList = async (issueIds: string[], reason?: string) => {
    console.log('批量标记误报:', issueIds.length, '条, 原因:', reason)
    // TODO: 根据实际需求实现批量误报标记逻辑
  }

  return {
    fpDialogVisible,
    fpSubmitting,
    fpTargetDetail,
    handleFalsePositive,
    handleConfirmFalsePositive,
    handleBatchFalsePositiveFromIssueList,
  }
}
