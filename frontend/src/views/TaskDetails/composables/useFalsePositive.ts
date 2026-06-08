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

      // 查找同类问题（相同 ruleCode 的其他未标记误报的问题）
      const sameTypeIssues = allDetails.value.filter((d: any) =>
        d.ruleCode === fpTargetDetail.value!.ruleCode &&
        d.ruleCode &&
        d.id !== fpTargetDetail.value!.id &&
        !d.isFalsePositive
      )

      fpDialogVisible.value = false

      if (sameTypeIssues.length > 0) {
        const { ElMessageBox } = await import('element-plus')
        try {
          await ElMessageBox.confirm(
            `还有 ${sameTypeIssues.length} 条相同规则（${fpTargetDetail.value!.ruleCode}）的问题，是否全部标记为误报？`,
            '批量标记',
            { confirmButtonText: '全部标记', cancelButtonText: '仅此一条', type: 'warning' }
          )
          // 用户选择全部标记
          for (const item of sameTypeIssues) {
            try {
              await toggleFalsePositiveApi(item.id, {
                isFalsePositive: true,
                reason: reason || undefined,
              })
              item.isFalsePositive = true
            } catch {}
          }
          ElMessage.success(`已标记 ${sameTypeIssues.length + 1} 条同类问题为误报`)
        } catch {
          // 用户选择仅此一条
          ElMessage.success('已标记为误报')
        }
      } else {
        ElMessage.success('已标记为误报')
      }
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
