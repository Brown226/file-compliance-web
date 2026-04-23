/** 任务状态映射 */
const TASK_STATUS_MAP: Record<string, { label: string; type: string }> = {
  PENDING: { label: '排队中', type: 'info' },
  PROCESSING: { label: '审查中', type: 'primary' },
  COMPLETED: { label: '已完成', type: 'success' },
  FAILED: { label: '失败', type: 'danger' },
}

/** 审查类型映射 */
const REVIEW_TYPE_MAP: Record<string, { label: string; type: string }> = {
  TEXT: { label: '文字审查', type: '' },
  IMAGE: { label: '图片审查', type: 'warning' },
  DOCUMENT: { label: '文档审查', type: 'success' },
}

/**
 * 状态辅助 Composable
 */
export function useStatusHelpers() {
  const getTaskStatusLabel = (status: string): string => {
    return TASK_STATUS_MAP[status]?.label ?? '未知状态'
  }

  const getTaskStatusType = (status: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' | undefined => {
    return (TASK_STATUS_MAP[status]?.type ?? 'info') as 'primary' | 'success' | 'warning' | 'info' | 'danger'
  }

  const getReviewTypeLabel = (type: string): string => {
    return REVIEW_TYPE_MAP[type]?.label ?? type
  }

  const getReviewTypeType = (type: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' | undefined => {
    const t = REVIEW_TYPE_MAP[type]?.type
    return (t || 'info') as 'primary' | 'success' | 'warning' | 'info' | 'danger'
  }

  return {
    getTaskStatusLabel,
    getTaskStatusType,
    getReviewTypeLabel,
    getReviewTypeType,
  }
}
