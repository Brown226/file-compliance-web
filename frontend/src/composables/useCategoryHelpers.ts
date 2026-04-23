/** 问题分类映射 */
const CATEGORY_MAP: Record<string, { label: string; type: string }> = {
  TYPO: { label: '错别字', type: 'warning' },
  VIOLATION: { label: '违规', type: 'danger' },
}

/**
 * 分类辅助 Composable
 */
export function useCategoryHelpers() {
  const getCategoryLabel = (category: string): string => {
    return CATEGORY_MAP[category]?.label ?? category
  }

  const getCategoryType = (category: string): string => {
    return CATEGORY_MAP[category]?.type ?? 'info'
  }

  const allCategories = [
    { value: 'TYPO', label: '错别字' },
    { value: 'VIOLATION', label: '违规' },
  ]

  return { getCategoryLabel, getCategoryType, allCategories }
}
