import { ref, computed, type ComputedRef } from 'vue'
import type { IssueDetail } from '../types/issue'

export function useBatchSelection(filteredItems: ComputedRef<IssueDetail[]>) {
  // ===== 批量操作状态 =====
  const batchMode = ref(false)
  const selectedIssueIds = ref<string[]>([])
  const batchLoading = ref(false)

  // ===== 进入批量模式 =====
  const enterBatchMode = () => {
    batchMode.value = true
    selectedIssueIds.value = []
  }

  // ===== 退出批量模式 =====
  const exitBatchMode = () => {
    batchMode.value = false
    selectedIssueIds.value = []
  }

  // ===== 切换单个选择状态 =====
  const toggleIssueSelection = (issueId: string, isSelected: boolean) => {
    if (isSelected) {
      if (!selectedIssueIds.value.includes(issueId)) {
        selectedIssueIds.value.push(issueId)
      }
    } else {
      selectedIssueIds.value = selectedIssueIds.value.filter(id => id !== issueId)
    }
  }

  // ===== 全选/取消全选 =====
  const toggleSelectAll = (isSelected: boolean) => {
    if (isSelected) {
      selectedIssueIds.value = filteredItems.value.map(d => d.id)
    } else {
      selectedIssueIds.value = []
    }
  }

  // ===== 清空选择 =====
  const clearSelection = () => {
    selectedIssueIds.value = []
  }

  // ===== 是否全选 =====
  const isAllSelected = computed(() =>
    filteredItems.value.length > 0 &&
    selectedIssueIds.value.length === filteredItems.value.length
  )

  // ===== 是否半选（部分选中）=====
  const isIndeterminate = computed(() =>
    selectedIssueIds.value.length > 0 &&
    selectedIssueIds.value.length < filteredItems.value.length
  )

  // ===== 获取选中项的详细信息 =====
  const getSelectedIssues = (): IssueDetail[] =>
    filteredItems.value.filter(d =>
      selectedIssueIds.value.includes(d.id)
    )

  // ===== 可采纳的问题数量 =====
  const adoptableCount = computed(() =>
    selectedIssueIds.value.filter(id => {
      const issue = filteredItems.value.find(d => d.id === id)
      return issue?.suggestedText && !issue?.isFalsePositive
    }).length
  )

  // ===== 可标记误报的问题数量 =====
  const fpMarkableCount = computed(() =>
    selectedIssueIds.value.filter(id => {
      const issue = filteredItems.value.find(d => d.id === id)
      return issue && !issue.isFalsePositive
    }).length
  )

  // ===== 是否有可采纳项 =====
  const hasAdoptableItems = computed(() => adoptableCount.value > 0)

  // ===== 是否有可标记误报项 =====
  const hasFpMarkableItems = computed(() => fpMarkableCount.value > 0)

  return {
    // 状态
    batchMode,
    selectedIssueIds,
    batchLoading,

    // 计算属性
    isAllSelected,
    isIndeterminate,
    adoptableCount,
    fpMarkableCount,
    hasAdoptableItems,
    hasFpMarkableItems,

    // 方法
    enterBatchMode,
    exitBatchMode,
    toggleIssueSelection,
    toggleSelectAll,
    clearSelection,
    getSelectedIssues,
  }
}
