import { computed, watch } from 'vue'
import type { ReviewPlan, ReviewObjective, ReviewEvidenceSource } from '@/types/models'
import type { EntryModule } from '../types/smart-review'
import {
  OBJECTIVE_OPTIONS,
  EVIDENCE_SOURCE_OPTIONS,
} from '../constants/review-config'

export function useReviewPlan(state: ReturnType<typeof import('./useSmartReviewState').default>) {
  // ===== 审查目标选项 =====
  const objectiveOptions = OBJECTIVE_OPTIONS

  // ===== 证据源配置 =====
  const evidenceSourceOptions = EVIDENCE_SOURCE_OPTIONS

  const availableEvidenceSources = computed(() =>
    evidenceSourceOptions[state.reviewPlanDraft.objective] || []
  )

  // ===== 审查计划 Payload =====
  const reviewPlanPayload = computed<ReviewPlan>(() => ({
    ...state.reviewPlanDraft,
    evidence: {
      ...state.reviewPlanDraft.evidence,
      knowledgeCategoryIds: [...(state.reviewPlanDraft.evidence.knowledgeCategoryIds || [])],
      sources: [...(state.reviewPlanDraft.evidence.sources || [])],
      reviewSpecificationId: state.reviewPlanDraft.evidence.reviewSpecificationId || null,
      refFileGroupId: state.reviewPlanDraft.evidence.refFileGroupId || null,
      enabledPrefixes: [...state.enabledRulePrefixes.value],
    },
    enhancements: { ...state.reviewPlanDraft.enhancements },
    execution: { ...state.reviewPlanDraft.execution },
    templateId: state.reviewPlanDraft.templateId,
  }))

  // ===== 证据源操作 =====
  const isEvidenceLocked = (source: ReviewEvidenceSource): boolean => {
    if (!state.entryModule.value) return state.reviewPlanDraft.objective === 'COMPARE'
    if (state.entryModule.value === 'RULE_ONLY') return source !== 'REVIEW_SPECIFICATION'
    if (state.entryModule.value === 'PROOFREAD') return true
    if (state.entryModule.value === 'CONSISTENCY' && state.reviewPlanDraft.objective === 'COMPARE') {
      return source !== 'REFERENCE'
    }
    return state.reviewPlanDraft.objective === 'COMPARE'
  }

  const toggleEvidenceSource = (source: ReviewEvidenceSource) => {
    if (isEvidenceLocked(source)) return
    const current = new Set(state.reviewPlanDraft.evidence.sources)
    if (current.has(source)) {
      current.delete(source)
      if (source === 'REVIEW_SPECIFICATION') state.reviewPlanDraft.evidence.reviewSpecificationId = null
    } else {
      current.add(source)
    }
    state.reviewPlanDraft.evidence.sources = Array.from(current)
  }

  const handleEvidenceCardClick = (source: ReviewEvidenceSource) => {
    if (isEvidenceLocked(source)) return

    if (source === 'STANDARD' || source === 'REVIEW_SPECIFICATION') {
      const current = new Set(state.reviewPlanDraft.evidence.sources)
      if (current.has(source)) {
        current.delete(source)
        // 取消选中时清空关联数据
        if (source === 'REVIEW_SPECIFICATION') state.reviewPlanDraft.evidence.reviewSpecificationId = null
        if (source === 'STANDARD') state.reviewPlanDraft.evidence.knowledgeCategoryIds = []
      } else {
        current.add(source)
      }
      state.reviewPlanDraft.evidence.sources = Array.from(current)
    } else {
      toggleEvidenceSource(source)
    }
  }

  // ===== 规则前缀操作 =====
  const togglePrefix = (prefix: string) => {
    const idx = state.enabledRulePrefixes.value.indexOf(prefix)
    if (idx >= 0) {
      state.enabledRulePrefixes.value.splice(idx, 1)
    } else {
      state.enabledRulePrefixes.value.push(prefix)
    }
  }

  const toggleGroup = (prefixes: string[], enabled: boolean) => {
    if (enabled) {
      prefixes.forEach(p => {
        if (!state.enabledRulePrefixes.value.includes(p)) {
          state.enabledRulePrefixes.value.push(p)
        }
      })
    } else {
      state.enabledRulePrefixes.value = state.enabledRulePrefixes.value.filter(p => !prefixes.includes(p))
    }
  }

  // ===== 入口模块预设应用 =====
  const applyEntryModulePreset = (module: EntryModule) => {
    const draft = state.reviewPlanDraft

    switch (module) {![1779933023100](image/useReviewPlan/1779933023100.png)![1779933024930](image/useReviewPlan/1779933024930.png)![1779933032645](image/useReviewPlan/1779933032645.png)![1779933033749](image/useReviewPlan/1779933033749.png)![1779933042503](image/useReviewPlan/1779933042503.png)![1779933042740](image/useReviewPlan/1779933042740.png)![1779933042973](image/useReviewPlan/1779933042973.png)![1779933049544](image/useReviewPlan/1779933049544.png)
      case 'LIBRARY':
        draft.objective = 'COMPLIANCE'
        draft.evidence.sources = []
        draft.execution.profile = 'AI_ONLY'
        break

      case 'CONSISTENCY':
        draft.objective = 'COMPLIANCE'
        draft.evidence.sources = []
        draft.evidence.reviewSpecificationId = null
        draft.evidence.knowledgeCategoryIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = true
        draft.execution.profile = 'AI_ONLY'
        break

      case 'PROOFREAD':
        draft.objective = 'PROOFREAD'
        draft.evidence.sources = []
        draft.evidence.reviewSpecificationId = null
        draft.evidence.knowledgeCategoryIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = false
        draft.execution.profile = 'AI_ONLY'
        break

      case 'MULTIMODAL':
        draft.objective = 'STRUCTURED'
        draft.evidence.sources = []
        draft.evidence.reviewSpecificationId = null
        draft.evidence.knowledgeCategoryIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = true
        draft.execution.profile = 'AI_ONLY'
        break

      case 'DOC_REVIEW':
        draft.objective = 'COMPARE'
        draft.evidence.sources = ['REFERENCE']
        draft.evidence.reviewSpecificationId = null
        draft.evidence.knowledgeCategoryIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = true
        draft.execution.profile = 'AI_ONLY'
        break

      case 'RULE_ONLY':
        draft.objective = 'COMPLIANCE'
        draft.evidence.sources = []
        draft.evidence.reviewSpecificationId = null
        draft.evidence.knowledgeCategoryIds = []
        draft.enhancements.intraFileConsistency = false
        draft.enhancements.crossFileConsistency = false
        draft.execution.profile = 'RULE_ONLY'
        break
    }
  }

  // ===== 监听审查目标变化，自动调整证据源 =====
  watch(() => state.reviewPlanDraft.objective, (objective) => {
    const allowed = new Set((evidenceSourceOptions[objective] || []).map(item => item.value))
    
    if (objective === 'COMPARE') {
      state.reviewPlanDraft.evidence.sources = ['REFERENCE']
      state.reviewPlanDraft.execution.profile = 'AI_ONLY'
    } else if (objective === 'PROOFREAD') {
      state.reviewPlanDraft.evidence.sources = []
      state.reviewPlanDraft.evidence.reviewSpecificationId = null
      state.reviewPlanDraft.evidence.knowledgeCategoryIds = []
      state.reviewPlanDraft.execution.profile = 'AI_ONLY'
    } else {
      const next = state.reviewPlanDraft.evidence.sources.filter(source => allowed.has(source))
      state.reviewPlanDraft.evidence.sources = next.length > 0 ? next : (allowed.has('STANDARD') ? ['STANDARD'] : [])
    }

    if (!state.reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')) {
      state.reviewPlanDraft.evidence.reviewSpecificationId = null
    }
    if (!state.reviewPlanDraft.evidence.sources.includes('STANDARD')) {
      state.reviewPlanDraft.evidence.knowledgeCategoryIds = []
    }
    if (!state.reviewPlanDraft.evidence.sources.includes('REFERENCE')) {
      state.reviewPlanDraft.evidence.refFileGroupId = null
    }
  })

  // ===== 提交验证 =====
  const canSubmit = computed(() => {
    if (!state.form.title.trim()) return false
    if (state.fileList.value.length === 0) return false
    if (state.reviewPlanDraft.objective === 'COMPARE' && state.refFileList.value.length === 0) return false
    // 勾选了证据源但未做具体选择时，阻断提交
    if (state.reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION') && !state.reviewPlanDraft.evidence.reviewSpecificationId) return false
    if (state.reviewPlanDraft.evidence.sources.includes('STANDARD') && (!state.reviewPlanDraft.evidence.knowledgeCategoryIds || state.reviewPlanDraft.evidence.knowledgeCategoryIds.length === 0)) return false
    
    return true
  })

  return {
    objectiveOptions,
    evidenceSourceOptions,
    availableEvidenceSources,
    reviewPlanPayload,

    isEvidenceLocked,
    toggleEvidenceSource,
    handleEvidenceCardClick,

    togglePrefix,
    toggleGroup,

    applyEntryModulePreset,
    canSubmit,
  }
}
