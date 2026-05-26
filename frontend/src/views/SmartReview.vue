<template>
  <div class="smart-review">
    <div v-if="currentStep === 0" class="review-flow">
      <!-- 顶部：任务标题 -->
      <div class="flow-section flow-section--title">
        <label class="title-label">任务标题 <span class="required-mark">*</span></label>
        <el-input v-model="form.title" placeholder="请输入任务标题" size="large" clearable maxlength="100" show-word-limit />
      </div>

      <!-- 中部：上传文件 -->
      <div class="flow-section flow-section--upload">
        <SmartReviewUploadStep
          v-model:file-list="fileList"
          v-model:ref-file-list="refFileList"
          :entry-module="entryModule"
          :dwg-parsed-data-map="dwgParsedDataMap"
          hide-actions
        />
      </div>

      <!-- 底部：配置区 + 提交 -->
      <div class="flow-section flow-section--config">
        <div class="review-items-section">
          <div class="review-item-config">
            <!-- 目标选择 -->
            <div v-if="showObjectiveSelector" class="config-section">
              <div class="config-section-label">审查目标</div>
              <div class="objective-cards">
                <div v-for="option in objectiveOptions" :key="option.value" class="selectable-card" :class="{ 'selectable-card--active': (reviewPlanDraft?.objective ?? '') === option.value }" @click="reviewPlanDraft.objective = option.value as any" tabindex="0">
                  <div class="selectable-card__icon"><el-icon :size="16"><component :is="objectiveIconComponentMap[option.value]" /></el-icon></div>
                  <div class="selectable-card__content">
                    <div class="selectable-card__label">{{ option.label }}</div>
                    <div class="selectable-card__desc">{{ option.desc }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 规则库模式：检查项目 -->
            <template v-if="entryModule === 'RULE_ONLY'">
              <div class="config-section">
                <div class="config-section-label">检查项目 <el-tag v-if="enabledRulePrefixes.length > 0" size="small" type="info" style="margin-left: auto">{{ enabledRulePrefixes.length }}项</el-tag></div>
                <div v-if="!ruleRegistryLoaded" style="padding:20px;text-align:center;color:#94a3b8"><el-icon class="is-loading" :size="24"><Loading /></el-icon><span style="margin-left:8px">加载检查项目...</span></div>
                <div v-else class="rule-prefix-panel">
                  <div v-for="group in rulePrefixGroups" :key="group.title" class="rule-prefix-group">
                    <div class="rule-prefix-group__header" @click="toggleGroup(group.items.map((i:any)=>i.prefix),!group.items.every((item:any)=>enabledRulePrefixes.includes(item.prefix)))">
                      <el-icon :size="14"><component :is="group.icon" /></el-icon>
                      <span class="rule-prefix-group__title">{{ group.title }}</span>
                      <span class="rule-prefix-group__count">{{ group.items.filter((i:any)=>enabledRulePrefixes.includes(i.prefix)).length }}/{{ group.items.length }}</span>
                      <el-checkbox :model-value="group.items.every((item:any)=>enabledRulePrefixes.includes(item.prefix))" :indeterminate="group.items.some((item:any)=>enabledRulePrefixes.includes(item.prefix))&&!group.items.every((item:any)=>enabledRulePrefixes.includes(item.prefix))" size="small" @click.stop @change="(val:any)=>toggleGroup(group.items.map((i:any)=>i.prefix),!!val)" />
                    </div>
                    <div class="rule-prefix-group__items">
                      <div v-for="item in group.items" :key="item.prefix" class="rule-prefix-item" :class="{'rule-prefix-item--active':enabledRulePrefixes.includes(item.prefix)}" @click="togglePrefix(item.prefix)">
                        <div class="rule-prefix-item__info"><span class="rule-prefix-item__label">{{ item.label }}</span><span class="rule-prefix-item__desc">{{ item.description }}</span></div>
                        <el-checkbox :model-value="enabledRulePrefixes.includes(item.prefix)" size="small" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 其他模式：证据源 -->
            <template v-else-if="showEvidenceSection && entryModule !== 'DOC_REVIEW'">
              <div class="config-section">
                <div class="config-section-label">审查依据</div>
                <div class="evidence-cards">
                  <div v-for="option in availableEvidenceSources" :key="option.value" class="selectable-card selectable-card--compact" :class="{'selectable-card--active':(reviewPlanDraft?.evidence?.sources??[]).includes(option.value),'selectable-card--disabled':isEvidenceLocked(option.value)}" @click="handleEvidenceCardClick(option.value)" tabindex="0">
                    <div class="selectable-card__icon"><el-icon :size="14"><component :is="evidenceIconComponentMap[option.value]" /></el-icon></div>
                    <span class="selectable-card__label">{{ option.label }}</span>
                    <div class="selectable-card__check" v-if="(reviewPlanDraft?.evidence?.sources??[]).includes(option.value)"><el-icon><Check /></el-icon></div>
                  </div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources??[]).includes('STANDARD')" class="selected-items-display">
                  <div class="selected-items-header"><span>已选 {{ (reviewPlanDraft?.evidence?.knowledgeCategoryIds??[]).length }} 个知识库</span><el-button size="small" @click="openKnowledgeDialog"><el-icon><Plus /></el-icon>添加</el-button></div>
                  <div v-if="(reviewPlanDraft?.evidence?.knowledgeCategoryIds??[]).length>0" class="selected-items-tags"><el-tag v-for="id in (reviewPlanDraft?.evidence?.knowledgeCategoryIds??[])" :key="id" closable type="info" size="small" @close="removeKnowledgeCategory(id)">{{ getKnowledgeCategoryName(id) }}</el-tag></div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources??[]).includes('REVIEW_SPECIFICATION')" class="selected-items-display">
                  <div class="selected-items-header"><span>{{ reviewPlanDraft?.evidence?.reviewSpecificationId?'已选择':'未选择' }}语义规范库</span><el-button size="small" @click="openReviewSpecificationDialog"><el-icon><Plus /></el-icon>添加</el-button></div>
                  <div v-if="reviewPlanDraft?.evidence?.reviewSpecificationId" class="selected-item-single"><el-tag closable type="info" size="small" @close="reviewPlanDraft.evidence.reviewSpecificationId=null">{{ getReviewSpecificationName(reviewPlanDraft?.evidence?.reviewSpecificationId??'') }}</el-tag></div>
                </div>
              </div>
            </template>

            <div v-if="entryModule==='DOC_REVIEW'&&reviewPlanDraft?.objective==='COMPARE'" class="config-reason config-reason--warning">
              <el-icon><WarningFilled /></el-icon> 参照比对目标强制使用参考文件，未上传参考文件将无法提交。
            </div>

          </div>
        </div>

        <!-- 提交按钮 -->
        <div class="submit-bar">
          <el-button type="primary" size="large" :disabled="!canSubmit" @click="startAnalysis" class="submit-btn">
            <el-icon><MagicStick /></el-icon>
            {{ fileList.length > 0 ? '开始分析' : '请先上传文件' }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="loading && currentStep === 0" class="loading-overlay">
      <div class="loading-content">
        <p class="loading-title">{{ loadingMessage }}</p>
        <div v-if="analysisProgress.length" class="analysis-progress-steps">
          <div v-for="(item, index) in visibleAnalysisProgress" :key="index" class="progress-step" :class="`progress-step--${progressStatusClass(item.status)}`">
            <div class="progress-marker"><span v-if="item.status==='completed'">✓</span><span v-else-if="item.status==='failed'">!</span></div>
            <div class="progress-info"><div class="progress-title"><span>{{ progressStepLabel(item.step) }}</span><span class="progress-status">{{ progressStatusLabel(item.status) }}</span></div><p v-if="item.message" class="progress-message">{{ item.message }}</p></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 知识库选择对话框 -->
  <SmartReviewKnowledgeDialog v-model:visible="knowledgeDialogVisible" :knowledge-tree-data="knowledgeTreeData" :current-checked-knowledge-ids="reviewPlanDraft?.evidence?.knowledgeCategoryIds??[]" @confirm="handleKnowledgeConfirm" />
  <!-- 语义规范库选择对话框 -->
  <SmartReviewReviewSpecificationDialog v-model:visible="reviewSpecificationDialogVisible" :specifications="reviewSpecifications" @confirm="handleReviewSpecificationConfirm" />
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, MagicStick, WarningFilled, Loading, FolderOpened, Files, Link, Document, EditPen, DataAnalysis, Plus } from '@element-plus/icons-vue'
import { getAllKnowledgeCategoriesApi, getKnowledgeTreeApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { getRuleRegistryApi, type RuleGroupMeta } from '@/api/system'
import SmartReviewUploadStep from './components/SmartReviewUploadStep.vue'
import SmartReviewKnowledgeDialog from './components/SmartReviewKnowledgeDialog.vue'
import SmartReviewReviewSpecificationDialog from './components/SmartReviewReviewSpecificationDialog.vue'
import { useSmartReviewState } from './SmartReview/composables/useSmartReviewState'
import { useReviewPlan } from './SmartReview/composables/useReviewPlan'
import { useTaskSubmission } from './SmartReview/composables/useTaskSubmission'
import { PROGRESS_STEP_LABELS, PROGRESS_STATUS_LABELS } from './SmartReview/constants/review-config'
import type { EntryModule } from './SmartReview/types/smart-review'

const state = useSmartReviewState()
const { currentStep, isFromHistory, fileList, refFileList, dwgParsedDataMap, form, entryModule, reviewPlanDraft, enabledRulePrefixes, rulePrefixGroups, ruleRegistryLoaded, loading, loadingMessage, analysisProgress, backgroundStatus, submitting, visibleAnalysisProgress, showEvidenceSection, showObjectiveSelector, showExecutionProfileSection } = state
const plan = useReviewPlan(state)
const submission = useTaskSubmission(state, plan)
const { availableEvidenceSources, isEvidenceLocked, handleEvidenceCardClick, togglePrefix, toggleGroup, canSubmit } = plan
const objectiveIconComponentMap: Record<string, any> = {
  COMPLIANCE: MagicStick,
  COMPARE: Document,
  PROOFREAD: EditPen,
  STRUCTURED: DataAnalysis,
}
const evidenceIconComponentMap: Record<string, any> = {
  STANDARD: FolderOpened,
  REVIEW_SPECIFICATION: Files,
  REFERENCE: Link,
}

const knowledgeDialogVisible = ref(false)
const reviewSpecificationDialogVisible = ref(false)
const knowledgeCategories = ref<Array<{ id: string; name: string }>>([])
const knowledgeTreeData = ref<any[]>([])
const reviewSpecifications = ref<Array<{ id: string; name: string; status: string; itemCount: number; executableCount: number }>>([])

const progressStepLabel = (step: string) => PROGRESS_STEP_LABELS[step] || step || '处理中'
const progressStatusLabel = (status: string) => PROGRESS_STATUS_LABELS[status] || status || '处理中'
const progressStatusClass = (status: string) => { if (status==='completed') return 'completed'; if (status==='failed') return 'failed'; return 'running' }

const startAnalysis = async () => {
  if (!state.form.title.trim()) { ElMessage.warning('请输入任务标题'); return }
  if (!plan.canSubmit.value) {
    const reasons: string[] = []
    if (!state.form.title.trim()) reasons.push('请输入任务标题')
    if ((state.reviewPlanDraft?.objective??'')==='COMPARE'&&state.refFileList.value.length===0) reasons.push('以文审文/参照比对模式需要上传参照文件')
    if ((state.reviewPlanDraft?.evidence?.sources??[]).includes('REVIEW_SPECIFICATION')&&!state.reviewPlanDraft?.evidence?.reviewSpecificationId) reasons.push('语义规范库模式需要选择具体的语义规范库')
    ElMessage.warning(reasons.length>0?reasons[0]:'请完善审查配置后再开始分析')
    return
  }
  await submission.submitTask()
}

const openKnowledgeDialog = () => { knowledgeDialogVisible.value = true }
const openReviewSpecificationDialog = async () => {
  reviewSpecificationDialogVisible.value = true
  try { const specRes = await getRuleLibrariesApi(); reviewSpecifications.value = (specRes.data||[]).map((l:any)=>({ id:l.id, name:l.name, status:l.status||'DRAFT', description:l.description||'', itemCount:l._count?.items||l.items?.length||0, executableCount:l.enabledExecutableItemCount||l.executableItemCount||0 })) } catch(e) { console.warn('[SmartReview] 刷新语义规范库列表失败:',e) }
}
const handleKnowledgeConfirm = (selectedIds: string[]) => { if (state.reviewPlanDraft?.evidence) state.reviewPlanDraft.evidence.knowledgeCategoryIds = selectedIds }
const handleReviewSpecificationConfirm = (specificationId: string|null) => { if (state.reviewPlanDraft?.evidence) state.reviewPlanDraft.evidence.reviewSpecificationId = specificationId }
const removeKnowledgeCategory = (id: string) => { if (state.reviewPlanDraft?.evidence?.knowledgeCategoryIds) { const i=state.reviewPlanDraft.evidence.knowledgeCategoryIds.indexOf(id); if(i>-1) state.reviewPlanDraft.evidence.knowledgeCategoryIds.splice(i,1) } }
const getKnowledgeCategoryName = (id: string) => { const c=knowledgeCategories.value.find(x=>x.id===id); return c?.name||id }
const getReviewSpecificationName = (id: string) => { const s=reviewSpecifications.value.find(x=>x.id===id); return s?.name||id }

onMounted(async () => {
  const restored = state.restoreState()
  if (restored && state.currentStep.value>0) { nextTick(()=>{ if(state.currentStep.value>=1&&state.fileList.value.length===0){ ElMessage.warning('已恢复之前的配置草稿，但文件需要重新上传'); state.currentStep.value=0; state.clearSavedState() } }) }
  const entry = sessionStorage.getItem('smartReview.entryModule') as EntryModule|null
  if (entry && ['LIBRARY','CONSISTENCY','PROOFREAD','RULE_ONLY','MULTIMODAL','DOC_REVIEW'].includes(entry)) { state.entryModule.value=entry; plan.applyEntryModulePreset(entry) }
  try {
    const [catRes, treeRes, specRes, ruleRegRes] = await Promise.all([getAllKnowledgeCategoriesApi(), getKnowledgeTreeApi(), getRuleLibrariesApi(), getRuleRegistryApi()])
    knowledgeCategories.value = (catRes.data||[]).map((c:any)=>({ id:c.id, name:c.name }))
    knowledgeTreeData.value = treeRes.data||[]
    reviewSpecifications.value = (specRes.data||[]).map((l:any)=>({ id:l.id, name:l.name, status:l.status||'DRAFT', description:l.description||'', itemCount:l._count?.items||l.items?.length||0, executableCount:l.enabledExecutableItemCount||l.executableItemCount||0 }))
    if (ruleRegRes.data) { state.rulePrefixGroups.value=ruleRegRes.data.groups||[]; if(!state.enabledRulePrefixes.value.length&&ruleRegRes.data.allPrefixes?.length) state.enabledRulePrefixes.value=[...ruleRegRes.data.allPrefixes]; state.ruleRegistryLoaded.value=true }
  } catch(e) { console.warn('[SmartReview] 加载数据失败:',e) }
})
</script>

<style scoped>
/* ---- 两栏布局 ---- */
.review-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px 24px 40px;
}
.layout-left {
  flex: 0 0 420px;
  min-width: 360px;
  position: sticky;
  top: 16px;
}
.layout-right {
  flex: 1;
  min-width: 0;
}
.layout-right__inner {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
  border: 1px solid #E5E7EB;
}
@media (max-width: 900px) {
  .review-layout { flex-direction: column; padding: 16px 12px 40px; }
  .layout-left { flex: none; width: 100%; min-width: 0; position: static; }
  .layout-right { width: 100%; }
}

/* ---- 标题 ---- */
.title-input-section { margin-bottom: 18px; }
.title-label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
.required-mark { color: #EF4444; margin-left: 2px; font-weight: 700; }

/* ---- 提交按钮 ---- */
.submit-bar { margin-top: 24px; display: flex; justify-content: flex-end; padding-top: 16px; border-top: 1px solid #F1F5F9; }
.submit-btn { padding: 12px 36px; font-size: 15px; font-weight: 600; border-radius: 10px; min-width: 160px; }

/* ---- 配置区 ---- */
.review-items-section { margin-top: 4px; }
.config-section { padding: 14px 0; border-bottom: 1px solid #F1F5F9; }
.config-section:last-child { border-bottom: none; padding-bottom: 0; }
.config-section-label { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 10px; }

/* ---- 可选中卡片 ---- */
.selectable-card { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 2px solid #E2E8F0; border-radius: 10px; background: #FAFBFC; cursor: pointer; transition: all 0.2s; user-select: none; }
.selectable-card:hover:not(.selectable-card--disabled) { border-color: #93C5FD; background: white; box-shadow: 0 2px 8px rgba(59,130,246,0.08); }
.selectable-card--active { border-color: #3B82F6; background: linear-gradient(135deg,#EFF6FF,#F0F4FF); box-shadow: 0 2px 12px rgba(59,130,246,0.12); }
.selectable-card--disabled { opacity: 0.45; cursor: not-allowed; }
.selectable-card--compact { padding: 11px 14px; }
.selectable-card--compact .selectable-card__icon { width: 28px; height: 28px; border-radius: 7px; }
.selectable-card--inline { flex: 1; justify-content: center; }
.selectable-card__icon { width: 30px; height: 30px; border-radius: 8px; background: #E0E7FF; color: #4F46E5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.selectable-card--active .selectable-card__icon { background: linear-gradient(135deg,#3B82F6,#2563EB); color: white; }
.selectable-card__content { flex: 1; min-width: 0; }
.selectable-card__label { font-size: 13px; font-weight: 600; color: #1E293B; }
.selectable-card__desc { font-size: 12px; color: #94A3B8; margin-top: 1px; }
.selectable-card__check { margin-left: auto; width: 20px; height: 20px; border-radius: 50%; background: #3B82F6; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }

/* ---- 目标选择 ---- */
.objective-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* ---- 证据源 ---- */
.evidence-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.execution-options { display: flex; gap: 8px; }

/* ---- 已选项目 ---- */
.selected-items-display { margin-top: 10px; padding: 12px 14px; background: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; }
.selected-items-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 500; color: #64748B; }
.selected-items-header span { color: #475569; font-weight: 600; }
.selected-items-header :deep(.el-button) { padding: 5px 12px; font-size: 12px; border-radius: 6px; }
.selected-items-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* ---- 提示条 ---- */
.config-reason { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 10px 14px; font-size: 13px; border-radius: 8px; }
.config-reason--warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }

/* ---- 规则前缀面板 ---- */
.rule-prefix-panel { display: flex; flex-direction: column; gap: 10px; }
.rule-prefix-group { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; }
.rule-prefix-group__header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #F1F5F9; border-bottom:1px solid #E2E8F0; color:#475569; font-size:13px; font-weight:600; cursor:pointer; user-select:none; }
.rule-prefix-group__header:hover { background: #E8EDF5; }
.rule-prefix-group__title { flex: 1; }
.rule-prefix-group__count { font-size: 11px; color: #94A3B8; }
.rule-prefix-group__items { display: grid; grid-template-columns: 1fr; gap: 1px; background: #E2E8F0; }
.rule-prefix-item { display: flex; align-items: center; gap: 8px; padding: 9px 14px; background: white; cursor: pointer; transition: all 0.15s; user-select: none; }
.rule-prefix-item:hover { background: #FAFBFC; }
.rule-prefix-item--active { background: #F0F9FF; }
.rule-prefix-item__info { flex: 1; min-width: 0; }
.rule-prefix-item__label { font-size: 13px; font-weight: 500; color: #1E293B; }
.rule-prefix-item--active .rule-prefix-item__label { color: #0369A1; font-weight: 600; }
.rule-prefix-item__desc { font-size: 11px; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- 加载遮罩 ---- */
.loading-overlay { position: fixed; inset: 0; background: rgba(255,255,255,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.loading-content { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); border: 1px solid #E5E7EB; max-width: 480px; width: 100%; }
.loading-title { font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 16px; text-align: center; }
.analysis-progress-steps { display: flex; flex-direction: column; gap: 12px; }
.progress-step { display: flex; align-items: flex-start; gap: 12px; padding: 8px; border-radius: 6px; }
.progress-step--running { background: #EFF6FF; }
.progress-step--completed { background: #F0FDF4; }
.progress-step--failed { background: #FEF2F2; }
.progress-marker { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.progress-step--running .progress-marker { background: #3B82F6; color: white; }
.progress-step--completed .progress-marker { background: #10B981; color: white; }
.progress-step--failed .progress-marker { background: #EF4444; color: white; }
.progress-info { flex: 1; }
.progress-title { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 600; color: #111827; }
.progress-status { font-size: 12px; font-weight: 500; color: #6B7280; }
.progress-message { font-size: 12px; color: #6B7280; margin: 4px 0 0; }
</style>
