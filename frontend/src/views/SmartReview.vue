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
          <el-input
            v-model="form.title"
            placeholder="请输入任务标题，例如：XX项目施工图审查"
            size="large"
            clearable
            maxlength="100"
            show-word-limit
          />
        </div>

        <!-- 文件上传成功提示 -->
        <div class="upload-success">
          <p class="success-text">文件 <span class="file-name">{{ fileList.length }} 个文件</span> 已上传成功。</p>
          <template v-if="entryModule !== 'RULE_ONLY'">
            <p class="ai-hint" v-if="isUploadingForPreAnalysis">
              <el-icon class="is-loading"><Loading /></el-icon>
              正在上传文件用于AI分析...
            </p>
            <p class="ai-hint" v-else-if="preAnalyzing && !preAnalyzed">
              <el-icon class="is-loading"><Loading /></el-icon>
              AI 正在智能分析文件内容...
            </p>
            <p class="ai-hint" v-else-if="preAnalysisData.contractType">
              AI初步识别文件类型为：<span class="type-text">{{ preAnalysisData.contractType }}</span>
            </p>
          </template>
        </div>

        <!-- 审查点及核心目的（仅非 RULE_ONLY 模式显示） -->
        <div v-if="entryModule !== 'RULE_ONLY'" class="review-options-panel">
          <h3 class="panel-title">审查点及核心目的</h3>
          
          <!-- 审查点选择 -->
          <div class="review-points-section">
            <h4 class="section-label">
              审查点选择 (可多选)
              <el-tag 
                v-if="preAnalysisData.llmAnalyzed" 
                type="success" 
                size="small"
                class="analysis-badge"
              >
                AI分析
              </el-tag>
              <el-tag 
                v-else 
                type="info" 
                size="small"
                class="analysis-badge"
              >
                默认模板
              </el-tag>
            </h4>
            <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group">
              <el-checkbox
                v-for="point in allSuggestedReviewPoints"
                :key="point"
                :label="point"
                :value="point"
                border
              ></el-checkbox>
            </el-checkbox-group>
          </div>

          <!-- 审查核心目的 -->
          <div class="review-purposes-section">
            <h4 class="section-label">
              审查核心目的 (可自定义)
              <el-tag 
                v-if="preAnalysisData.llmAnalyzed" 
                type="success" 
                size="small"
                class="analysis-badge"
              >
                AI分析
              </el-tag>
              <el-tag 
                v-else 
                type="info" 
                size="small"
                class="analysis-badge"
              >
                默认模板
              </el-tag>
            </h4>
            <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row">
              <el-autocomplete
                v-model="purpose.value"
                :fetch-suggestions="querySearchCorePurposes"
                placeholder="搜索或输入新目的"
                class="w-full"
                trigger-on-focus
              ></el-autocomplete>
              <el-button 
                type="primary" link
                @click="removePurpose(index)"
                class="remove-btn"
              >
                <el-icon><RemoveFilled /></el-icon>
              </el-button>
            </div>
            <el-button 
              type="primary" link
              @click="addPurpose" 
              class="add-purpose-btn"
            >
              <el-icon><CirclePlusFilled /></el-icon>
              添加目的
            </el-button>
          </div>
        </div>

                <div v-if="entryModule !== 'PROOFREAD'" class="review-items-section">
          <div class="review-item-config">
            <!-- 模式说明横幅 -->
            <div v-if="entryModule && modeDescriptionMap[entryModule as EntryModule]" class="mode-banner">
              <div class="mode-banner__icon">
                <el-icon :size="22"><component :is="modeDescriptionMap[entryModule as EntryModule].icon" /></el-icon>
              </div>
              <div class="mode-banner__content">
                <div class="mode-banner__title">{{ modeDescriptionMap[entryModule as EntryModule].title }}</div>
                <div class="mode-banner__desc">{{ modeDescriptionMap[entryModule as EntryModule].desc }}</div>
              </div>
              <div class="mode-banner__badge">
                <el-tag :type="getModeBadgeType(entryModule as EntryModule)" effect="dark" round>
                  {{ getModeBadgeLabel(entryModule as EntryModule) }}
                </el-tag>
              </div>
            </div>

            <div class="config-section">
              <div v-if="showObjectiveSelector" class="objective-cards">
                <div
                  v-for="option in objectiveOptions"
                  :key="option.value"
                  class="objective-card"
                  :class="{ 'objective-card--active': reviewPlanDraft.objective === option.value }"
                  @click="reviewPlanDraft.objective = option.value as any"
                >
                  <div class="objective-card__icon">
                    <el-icon :size="18">
                      <component :is="objectiveIconMap[option.value]" />
                    </el-icon>
                  </div>
                  <div class="objective-card__content">
                    <div class="objective-card__label">{{ option.label }}</div>
                    <div class="objective-card__desc">{{ option.desc }}</div>
                  </div>
                  <div class="objective-card__check" v-if="reviewPlanDraft.objective === option.value">
                    <el-icon><Check /></el-icon>
                  </div>
                </div>
              </div>
            </div>

            <template v-if="showEvidenceSection">
              <div class="config-section">
                <!-- RULE_ONLY 模式：规则前缀开关面板 -->
                <template v-if="entryModule === 'RULE_ONLY'">
                  <div class="config-section-label">
                    <span class="section-label-num">2</span>
                    检查项目
                  </div>
                  <div class="rule-prefix-panel">
                    <div
                      v-for="group in RULE_PREFIX_GROUPS"
                      :key="group.title"
                      class="rule-prefix-group"
                    >
                      <div class="rule-prefix-group__header" @click="toggleGroup(group.items.map((i: any) => i.prefix), !group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix)))">
                        <el-icon :size="16"><component :is="group.icon" /></el-icon>
                        <span class="rule-prefix-group__title">{{ group.title }}</span>
                        <span class="rule-prefix-group__count">{{ group.items.filter((i: any) => enabledRulePrefixes.includes(i.prefix)).length }}/{{ group.items.length }}</span>
                        <el-checkbox
                          :model-value="group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix))"
                          :indeterminate="group.items.some((item: any) => enabledRulePrefixes.includes(item.prefix)) && !group.items.every((item: any) => enabledRulePrefixes.includes(item.prefix))"
                          size="small"
                          @click.stop
                          @change="(val: boolean | string | number) => toggleGroup(group.items.map((i: any) => i.prefix), !!val)"
                        />
                      </div>
                      <div class="rule-prefix-group__items">
                        <div
                          v-for="item in group.items"
                          :key="item.prefix"
                          class="rule-prefix-item"
                          :class="{ 'rule-prefix-item--active': enabledRulePrefixes.includes(item.prefix) }"
                          @click="togglePrefix(item.prefix)"
                        >
                          <div class="rule-prefix-item__info">
                            <span class="rule-prefix-item__label">{{ item.label }}</span>
                            <span class="rule-prefix-item__desc">{{ item.desc }}</span>
                          </div>
                          <el-switch
                            :model-value="enabledRulePrefixes.includes(item.prefix)"
                            size="small"
                            style="pointer-events: none;"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <!-- 其他模式（非 RULE_ONLY 且非 DOC_REVIEW）：标准展示证据源卡片 -->
                <template v-else-if="entryModule !== 'DOC_REVIEW'">
                  <div class="evidence-cards">
                    <div
                      v-for="option in availableEvidenceSources"
                      :key="option.value"
                      class="evidence-card"
                      :class="{
                        'evidence-card--active': reviewPlanDraft.evidence.sources.includes(option.value),
                        'evidence-card--disabled': isEvidenceLocked(option.value)
                      }"
                      @click="handleEvidenceCardClick(option.value)"
                    >
                      <div class="evidence-card__icon">
                        <el-icon :size="16">
                          <component :is="evidenceIconMap[option.value]" />
                        </el-icon>
                      </div>
                      <span class="evidence-card__label">{{ option.label }}</span>
                      <div class="evidence-card__check" v-if="reviewPlanDraft.evidence.sources.includes(option.value)">
                        <el-icon><Check /></el-icon>
                      </div>
                    </div>
                  </div>
                  <div v-if="reviewPlanDraft.evidence.sources.includes('STANDARD')" class="selected-items-display">
                    <div class="selected-items-header">
                      <span class="selected-items-count">已选 {{ reviewPlanDraft.evidence.knowledgeCategoryIds.length }} 个知识库</span>
                      <el-button type="primary" link size="small" @click="openKnowledgeDialog">管理知识库</el-button>
                    </div>
                    <div v-if="reviewPlanDraft.evidence.knowledgeCategoryIds.length > 0" class="selected-items-tags">
                      <el-tag
                        v-for="id in reviewPlanDraft.evidence.knowledgeCategoryIds"
                        :key="id"
                        closable
                        type="info"
                        size="small"
                        @close="removeKnowledgeCategory(id)"
                      >
                        {{ getKnowledgeCategoryName(id) }}
                      </el-tag>
                    </div>
                  </div>
                  <div v-if="reviewPlanDraft.evidence.sources.includes('REVIEW_SPECIFICATION')" class="selected-items-display">
                    <div class="selected-items-header">
                      <span class="selected-items-count">{{ reviewPlanDraft.evidence.reviewSpecificationId ? '已选择' : '未选择' }}语义规范库</span>
                      <el-button type="primary" link size="small" @click="openReviewSpecificationDialog">选择语义规范库</el-button>
                    </div>
                    <div v-if="reviewPlanDraft.evidence.reviewSpecificationId" class="selected-item-single">
                      <el-tag closable type="info" size="small" @close="reviewPlanDraft.evidence.reviewSpecificationId = null">
                        {{ getReviewSpecificationName(reviewPlanDraft.evidence.reviewSpecificationId) }}
                      </el-tag>
                    </div>
                  </div>
                </template>
                <div v-if="entryModule === 'DOC_REVIEW' && reviewPlanDraft.objective === 'COMPARE'" class="config-reason config-reason--warning">
                  <el-icon><WarningFilled /></el-icon>
                  参照比对目标强制使用参考文件，未上传参考文件将无法提交。
                </div>
              </div>
            </template>

            <template v-if="showExecutionProfileSection && entryModule !== 'RULE_ONLY'">
              <div class="config-section">
                <div class="config-section-label">
                  <span class="section-label-num">4</span>
                  执行方式
                </div>
                <div class="execution-options">
                  <div
                    class="execution-option"
                    :class="{ 'execution-option--active': reviewPlanDraft.execution.profile === 'HYBRID' }"
                    @click="reviewPlanDraft.execution.profile = 'HYBRID'"
                  >
                    <el-icon :size="16"><MagicStick /></el-icon>
                    <span>标准执行</span>
                    <span class="execution-option__badge">AI + 规则</span>
                  </div>
                  <div
                    class="execution-option"
                    :class="{ 'execution-option--active': reviewPlanDraft.execution.profile === 'RULE_ONLY' }"
                    @click="reviewPlanDraft.execution.profile = 'RULE_ONLY'"
                  >
                    <el-icon :size="16"><Check /></el-icon>
                    <span>仅规则执行</span>
                    <span class="execution-option__badge">快速</span>
                  </div>
                </div>
              </div>
            </template>
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
      @click="startAnalysis"
      class="action-btn action-btn--primary"
    >
      <el-icon><MagicStick /></el-icon>
      开始分析
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile, FormInstance, FormRules } from 'element-plus'
import {
  Check, MagicStick, WarningFilled,
  RemoveFilled, CirclePlusFilled, Document, Link,
  Loading, ArrowUp, EditPen, DataAnalysis, FolderOpened, Files,
  Connection, Monitor,
} from '@element-plus/icons-vue'
import { createTaskApi, preAnalyzeApi, uploadOnlyApi, exportTaskReportApi, exportTaskReportWordApi } from '@/api/task'
import type { ReviewPlan, ReviewObjective, ReviewEvidenceSource } from '@/types/models'
import { getAllKnowledgeCategoriesApi, getKnowledgeTreeApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
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
  llmAnalyzed: false,  // 新增：标记是否经过真实AI分析
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
  return ['LIBRARY', 'RULE_ONLY', 'MULTIMODAL', 'DOC_REVIEW'].includes(entryModule.value)
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
    reviewPlanDraft.evidence.sources = ['STANDARD']
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

const enabledRulePrefixes = ref<string[]>([...defaultEnabledPrefixes])

const RULE_PREFIX_GROUPS = [
  {
    title: '文件规范',
    icon: 'FolderOpened',
    items: [
      { prefix: 'NAME', label: '命名规范', desc: '文件名格式、版本号、特殊字符检查' },
      { prefix: 'FORMAT', label: '格式规范', desc: '文档排版、字体、段落格式检查' },
      { prefix: 'LAYOUT', label: '排版布局', desc: '布局结构、缩进、对齐方式检查' },
    ],
  },
  {
    title: '内容规范',
    icon: 'EditPen',
    items: [
      { prefix: 'HEADER', label: '页眉规范', desc: '页眉内容、格式一致性检查' },
      { prefix: 'PAGE', label: '页码规范', desc: '页码连续性、格式正确性检查' },
      { prefix: 'CODE', label: '编码规范', desc: '编码规则、编号一致性检查' },
      { prefix: 'UNIT', label: '单位规范', desc: '计量单位使用规范性检查' },
      { prefix: 'ATTR', label: '属性规范', desc: '文档属性、元数据完整性检查' },
      { prefix: 'TYPO', label: '术语一致性', desc: '专业术语使用是否统一检查' },
    ],
  },
  {
    title: '逻辑验证',
    icon: 'List',
    items: [
      { prefix: 'CONSIST', label: '一致性检查', desc: '前后参数、数据逻辑一致性检查' },
      { prefix: 'COMPL', label: '完整性检查', desc: '必填项、关键内容是否缺失检查' },
    ],
  },
  {
    title: '图纸审查 (DWG)',
    icon: 'DataAnalysis',
    items: [
      { prefix: 'DWG_TITLE', label: '标题规范', desc: '图签、标题栏格式内容检查' },
      { prefix: 'DWG_LAYER', label: '图层规范', desc: '图层命名、颜色、线型规范性检查' },
      { prefix: 'DWG_DIM', label: '标注规范', desc: '尺寸标注样式和规范性检查' },
      { prefix: 'DWG_STDREF', label: '标准引用', desc: '图纸引用的标准有效性检查' },
      { prefix: 'DWG_SCALE', label: '比例规范', desc: '图幅比例设置正确性检查' },
      { prefix: 'DWG_OVERLAP', label: '重叠检查', desc: '图元重叠、干涉问题检查' },
    ],
  },
]

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
    const allowEmptySources = ['PROOFREAD'].includes(reviewPlanDraft.objective) || entryModule.value === 'CONSISTENCY' || entryModule.value === 'RULE_ONLY'
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
  customPurposes.value.splice(index, 1)
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
  const allowEmptySources = ['PROOFREAD'].includes(reviewPlanDraft.objective) || entryModule.value === 'CONSISTENCY' || entryModule.value === 'RULE_ONLY'
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
    const [catRes, treeRes, specRes] = await Promise.all([
      getAllKnowledgeCategoriesApi(),
      getKnowledgeTreeApi(),
      getRuleLibrariesApi(),
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
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px;
  position: relative;
  min-height: calc(100vh - 140px);
}



/* 确认步骤 */
.confirm-step {
  max-width: 1000px;
  margin: 0 auto;
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
  margin-bottom: 20px;
}

.upload-success {
  text-align: center;
  margin-bottom: 32px;
}

.success-text {
  font-size: 16px;
  color: #111827;
  margin: 0 0 8px;
}

.file-name {
  font-weight: 700;
  color: #3B82F6;
}

.ai-hint {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.type-text {
  font-weight: 700;
  color: #111827;
}

/* 配置网格 */
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.config-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.config-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 8px;
}

.config-panel .panel-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 16px;
}

/* 审查选项面板 */
.review-options-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
  margin-bottom: 24px;
}

.review-options-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 20px;
}

.review-points-section {
  margin-bottom: 24px;
}

.section-label {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 12px;
}

.review-points-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.review-points-group :deep(.el-checkbox) {
  margin-right: 0;
}

.review-purposes-section .purpose-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.remove-btn {
  color: #EF4444;
  padding: 4px;
}

.add-purpose-btn {
  margin-top: 8px;
  color: #3B82F6;
}

/* ========== 新流程配置面板（美化版）========== */
.review-items-section {
  background: white;
  border-radius: 16px;
  padding: 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
  overflow: hidden;
}

.review-flow-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 50%, #F0FDF4 100%);
  border-bottom: 1px solid #E0E7FF;
}

.review-flow-header-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3B82F6 0%, #6366F1 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.review-flow-header-content {
  flex: 1;
  min-width: 0;
}

.review-flow-header-content .review-item-title {
  font-size: 17px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 2px;
}

.review-flow-header-content .review-item-desc {
  font-size: 13px;
  color: #64748B;
  margin: 0;
}

.review-flow-switch {
  flex-shrink: 0;
}

.review-item-config {
  padding: 20px 24px 24px;
}

.config-section {
  margin-bottom: 24px;
}

.config-section:last-child {
  margin-bottom: 0;
}

.config-section-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 14px;
}

.section-label-num {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.objective-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.objective-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.objective-card:hover {
  border-color: #93C5FD;
  background: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
  transform: translateY(-1px);
}

.objective-card--active {
  border-color: #3B82F6;
  background: linear-gradient(135deg, #EFF6FF 0%, #F0F4FF 100%);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.15);
}

.objective-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #E0E7FF;
  color: #4F46E5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.25s ease;
}

.objective-card--active .objective-card__icon {
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.objective-card__content {
  flex: 1;
  min-width: 0;
}

.objective-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 2px;
}

.objective-card__desc {
  font-size: 12px;
  color: #94A3B8;
  line-height: 1.4;
}

.objective-card__check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  animation: checkPop 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes checkPop {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.rule-review-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #FAFBFC;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  margin-bottom: 14px;
  transition: all 0.2s ease;
}

.rule-review-toggle:hover {
  background: #F5F7FA;
  border-color: #D1D5DB;
}

.rule-review-toggle__info {
  flex: 1;
}

.rule-review-toggle__info .review-item-title {
  font-size: 14px;
  margin-bottom: 2px;
}

.rule-review-toggle__info .review-item-desc {
  font-size: 12px;
}

.evidence-cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.evidence-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  flex: 1;
  min-width: 140px;
}

.evidence-card:hover:not(.evidence-card--disabled) {
  border-color: #93C5FD;
  background: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.evidence-card--active {
  border-color: #3B82F6;
  background: linear-gradient(135deg, #EFF6FF 0%, #F0F4FF 100%);
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.12);
}

.evidence-card--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.evidence-card__icon {
  color: #94A3B8;
  transition: color 0.2s ease;
}

.evidence-card--active .evidence-card__icon {
  color: #3B82F6;
}

.evidence-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  flex: 1;
}

.evidence-card--active .evidence-card__label {
  color: #1D4ED8;
}

.evidence-card__check {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  animation: checkPop 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.rule-library-select {
  margin-top: 12px;
  padding: 12px;
  background: #F8FAFC;
  border-radius: 10px;
  border: 1px dashed #CBD5E1;
}

.execution-options {
  display: flex;
  gap: 10px;
}

.execution-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 16px;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  background: #FAFBFC;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: #64748B;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

.execution-option:hover:not(.execution-option--disabled) {
  border-color: #93C5FD;
  color: #3B82F6;
  background: white;
}

.execution-option--active {
  border-color: #3B82F6;
  background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
  color: #1D4ED8;
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.12);
}

.execution-option--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.execution-option__badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: #E0E7FF;
  color: #4338CA;
  letter-spacing: 0.02em;
}

.execution-option--active .execution-option__badge {
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

.compare-config-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-row label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

/* ========== CONSISTENCY：一致性配置 ========== */
.consistency-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tolerance-setting {
  padding: 16px;
  background: #FAFBFC;
  border-radius: 10px;
  border: 1px solid #E2E8F0;
}

.setting-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.setting-label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.setting-value {
  font-size: 18px;
  font-weight: 700;
  color: #3B82F6;
}

.setting-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #94A3B8;
  line-height: 1.5;
}

.dimension-setting .dimension-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.dimension-item {
  margin-right: 0 !important;
}

/* ========== MULTIMODAL：模态卡片 ========== */
.modal-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .modal-grid {
    grid-template-columns: 1fr;
  }
}

.modal-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-card:hover {
  border-color: #A5B4FC;
  background: white;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
}

.modal-card--active {
  border-color: #6366F1;
  background: linear-gradient(135deg, #EEF2FF 0%, #F0F4FF 100%);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.15);
}

.modal-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: #E0E7FF;
  color: #6366F1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.25s ease;
}

.modal-card--active .modal-card__icon {
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  color: white;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.modal-card__content {
  flex: 1;
  min-width: 0;
}

.modal-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 2px;
}

.modal-card__desc {
  font-size: 11px;
  color: #94A3B8;
  line-height: 1.4;
}

.modal-card__check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.modal-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 14px;
  background: #FEF3C7;
  border-radius: 8px;
  font-size: 12px;
  color: #92400E;
}

/* ========== LIBRARY：合规等级 ========== */
.compliance-level-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 640px) {
  .compliance-level-cards {
    grid-template-columns: 1fr;
  }
}

.compliance-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 12px;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s ease;
  text-align: center;
}

.compliance-card:hover {
  border-color: #93C5FD;
  background: white;
}

.compliance-card--active {
  border-color: #3B82F6;
  background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.15);
}

.compliance-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #E0E7FF;
  color: #6366F1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
}

.compliance-card--active .compliance-card__icon {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
  box-shadow: 0 3px 10px rgba(59, 130, 246, 0.3);
}

.compliance-card__content {
  text-align: center;
}

.compliance-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
}

.compliance-card__desc {
  font-size: 11px;
  color: #94A3B8;
  line-height: 1.4;
}

.compliance-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #3B82F6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

/* ========== PROOFREAD：校对类型 ========== */
.proofread-type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .proofread-type-grid {
    grid-template-columns: 1fr;
  }
}

.proofread-type-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s ease;
}

.proofread-type-card:hover {
  border-color: #6EE7B7;
  background: white;
}

.proofread-type-card--active {
  border-color: #10B981;
  background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.15);
}

.proofread-type-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #D1FAE5;
  color: #10B981;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.25s ease;
}

.proofread-type-card--active .proofread-type-card__icon {
  background: linear-gradient(135deg, #10B981, #059669);
  color: white;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
}

.proofread-type-card__content {
  flex: 1;
  min-width: 0;
}

.proofread-type-card__label {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 2px;
}

.proofread-type-card__desc {
  font-size: 11px;
  color: #94A3B8;
  line-height: 1.4;
}

.proofread-type-card__check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #10B981;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

/* ========== RULE_ONLY：执行策略 ========== */
.strategy-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.strategy-card {
  position: relative;
  padding: 16px 18px;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  background: #FAFBFC;
  cursor: pointer;
  transition: all 0.25s ease;
}

.strategy-card:hover {
  border-color: #FBBF24;
  background: white;
}

.strategy-card--active {
  border-color: #F59E0B;
  background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%);
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.15);
}

.strategy-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.strategy-card__header .el-icon {
  color: #F59E0B;
  font-size: 20px;
}

.strategy-card--active .strategy-card__header .el-icon {
  color: #D97706;
}

.strategy-card__title {
  font-size: 15px;
  font-weight: 700;
  color: #1E293B;
}

.strategy-card__desc {
  font-size: 13px;
  color: #64748B;
  line-height: 1.5;
  margin-bottom: 6px;
}

.strategy-card__meta {
  font-size: 11px;
  color: #D97706;
  font-weight: 600;
  background: #FEF3C7;
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
}

/* 高级选项 */
.advanced-section {
  margin-top: 16px;
  border-top: 1px solid #E5E7EB;
  padding-top: 12px;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #6B7280;
  user-select: none;
}

.advanced-toggle:hover {
  color: #374151;
}

.manual-mode-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #F59E0B;
  font-weight: 600;
}

.advanced-content {
  margin-top: 12px;
  padding: 16px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.advanced-hint {
  font-size: 13px;
  color: #6B7280;
  margin: 0 0 12px;
}

.mode-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pre-analyzing {
  padding: 24px;
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
  position: absolute;
  bottom: 0;
  right: 0;
  display: flex;
  gap: 12px;
  z-index: 100;
  padding: 16px 24px;
  background: transparent;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 10px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.action-btn:active {
  transform: translateY(0);
}

.action-btn--secondary {
  background: #F8FAFC;
  border-color: #E2E8F0;
  color: #475569;
}

.action-btn--secondary:hover {
  background: white;
  border-color: #CBD5E1;
  color: #1E293B;
}

.action-btn--primary {
  background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
  border-color: transparent;
  color: white;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
}

.action-btn--primary:hover {
  background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.45);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .floating-actions {
    left: 0;
    justify-content: center;
    padding: 12px 16px;
    gap: 10px;
  }

  .action-btn {
    padding: 9px 16px;
    font-size: 13px;
  }

  .action-btn .el-icon {
    display: none;
  }
}

@media (max-width: 480px) {
  .floating-actions {
    padding: 10px 12px;
    gap: 8px;
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
