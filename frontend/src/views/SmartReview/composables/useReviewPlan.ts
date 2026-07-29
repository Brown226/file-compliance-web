import { computed, watch } from 'vue'
import type { ReviewPlan, ReviewObjective, ReviewEvidenceSource } from '../types/smart-review'
import type { EntryModule } from '../types/smart-review'
import {
  OBJECTIVE_OPTIONS,
  EVIDENCE_SOURCE_OPTIONS,
} from '../constants/review-config'

export function useReviewPlan(state: ReturnType<typeof useSmartReviewState>) {
  // ===== 审查目标选项 =====
  const objectiveOptions = OBJECTIVE_OPTIONS

  // ===== 证据源配�?=====
  const evidenceSourceOptions = EVIDENCE_SOURCE_OPTIONS

  const availableEvidenceSources = computed(() =>
    evidenceSourceOptions[state.reviewPlanDraft.objective] || []
  )

  // ===== 审查计划 Payload =====
  const reviewPlanPayload = computed<ReviewPlan>(() => ({
    ...state.reviewPlanDraft,
    evidence: {
      ...state.reviewPlanDraft.evidence,
      maxkbKnowledgeIds: [...(state.reviewPlanDraft.evidence.maxkbKnowledgeIds || [])],
      sources: [...(state.reviewPlanDraft.evidence.sources || [])],
      ruleLibraryId: state.reviewPlanDraft.evidence.ruleLibraryId || null,
      refFileGroupId: state.reviewPlanDraft.evidence.refFileGroupId || null,
      enabledPrefixes: [...state.enabledRulePrefixes.value],
    },
    enhancements: { ...state.reviewPlanDraft.enhancements },
    execution: { ...state.reviewPlanDraft.execution },
    templateId: state.reviewPlanDraft.templateId,
  }))

  // ===== 证据源操�?=====
  const isEvidenceLocked = (source: ReviewEvidenceSource): boolean => {
    if (!state.entryModule.value) return state.reviewPlanDraft.objective === 'COMPARE'
    if (state.entryModule.value === 'PROOFREAD') return true
    if (state.entryModule.value === 'CONSISTENCY' && state.reviewPlanDraft.objective === 'COMPARE') {
      return source !== 'REFERENCE'
    }
    // 合同审查模式：REFERENCE 和 STANDARD 都可选
    if (state.entryModule.value === 'CONTRACT') {
      return false  // 所有证据源都可选
    }
    return state.reviewPlanDraft.objective === 'COMPARE'
  }

  const toggleEvidenceSource = (source: ReviewEvidenceSource) => {
    if (isEvidenceLocked(source)) return
    const current = new Set(state.reviewPlanDraft.evidence.sources)
    if (current.has(source)) {
      current.delete(source)
      if (source === 'RULE_LIBRARY') state.reviewPlanDraft.evidence.ruleLibraryId = null
    } else {
      current.add(source)
    }
    state.reviewPlanDraft.evidence.sources = Array.from(current)
  }

  const handleEvidenceCardClick = (source: ReviewEvidenceSource) => {
    if (isEvidenceLocked(source)) return

    if (source === 'STANDARD' || source === 'RULE_LIBRARY') {
      const current = new Set(state.reviewPlanDraft.evidence.sources)
      if (current.has(source)) {
        current.delete(source)
        // 取消选中时清空关联数�?
        if (source === 'RULE_LIBRARY') state.reviewPlanDraft.evidence.ruleLibraryId = null
        if (source === 'STANDARD') state.reviewPlanDraft.evidence.maxkbKnowledgeIds = []
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

    switch (module) {
      case 'LIBRARY':
        draft.objective = 'COMPLIANCE'
        // 默认勾选知识库证据源，用户可在向导内切换为语义规则库或同时勾选
        draft.evidence.sources = ['STANDARD']
        draft.execution.profile = 'AI_ONLY'
        break

      case 'CONSISTENCY':
        draft.objective = 'COMPLIANCE'
        draft.evidence.sources = []
        draft.evidence.ruleLibraryId = null
        draft.evidence.maxkbKnowledgeIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = true
        draft.execution.profile = 'AI_ONLY'
        // 默认开启「工程规则增强」：执行 CONSIST 前缀规则（核电工程文档高价值检查点）
        state.enabledRulePrefixes.value = ['CONSIST']
        break

      case 'PROOFREAD':
        draft.objective = 'PROOFREAD'
        draft.evidence.sources = []
        draft.evidence.ruleLibraryId = null
        draft.evidence.maxkbKnowledgeIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = false
        draft.execution.profile = 'AI_ONLY'
        break

      case 'DOC_REVIEW':
        draft.objective = 'COMPARE'
        draft.evidence.sources = ['REFERENCE']
        draft.evidence.ruleLibraryId = null
        draft.evidence.maxkbKnowledgeIds = []
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = true
        draft.execution.profile = 'AI_ONLY'
        break

      case 'RULE_ONLY':
        draft.objective = 'COMPLIANCE'
        draft.evidence.sources = []
        draft.evidence.ruleLibraryId = null
        draft.evidence.maxkbKnowledgeIds = []
        draft.enhancements.intraFileConsistency = false
        draft.enhancements.crossFileConsistency = false
        draft.execution.profile = 'RULE_ONLY'
        break

      case 'CONTRACT':
        draft.objective = 'COMPARE'
        draft.evidence.sources = ['REFERENCE']  // 默认只用参照文件
        draft.evidence.ruleLibraryId = null
        draft.evidence.maxkbKnowledgeIds = []  // 知识库可选
        draft.enhancements.intraFileConsistency = true
        draft.enhancements.crossFileConsistency = false
        draft.execution.profile = 'AI_ONLY'
        draft.contractStance = 'owner'
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
      state.reviewPlanDraft.evidence.ruleLibraryId = null
      state.reviewPlanDraft.evidence.maxkbKnowledgeIds = []
      state.reviewPlanDraft.execution.profile = 'AI_ONLY'
    } else {
      const next = state.reviewPlanDraft.evidence.sources.filter(source => allowed.has(source))
      state.reviewPlanDraft.evidence.sources = next.length > 0 ? next : (allowed.has('STANDARD') ? ['STANDARD'] : [])
    }

    if (!state.reviewPlanDraft.evidence.sources.includes('RULE_LIBRARY')) {
      state.reviewPlanDraft.evidence.ruleLibraryId = null
    }
    if (!state.reviewPlanDraft.evidence.sources.includes('STANDARD')) {
      state.reviewPlanDraft.evidence.maxkbKnowledgeIds = []
    }
    if (!state.reviewPlanDraft.evidence.sources.includes('REFERENCE')) {
      state.reviewPlanDraft.evidence.refFileGroupId = null
    }
  })

  // ===== 提交验证 =====
  const canSubmit = computed(() => {
    if (!state.form.title.trim()) return false
    if (state.fileList.value.length === 0) return false
    // COMPARE 模式需要参考文件，但 CONTRACT 模式例外（允许纯知识库或无参照审查）
    if (state.reviewPlanDraft.objective === 'COMPARE' && state.entryModule.value !== 'CONTRACT' && state.refFileList.value.length === 0) return false
    // 勾选了证据源但未做具体选择时，阻断提交
    if (state.reviewPlanDraft.evidence.sources.includes('RULE_LIBRARY') && !state.reviewPlanDraft.evidence.ruleLibraryId) return false
    if (state.reviewPlanDraft.evidence.sources.includes('STANDARD') && (!state.reviewPlanDraft.evidence.maxkbKnowledgeIds || state.reviewPlanDraft.evidence.maxkbKnowledgeIds.length === 0)) return false
    
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
