import { ref, reactive, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { UploadFile } from 'element-plus'
import type { ReviewPlan } from '@/types/models'
import type { EntryModule, PersistedState } from '../types/smart-review'

const STORAGE_KEY = 'smartReview_draft_v3'

export function useSmartReviewState() {
  const route = useRoute()

  // ===== 步骤控制 =====
  const currentStep = ref(0)
  const isFromHistory = computed(() => !!route.params.id)

  // ===== 文件上传 =====
  const fileList = ref<UploadFile[]>([])
  const refFileList = ref<UploadFile[]>([])
  const dwgParsedDataMap = ref<Record<string, any>>({})

  // ===== 表单 =====
  const form = reactive({ title: '' })

  // ===== 入口模式 =====
  const entryModule = ref<EntryModule | ''>('')

  // ===== 审查计划草稿 =====
  const reviewPlanDraft = reactive<ReviewPlan>({
    objective: 'COMPLIANCE',
    evidence: {
      sources: ['STANDARD'],
      knowledgeCategoryIds: [],
      reviewSpecificationId: null,
      refFileGroupId: null,
      enabledPrefixes: [],
    },
    enhancements: {
      intraFileConsistency: false,
      crossFileConsistency: false,
    },
    execution: {
      profile: 'RULE_ONLY',
    },
    templateId: 'general',
  })

  // ===== 规则相关 =====
  const enabledRulePrefixes = ref<string[]>([])
  const rulePrefixGroups = ref<any[]>([])
  const ruleRegistryLoaded = ref(false)

  // ===== 审查点和目的 =====
  const selectedReviewPoints = ref<string[]>([])
  const customPurposes = ref<Array<{ value: string }>>([{ value: '' }])
  const allSuggestedReviewPoints = ref<string[]>([])
  const allSuggestedCorePurposes = ref<string[]>([])

  // ===== UI 状态 =====
  const loading = ref(false)
  const loadingMessage = ref('')
  const analysisProgress = ref<Array<any>>([])
  const backgroundStatus = ref<'idle' | 'analyzing' | 'done'>('idle')
  const submitting = ref(false)

  // ===== 计算属性 =====
  const showEvidenceSection = computed(() => {
    if (!entryModule.value) return true
    return ['LIBRARY', 'RULE_ONLY', 'DOC_REVIEW'].includes(entryModule.value)
  })

  const showObjectiveSelector = computed(() => !entryModule.value)

  const showExecutionProfileSection = computed(() =>
    !entryModule.value || entryModule.value === 'RULE_ONLY'
  )

  const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6))

  // ===== localStorage 持久化 =====
  const saveState = () => {
    try {
      const state: PersistedState = {
        currentStep: currentStep.value,
        title: form.title,
        preAnalyzed: false,
        preAnalysisData: {
          contractType: '',
          noResultReason: '',
          potentialParties: [],
          suggestedReviewPoints: [],
          suggestedCorePurposes: [],
          llmAnalyzed: false,
        },
        selectedReviewPoints: [...selectedReviewPoints.value],
        customPurposes: customPurposes.value.map(p => ({ value: p.value })),
        allSuggestedReviewPoints: [...allSuggestedReviewPoints.value],
        allSuggestedCorePurposes: [...allSuggestedCorePurposes.value],
        fileNames: fileList.value.map(f => f.name),
        refFileNames: refFileList.value.map(f => f.name),
        savedAt: Date.now(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.warn('[useSmartReviewState] saveState failed:', e)
    }
  }

  const restoreState = (): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const state: PersistedState = JSON.parse(raw)
      if (Date.now() - state.savedAt > 30 * 60 * 1000) {
        clearSavedState()
        return false
      }
      if (state.currentStep !== undefined && state.currentStep > 0) {
        clearSavedState()
        return false
      }
      if (state.currentStep !== undefined) currentStep.value = state.currentStep
      if (state.title) form.title = state.title
      if (state.selectedReviewPoints?.length) selectedReviewPoints.value = state.selectedReviewPoints
      if (state.customPurposes?.length) customPurposes.value = state.customPurposes
      if (state.allSuggestedReviewPoints?.length) allSuggestedReviewPoints.value = state.allSuggestedReviewPoints
      if (state.allSuggestedCorePurposes?.length) allSuggestedCorePurposes.value = state.allSuggestedCorePurposes
      return true
    } catch (e) {
      return false
    }
  }

  const clearSavedState = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch (e) { /* ignore */ }
  }

  // 自动保存监听
  watch([currentStep, () => form.title], () => saveState(), { deep: true })
  watch([selectedReviewPoints, customPurposes], () => saveState(), { deep: true })

  // ===== 方法 =====
  const goToStep = (step: number) => {
    currentStep.value = step
  }

  const resetState = () => {
    currentStep.value = 0
    form.title = ''
    fileList.value = []
    refFileList.value = []
    clearSavedState()
  }

  return {
    // 状态
    currentStep,
    isFromHistory,
    fileList,
    refFileList,
    dwgParsedDataMap,
    form,
    entryModule,
    reviewPlanDraft,
    enabledRulePrefixes,
    rulePrefixGroups,
    ruleRegistryLoaded,
    selectedReviewPoints,
    customPurposes,
    allSuggestedReviewPoints,
    allSuggestedCorePurposes,
    loading,
    loadingMessage,
    analysisProgress,
    backgroundStatus,
    submitting,

    // 计算属性
    showEvidenceSection,
    showObjectiveSelector,
    showExecutionProfileSection,
    visibleAnalysisProgress,

    // 方法
    goToStep,
    resetState,
    saveState,
    restoreState,
    clearSavedState,
  }
}
