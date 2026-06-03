import { ref, computed, type Ref } from 'vue'
import type { IssueDetail } from '../types/issue'

export function useIssueFilter(details: Ref<IssueDetail[]>, selectedFileId: Ref<string | null>) {
  // ===== 筛选状态 =====
  const filterSeverity = ref('')
  const filterCategory = ref('')
  const searchText = ref('')
  
  // DWG 专属筛选
  const filterDwgLayers = ref<string[]>([])
  const filterDwgEntityTypes = ref<string[]>([])
  const filterDwgRuleTypes = ref<string[]>([])

  // ===== 文件过滤（基础）=====
  const filteredDetails = computed(() => {
    if (!selectedFileId.value) return details.value
    return details.value.filter(d => d.fileId === selectedFileId.value)
  })

  // ===== DWG 数据检测 =====
  const hasDwgDetails = computed(() =>
    filteredDetails.value.some(d => d.dwgMetadata)
  )

  // ===== 图层选项提取 =====
  const dwgLayerOptions = computed(() => {
    const set = new Set<string>()
    filteredDetails.value.forEach(d => {
      if (d.dwgMetadata?.layer) set.add(d.dwgMetadata.layer)
    })
    return Array.from(set).sort()
  })

  // ===== 图元类型选项提取 =====
  const dwgEntityTypeOptions = computed(() => {
    const set = new Set<string>()
    filteredDetails.value.forEach(d => {
      if (d.dwgMetadata?.entityType) set.add(d.dwgMetadata.entityType)
    })
    return Array.from(set).sort()
  })

  // ===== 是否有激活的筛选条件 =====
  const hasActiveFilters = computed(() =>
    !!filterSeverity.value ||
    !!filterCategory.value ||
    !!searchText.value.trim() ||
    filterDwgLayers.value.length > 0 ||
    filterDwgEntityTypes.value.length > 0 ||
    filterDwgRuleTypes.value.length > 0
  )

  // ===== 组合所有筛选条件 =====
  const filteredAndSearched = computed(() => {
    let list = filteredDetails.value

    // 严重度筛选
    if (filterSeverity.value) {
      list = list.filter(d => d.severity === filterSeverity.value)
    }

    // 分类筛选
    if (filterCategory.value) {
      list = list.filter(d => d.issueType === filterCategory.value)
    }

    // DWG 图层筛选
    if (filterDwgLayers.value.length > 0) {
      list = list.filter(d => {
        const layer = d.dwgMetadata?.layer
        return layer && filterDwgLayers.value.includes(layer)
      })
    }

    // DWG 图元类型筛选
    if (filterDwgEntityTypes.value.length > 0) {
      list = list.filter(d => {
        const et = d.dwgMetadata?.entityType
        return et && filterDwgEntityTypes.value.includes(et)
      })
    }

    // DWG 规则类型筛选
    if (filterDwgRuleTypes.value.length > 0) {
      list = list.filter(d => {
        const code = d.ruleCode
        if (!code) return false
        let prefix = code.split('_')[0]
        if (prefix === 'DIM') prefix = 'DIMENSION'
        return filterDwgRuleTypes.value.includes(prefix)
      })
    }

    // 全文搜索
    if (searchText.value.trim()) {
      const kw = searchText.value.trim().toLowerCase()
      list = list.filter(d =>
        d.originalText.toLowerCase().includes(kw) ||
        (d.description && d.description.toLowerCase().includes(kw)) ||
        (d.ruleCode && d.ruleCode.toLowerCase().includes(kw))
      )
    }

    return list
  })

  // ===== 重置筛选 =====
  const resetFilters = () => {
    filterSeverity.value = ''
    filterCategory.value = ''
    searchText.value = ''
    filterDwgLayers.value = []
    filterDwgEntityTypes.value = []
    filterDwgRuleTypes.value = []
  }

  return {
    // 状态
    filterSeverity,
    filterCategory,
    searchText,
    filterDwgLayers,
    filterDwgEntityTypes,
    filterDwgRuleTypes,

    // 计算属性
    filteredDetails,
    hasDwgDetails,
    dwgLayerOptions,
    dwgEntityTypeOptions,
    hasActiveFilters,
    filteredAndSearched,

    // 方法
    resetFilters,
  }
}
