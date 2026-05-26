<template>
  <div class="smart-review">
    <!-- 步骤条 - 参考项目风格（仅在新任务流程中显示，历史记录入口自动隐藏以释放空间） -->
    <div v-if="!isFromHistory" class="step-header">
      <div class="step-item" :class="{ active: currentStep >= 0, completed: currentStep > 0 }">
        <div class="step-circle">
          <span v-if="currentStep > 0">✓</span>
          <span v-else>1</span>
        </div>
        <span class="step-label">上传文件</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 1 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 1, completed: currentStep > 1 }">
        <div class="step-circle">
          <span v-if="currentStep > 1">✓</span>
          <span v-else>2</span>
        </div>
        <span class="step-label">确认信息并分析</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 2 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 2 }">
        <div class="step-circle">3</div>
        <span class="step-label">查看并编辑结果</span>
      </div>
    </div>

    <!-- Step 0: 上传区域 -->
    <SmartReviewUploadStep
      v-if="currentStep === 0"
      v-model:file-list="fileList"
      v-model:ref-file-list="refFileList"
      :entry-module="entryModule"
      :dwg-parsed-data-map="dwgParsedDataMap"
      @next="goToStep1"
    />

    <!-- Step 1: 预审配置 - 参考项目左右分栏布局 -->
    <div v-if="currentStep === 1" class="confirm-step">
      <!-- 后台预分析状态横幅（仅非 RULE_ONLY 模式显示） -->
      <template v-if="entryModule !== 'RULE_ONLY'">
        <el-alert
          v-if="backgroundStatus === 'pre-analyzing'"
          title="正在AI预分析..."
          type="warning"
          :closable="false"
          show-icon
          class="background-status-alert"
        >
          <template #default>
            <span>AI 正在分析您的文件内容并生成推荐配置，您可以先手动选择审查参数。</span>
          </template>
        </el-alert>
        <el-alert
          v-else-if="backgroundStatus === 'done'"
          title="预分析完成"
          type="success"
          :closable="true"
          show-icon
          @close="backgroundStatus = 'idle'"
          class="background-status-alert"
        >
          <template #default>
            <span>AI 预分析已完成，推荐配置已自动填入下方表单。</span>
          </template>
        </el-alert>
        <el-alert
          v-else-if="backgroundStatus === 'failed'"
          title="预分析失败"
          type="error"
          :closable="true"
          show-icon
          @close="backgroundStatus = 'idle'"
          class="background-status-alert"
        >
          <template #default>
            <span>AI 预分析失败，不影响正常使用。请手动配置后点击"开始分析"。</span>
          </template>
        </el-alert>
      </template>

      <div class="confirm-content">
        <!-- 任务标题 -->
        <div class="title-input-section">
          <label class="title-label">
            任务标题
            <span class="required-mark">*</span>
          </label>
          <el-input
            v-model="form.title"
            :placeholder="aiSuggestedTitle ? '点击右侧按钮使用AI建议，或手动输入' : '请输入任务标题，例如：XX项目施工图审查'"
            size="large"
            clearable
            maxlength="100"
            show-word-limit
          >
            <template #suffix v-if="aiSuggestedTitle && !form.title">
              <button class="ai-fill-btn" @click="form.title = aiSuggestedTitle" type="button">
                <el-icon><MagicStick /></el-icon>
                使用AI建议
              </button>
            </template>
          </el-input>
          <div v-if="aiSuggestedTitle && !form.title" class="ai-suggestion-preview" @click="form.title = aiSuggestedTitle">
            <el-icon><MagicStick /></el-icon>
            <span>建议：<span class="suggestion-text">{{ aiSuggestedTitle }}</span></span>
            <span class="suggestion-action">点击采用</span>
          </div>
        </div>

        <!-- 文件上传状态（精简单行） -->
        <div class="upload-status-bar">
          <span class="status-file-count">
            <el-icon><Document /></el-icon>
            {{ fileList.length }} 个文件已就绪
          </span>
        </div>

        <!-- 核心配置区：始终展开 -->
        <div class="review-items-section">
          <div class="review-item-config">
            <!-- 目标选择（核心决策，始终可见） -->
            <div v-if="showObjectiveSelector" class="config-section">
              <div class="config-section-label">
                <span class="section-label-num">1</span>
                审查目标
              </div>
              <div class="objective-cards">
                <div
                  v-for="option in objectiveOptions"
                  :key="option.value"
                  class="selectable-card"
                  :class="{ 'selectable-card--active': (reviewPlanDraft?.objective ?? '') === option.value }"
                  @click="reviewPlanDraft.objective = option.value as any"
                  tabindex="0"
                  role="button"
                  @keydown.enter="reviewPlanDraft.objective = option.value as any"
                >
                  <div class="selectable-card__icon">
                    <el-icon :size="16"><component :is="objectiveIconMap[option.value]" /></el-icon>
                  </div>
                  <div class="selectable-card__content">
                    <div class="selectable-card__label">{{ option.label }}</div>
                    <div class="selectable-card__desc">{{ option.desc }}</div>
                  </div>
                  <div class="selectable-card__check" v-if="(reviewPlanDraft?.objective ?? '') === option.value">
                    <el-icon><Check /></el-icon>
                  </div>
                </div>
              </div>
            </div>

            <!-- 证据源 / 检查项目 -->
            <div v-if="showEvidenceSection" class="config-section">
              <div class="config-section-label">
                <span class="section-label-num">3</span>
                {{ entryModule === 'RULE_ONLY' ? '检查项目' : '审查依据' }}
                <el-tag v-if="(reviewPlanDraft?.evidence?.sources?.length ?? 0) > 0 || enabledRulePrefixes.length > 0" size="small" type="info" style="margin-left: auto">
                  {{ entryModule === 'RULE_ONLY' ? enabledRulePrefixes.length + '项' : (reviewPlanDraft?.evidence?.sources?.length ?? 0) + '个来源' }}
                </el-tag>
              </div>
              <!-- RULE_ONLY: 规则前缀开关面板 -->
              <template v-if="entryModule === 'RULE_ONLY'">
                <div v-if="!ruleRegistryLoaded" class="rule-prefix-panel" style="padding: 20px; text-align: center; color: #94a3b8;">
                  <el-icon class="is-loading" :size="24"><Loading /></el-icon>
                  <span style="margin-left: 8px;">加载检查项目...</span>
                </div>
                <div v-else class="rule-prefix-panel">
                  <div v-for="group in rulePrefixGroups" :key="group.title" class="rule-prefix-group">
                    <div class="rule-prefix-group__header" @click="toggleGroup(group.items.map((i: any) => i.prefix), !group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix)))">
                      <el-icon :size="14"><component :is="group.icon" /></el-icon>
                      <span class="rule-prefix-group__title">{{ group.title }}</span>
                      <span class="rule-prefix-group__count">{{ group.items.filter((i: any) => enabledRulePrefixes.includes(i.prefix)).length }}/{{ group.items.length }}</span>
                      <el-checkbox :model-value="group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix))" :indeterminate="group.items.some((item: any) => enabledRulePrefixes.includes(item.prefix)) && !group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix))" size="small" @click.stop @change="(val: boolean | string | number) => toggleGroup(group.items.map((i: any) => i.prefix), !!val)" />
                    </div>
                    <div class="rule-prefix-group__items">
                      <div v-for="item in group.items" :key="item.prefix" class="rule-prefix-item" :class="{ 'rule-prefix-item--active': enabledRulePrefixes.includes(item.prefix) }" @click="togglePrefix(item.prefix)">
                        <div class="rule-prefix-item__info">
                          <span class="rule-prefix-item__label">{{ item.label }}</span>
                          <span class="rule-prefix-item__desc">{{ item.description }}</span>
                        </div>
                        <el-checkbox :model-value="enabledRulePrefixes.includes(item.prefix)" size="small" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <!-- 其他模式：证据源卡片 -->
              <template v-else-if="entryModule !== 'DOC_REVIEW'">
                <div class="evidence-cards">
                  <div v-for="option in availableEvidenceSources" :key="option.value" class="selectable-card selectable-card--compact" :class="{ 'selectable-card--active': (reviewPlanDraft?.evidence?.sources ?? []).includes(option.value), 'selectable-card--disabled': isEvidenceLocked(option.value) }" @click="handleEvidenceCardClick(option.value)" tabindex="0" role="button" @keydown.enter="handleEvidenceCardClick(option.value)">
                    <div class="selectable-card__icon">
                      <el-icon :size="14"><component :is="evidenceIconMap[option.value]" /></el-icon>
                    </div>
                    <span class="selectable-card__label">{{ option.label }}</span>
                    <div class="selectable-card__check" v-if="(reviewPlanDraft?.evidence?.sources ?? []).includes(option.value)">
                      <el-icon><Check /></el-icon>
                    </div>
                  </div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources ?? []).includes('STANDARD')" class="selected-items-display">
                  <div class="selected-items-header">
                    <span class="selected-items-count">已选 {{ (reviewPlanDraft?.evidence?.knowledgeCategoryIds ?? []).length }} 个知识库</span>
                    <el-button type="primary" link size="small" @click="openKnowledgeDialog">管理</el-button>
                  </div>
                  <div v-if="(reviewPlanDraft?.evidence?.knowledgeCategoryIds ?? []).length > 0" class="selected-items-tags">
                    <el-tag v-for="id in (reviewPlanDraft?.evidence?.knowledgeCategoryIds ?? [])" :key="id" closable type="info" size="small" @close="removeKnowledgeCategory(id)">{{ getKnowledgeCategoryName(id) }}</el-tag>
                  </div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources ?? []).includes('REVIEW_SPECIFICATION')" class="selected-items-display">
                  <div class="selected-items-header">
                    <span class="selected-items-count">{{ reviewPlanDraft?.evidence?.reviewSpecificationId ? '已选择' : '未选择' }}语义规范库</span>
                    <el-button type="primary" link size="small" @click="openReviewSpecificationDialog">选择</el-button>
                  </div>
                  <div v-if="reviewPlanDraft?.evidence?.reviewSpecificationId" class="selected-item-single">
                    <el-tag closable type="info" size="small" @close="reviewPlanDraft.evidence.reviewSpecificationId = null">{{ getReviewSpecificationName(reviewPlanDraft?.evidence?.reviewSpecificationId ?? '') }}</el-tag>
                  </div>
                </div>
              </template>
              <div v-if="entryModule === 'DOC_REVIEW' && reviewPlanDraft?.objective === 'COMPARE'" class="config-reason config-reason--warning">
                <el-icon><WarningFilled /></el-icon>
                参照比对目标强制使用参考文件，未上传参考文件将无法提交。
              </div>
            </div>

            <!-- 执行方式 -->
            <div v-if="showExecutionProfileSection && entryModule !== 'RULE_ONLY'" class="config-section">
              <div class="config-section-label">
                <span class="section-label-num">4</span>
                执行方式
              </div>
              <div class="execution-options">
                <div class="selectable-card selectable-card--inline" :class="{ 'selectable-card--active': (reviewPlanDraft?.execution?.profile ?? '') === 'HYBRID' }" @click="reviewPlanDraft.execution.profile = 'HYBRID'" tabindex="0" role="button" @keydown.enter="reviewPlanDraft.execution.profile = 'HYBRID'">
                  <el-icon :size="14"><MagicStick /></el-icon>
                  <span>标准执行</span>
                  <span class="execution-option__badge">AI + 规则</span>
                </div>
                <div class="selectable-card selectable-card--inline" :class="{ 'selectable-card--active': (reviewPlanDraft?.execution?.profile ?? '') === 'RULE_ONLY' }" @click="reviewPlanDraft.execution.profile = 'RULE_ONLY'" tabindex="0" role="button" @keydown.enter="reviewPlanDraft.execution.profile = 'RULE_ONLY'">
                  <el-icon :size="14"><Check /></el-icon>
                  <span>仅规则执行</span>
                  <span class="execution-option__badge">快速</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="loading && currentStep < 2" class="loading-overlay">
      <div class="loading-content">
        <p class="loading-title">{{ loadingMessage }}</p>
        <div v-if="analysisProgress.length" class="analysis-progress-steps">
          <div
            v-for="(item, index) in visibleAnalysisProgress"
            :key="index"
            class="progress-step"
            :class="`progress-step--${progressStatusClass(item.status)}`"
          >
            <div class="progress-marker">
              <span v-if="item.status === 'completed'">✓</span>
              <span v-else-if="item.status === 'failed'">!</span>
            </div>
            <div class="progress-info">
              <div class="progress-title">
                <span>{{ progressStepLabel(item.step) }}</span>
                <span class="progress-status">{{ progressStatusLabel(item.status) }}</span>
              </div>
              <p v-if="item.message" class="progress-message">{{ item.message }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 知识库选择对话框 -->
  <SmartReviewKnowledgeDialog
    v-model:visible="knowledgeDialogVisible"
    :knowledge-tree-data="knowledgeTreeData"
    :current-checked-knowledge-ids="reviewPlanDraft?.evidence?.knowledgeCategoryIds ?? []"
    @confirm="handleKnowledgeConfirm"
  />

  <!-- 语义规范库选择对话框 -->
  <SmartReviewReviewSpecificationDialog
    v-model:visible="reviewSpecificationDialogVisible"
    :specifications="reviewSpecifications"
    @confirm="handleReviewSpecificationConfirm"
  />

  <!-- 浮动操作按钮 - 固定在右下角 -->
  <div v-if="currentStep === 1" class="floating-actions">
    <el-button @click="goBackToUpload" class="action-btn action-btn--secondary">
      <el-icon><ArrowUp /></el-icon>
      重新上传
    </el-button>
    <el-button
      type="primary"
      :disabled="!canSubmit"
      @click="startAnalysis"
      class="action-btn action-btn--primary"
      :class="{ 'action-btn--disabled': !canSubmit }"
    >
      <el-icon><MagicStick /></el-icon>
      {{ canSubmit ? '开始分析' : '请完善配置' }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Check, MagicStick, WarningFilled,
  RemoveFilled, CirclePlusFilled, Document, Link,
  Loading, ArrowUp,
} from '@element-plus/icons-vue'
import { getAllKnowledgeCategoriesApi, getKnowledgeTreeApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { getRuleRegistryApi, type RuleGroupMeta } from '@/api/system'
import SmartReviewUploadStep from './components/SmartReviewUploadStep.vue'
import SmartReviewKnowledgeDialog from './components/SmartReviewKnowledgeDialog.vue'
import SmartReviewReviewSpecificationDialog from './components/SmartReviewReviewSpecificationDialog.vue'
import { useSmartReviewState } from './SmartReview/composables/useSmartReviewState'
import { useReviewPlan } from './SmartReview/composables/useReviewPlan'
import { useTaskSubmission } from './SmartReview/composables/useTaskSubmission'
import {
  OBJECTIVE_ICON_MAP,
  EVIDENCE_ICON_MAP,
  PROGRESS_STEP_LABELS,
  PROGRESS_STATUS_LABELS,
} from './SmartReview/constants/review-config'
import type { EntryModule } from './SmartReview/types/smart-review'

const state = useSmartReviewState()
// 将 state 属性解构暴露到模板作用域（模板中直接使用 currentStep 等裸变量名）
const {
  currentStep, isFromHistory, fileList, refFileList, dwgParsedDataMap,
  form, entryModule, reviewPlanDraft, enabledRulePrefixes, rulePrefixGroups,
  ruleRegistryLoaded, loading, loadingMessage, analysisProgress, backgroundStatus,
  submitting, visibleAnalysisProgress, showEvidenceSection, showObjectiveSelector,
  showExecutionProfileSection,
} = state
const plan = useReviewPlan(state)
const submission = useTaskSubmission(state, plan)

const {
  availableEvidenceSources, isEvidenceLocked, handleEvidenceCardClick,
  togglePrefix, toggleGroup, canSubmit,
} = plan

const { objectiveIconMap } = { objectiveIconMap: OBJECTIVE_ICON_MAP }
const { evidenceIconMap } = { evidenceIconMap: EVIDENCE_ICON_MAP }

const knowledgeDialogVisible = ref(false)
const reviewSpecificationDialogVisible = ref(false)
const knowledgeCategories = ref<Array<{ id: string; name: string }>>([])
const knowledgeTreeData = ref<any[]>([])
const reviewSpecifications = ref<Array<{
  id: string
  name: string
  status: string
  itemCount: number
  executableCount: number
}>>([])

const progressStepLabel = (step: string) => PROGRESS_STEP_LABELS[step] || step || '处理中'
const progressStatusLabel = (status: string) => PROGRESS_STATUS_LABELS[status] || status || '处理中'
const progressStatusClass = (status: string) => {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
}

const goToStep1 = () => { state.currentStep.value = 1 }

const goBackToUpload = () => {
  state.currentStep.value = 0
  state.fileList.value = []
  state.refFileList.value = []
}

const startAnalysis = async () => {
  if (!state.form.title.trim()) {
    ElMessage.warning('请输入任务标题')
    return
  }
  if (!plan.canSubmit.value) {
    const reasons: string[] = []
    if (!state.form.title.trim()) reasons.push('请输入任务标题')
    if ((state.reviewPlanDraft?.objective ?? '') === 'COMPARE' && state.refFileList.value.length === 0)
      reasons.push('以文审文/参照比对模式需要上传参照文件（在参考文件区上传）')
    if ((state.reviewPlanDraft?.evidence?.sources ?? []).includes('REVIEW_SPECIFICATION') && !state.reviewPlanDraft?.evidence?.reviewSpecificationId)
      reasons.push('语义规范库模式需要选择具体的语义规范库')
    ElMessage.warning(reasons.length > 0 ? reasons[0] : '请完善审查配置后再开始分析')
    return
  }
  await submission.submitTask()
}

const openKnowledgeDialog = () => {
  knowledgeDialogVisible.value = true
}

const openReviewSpecificationDialog = async () => {
  reviewSpecificationDialogVisible.value = true
  try {
    const specRes = await getRuleLibrariesApi()
    reviewSpecifications.value = (specRes.data || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status || 'DRAFT',
      description: l.description || '',
      itemCount: l._count?.items || l.items?.length || 0,
      executableCount: l.enabledExecutableItemCount || l.executableItemCount || 0,
    }))
  } catch (e) {
    console.warn('[SmartReview] 刷新语义规范库列表失败:', e)
  }
}

const handleKnowledgeConfirm = (selectedIds: string[]) => {
  if (state.reviewPlanDraft?.evidence) {
    state.reviewPlanDraft.evidence.knowledgeCategoryIds = selectedIds
  }
}

const handleReviewSpecificationConfirm = (specificationId: string | null) => {
  if (state.reviewPlanDraft?.evidence) {
    state.reviewPlanDraft.evidence.reviewSpecificationId = specificationId
  }
}

const removeKnowledgeCategory = (id: string) => {
  if (state.reviewPlanDraft?.evidence?.knowledgeCategoryIds) {
    const index = state.reviewPlanDraft.evidence.knowledgeCategoryIds.indexOf(id)
    if (index > -1) {
      state.reviewPlanDraft.evidence.knowledgeCategoryIds.splice(index, 1)
    }
  }
}

const getKnowledgeCategoryName = (id: string) => {
  const category = knowledgeCategories.value.find(c => c.id === id)
  return category?.name || id
}

const getReviewSpecificationName = (id: string) => {
  const specification = reviewSpecifications.value.find(l => l.id === id)
  return specification?.name || id
}

onMounted(async () => {
  const restored = state.restoreState()
  if (restored && state.currentStep.value > 0) {
    nextTick(() => {
      if (state.currentStep.value >= 1 && state.fileList.value.length === 0) {
        ElMessage.warning('已恢复之前的配置草稿，但文件需要重新上传')
        state.currentStep.value = 0
        state.clearSavedState()
      }
    })
  }

  const entry = sessionStorage.getItem('smartReview.entryModule') as EntryModule | null
  if (entry && ['LIBRARY', 'CONSISTENCY', 'PROOFREAD', 'RULE_ONLY', 'MULTIMODAL', 'DOC_REVIEW'].includes(entry)) {
    state.entryModule.value = entry
    plan.applyEntryModulePreset(entry)
  }

  try {
    const [catRes, treeRes, specRes, ruleRegRes] = await Promise.all([
      getAllKnowledgeCategoriesApi(),
      getKnowledgeTreeApi(),
      getRuleLibrariesApi(),
      getRuleRegistryApi(),
    ])
    knowledgeCategories.value = (catRes.data || []).map((c: any) => ({ id: c.id, name: c.name }))
    knowledgeTreeData.value = treeRes.data || []
    reviewSpecifications.value = (specRes.data || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status || 'DRAFT',
      description: l.description || '',
      itemCount: l._count?.items || l.items?.length || 0,
      executableCount: l.enabledExecutableItemCount || l.executableItemCount || 0,
    }))

    if (ruleRegRes.data) {
      state.rulePrefixGroups.value = ruleRegRes.data.groups || []
      if (!state.enabledRulePrefixes.value.length && ruleRegRes.data.allPrefixes?.length) {
        state.enabledRulePrefixes.value = [...ruleRegRes.data.allPrefixes]
      }
      state.ruleRegistryLoaded.value = true
    }
  } catch (e) {
    console.warn('[SmartReview] 加载知识库/语义规范库列表失败:', e)
  }
})
</script>

<style scoped>
/* 步骤条 - 参考项目风格 */
.step-header {
  background: white;
  border-radius: 8px;
  padding: 12px 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9CA3AF;
  transition: all 0.3s;
}

.step-item.active {
  color: #3B82F6;
}

.step-item.completed {
  color: #10B981;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  transition: all 0.3s;
}

.step-item.active .step-circle {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

.step-item.completed .step-circle {
  background: #10B981;
  border-color: #10B981;
  color: white;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
}

.step-line {
  flex: 1;
  max-width: 60px;
  height: 2px;
  background: #E5E7EB;
  transition: all 0.3s;
}

.step-line.active {
  background: #3B82F6;
}

/* 主容器 */
.smart-review {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 32px 80px;
  position: relative;
}



/* 确认步骤 */
.confirm-step {
  margin: 0 auto;
  padding-bottom: 80px;
}

/* 后台上传/预分析状态横幅 */
.background-status-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.background-status-alert :deep(.el-alert__title) {
  font-weight: 600;
}

.background-status-alert :deep(.el-alert__content) {
  font-size: 13px;
  line-height: 1.5;
}

.title-input-section {
  margin-bottom: 16px;
}

.title-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.required-mark {
  color: #EF4444;
  margin-left: 2px;
  font-weight: 700;
}

.ai-fill-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #2563EB;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ai-fill-btn:hover {
  background: #DBEAFE;
  border-color: #93C5FD;
  color: #1D4ED8;
}

.ai-suggestion-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  background: linear-gradient(135deg, #F0FDF4, #ECFDF5);
  border: 1px solid #BBF7D0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
  font-size: 13px;
  color: #374151;
}

.ai-suggestion-preview:hover {
  background: linear-gradient(135deg, #DCFCE7, #D1FAE5);
  border-color: #86EFAC;
}

.ai-suggestion-preview .el-icon {
  color: #10B981;
  font-size: 14px;
}

.suggestion-text {
  font-weight: 600;
  color: #059669;
}

.suggestion-action {
  margin-left: auto;
  font-size: 11px;
  color: #3B82F6;
  font-weight: 600;
  white-space: nowrap;
}

.upload-status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  margin-bottom: 18px;
  background: #F8FAFC;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
  font-size: 13px;
}

.status-file-count {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #374151;
  font-weight: 600;
}

.status-loading {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #D97706;
  font-size: 12px;
}

.status-done {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #059669;
  font-weight: 600;
  font-size: 12px;
  padding: 1px 8px;
  background: #ECFDF5;
  border-radius: 4px;
}

/* ========== 统一可选中卡片组件（替代 objective-card / evidence-card / execution-option）========== */
.selectable-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.selectable-card:hover:not(.selectable-card--disabled) {
  border-color: #93C5FD;
  background: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.selectable-card--active {
  border-color: #3B82F6;
  background: linear-gradient(135deg, #EFF6FF 0%, #F0F4FF 100%);
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.12);
}

.selectable-card--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.selectable-card:focus-visible {
  outline: 2px solid #3B82F6;
  outline-offset: 2px;
}

/* 紧凑变体：用于证据源等小卡片 */
.selectable-card--compact {
  padding: 12px 16px;
  flex: 1;
  min-width: 0;
}

.selectable-card--compact .selectable-card__icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}

/* 内联变体：用于执行方式 */
.selectable-card--inline {
  flex: 1;
  justify-content: center;
}

.selectable-card__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #E0E7FF;
  color: #4F46E5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.selectable-card--active .selectable-card__icon {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25);
}

.selectable-card__content {
  flex: 1;
  min-width: 0;
}

.selectable-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
}

.selectable-card__desc {
  font-size: 12px;
  color: #94A3B8;
  line-height: 1.4;
  margin-top: 1px;
}

.selectable-card__check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #3B82F6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  animation: checkPop 0.25s ease;
}
/* ========== 折叠面板配置区 ========== */
.review-items-section {
  background: white;
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.config-section {
  padding: 18px 0;
  border-bottom: 1px solid #F1F5F9;
}

.config-section:last-child {
  border-bottom: none;
  padding-bottom: 4px;
}

.config-section-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 12px;
}

.section-label-num {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* 子区域背景区分 */
.sub-area {
  padding: 12px 14px;
  border-radius: 8px;
  background: #FAFBFC;
  margin-bottom: 10px;
}

.sub-area--alt {
  background: #F8FAFC;
  margin-bottom: 0;
}

.review-points-section {
  margin-bottom: 0;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 10px;
}

.review-points-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.review-points-group :deep(.el-checkbox) {
  margin-right: 0;
  max-width: 100%;
}

.review-point-checkbox :deep(.el-checkbox__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.review-purposes-section .purpose-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.remove-btn {
  color: #94A3B8;
  padding: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.purpose-row:hover .remove-btn {
  opacity: 1;
  color: #EF4444;
}

.add-purpose-btn {
  margin-top: 6px;
  color: #3B82F6;
  font-size: 13px;
}

/* 目标选择网格 */
.objective-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

@keyframes checkPop {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

/* 证据源卡片容器 */
.evidence-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.execution-options {
  display: flex;
  gap: 8px;
}

.execution-option__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: #E0E7FF;
  color: #4338CA;
}

.selectable-card--active .execution-option__badge {
  background: #3B82F6;
  color: white;
}

.config-reason {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: #64748B;
  line-height: 1.55;
  border-radius: 8px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
}

.config-reason--highlight {
  background: linear-gradient(135deg, #EFF6FF, #F0FDF4);
  border-color: #BFDBFE;
  color: #1E40AF;
}

.config-reason--highlight strong {
  color: #1D4ED8;
}

.config-reason--info {
  background: #EFF6FF;
  border-color: #BFDBFE;
  color: #1E40AF;
}

.config-reason--warning {
  background: #FFFBEB;
  border-color: #FDE68A;
  color: #92400E;
}

.config-reason--muted {
  background: #F1F5F9;
  border-color: #E2E8F0;
  color: #94A3B8;
}

.config-reason .el-icon {
  color: #3B82F6;
  margin-top: 2px;
  flex-shrink: 0;
}

.config-reason--warning .el-icon {
  color: #F59E0B;
}

.config-reason--muted .el-icon {
  color: #94A3B8;
}

/* 已选择项显示区域 */
.selected-items-display {
  margin-top: 14px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #FAFBFC 0%, #F8FAFC 100%);
  border-radius: 10px;
  border: 1px solid #E2E8F0;
  position: relative;
  overflow: hidden;
}

.selected-items-display::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, #3B82F6, #60A5FA);
  border-radius: 1px 0 0 1px;
}

.selected-items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.selected-items-count {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.selected-items-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.selected-item-single {
  display: flex;
}

/* 选中项内的标签美化 */
.selected-items-display :deep(.el-tag) {
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.selected-items-display :deep(.el-tag:hover) {
  transform: translateY(-1px);
}

.selected-items-display :deep(.el-tag .el-tag__close) {
  margin-left: 4px;
}

/* 操作按钮样式 */
.selected-items-header :deep(.el-button--primary) {
  font-weight: 600;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
}







.empty-state {
  text-align: center;
  padding: 32px;
  color: #9CA3AF;
  font-size: 14px;
}

/* 加载遮罩 */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border: 1px solid #E5E7EB;
  max-width: 480px;
  width: 100%;
}

.loading-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
  text-align: center;
}

.analysis-progress-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
}

.progress-step--running {
  background: #EFF6FF;
}

.progress-step--completed {
  background: #F0FDF4;
}

.progress-step--failed {
  background: #FEF2F2;
}

.progress-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.progress-step--running .progress-marker {
  background: #3B82F6;
  color: white;
}

.progress-step--completed .progress-marker {
  background: #10B981;
  color: white;
}

.progress-step--failed .progress-marker {
  background: #EF4444;
  color: white;
}

.progress-info {
  flex: 1;
}

.progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.progress-status {
  font-size: 12px;
  font-weight: 500;
  color: #6B7280;
}

.progress-message {
  font-size: 12px;
  color: #6B7280;
  margin: 4px 0 0;
}

/* 浮动操作按钮 - 固定右下角 */
.floating-actions {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  gap: 10px;
  z-index: 100;
  padding: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 10px;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.action-btn:active {
  transform: translateY(0);
}

.action-btn--secondary {
  background: white;
  border-color: #E2E8F0;
  color: #475569;
}

.action-btn--secondary:hover {
  background: #F8FAFC;
  border-color: #CBD5E1;
  color: #1E293B;
}

.action-btn--primary {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.action-btn--primary:hover:not(:disabled) {
  background: #2563EB;
  border-color: #2563EB;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
}

.action-btn--disabled {
  opacity: 0.55;
  cursor: not-allowed;
  background: #9CA3AF;
  border-color: #9CA3AF;
  box-shadow: none;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .floating-actions {
    left: 12px;
    right: 12px;
    justify-content: center;
  }

  .action-btn {
    padding: 9px 16px;
    font-size: 13px;
  }

  .action-btn .el-icon {
    display: none;
  }

  .objective-cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .floating-actions {
    left: 8px;
    right: 8px;
    bottom: 16px;
  }

  .action-btn {
    padding: 8px 14px;
    font-size: 12px;
    flex: 1;
  }
}

/* 规则前缀开关面板 - RULE_ONLY 模式 */
.rule-prefix-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rule-prefix-group {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.rule-prefix-group:hover {
  border-color: #CBD5E1;
}

.rule-prefix-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #F1F5F9;
  border-bottom: 1px solid #E2E8F0;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.rule-prefix-group__header:hover {
  background: #E8EDF5;
}

.rule-prefix-group__header .el-icon {
  color: #64748B;
}

.rule-prefix-group__title {
  flex: 1;
}

.rule-prefix-group__count {
  font-size: 11px;
  font-weight: 500;
  color: #94A3B8;
  min-width: 28px;
  text-align: center;
}

.rule-prefix-group__items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1px;
  background: #E2E8F0;
}

.rule-prefix-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: white;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.rule-prefix-item:hover {
  background: #FAFBFC;
}

.rule-prefix-item--active {
  background: #F0F9FF;
}

.rule-prefix-item--active:hover {
  background: #E0F2FE;
}

.rule-prefix-item__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rule-prefix-item__label {
  font-size: 13px;
  font-weight: 500;
  color: #1E293B;
  line-height: 1.4;
}

.rule-prefix-item--active .rule-prefix-item__label {
  color: #0369A1;
  font-weight: 600;
}

.rule-prefix-item__desc {
  font-size: 11px;
  color: #94A3B8;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 640px) {
  .rule-prefix-group__items {
    grid-template-columns: 1fr;
  }
}
</style>
