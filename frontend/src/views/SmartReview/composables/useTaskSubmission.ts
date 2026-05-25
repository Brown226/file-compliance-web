import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createTaskApi } from '@/api/task'
import { useUserStore } from '@/stores/user'

export function useTaskSubmission(
  state: ReturnType<typeof import('./useSmartReviewState').default>,
  plan: ReturnType<typeof import('./useReviewPlan').default>,
  preAnalysis: ReturnType<typeof import('./usePreAnalysis').default>
) {
  const router = useRouter()
  const userStore = useUserStore()
  const submitting = ref(false)

  // 构建提交的 FormData
  const buildFormData = (): FormData => {
    const fd = new FormData()
    const submitPlan = plan.reviewPlanPayload.value

    fd.append('title', state.form.title)

    // 知识库
    if (submitPlan.evidence.sources.includes('STANDARD') && submitPlan.evidence.knowledgeCategoryIds?.length) {
      fd.append('knowledgeCategoryIds', JSON.stringify(submitPlan.evidence.knowledgeCategoryIds))
    }

    // 语义规范库
    if (submitPlan.evidence.sources.includes('REVIEW_SPECIFICATION') && submitPlan.evidence.reviewSpecificationId) {
      fd.append('ruleLibraryId', submitPlan.evidence.reviewSpecificationId)
    }

    // 预分析数据
    if (preAnalysis.preAnalyzed.value) {
      fd.append('preAnalysisData', JSON.stringify(preAnalysis.preAnalysisData))
    }

    fd.append('reviewPlan', JSON.stringify(submitPlan))

    // 审查点
    if (state.selectedReviewPoints.value.length > 0) {
      fd.append('reviewPoints', JSON.stringify(state.selectedReviewPoints.value))
    }

    // 核心目的（过滤空值）
    const validPurposes = state.customPurposes.value
      .map(p => p.value.trim())
      .filter(v => v.length > 0)
    if (validPurposes.length > 0) {
      fd.append('corePurposes', JSON.stringify(validPurposes))
    }

    // 文件
    state.fileList.value.forEach(f => { if (f.raw) fd.append('files', f.raw) })

    // 参照文件
    state.refFileList.value.forEach(f => { if (f.raw) fd.append('refFiles', f.raw) })

    // DWG 解析数据
    const dwgEntries = Object.entries(state.dwgParsedDataMap.value)
    if (dwgEntries.length > 0) {
      try {
        const validatedDwgData: Record<string, any> = {}
        for (const [fileName, data] of dwgEntries) {
          if (!data || typeof data !== 'object') continue
          validatedDwgData[fileName] = data
        }
        if (Object.keys(validatedDwgData).length > 0) {
          fd.append('dwgParsedData', JSON.stringify(validatedDwgData))
        }
      } catch (jsonErr) {
        console.error('[useTaskSubmission] DWG数据序列化失败:', jsonErr)
      }
    }

    return fd
  }

  // 提交任务
  const submitTask = async () => {
    if (!userStore.token) {
      ElMessage.error('请先登录后再创建任务')
      router.push('/login')
      return
    }

    // 前端验证
    if (!state.form.title.trim()) {
      ElMessage.warning('请输入任务标题')
      return
    }

    if (!plan.canSubmit.value) {
      const reasons: string[] = []
      if (!state.form.title.trim()) reasons.push('请输入任务标题')
      
      if (state.reviewPlanDraft.objective === 'COMPARE' && state.refFileList.value.length === 0)
        reasons.push('以文审文/参照比对模式需要上传参照文件')
      
      if (state.reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION') && !state.reviewPlanDraft.evidence.reviewSpecificationId)
        reasons.push('语义规范库模式需要选择具体的语义规范库')

      const allowEmptySources = ['PROOFREAD'].includes(state.reviewPlanDraft.objective) ||
        ['CONSISTENCY', 'RULE_ONLY', 'MULTIMODAL'].includes(state.entryModule.value as any)
      
      if (!allowEmptySources && state.reviewPlanDraft.evidence.sources.length === 0)
        reasons.push('请至少选择一项审查依据')

      ElMessage.warning(reasons.length > 0 ? reasons[0] : '请完善审查配置后再开始分析')
      return
    }

    submitting.value = true
    try {
      const fd = buildFormData()
      const { data } = await createTaskApi(fd)

      ElMessage.success('审查任务已创建')
      state.clearSavedState()
      router.push(`/review/${data.id}`)
    } catch (e: any) {
      console.error('[useTaskSubmission] 创建任务失败:', e)
      ElMessage.error(e?.response?.data?.message || e?.message || '创建任务失败')
    } finally {
      submitting.value = false
    }
  }

  // 审查目的操作
  const addPurpose = () => {
    state.customPurposes.value.push({ value: '' })
  }

  const removePurpose = (index: number) => {
    if (state.customPurposes.value.length <= 1) {
      ElMessage.warning('至少保留一个目的输入框')
      return
    }
    ElMessageBox.confirm('确认删除该审查目的？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => { state.customPurposes.value.splice(index, 1) })
      .catch(() => {})
  }

  // 搜索核心目的
  const querySearchCorePurposes = (queryString: string, cb: any) => {
    const results = queryString
      ? state.allSuggestedCorePurposes.value.filter(p =>
          p.toLowerCase().includes(queryString.toLowerCase())
        )
      : state.allSuggestedCorePurposes.value
    cb(results.map(p => ({ value: p })))
  }

  return {
    submitting,
    submitTask,
    addPurpose,
    removePurpose,
    querySearchCorePurposes,
  }
}
