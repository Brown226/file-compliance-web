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
    // 2026-08 修复：原为空实现（仅 console.log），但 UI 会弹"已提交 N 条"假成功提示。
    // 改为真实逐条调用误报接口，成功后统一提示。
    if (!issueIds.length) {
      ElMessage.warning('没有可标记的问题')
      return
    }
    const results = await Promise.allSettled(
      issueIds.map(id => toggleFalsePositiveApi(id, {
        isFalsePositive: true,
        reason: reason || undefined,
      }))
    )
    // 只对成功项更新本地状态（2026-08：原实现按入参 id 全量置位，部分失败时会误标失败项）
    const succeededIds = issueIds.filter((_, i) => results[i]?.status === 'fulfilled')
    const succeeded = succeededIds.length
    const failed = results.length - succeeded
    if (succeeded > 0) {
      const idSet = new Set(succeededIds)
      allDetails.value.forEach((d: any) => {
        if (idSet.has(d.id)) d.isFalsePositive = true
      })
      ElMessage.success(`已标记 ${succeeded} 条误报${failed > 0 ? `，${failed} 条失败` : ''}`)
    } else {
      ElMessage.error('批量标记误报失败')
    }
  }

  /** 取消误报标记（2026-08 新增：原 UI 有入口但父组件未接线） */
  const handleCancelFalsePositive = async (detail: TaskDetail) => {
    if (!detail?.id) return
    try {
      await toggleFalsePositiveApi(detail.id, {
        isFalsePositive: false,
      })
      const target = allDetails.value.find((d: any) => d.id === detail.id)
      if (target) {
        target.isFalsePositive = false
        target.fpReason = null
      }
      ElMessage.success('已取消误报标记')
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '取消误报标记失败')
    }
  }

  return {
    fpDialogVisible,
    fpSubmitting,
    fpTargetDetail,
    handleFalsePositive,
    handleConfirmFalsePositive,
    handleBatchFalsePositiveFromIssueList,
    handleCancelFalsePositive,
  }
}
