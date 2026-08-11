/**
 * 审查结果统计相关的响应式状态
 * 从 TaskResultsView.vue 提取
 */
import { computed, type Ref } from 'vue'
import type { Task, TaskDetail, TaskFile } from '@/types/models'

export interface ReviewSummary {
  totalFiles?: number
  totalIssues?: number
  errorCount?: number
  warningCount?: number
  infoCount?: number
  aiIssues?: number
  ruleIssues?: number
  reviewMode?: string
  [key: string]: any
}

export interface ReviewPlanSummary {
  module: string
  objective: string
  evidence: string
  execution: string
  enhancements: string
  proofreadingEnhancement: string
  taskMode: string
}

const objectiveLabelMap: Record<string, string> = {
  COMPLIANCE: '合规审查',
  COMPARE: '参照比对',
  PROOFREAD: '基础校对',
  STRUCTURED: '结构化审查',
}

const evidenceLabelMap: Record<string, string> = {
  STANDARD: '知识库',
  RULE_LIBRARY: '条文库',
  REFERENCE: '参考文件',
}

const executionLabelMap: Record<string, string> = {
  AI_ONLY: 'AI 审查',
  RULE_ONLY: '仅规则执行',
}

const modeLabelMap: Record<string, string> = {
  LIBRARY_REVIEW: '以库审文',
  DOC_REVIEW: '以文审文',
  CONTRACT_REVIEW: '合同风险审查',
  TYPO_GRAMMAR: '基础校对',
  SELF_CHECK: '标准引用自检',
  CONSISTENCY: '一致性审查',
  RULE_ONLY: '仅规则审查',
}

export function getModeLabel(mode: string): string {
  return modeLabelMap[mode] || mode
}

export function useReviewStats(
  task: Ref<Task | null>,
  allDetails: Ref<TaskDetail[]>,
  files: Ref<TaskFile[]>,
  filterFileId: Ref<string>,
  runtimeFileStatus: Ref<Record<string, 'completed' | 'failed' | 'skipped'>>,
) {
  const isSelfCheck = computed(() => (task.value as any)?.reviewMode === 'SELF_CHECK')

  const showAiWarning = computed(() => {
    const mode = (task.value as any)?.reviewMode
    if (!mode || mode === 'RULE_ONLY' || mode === 'SELF_CHECK') return false
    return (reviewSummary.value?.aiIssues ?? 0) === 0
  })

  const reviewSummary = computed((): ReviewSummary | null => {
    const detail = allDetails.value.find((d: any) => d.issueType === 'REVIEW_SUMMARY')
    if (detail?.description) {
      return typeof detail.description === 'string' ? JSON.parse(detail.description) : detail.description
    }
    return null
  })

  const reviewPlanSummary = computed((): ReviewPlanSummary => {
    const plan = (task.value as any)?.reviewPlan
    const taskMode = reviewSummary.value?.reviewMode || (task.value as any)?.reviewMode || '-'

    if (!plan || typeof plan !== 'object') {
      return {
        module: getModeLabel(taskMode),
        objective: '—',
        evidence: '—',
        execution: '—',
        enhancements: '无',
        proofreadingEnhancement: '—',
        taskMode: getModeLabel(taskMode),
      }
    }

    const sources = Array.isArray(plan.evidence?.sources) ? plan.evidence.sources : []
    const evidence = sources.length > 0
      ? sources.map((item: string) => evidenceLabelMap[item] || item).join(' + ')
      : '无外部依据'

    const enhancements: string[] = []
    if (plan.enhancements?.intraFileConsistency) enhancements.push('文件内一致性')
    if (plan.enhancements?.crossFileConsistency) enhancements.push('跨文件一致性')

    const module = (() => {
      if (plan.objective === 'COMPARE') return '一致性审查（对照）'
      if (plan.objective === 'PROOFREAD') return '基础校对'
      if (plan.objective === 'STRUCTURED') return '结构化审查'
      if (plan.execution?.profile === 'RULE_ONLY' && sources.includes('RULE_LIBRARY')) return '条文库审查'
      if (sources.includes('RULE_LIBRARY') && sources.includes('STANDARD')) return '以库审文'
      if (sources.includes('RULE_LIBRARY')) return '条文库审查'
      return '以库审文'
    })()

    const proofreadingEnhancement = plan.execution?.profile === 'RULE_ONLY'
      ? '关闭（纯规则）'
      : (plan.enhancements?.intraFileConsistency ? '开启' : '关闭')

    return {
      module,
      objective: objectiveLabelMap[plan.objective] || plan.objective || '—',
      evidence,
      execution: executionLabelMap[plan.execution?.profile] || plan.execution?.profile || '—',
      enhancements: enhancements.length > 0 ? enhancements.join(' + ') : '无',
      proofreadingEnhancement,
      taskMode: getModeLabel(taskMode),
    }
  })

  const filteredDetails = computed(() => {
    let details = allDetails.value.filter((d: any) => d.issueType !== 'REVIEW_SUMMARY')
    if (filterFileId.value) {
      details = details.filter((d: any) => d.fileId === filterFileId.value)
    }
    return details
  })

  const noResultEntries = computed(() =>
    filteredDetails.value.filter((d: any) => d.ruleCode === 'NO_RESULT')
  )

  const issueDetails = computed(() =>
    filteredDetails.value.filter((d: any) => d.ruleCode !== 'NO_RESULT')
  )

  const noResultReasons = computed(() =>
    noResultEntries.value
      .map((d: any) => d.description)
      .filter(Boolean)
  )

  const totalIssuesExclSummary = computed(() => issueDetails.value.length)
  const errorIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'error'))
  const warningIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'warning'))
  const infoIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'info'))
  const standardRefIssues = computed(() => issueDetails.value.filter((d: any) => d.standardRef || d.standardRefId))

  const fileStatusSummary = computed(() => {
    const ids = new Set(files.value.map((f: any) => f.id))
    let completed = 0
    let failed = 0
    let skipped = 0

    Object.entries(runtimeFileStatus.value).forEach(([fileId, status]) => {
      if (!ids.has(fileId)) return
      if (status === 'completed') completed++
      if (status === 'failed') failed++
      if (status === 'skipped') skipped++
    })

    return { completed, failed, skipped }
  })

  const tabBadges = computed(() => ({
    overview: {
      total: issueDetails.value.length,
      errors: errorIssues.value.length,
      warnings: warningIssues.value.length,
      hasIssues: issueDetails.value.length > 0,
    },
    suggestions: {
      total: issueDetails.value.length,
      errorCount: errorIssues.value.length,
      warningCount: warningIssues.value.length,
    },
    knowledge: {
      count: standardRefIssues.value.length,
      isEmpty: standardRefIssues.value.length === 0,
    },
  }))

  const getTabBadge = (key: string) => {
    const badges = tabBadges.value

    switch (key) {
      case 'overview':
        return badges.overview.hasIssues
          ? { value: badges.overview.total, type: 'danger' as const }
          : { value: '✓', type: 'success' as const }
      case 'suggestions':
        if (badges.suggestions.total === 0) return null
        return {
          value: `${badges.suggestions.errorCount}/${badges.suggestions.total}`,
          type: 'danger' as const,
        }
      case 'knowledge':
        return badges.knowledge.isEmpty
          ? null
          : { value: badges.knowledge.count, type: 'success' as const }
      default:
        return null
    }
  }

  return {
    isSelfCheck,
    showAiWarning,
    reviewSummary,
    reviewPlanSummary,
    filteredDetails,
    noResultEntries,
    issueDetails,
    noResultReasons,
    totalIssuesExclSummary,
    errorIssues,
    warningIssues,
    infoIssues,
    standardRefIssues,
    fileStatusSummary,
    tabBadges,
    getTabBadge,
  }
}
