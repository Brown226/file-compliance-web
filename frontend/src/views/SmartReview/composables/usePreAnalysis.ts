import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { preAnalyzeApi, uploadOnlyApi } from '@/api/task'
import type { PreAnalysisData, BackgroundStatus } from '../types/smart-review'

export function usePreAnalysis(state: ReturnType<typeof import('./useSmartReviewState').default>) {
  const preAnalyzed = ref(false)
  const preAnalyzing = ref(false)
  const isUploadingForPreAnalysis = ref(false)
  const tempUploadedFilePaths = ref<string[]>([])

  const preAnalysisData = reactive<PreAnalysisData>({
    contractType: '',
    noResultReason: '',
    potentialParties: [],
    suggestedReviewPoints: [],
    suggestedCorePurposes: [],
    llmAnalyzed: false,
  })

  let currentPreAnalysisAbortController: AbortController | null = null
  let preAnalyzeTimer: ReturnType<typeof setTimeout> | null = null
  let backgroundStatusHideTimer: ReturnType<typeof setTimeout> | null = null

  // AI 建议标题
  const aiSuggestedTitle = computed(() => {
    if (!preAnalyzed.value || state.form.title) return ''
    if (preAnalysisData.noResultReason) return ''
    const type = preAnalysisData.contractType
    const firstFile = state.fileList.value[0]?.name?.replace(/\.[^.]+$/, '') || ''
    if (type && firstFile) return `${firstFile}-${type}审查`
    if (type) return `${type}智能审查`
    if (firstFile) return `${firstFile}-文件合规审查`
    return ''
  })

  // 应用预分析数据到界面
  const applyPreAnalysisData = (data: any) => {
    console.log('[usePreAnalysis] applyPreAnalysisData:', JSON.stringify({
      suggestedReviewPoints: data.suggestedReviewPoints,
      contractType: data.contractType,
      llmAnalyzed: data.llmAnalyzed,
    }, null, 2))

    preAnalysisData.llmAnalyzed = !!data.llmAnalyzed

    if (data.contractType) {
      preAnalysisData.contractType = data.contractType
    } else if (data.documentTypeLabel) {
      preAnalysisData.contractType = data.documentTypeLabel
    }
    preAnalysisData.noResultReason = data.noResultReason || ''

    const rec = data.recommendations
    if (!rec) {
      console.log('[usePreAnalysis] 无推荐数据，跳过审查项设置')
      return
    }

    // 填充知识库和规范库
    if (rec.libraryReview?.categoryId) {
      const ids = state.reviewPlanDraft.evidence.knowledgeCategoryIds
      if (!ids.includes(rec.libraryReview.categoryId)) {
        ids.push(rec.libraryReview.categoryId)
      }
    }
    if (rec.reviewSpecification?.specificationId) {
      state.reviewPlanDraft.evidence.reviewSpecificationId = rec.reviewSpecification.specificationId
      if (!state.reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')) {
        state.reviewPlanDraft.evidence.sources.push('REVIEW_SPECIFICATION')
      }
    }

    // 更新审查点
    const suggestedPoints = data.suggestedReviewPoints || []
    if (data.llmAnalyzed && suggestedPoints.length > 0) {
      preAnalysisData.suggestedReviewPoints = suggestedPoints
      state.allSuggestedReviewPoints.value = [...suggestedPoints]
      state.selectedReviewPoints.value = [...suggestedPoints]
    }

    // 更新核心目的
    const suggestedPurposes = data.suggestedCorePurposes || []
    if (data.llmAnalyzed && suggestedPurposes.length > 0) {
      preAnalysisData.suggestedCorePurposes = suggestedPurposes
      state.allSuggestedCorePurposes.value = [...suggestedPurposes]
      state.customPurposes.value = suggestedPurposes.map((p: string) => ({ value: p }))
    }
  }

  // 带取消信号的预分析
  const runPreAnalysisWithSignal = async (files: Array<{ name: string; size: number }>, signal?: AbortSignal) => {
    preAnalyzing.value = true
    try {
      const { data } = await preAnalyzeApi(files)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      applyPreAnalysisData(data)
      preAnalyzed.value = true
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      console.warn('[usePreAnalysis] 预分析失败:', e)
      throw e
    } finally {
      preAnalyzing.value = false
    }
  }

  // 进入步骤1时的预分析流程
  const goToStep1WithPreAnalysis = async () => {
    if (state.fileList.value.length === 0) {
      ElMessage.warning('请至少选择一个待审文件')
      return
    }

    state.currentStep.value = 1

    // RULE_ONLY 模式无需预分析
    if (state.entryModule.value === 'RULE_ONLY') {
      return
    }

    if (preAnalyzed.value) {
      state.backgroundStatus.value = 'idle'
      return
    }

    state.backgroundStatus.value = 'pre-analyzing'
    currentPreAnalysisAbortController = new AbortController()

    try {
      isUploadingForPreAnalysis.value = true

      // 阶段1：上传文件
      const formData = new FormData()
      state.fileList.value.forEach(f => {
        if (f.raw) formData.append('files', f.raw)
      })
      const uploadRes = await uploadOnlyApi(formData)
      const uploadedFiles = uploadRes.data?.files || []
      tempUploadedFilePaths.value = uploadedFiles.map((f: any) => f.filePath)

      isUploadingForPreAnalysis.value = false

      // 阶段2：使用实际路径进行预分析
      const fileMetaWithPaths = uploadedFiles.map((f: any) => ({
        name: f.fileName,
        size: f.fileSize,
        filePath: f.filePath,
      }))

      await runPreAnalysisWithSignal(fileMetaWithPaths, currentPreAnalysisAbortController.signal)

      state.backgroundStatus.value = 'done'
      ElMessage.success('AI 预分析完成，已自动填入推荐配置')
      if (backgroundStatusHideTimer) clearTimeout(backgroundStatusHideTimer)
      backgroundStatusHideTimer = setTimeout(() => { state.backgroundStatus.value = 'idle' }, 3000)

    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error('[usePreAnalysis] 预分析流程失败:', err)
      state.backgroundStatus.value = 'failed'
      ElMessage.warning('预分析失败，您可手动配置后直接开始分析')
    } finally {
      isUploadingForPreAnalysis.value = false
    }
  }

  // 监听文件列表变化，后台预分析（用户返回重新上传时触发）
  watch(state.fileList, (newList) => {
    if (preAnalyzeTimer) clearTimeout(preAnalyzeTimer)
    if (newList.length > 0) {
      preAnalyzed.value = false
      preAnalyzing.value = true

      if (state.currentStep.value === 1 && state.entryModule.value !== 'RULE_ONLY') {
        preAnalyzeTimer = setTimeout(() => {
          const metaList = newList.map(f => ({ name: f.name, size: f.size || 0 }))
          runPreAnalysisWithSignal(metaList, currentPreAnalysisAbortController?.signal).catch(() => {})
        }, 800)
      }
    } else {
      preAnalyzed.value = false
      preAnalyzing.value = false
    }
  }, { deep: true })

  return {
    preAnalyzed,
    preAnalyzing,
    isUploadingForPreAnalysis,
    tempUploadedFilePaths,
    preAnalysisData,
    aiSuggestedTitle,

    applyPreAnalysisData,
    runPreAnalysisWithSignal,
    goToStep1WithPreAnalysis,
  }
}
