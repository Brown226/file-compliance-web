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
          <template v-if="entryModule !== 'RULE_ONLY'">
            <span v-if="isUploadingForPreAnalysis || preAnalyzing" class="status-loading">
              <el-icon class="is-loading"><Loading /></el-icon>
              AI分析中...
            </span>
            <span v-else-if="preAnalyzed && preAnalysisData.contractType" class="status-done">
              <el-icon><CircleCheck /></el-icon>
              {{ preAnalysisData.contractType }}
            </span>
          </template>
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
                  :class="{ 'selectable-card--active': reviewPlanDraft.objective === option.value }"
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
                  <div class="selectable-card__check" v-if="reviewPlanDraft.objective === option.value">
                    <el-icon><Check /></el-icon>
                  </div>
                </div>
              </div>
            </div>

            <!-- 审查点及核心目的（非 RULE_ONLY） -->
            <div v-if="entryModule !== 'RULE_ONLY'" class="config-section">
              <div class="config-section-label">
                <span class="section-label-num">2</span>
                审查点与核心目的
                <el-tag v-if="selectedReviewPoints.length > 0" size="small" type="info" style="margin-left: auto">{{ selectedReviewPoints.length }}项</el-tag>
              </div>
              <div class="sub-area">
                <div class="review-points-section">
                <h4 class="section-label">
                  审查点选择 (可多选)
                  <el-tag v-if="preAnalysisData.llmAnalyzed" type="success" size="small">AI推荐</el-tag>
                </h4>
                <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group">
                  <el-tooltip
                    v-for="point in allSuggestedReviewPoints"
                    :key="point"
                    :content="point"
                    placement="top"
                    :show-after="300"
                  >
                    <el-checkbox :label="point" :value="point" border class="review-point-checkbox"></el-checkbox>
                  </el-tooltip>
                </el-checkbox-group>
              </div>
              </div>
              <div class="sub-area sub-area--alt">
              <div class="review-purposes-section">
                <h4 class="section-label">
                  审查核心目的 (可自定义)
                  <el-tag v-if="preAnalysisData.llmAnalyzed" type="success" size="small">AI推荐</el-tag>
                </h4>
                <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row">
                  <el-autocomplete v-model="purpose.value" :fetch-suggestions="querySearchCorePurposes" placeholder="搜索或输入新目的" class="w-full" trigger-on-focus></el-autocomplete>
                  <el-button type="primary" link @click="removePurpose(index)" class="remove-btn">
                    <el-icon><RemoveFilled /></el-icon>
                  </el-button>
                </div>
                <el-button type="primary" link @click="addPurpose" class="add-purpose-btn">
                  <el-icon><CirclePlusFilled /></el-icon>
                  添加目的
                </el-button>
              </div>
              </div>
            </div>

            <!-- 证据源 / 检查项目 -->
            <div v-if="showEvidenceSection" class="config-section">
              <div class="config-section-label">
                <span class="section-label-num">3</span>
                {{ entryModule === 'RULE_ONLY' ? '检查项目' : '审查依据' }}
                <el-tag v-if="reviewPlanDraft.evidence.sources.length > 0 || enabledRulePrefixes.length > 0" size="small" type="info" style="margin-left: auto">
                  {{ entryModule === 'RULE_ONLY' ? enabledRulePrefixes.length + '项' : reviewPlanDraft.evidence.sources.length + '个来源' }}
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
                  <div v-for="option in availableEvidenceSources" :key="option.value" class="selectable-card selectable-card--compact" :class="{ 'selectable-card--active': reviewPlanDraft.evidence.sources.includes(option.value), 'selectable-card--disabled': isEvidenceLocked(option.value) }" @click="handleEvidenceCardClick(option.value)" tabindex="0" role="button" @keydown.enter="handleEvidenceCardClick(option.value)">
                    <div class="selectable-card__icon">
                      <el-icon :size="14"><component :is="evidenceIconMap[option.value]" /></el-icon>
                    </div>
                    <span class="selectable-card__label">{{ option.label }}</span>
                    <div class="selectable-card__check" v-if="reviewPlanDraft.evidence.sources.includes(option.value)">
                      <el-icon><Check /></el-icon>
                    </div>
                  </div>
                </div>
                <div v-if="reviewPlanDraft.evidence.sources.includes('STANDARD')" class="selected-items-display">
                  <div class="selected-items-header">
                    <span class="selected-items-count">已选 {{ reviewPlanDraft.evidence.knowledgeCategoryIds.length }} 个知识库</span>
                    <el-button type="primary" link size="small" @click="openKnowledgeDialog">管理</el-button>
                  </div>
                  <div v-if="reviewPlanDraft.evidence.knowledgeCategoryIds.length > 0" class="selected-items-tags">
                    <el-tag v-for="id in reviewPlanDraft.evidence.knowledgeCategoryIds" :key="id" closable type="info" size="small" @close="removeKnowledgeCategory(id)">{{ getKnowledgeCategoryName(id) }}</el-tag>
                  </div>
                </div>
                <div v-if="reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')" class="selected-items-display">
                  <div class="selected-items-header">
                    <span class="selected-items-count">{{ reviewPlanDraft.evidence.reviewSpecificationId ? '已选择' : '未选择' }}语义规范库</span>
                    <el-button type="primary" link size="small" @click="openReviewSpecificationDialog">选择</el-button>
                  </div>
                  <div v-if="reviewPlanDraft.evidence.reviewSpecificationId" class="selected-item-single">
                    <el-tag closable type="info" size="small" @close="reviewPlanDraft.evidence.reviewSpecificationId = null">{{ getReviewSpecificationName(reviewPlanDraft.evidence.reviewSpecificationId) }}</el-tag>
                  </div>
                </div>
              </template>
              <div v-if="entryModule === 'DOC_REVIEW' && reviewPlanDraft.objective === 'COMPARE'" class="config-reason config-reason--warning">
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
                <div class="selectable-card selectable-card--inline" :class="{ 'selectable-card--active': reviewPlanDraft.execution.profile === 'HYBRID' }" @click="reviewPlanDraft.execution.profile = 'HYBRID'" tabindex="0" role="button" @keydown.enter="reviewPlanDraft.execution.profile = 'HYBRID'">
                  <el-icon :size="14"><MagicStick /></el-icon>
                  <span>标准执行</span>
                  <span class="execution-option__badge">AI + 规则</span>
                </div>
                <div class="selectable-card selectable-card--inline" :class="{ 'selectable-card--active': reviewPlanDraft.execution.profile === 'RULE_ONLY' }" @click="reviewPlanDraft.execution.profile = 'RULE_ONLY'" tabindex="0" role="button" @keydown.enter="reviewPlanDraft.execution.profile = 'RULE_ONLY'">
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
    :current-checked-knowledge-ids="reviewPlanDraft.evidence.knowledgeCategoryIds"
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
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile, FormInstance, FormRules } from 'element-plus'
import {
  Check, MagicStick, WarningFilled,
  RemoveFilled, CirclePlusFilled, Document, Link,
  Loading, ArrowUp, EditPen, DataAnalysis, Files,
  Connection, Monitor, CircleCheck,
} from '@element-plus/icons-vue'
import { createTaskApi, preAnalyzeApi, uploadOnlyApi, exportTaskReportApi, exportTaskReportWordApi } from '@/api/task'
import type { ReviewPlan, ReviewObjective, ReviewEvidenceSource } from '@/types/models'
import { getAllKnowledgeCategoriesApi, getKnowledgeTreeApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { getRuleRegistryApi, type RuleGroupMeta, type RuleMetaItem } from '@/api/system'
import { useUserStore } from '@/stores/user'
import SmartReviewUploadStep from './components/SmartReviewUploadStep.vue'
import SmartReviewKnowledgeDialog from './components/SmartReviewKnowledgeDialog.vue'
import SmartReviewReviewSpecificationDialog from './components/SmartReviewReviewSpecificationDialog.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

// ===== 入口来源判断 =====
// 当路由包含 :id 参数时（如 /review/123），说明是从历史记录入口访问，应隐藏步骤条以释放空间
// 从新建流程访问时路由为 /review（无参数），步骤条正常显示
const isFromHistory = computed(() => !!route.params.id)

// ===== 步骤控制 =====
const currentStep = ref(0) // 0: 上传, 1: 确认, 2: 审查中

// ===== 文件上传 =====
const fileList = ref<UploadFile[]>([])
const refFileList = ref<UploadFile[]>([])
const dwgParsedDataMap = ref<Record<string, any>>({})

const onDwgParsed = (fileName: string, data: any) => {
  dwgParsedDataMap.value[fileName] = data
}
const onDwgParseError = (fileName: string, _err: any) => {
  console.warn('[SmartReview] DWG parse error:', fileName)
}

// ===== 表单 =====
const form = reactive({ title: '' })
const rules: FormRules = {
  title: [{ required: true, message: '请输入任务标题', trigger: 'blur' }],
}

// ===== 预分析 =====
const preAnalyzed = ref(false)
const preAnalyzing = ref(false)
const tempUploadedFilePaths = ref<string[]>([])
const isUploadingForPreAnalysis = ref(false)
const preAnalysisData = reactive({
  contractType: '',
  noResultReason: '',
  potentialParties: [] as string[],
  suggestedReviewPoints: [] as string[],
  suggestedCorePurposes: [] as string[],
  llmAnalyzed: false,
})

const aiSuggestedTitle = computed(() => {
  if (!preAnalyzed.value || form.title) return ''
  if (preAnalysisData.noResultReason) return ''
  const type = preAnalysisData.contractType
  const firstFile = fileList.value[0]?.name?.replace(/\.[^.]+$/, '') || ''
  if (type && firstFile) return `${firstFile}-${type}审查`
  if (type) return `${type}智能审查`
  if (firstFile) return `${firstFile}-文件合规审查`
  return ''
})

let preAnalyzeTimer: ReturnType<typeof setTimeout> | null = null

// 监听文件列表变化，后台进行预分析（不自动跳转步骤）
// 仅在已在步骤1时触发（如用户返回重新上传），步骤0的预分析由 goToStep1 处理
watch(fileList, (newList) => {
  if (preAnalyzeTimer) clearTimeout(preAnalyzeTimer)
  if (newList.length > 0) {
    // 标记预分析未完成（因为文件列表变化了）
    preAnalyzed.value = false
    preAnalyzing.value = true

    // 仅在已在步骤1时自动触发预分析（用户返回修改文件的场景）
    if (currentStep.value === 1) {
      preAnalyzeTimer = setTimeout(() => {
        const metaList = newList.map(f => ({ name: f.name, size: f.size || 0 }))
        runPreAnalysisWithSignal(metaList, currentPreAnalysisAbortController?.signal)
      }, 800)
    }
  } else {
    // 文件列表为空时，重置预分析状态
    preAnalyzed.value = false
    preAnalyzing.value = false
  }
}, { deep: true })

// 应用预分析数据到界面
const applyPreAnalysisData = (data: any) => {
  console.log('[SmartReview] applyPreAnalysisData 接收到的数据:', JSON.stringify({
    suggestedReviewPoints: data.suggestedReviewPoints,
    suggestedCorePurposes: data.suggestedCorePurposes,
    contractType: data.contractType,
    documentTypeLabel: data.documentTypeLabel,
    recommendations: data.recommendations,
    llmAnalyzed: data.llmAnalyzed,
  }, null, 2))

  // 记录是否经过真实AI分析
  preAnalysisData.llmAnalyzed = !!data.llmAnalyzed

  // 应用推荐结果
  if (data.suggestedPerspective) {
    config.perspective = data.suggestedPerspective
  } else if (!config.perspective) {
    config.perspective = 'general'
  }
  // 兼容两种字段名：contractType 或 documentType
  if (data.contractType) {
    preAnalysisData.contractType = data.contractType
  } else if (data.documentTypeLabel) {
    preAnalysisData.contractType = data.documentTypeLabel
  }
  preAnalysisData.noResultReason = data.noResultReason || ''

  // 根据预分析结果设置审查项
  const rec = data.recommendations
  if (!rec) {
    console.log('[SmartReview] 无推荐数据，跳过审查项设置')
    return
  }

  // 新流程(ReviewPlanDraft)直接填充：预分析推荐作用于新版配置面板
  if (rec.libraryReview?.categoryId) {
    const ids = reviewPlanDraft.evidence.knowledgeCategoryIds
    if (!ids.includes(rec.libraryReview.categoryId)) {
      ids.push(rec.libraryReview.categoryId)
    }
  }
  if (rec.reviewSpecification?.specificationId) {
    reviewPlanDraft.evidence.reviewSpecificationId = rec.reviewSpecification.specificationId
    if (!reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')) {
      reviewPlanDraft.evidence.sources.push('REVIEW_SPECIFICATION')
    }
  }

  // 保存推荐理由
  preAnalysisReasons.value = {
    library: rec.libraryReview?.reason,
    reviewSpecification: rec.reviewSpecification?.reason,
    typo: rec.generalChecks?.typoCheck?.reason,
    crossFile: rec.generalChecks?.crossFileCheck?.reason,
  }

  // 更新预分析数据（只在真实AI分析成功时更新）
  const suggestedPoints = data.suggestedReviewPoints || []
  console.log('[SmartReview] suggestedReviewPoints 长度:', suggestedPoints.length, '内容:', suggestedPoints, 'llmAnalyzed:', data.llmAnalyzed)
  
  if (data.llmAnalyzed && suggestedPoints.length > 0) {
    preAnalysisData.suggestedReviewPoints = suggestedPoints
    allSuggestedReviewPoints.value = [...suggestedPoints]
    selectedReviewPoints.value = [...suggestedPoints]
    console.log('[SmartReview] 已更新审查点为AI生成的值')
  } else if (!data.llmAnalyzed) {
    console.warn('[SmartReview] LLM分析未执行，使用默认审查点模板')
  }
  
  const suggestedPurposes = data.suggestedCorePurposes || []
  console.log('[SmartReview] suggestedCorePurposes 长度:', suggestedPurposes.length, '内容:', suggestedPurposes, 'llmAnalyzed:', data.llmAnalyzed)
  
  if (data.llmAnalyzed && suggestedPurposes.length > 0) {
    preAnalysisData.suggestedCorePurposes = suggestedPurposes
    allSuggestedCorePurposes.value = [...suggestedPurposes]
    customPurposes.value = suggestedPurposes.map((p: string) => ({ value: p }))
    console.log('[SmartReview] 已更新核心目的为AI生成的值')
  } else if (!data.llmAnalyzed) {
    console.warn('[SmartReview] LLM分析未执行，使用默认核心目的模板')
  }
}

// 下一步：进入预审配置（先上传文件，再进行AI预分析）
const goToStep1 = async () => {
  if (fileList.value.length === 0) {
    ElMessage.warning('请至少选择一个待审文件')
    return
  }

  currentStep.value = 1
  if (!config.perspective) {
    config.perspective = 'general'
  }

  // RULE_ONLY 模式无需 AI 预分析，直接跳过
  if (entryModule.value === 'RULE_ONLY') {
    return
  }

  if (preAnalyzed.value) {
    backgroundStatus.value = 'idle'
    return
  }

  // 阶段1：先上传文件到服务器（获取实际文件路径）
  backgroundStatus.value = 'pre-analyzing'
  currentPreAnalysisAbortController = new AbortController()

  try {
    isUploadingForPreAnalysis.value = true

    // 构建FormData并上传文件
    const formData = new FormData()
    fileList.value.forEach(f => {
      if (f.raw) {
        formData.append('files', f.raw)
      }
    })

    const uploadRes = await uploadOnlyApi(formData)

    // 保存返回的文件路径
    const uploadedFiles = uploadRes.data?.files || []
    tempUploadedFilePaths.value = uploadedFiles.map((f: any) => f.filePath)

    console.log('[SmartReview] 文件已上传用于预分析，路径:', tempUploadedFilePaths.value)

    isUploadingForPreAnalysis.value = false

    // 阶段2：使用实际文件路径进行预分析
    const fileMetaWithPaths = uploadedFiles.map((f: any) => ({
      name: f.fileName,
      size: f.fileSize,
      filePath: f.filePath  // 关键：传入实际路径
    }))

    await runPreAnalysisWithSignal(fileMetaWithPaths, currentPreAnalysisAbortController.signal)

    backgroundStatus.value = 'done'
    ElMessage.success('AI 预分析完成，已自动填入推荐配置')
    if (backgroundStatusHideTimer) clearTimeout(backgroundStatusHideTimer)
    backgroundStatusHideTimer = setTimeout(() => { backgroundStatus.value = 'idle' }, 3000)

  } catch (err: any) {
    if (err?.name === 'AbortError') return
    console.error('[SmartReview] 预分析流程失败:', err)
    backgroundStatus.value = 'failed'
    ElMessage.warning('预分析失败，您可手动配置后直接开始分析')
  } finally {
    isUploadingForPreAnalysis.value = false
  }
}

// 带取消信号的预分析（用于解决竞态问题）
let currentPreAnalysisAbortController: AbortController | null = null

const handleKnowledgeConfirm = (selectedIds: string[]) => {
  reviewPlanDraft.evidence.knowledgeCategoryIds = selectedIds
}
const handleReviewSpecificationConfirm = (specificationId: string | null) => {
  reviewPlanDraft.evidence.reviewSpecificationId = specificationId
}

const runPreAnalysisWithSignal = async (files: Array<{ name: string; size: number }>, signal?: AbortSignal) => {
  preAnalyzing.value = true
  try {
    const { data } = await preAnalyzeApi(files)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    applyPreAnalysisData(data)
    preAnalyzed.value = true
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    console.warn('[SmartReview] 预分析失败:', e)
    throw e
  } finally {
    preAnalyzing.value = false
  }
}

const preAnalysisReasons = ref<Record<string, string>>({})

// ===== 后台预分析状态跟踪 =====
// 'idle' | 'pre-analyzing' | 'done' | 'failed'
const backgroundStatus = ref<'idle' | 'pre-analyzing' | 'done' | 'failed'>('idle')
let backgroundStatusHideTimer: ReturnType<typeof setTimeout> | null = null

// ===== localStorage 状态持久化 =====
const STORAGE_KEY = 'smartReview_draft_v3'

interface PersistedState {
  currentStep: number
  title: string
  preAnalyzed: boolean
  preAnalysisData: typeof preAnalysisData
  selectedReviewPoints: string[]
  customPurposes: Array<{ value: string }>
  allSuggestedReviewPoints: string[]
  allSuggestedCorePurposes: string[]
  fileNames: string[]
  refFileNames: string[]
  savedAt: number
}

const saveState = () => {
  try {
    const state: PersistedState = {
      currentStep: currentStep.value,
      title: form.title,
      preAnalyzed: preAnalyzed.value,
      preAnalysisData: { ...preAnalysisData },
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
    // localStorage 不可用或存储满时静默失败
  }
}

const restoreState = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const state: PersistedState = JSON.parse(raw)
    // 30分钟内有效
    if (Date.now() - state.savedAt > 30 * 60 * 1000) {
      clearSavedState()
      return false
    }
    if (state.currentStep !== undefined) currentStep.value = state.currentStep
    if (state.title) form.title = state.title
    if (state.preAnalyzed) preAnalyzed.value = state.preAnalyzed
    if (state.preAnalysisData) {
      if (state.preAnalysisData.contractType) preAnalysisData.contractType = state.preAnalysisData.contractType
      if (state.preAnalysisData.potentialParties?.length) preAnalysisData.potentialParties = state.preAnalysisData.potentialParties
      if (state.preAnalysisData.suggestedReviewPoints?.length) preAnalysisData.suggestedReviewPoints = state.preAnalysisData.suggestedReviewPoints
      if (state.preAnalysisData.suggestedCorePurposes?.length) preAnalysisData.suggestedCorePurposes = state.preAnalysisData.suggestedCorePurposes
    }
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

// ===== 审查配置（需求驱动） =====
const config = reactive({
  perspective: '',
})



type EntryModule = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'MULTIMODAL' | 'DOC_REVIEW'

const ENTRY_MODULE_LABEL: Record<EntryModule, string> = {
  LIBRARY: '以库审文',
  CONSISTENCY: '一致性审查',
  PROOFREAD: '基础校对审查',
  RULE_ONLY: '规则库审查',
  MULTIMODAL: '多模态识别',
  DOC_REVIEW: '以文审文',
}

const modeHintMap: Partial<Record<EntryModule, string>> = {
  CONSISTENCY: '本模式检查文件内部/之间的数据参数是否自洽（如"设计压力"在前后文中是否一致），使用规则引擎精确数值比对。如需与参照文件做语义级比对，请选择「以文审文」。',
  DOC_REVIEW: '本模式将待审文件与参照文件进行 AI 语义级逐项比对，可发现内容缺失、偏差和条款遗漏。需上传参照文件。',
}

const modeDescriptionMap: Record<EntryModule, { title: string; desc: string; icon: string }> = {
  LIBRARY: { title: '以库审文模式', desc: '基于知识库进行合规性审查，适用于合同、规范等标准化文档的全面检查。', icon: 'FolderOpened' },
  CONSISTENCY: { title: '一致性审查模式', desc: '检查文件内部及跨文件的数据参数一致性，支持数值容差和维度自定义。', icon: 'Connection' },
  PROOFREAD: { title: '基础校对模式', desc: '专注于文本层面的错别字、语法、标点和格式错误检测与纠正。', icon: 'EditPen' },
  RULE_ONLY: { title: '规则库审查模式', desc: '仅使用自定义规则库进行结构化审查，适合有明确规则的标准化检查场景。', icon: 'Files' },
  MULTIMODAL: { title: '多模态识别模式', desc: '综合处理文本、表格、图片、图纸等多种格式，AI智能识别并提取关键信息。', icon: 'Monitor' },
  DOC_REVIEW: { title: '以文审文模式', desc: '将待审文件与参照文件进行AI语义级逐项比对，发现内容遗漏、偏差和冲突。', icon: 'Document' },
}

const getModeBadgeType = (mode: EntryModule): '' | 'success' | 'warning' | 'danger' | 'info' => {
  const map: Record<EntryModule, '' | 'success' | 'warning' | 'danger' | 'info'> = {
    LIBRARY: '', CONSISTENCY: 'success', PROOFREAD: 'info', RULE_ONLY: 'warning', MULTIMODAL: 'danger', DOC_REVIEW: '',
  }
  return map[mode] || ''
}

const getModeBadgeLabel = (mode: EntryModule) => {
  const map: Record<EntryModule, string> = {
    LIBRARY: '常用', CONSISTENCY: '精确', PROOFREAD: '轻量', RULE_ONLY: '专业', MULTIMODAL: '高级', DOC_REVIEW: '对比',
  }
  return map[mode] || ''
}

const scrollToUpload = () => {
  currentStep.value = 0
}

const entryModule = ref<EntryModule | ''>('')

const entryModuleLabel = computed(() =>
  entryModule.value ? ENTRY_MODULE_LABEL[entryModule.value] : '',
)

const showEvidenceSection = computed(() => {
  if (!entryModule.value) return true
  return ['LIBRARY', 'RULE_ONLY', 'DOC_REVIEW'].includes(entryModule.value)
})

const showObjectiveSelector = computed(() =>
  !entryModule.value,
)

const showExecutionProfileSection = computed(() =>
  !entryModule.value || entryModule.value === 'RULE_ONLY',
)

const ruleReviewEnabled = computed({
  get: () => reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION'),
  set: (enabled: boolean) => {
    const current = new Set(reviewPlanDraft.evidence.sources)
    if (enabled) {
      current.add('REVIEW_SPECIFICATION')
    } else {
      current.delete('REVIEW_SPECIFICATION')
      reviewPlanDraft.evidence.reviewSpecificationId = null
    }
    reviewPlanDraft.evidence.sources = Array.from(current)
  },
})

const isEvidenceLocked = (source: ReviewEvidenceSource) => {
  if (!entryModule.value) return reviewPlanDraft.objective === 'COMPARE'
  if (entryModule.value === 'RULE_ONLY') return source !== 'REVIEW_SPECIFICATION'
  if (entryModule.value === 'PROOFREAD') return true
  if (entryModule.value === 'CONSISTENCY' && reviewPlanDraft.objective === 'COMPARE') {
    return source !== 'REFERENCE'
  }
  return reviewPlanDraft.objective === 'COMPARE'
}

const applyEntryModulePreset = (module: EntryModule) => {
  if (module === 'LIBRARY') {
    reviewPlanDraft.objective = 'COMPLIANCE'
    reviewPlanDraft.evidence.sources = ['STANDARD']
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }

  if (module === 'CONSISTENCY') {
    reviewPlanDraft.objective = 'COMPLIANCE'
    reviewPlanDraft.evidence.sources = []
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.evidence.refFileGroupId = null
    reviewPlanDraft.enhancements.intraFileConsistency = true
    reviewPlanDraft.enhancements.crossFileConsistency = true
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }

  if (module === 'PROOFREAD') {
    reviewPlanDraft.objective = 'PROOFREAD'
    reviewPlanDraft.evidence.sources = []
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.enhancements.intraFileConsistency = true
    reviewPlanDraft.enhancements.crossFileConsistency = false
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }

  if (module === 'MULTIMODAL') {
    reviewPlanDraft.objective = 'COMPLIANCE'
    reviewPlanDraft.evidence.sources = []
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.enhancements.intraFileConsistency = true
    reviewPlanDraft.enhancements.crossFileConsistency = true
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }

  if (module === 'DOC_REVIEW') {
    reviewPlanDraft.objective = 'COMPARE'
    reviewPlanDraft.evidence.sources = ['REFERENCE']
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.evidence.refFileGroupId = null
    reviewPlanDraft.enhancements.intraFileConsistency = true
    reviewPlanDraft.enhancements.crossFileConsistency = true
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }

  if (module === 'RULE_ONLY') {
    reviewPlanDraft.objective = 'COMPLIANCE'
    reviewPlanDraft.evidence.sources = []
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.evidence.refFileGroupId = null
    reviewPlanDraft.enhancements.intraFileConsistency = false
    reviewPlanDraft.enhancements.crossFileConsistency = false
    reviewPlanDraft.execution.profile = 'RULE_ONLY'
    return
  }
}

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

const defaultEnabledPrefixes = [
  'NAME', 'FORMAT', 'LAYOUT', 'HEADER', 'PAGE', 'CODE', 'UNIT', 'ATTR', 'TYPO',
  'CONSIST', 'COMPL',
  'DWG_TITLE', 'DWG_LAYER', 'DWG_DIM', 'DWG_STDREF', 'DWG_SCALE', 'DWG_OVERLAP',
]

const enabledRulePrefixes = ref<string[]>([])

const rulePrefixGroups = ref<RuleGroupMeta[]>([])
const ruleRegistryLoaded = ref(false)

async function loadRuleRegistry() {
  try {
    const { data } = await getRuleRegistryApi()
    rulePrefixGroups.value = data.groups || []
    if (!enabledRulePrefixes.value.length && data.allPrefixes?.length) {
      enabledRulePrefixes.value = [...data.allPrefixes]
    }
    ruleRegistryLoaded.value = true
    console.log(`[SmartReview] 规则注册表加载成功: ${data.total} 项, ${data.groups?.length || 0} 组`)
  } catch (e) {
    console.warn('[SmartReview] 规则注册表加载失败，使用空列表:', e)
    ruleRegistryLoaded.value = true
  }
}

const reviewPlanPayload = computed<ReviewPlan>(() => {
  return {
    ...reviewPlanDraft,
      evidence: {
        ...reviewPlanDraft.evidence,
        knowledgeCategoryIds: [...(reviewPlanDraft.evidence.knowledgeCategoryIds || [])],
        sources: [...(reviewPlanDraft.evidence.sources || [])],
        reviewSpecificationId: reviewPlanDraft.evidence.reviewSpecificationId || null,
        refFileGroupId: reviewPlanDraft.evidence.refFileGroupId || null,
        enabledPrefixes: [...enabledRulePrefixes.value],
      },
      enhancements: {
        ...reviewPlanDraft.enhancements,
      },
      execution: {
        ...reviewPlanDraft.execution,
      },
      templateId: reviewPlanDraft.templateId,
    }
  })

const objectiveOptions: Array<{ value: ReviewObjective; label: string; desc: string }> = [
  { value: 'COMPLIANCE', label: '合规审查', desc: '对照知识库或规则库检查文件是否合规。' },
  { value: 'COMPARE', label: '参照比对', desc: '与参考文件逐项比对，识别差异和不一致。' },
  { value: 'PROOFREAD', label: '文本校对', desc: '检查错别字、语病、术语一致性等文字问题。' },
  { value: 'STRUCTURED', label: '结构化审查', desc: '检查图纸、表格、公式和结构化内容。' },
]

const objectiveIconMap: Record<string, any> = {
  COMPLIANCE: 'MagicStick',
  COMPARE: 'Document',
  PROOFREAD: 'EditPen',
  STRUCTURED: 'DataAnalysis',
}

const evidenceIconMap: Record<string, any> = {
  STANDARD: 'FolderOpened',
  REVIEW_SPECIFICATION: 'Files',
  REFERENCE: 'Link',
}

const toggleEvidenceSource = (source: ReviewEvidenceSource) => {
  if (isEvidenceLocked(source)) return
  const current = new Set(reviewPlanDraft.evidence.sources)
  if (current.has(source)) {
    current.delete(source)
    if (source === 'REVIEW_SPECIFICATION') reviewPlanDraft.evidence.reviewSpecificationId = null
  } else {
    current.add(source)
  }
  reviewPlanDraft.evidence.sources = Array.from(current)
}

// ===== 选择对话框相关 =====
const knowledgeDialogVisible = ref(false)
const reviewSpecificationDialogVisible = ref(false)

const handleEvidenceCardClick = (source: ReviewEvidenceSource) => {
  if (isEvidenceLocked(source)) return

  if (source === 'STANDARD') {
    const current = new Set(reviewPlanDraft.evidence.sources)
    if (!current.has(source)) {
      current.add(source)
      reviewPlanDraft.evidence.sources = Array.from(current)
    }
    openKnowledgeDialog()
  } else if (source === 'REVIEW_SPECIFICATION') {
    const current = new Set(reviewPlanDraft.evidence.sources)
    if (!current.has(source)) {
      current.add(source)
      reviewPlanDraft.evidence.sources = Array.from(current)
    }
    openReviewSpecificationDialog()
  } else {
    toggleEvidenceSource(source)
  }
}

const openKnowledgeDialog = () => {
  knowledgeDialogVisible.value = true
}

const openReviewSpecificationDialog = async () => {
  reviewSpecificationDialogVisible.value = true
  try {
    const specRes = await getRuleLibrariesApi()
    console.log('[SmartReview] API response:', specRes)
    console.log('[SmartReview] specRes.data type:', typeof specRes.data, Array.isArray(specRes.data))
    console.log('[SmartReview] specRes.data content:', JSON.stringify(specRes.data))
    reviewSpecifications.value = (specRes.data || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status || 'DRAFT',
      description: l.description || '',
      itemCount: l._count?.items || l.items?.length || 0,
      executableCount: l.enabledExecutableItemCount || l.executableItemCount || 0,
    }))
    console.log('[SmartReview] reviewSpecifications.value:', reviewSpecifications.value)
  } catch (e) {
    console.warn('[SmartReview] 刷新语义规范库列表失败:', e)
  }
}

const removeKnowledgeCategory = (id: string) => {
  const index = reviewPlanDraft.evidence.knowledgeCategoryIds.indexOf(id)
  if (index > -1) {
    reviewPlanDraft.evidence.knowledgeCategoryIds.splice(index, 1)
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

const evidenceSourceOptions: Record<ReviewObjective, Array<{ value: ReviewEvidenceSource; label: string }>> = {
  COMPLIANCE: [
    { value: 'STANDARD', label: '知识库' },
    { value: 'REVIEW_SPECIFICATION', label: '语义规范库' },
  ],
  COMPARE: [
    { value: 'REFERENCE', label: '参考文件' },
  ],
  PROOFREAD: [],
  STRUCTURED: [
    { value: 'STANDARD', label: '知识库' },
    { value: 'REVIEW_SPECIFICATION', label: '语义规范库' },
  ],
}

const availableEvidenceSources = computed(() => evidenceSourceOptions[reviewPlanDraft.objective] || [])

watch(() => reviewPlanDraft.objective, (objective) => {
  const allowed = new Set((evidenceSourceOptions[objective] || []).map(item => item.value))
  if (objective === 'COMPARE') {
    reviewPlanDraft.evidence.sources = ['REFERENCE']
    reviewPlanDraft.execution.profile = 'HYBRID'
  } else if (objective === 'PROOFREAD') {
    reviewPlanDraft.evidence.sources = []
    reviewPlanDraft.evidence.reviewSpecificationId = null
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
    reviewPlanDraft.evidence.refFileGroupId = null
    reviewPlanDraft.execution.profile = 'HYBRID'
  } else {
    const next = reviewPlanDraft.evidence.sources.filter(source => allowed.has(source))
    reviewPlanDraft.evidence.sources = next.length > 0 ? next : (allowed.has('STANDARD') ? ['STANDARD'] : [])
  }

  if (!reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')) {
    reviewPlanDraft.evidence.reviewSpecificationId = null
  }
  if (!reviewPlanDraft.evidence.sources.includes('STANDARD')) {
    reviewPlanDraft.evidence.knowledgeCategoryIds = []
  }
  if (!reviewPlanDraft.evidence.sources.includes('REFERENCE')) {
    reviewPlanDraft.evidence.refFileGroupId = null
  }
})

// 知识库子库列表
const knowledgeCategories = ref<Array<{ id: string; name: string }>>([])
const knowledgeTreeData = ref<any[]>([])

const togglePrefix = (prefix: string) => {
  const idx = enabledRulePrefixes.value.indexOf(prefix)
  if (idx >= 0) {
    enabledRulePrefixes.value.splice(idx, 1)
  } else {
    enabledRulePrefixes.value.push(prefix)
  }
}

const toggleGroup = (prefixes: string[], enabled: boolean) => {
  if (enabled) {
    prefixes.forEach(p => {
      if (!enabledRulePrefixes.value.includes(p)) {
        enabledRulePrefixes.value.push(p)
      }
    })
  } else {
    enabledRulePrefixes.value = enabledRulePrefixes.value.filter(p => !prefixes.includes(p))
  }
}

// 语义规范库列表
const reviewSpecifications = ref<Array<{
  id: string
  name: string
  status: string
  itemCount: number
  executableCount: number
}>>([])

// 审查点和核心目的
const allSuggestedReviewPoints = ref<string[]>([])
const allSuggestedCorePurposes = ref<string[]>([])
const selectedReviewPoints = ref<string[]>([])
const customPurposes = ref<Array<{ value: string }>>([{ value: '' }])

// 监听关键状态变化，自动保存到 localStorage
watch([currentStep, () => form.title, preAnalyzed], () => saveState(), { deep: true })
watch(preAnalysisData, () => saveState(), { deep: true })
watch([selectedReviewPoints, customPurposes], () => saveState(), { deep: true })

// ===== 结果展示 =====
const loading = ref(false)
const loadingMessage = ref('')
const analysisProgress = ref<Array<any>>([])

const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6))

const progressStepLabels: Record<string, string> = {
  pre_analysis: '文档预分析',
  extract_text: '提取文件正文',
  knowledge_search: '检索知识与标准',
  llm_review: 'AI 深度审查',
  finalize: '保存审查结果',
}

const progressStatusLabels: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
}

const progressStepLabel = (step: string) => progressStepLabels[step] || step || '处理中'
const progressStatusLabel = (status: string) => progressStatusLabels[status] || status || '处理中'
const progressStatusClass = (status: string) => {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
}

// ===== 操作函数 =====
const goBackToUpload = () => {
  currentStep.value = 0
  fileList.value = []
  refFileList.value = []
}

const goBackToConfirm = () => {
  currentStep.value = 1
}

const startAnalysis = async () => {
  if (!form.title.trim()) {
    ElMessage.warning('请输入任务标题')
    return
  }
  if (!canSubmit.value) {
    const reasons: string[] = []
    if (!form.title.trim()) reasons.push('请输入任务标题')
    if (reviewPlanDraft.objective === 'COMPARE' && refFileList.value.length === 0)
      reasons.push('以文审文/参照比对模式需要上传参照文件（在参考文件区上传）')
    if (reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION') && !reviewPlanDraft.evidence.reviewSpecificationId)
      reasons.push('语义规范库模式需要选择具体的语义规范库')
    const allowEmptySources = ['PROOFREAD'].includes(reviewPlanDraft.objective) || ['CONSISTENCY', 'RULE_ONLY', 'MULTIMODAL'].includes(entryModule.value as EntryModule)
    if (!allowEmptySources && reviewPlanDraft.evidence.sources.length === 0)
      reasons.push('请至少选择一项审查依据（标准库/知识库/语义规范库/参照文件）')
    ElMessage.warning(reasons.length > 0 ? reasons[0] : '请完善审查配置后再开始分析')
    return
  }
  await submitTask()
}

const addPurpose = () => {
  customPurposes.value.push({ value: '' })
}

const removePurpose = (index: number) => {
  if (customPurposes.value.length <= 1) {
    ElMessage.warning('至少保留一个目的输入框')
    return
  }
  ElMessageBox.confirm('确认删除该审查目的？', '提示', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
    .then(() => { customPurposes.value.splice(index, 1) })
    .catch(() => {})
}



const querySearchCorePurposes = (queryString: string, cb: any) => {
  const results = queryString
    ? allSuggestedCorePurposes.value.filter(p => p.toLowerCase().includes(queryString.toLowerCase()))
    : allSuggestedCorePurposes.value
  cb(results.map(p => ({ value: p })))
}

const canSubmit = computed(() => {
  if (!form.title.trim()) return false
  if (reviewPlanDraft.objective === 'COMPARE' && refFileList.value.length === 0) return false
  if (reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION') && !reviewPlanDraft.evidence.reviewSpecificationId) return false
  const allowEmptySources = ['PROOFREAD'].includes(reviewPlanDraft.objective) || ['CONSISTENCY', 'RULE_ONLY', 'MULTIMODAL'].includes(entryModule.value as EntryModule)
  if (!allowEmptySources && reviewPlanDraft.evidence.sources.length === 0) return false
  return true
})

// ===== 提交 =====
const submitting = ref(false)

const submitTask = async () => {
  if (!userStore.token) {
    ElMessage.error('请先登录后再创建任务')
    router.push('/login')
    return
  }

  // 表单验证
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  const submitPlan = reviewPlanPayload.value

  if (submitPlan.objective === 'COMPARE') {
    if (!submitPlan.evidence.sources.includes('REFERENCE')) {
      ElMessage.warning('参照比对模式必须使用参考文件作为审查依据')
      return
    }
    if (refFileList.value.length === 0) {
      ElMessage.warning('参照比对模式必须上传至少一个参考文件')
      return
    }
  }

  if (submitPlan.execution.profile !== 'RULE_ONLY' && submitPlan.evidence.sources.includes('REVIEW_SPECIFICATION') && !submitPlan.evidence.reviewSpecificationId) {
    ElMessage.warning('已选择语义规范库依据，请先选择具体规范库')
    return
  }

  if (submitPlan.execution.profile === 'RULE_ONLY' && enabledRulePrefixes.value.length === 0) {
    ElMessage.warning('请至少启用一个检查项目')
    return
  }

  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('title', form.title)

    // 知识库（规范性审查启用时）
    if (submitPlan.evidence.sources.includes('STANDARD') && submitPlan.evidence.knowledgeCategoryIds?.length) {
      fd.append('knowledgeCategoryIds', JSON.stringify(submitPlan.evidence.knowledgeCategoryIds))
    }

    if (submitPlan.evidence.sources.includes('REVIEW_SPECIFICATION') && submitPlan.evidence.reviewSpecificationId) {
      fd.append('ruleLibraryId', submitPlan.evidence.reviewSpecificationId)
    }

    // 预分析数据（完整对象，包含文件类型、签约方等）
    if (preAnalyzed.value) {
      fd.append('preAnalysisData', JSON.stringify(preAnalysisData))
    }

    fd.append('reviewPlan', JSON.stringify(submitPlan))

    // 用户选中的审查点
    if (selectedReviewPoints.value.length > 0) {
      fd.append('reviewPoints', JSON.stringify(selectedReviewPoints.value))
    }

    // 用户自定义的核心目的（过滤空值）
    const validPurposes = customPurposes.value
      .map(p => p.value.trim())
      .filter(v => v.length > 0)
    if (validPurposes.length > 0) {
      fd.append('corePurposes', JSON.stringify(validPurposes))
    }

    // 文件
    fileList.value.forEach(f => { if (f.raw) fd.append('files', f.raw) })

    // 参照文件
    refFileList.value.forEach(f => { if (f.raw) fd.append('refFiles', f.raw) })

    // DWG 解析数据（带结构校验）
    const dwgEntries = Object.entries(dwgParsedDataMap.value)
    if (dwgEntries.length > 0) {
      try {
        const validatedDwgData: Record<string, any> = {}
        for (const [fileName, data] of dwgEntries) {
          if (!data || typeof data !== 'object') continue
          if (!data.layers && !data.dimensions && !data.textEntities && !data.standardRefs) {
            console.warn(`[SmartReview] DWG数据缺少预期字段: ${fileName}`)
          }
          validatedDwgData[fileName] = data
        }
        if (Object.keys(validatedDwgData).length > 0) {
          fd.append('dwgParsedData', JSON.stringify(validatedDwgData))
        }
      } catch (jsonErr) {
        console.error('[SmartReview] DWG数据序列化失败:', jsonErr)
      }
    }

    const { data } = await createTaskApi(fd)
    ElMessage.success('审查任务已创建')
    clearSavedState() // 任务创建成功，清除草稿
    router.push(`/review/${data.id}`)
  } catch (e: any) {
    console.error('[SmartReview] 创建任务失败详细错误:', e)
    console.error('[SmartReview] 响应数据:', e?.response?.data)
    console.error('[SmartReview] 响应状态:', e?.response?.status)
    console.error('[SmartReview] 请求配置:', e?.config?.url, e?.config?.method)
    ElMessage.error(e?.response?.data?.message || e?.message || '创建任务失败')
  } finally {
    submitting.value = false
  }
}

// ===== 初始化 =====
onMounted(async () => {
  // 恢复上次的草稿状态
  const restored = restoreState()
  if (restored && currentStep.value > 0) {
    console.log('[SmartReview] 已恢复草稿状态, step:', currentStep.value)
    // 草稿恢复时文件无法持久化（File对象无法序列化），提示用户重新上传
    nextTick(() => {
      if (currentStep.value >= 1 && fileList.value.length === 0) {
        ElMessage.warning('已恢复之前的配置草稿，但文件需要重新上传')
      }
    })
  }

  // 消费新版入口传入的模块选择，并应用模块预设
  const entry = sessionStorage.getItem('smartReview.entryModule') as EntryModule | null
  if (entry && ['LIBRARY', 'CONSISTENCY', 'PROOFREAD', 'RULE_ONLY', 'MULTIMODAL', 'DOC_REVIEW'].includes(entry)) {
    entryModule.value = entry
    applyEntryModulePreset(entry)
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
    
    console.log('[SmartReview] 知识库列表加载成功:', knowledgeCategories.value.length, '个')
    console.log('[SmartReview] 知识库树形结构加载成功:', knowledgeTreeData.value.length, '个根节点')
    console.log('[SmartReview] 语义规范库列表加载成功:', reviewSpecifications.value.length, '个')
    console.log('[SmartReview] 语义规范库详情:', JSON.stringify(reviewSpecifications.value, null, 2))
    
    if (ruleRegRes.data) {
      rulePrefixGroups.value = ruleRegRes.data.groups || []
      if (!enabledRulePrefixes.value.length && ruleRegRes.data.allPrefixes?.length) {
        enabledRulePrefixes.value = [...ruleRegRes.data.allPrefixes]
      }
      ruleRegistryLoaded.value = true
      console.log(`[SmartReview] 规则注册表加载成功: ${ruleRegRes.data.total} 项, ${ruleRegRes.data.groups?.length || 0} 组`)
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
  width: 600px;
  height: 1000px;
  margin: 0 auto;
  padding: 16px 32px;
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
  padding: 10px 14px;
  flex: 1;
  min-width: 120px;
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
  width: 550px;
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
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rule-library-select {
  margin-top: 10px;
  padding: 10px;
  background: #F8FAFC;
  border-radius: 8px;
  border: 1px dashed #CBD5E1;
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
  padding: 14px 16px;
  background: #F8FAFC;
  border-radius: 10px;
  border: 1px dashed #CBD5E1;
}

.selected-items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.selected-items-count {
  font-size: 13px;
  font-weight: 600;
  color: #64748B;
}

.selected-items-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.selected-item-single {
  display: flex;
}







/* ========== 模式说明横幅 ========== */
.mode-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 50%, #F0FDF4 100%);
  border-radius: 14px;
  margin-bottom: 20px;
  border: 1px solid #E0E7FF;
  animation: bannerFadeIn 0.4s ease-out;
}

@keyframes bannerFadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.mode-banner__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}

.mode-banner__content {
  flex: 1;
  min-width: 0;
}

.mode-banner__title {
  font-size: 16px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 3px;
}

.mode-banner__desc {
  font-size: 13px;
  color: #64748B;
  line-height: 1.5;
}

/* ========== 通用：带图标的section标签 ========== */
.section-label-with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 14px;
}

.section-label-with-icon .el-icon {
  color: #3B82F6;
}

/* ========== DOC_REVIEW：参照文件 ========== */
.ref-file-status {
  margin-bottom: 12px;
}

.ref-file-status.is-valid :deep(.el-alert) {
  background: #F0FDF4;
  border-color: #86EFAC;
}

.ref-file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.ref-file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #F8FAFC;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
}

.ref-file-icon {
  color: #3B82F6;
  font-size: 18px;
}

.ref-file-name {
  flex: 1;
  font-size: 13px;
  color: #334155;
  font-weight: 500;
}

.upload-ref-btn {
  width: 100%;
  justify-content: center;
  padding: 10px;
  border: 2px dashed #CBD5E1;
  border-radius: 10px;
  transition: all 0.25s ease;
}

.upload-ref-btn:hover {
  border-color: #3B82F6;
  background: #EFF6FF;
}

/* 审查步骤 */
.review-step {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #E5E7EB;
}

.review-title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-tabs {
  padding: 24px;
}

.tab-content h3 {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
}

.issues-list, .suggestions-list, .laws-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #F0F7FF;
  border: 1px solid #BAE0FF;
  border-radius: 8px;
  margin-bottom: 16px;
}

.issue-card, .suggestion-card, .law-card {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.suggestion-card.batch-selected {
  border-color: #1890FF;
  box-shadow: 0 0 0 1px rgba(24, 144, 255, 0.2);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.issue-title, .suggestion-title, .law-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 8px;
}

.issue-desc, .law-clause, .law-content {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
  line-height: 1.6;
}

/* 大白话模式 */
.plain-language-box {
  margin-top: 12px;
  padding: 12px;
  background: #F0FDF4;
  border-radius: 8px;
  border-left: 4px solid #10B981;
}

.plain-label {
  font-size: 12px;
  font-weight: 700;
  color: #15803D;
  margin: 0 0 4px;
}

.plain-text {
  font-size: 14px;
  color: #15803D;
  margin: 0;
  line-height: 1.6;
}

/* 详细模式 */
.detail-mode {
  margin-top: 12px;
}

.detail-item {
  margin-bottom: 12px;
}

.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 4px;
}

.detail-quote {
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.detail-quote.original {
  background: #FEF2F2;
  border-left: 4px solid #EF4444;
  color: #991B1B;
}

.detail-quote.suggested {
  background: #F0FDF4;
  border-left: 4px solid #10B981;
  color: #15803D;
}

.detail-reason {
  font-size: 14px;
  color: #374151;
  margin: 0;
  line-height: 1.6;
}

.suggestion-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #E5E7EB;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.workspace-section {
  margin-bottom: 24px;
}

.workspace-actions {
  margin-top: 12px;
}

.focused-result {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.result-summary {
  font-size: 14px;
  color: #374151;
  margin: 12px 0;
  line-height: 1.6;
}

.suggested-text-box {
  margin-top: 12px;
}

.suggested-text {
  padding: 12px;
  background: #F0FDF4;
  border-radius: 6px;
  font-size: 14px;
  color: #15803D;
  line-height: 1.6;
  margin: 8px 0 0;
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
