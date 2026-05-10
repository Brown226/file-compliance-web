<template>
  <div class="task-results-view">
    <!-- 步骤条头部 -->
    <div class="step-header">
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

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-overlay">
      <el-icon class="is-loading" :size="48"><Loading /></el-icon>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>

    <!-- 主内容区：左右分栏 -->
    <div v-else class="main-content">
      <!-- 左侧：OnlyOffice编辑器 / 文件预览 -->
      <div class="left-panel">
        <div class="panel-header">
          <span class="hint-text">左侧为文件实时预览与编辑区。可选中文本后进行专项审查。</span>
        </div>
        <div class="editor-container">
          <!-- OnlyOffice编辑器（DOCX文件） -->
          <OnlyOfficeEditor
            v-if="isDocxFileSelected && selectedFileId"
            ref="onlyOfficeEditorRef"
            :fileId="selectedFileId"
          />
          <!-- DWG图纸预览 -->
          <DwgPreviewPanel
            v-else-if="isDwgFileSelected && !dwgParseFailed"
            :file="dwgFileForPreview"
            :locateTarget="dwgLocateTarget"
          />
          <!-- 其他文件：文本预览 -->
          <TextPreviewPanel
            v-else
            :taskId="taskId"
            :fileId="selectedFileId"
            :locateTarget="locateTarget"
          />
        </div>

        <!-- 最近采纳预览面板 -->
        <div v-if="selectedSuggestionPreview" class="adopt-preview-panel">
          <div class="preview-header">
            <span class="preview-title">最近采纳预览</span>
            <el-tag :type="selectedSuggestionPreview.status === 'success' ? 'success' : 'info'" size="small">
              {{ selectedSuggestionPreview.status }}
            </el-tag>
          </div>
          <div class="preview-content">
            <div class="preview-before">
              <p class="preview-label">采纳前原文</p>
              <div class="preview-text before">{{ selectedSuggestionPreview.before }}</div>
            </div>
            <div class="preview-after">
              <p class="preview-label">采纳后文本</p>
              <div class="preview-text after">{{ selectedSuggestionPreview.after }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：AI审查报告面板 -->
      <div class="right-panel">
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="header-left">
            <h3 class="panel-title">AI 审查报告</h3>
            <div class="plain-mode-switch">
              <span class="switch-label">大白话模式</span>
              <el-switch v-model="showPlainLanguage" size="small" />
            </div>
          </div>
          <div class="header-right">
            <el-button type="primary" link size="small" @click="handleExportWord">
              导出Word
            </el-button>
            <el-button type="primary" link size="small" @click="handleExportExcel">
              导出Excel
            </el-button>
            <el-button type="primary" link size="small" @click="goBack">
              返回历史
            </el-button>
          </div>
        </div>

        <!-- Tab导航 -->
        <div class="tab-navigation">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-item', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Tab内容区 -->
        <div class="tab-content">
          <!-- Tab 1: 审查概览 -->
          <div v-if="activeTab === 'overview'" class="tab-pane">
            <!-- 风险点/争议点 -->
            <div v-if="errorIssues.length > 0" class="issue-section">
              <h4 class="section-title">🔴 严重错误（{{ errorIssues.length }}条）</h4>
              <div v-for="(issue, index) in errorIssues.slice(0, 5)" :key="issue.id" class="issue-card">
                <p class="issue-title">{{ getIssueTitle(issue, index) }}</p>
                <div v-if="showPlainLanguage && issue.plainLanguage" class="plain-language-box">
                  <p class="plain-label">📢 大白话解释：</p>
                  <p>{{ issue.plainLanguage }}</p>
                </div>
                <div v-else class="issue-content">
                  <p class="issue-desc">{{ issue.description }}</p>
                </div>
              </div>
            </div>

            <!-- 违约成本分析（如果有） -->
            <div v-if="warningIssues.length > 0" class="issue-section warning-section">
              <h4 class="section-title">🟡 警告（{{ warningIssues.length }}条）</h4>
              <div v-for="(issue, index) in warningIssues.slice(0, 5)" :key="issue.id" class="issue-card warning">
                <p class="issue-title">{{ getIssueTitle(issue, index) }}</p>
                <p class="issue-desc">{{ issue.description }}</p>
              </div>
            </div>

            <el-empty v-if="allDetails.length === 0" description="审查通过，未发现任何问题" />
          </div>

          <!-- Tab 2: 问题明细（核心功能） -->
          <div v-if="activeTab === 'suggestions'" class="tab-pane">
            <!-- 批量操作工具栏 -->
            <div v-if="allDetails.length > 0" class="batch-toolbar">
              <el-checkbox
                v-model="selectAll"
                @change="handleSelectAll"
              >
                全选
              </el-checkbox>
              <div class="selected-info">
                已选择 {{ selectedIndexes.length }} 条
              </div>
              <el-button
                type="primary"
                size="small"
                :disabled="selectedIndexes.length === 0 || batchApplying"
                @click="handleBatchAdopt"
              >
                {{ batchApplying ? '批量采纳中...' : '一键采纳所选' }}
              </el-button>
            </div>

            <!-- 问题卡片列表 -->
            <div v-if="allDetails.length > 0" class="suggestions-list">
              <div
                v-for="(item, index) in allDetails"
                :key="item.id || index"
                :class="['suggestion-card', { adopted: item.adopted }]"
              >
                <!-- 卡片头部：标题 + 操作按钮 -->
                <div class="card-header">
                  <div class="card-title-wrap">
                    <el-checkbox
                      :model-value="selectedIndexes.includes(index)"
                      @change="(val: boolean) => toggleSelect(index, val)"
                      class="card-checkbox"
                    />
                    <p class="card-title">{{ getIssueTitle(item, index) }}</p>
                  </div>
                  <div class="card-actions">
                    <el-tooltip content="在文档中定位" placement="top">
                      <el-button
                        type="primary"
                        link
                        size="small"
                        @click="handleLocateText(item)"
                      >
                        <el-icon><Search /></el-icon>
                      </el-button>
                    </el-tooltip>
                    <el-tooltip content="标记误报" placement="top">
                      <el-button
                        type="warning"
                        link
                        size="small"
                        @click="handleFalsePositive(item)"
                      >
                        <el-icon><WarningFilled /></el-icon>
                      </el-button>
                    </el-tooltip>
                  </div>
                </div>

                <!-- 大白话模式展示 -->
                <div v-if="showPlainLanguage && item.plainLanguage" class="plain-language-box">
                  <p class="plain-label">📢 大白话建议：</p>
                  <p>{{ item.plainLanguage }}</p>
                </div>

                <!-- 原文 + 建议 + 理由 -->
                <div v-else class="suggestion-detail">
                  <div v-if="item.originalText" class="detail-block">
                    <p class="block-label">原文：</p>
                    <blockquote class="original-text">{{ item.originalText }}</blockquote>
                  </div>
                  <div v-if="item.suggestedText" class="detail-block">
                    <p class="block-label">建议：</p>
                    <blockquote
                      :class="['suggested-text', { adopted: item.adopted }]"
                      :title="item.adopted ? `采纳前：${item.originalText}` : ''"
                    >
                      {{ item.suggestedText }}
                    </blockquote>
                  </div>
                  <div v-if="item.description" class="detail-block">
                    <p class="block-label">理由：</p>
                    <p class="reason-text">{{ item.description }}</p>
                  </div>
                </div>

                <!-- 卡片底部操作 -->
                <div class="card-footer">
                  <el-button
                    type="primary"
                    plain
                    size="small"
                    @click="handlePreviewSuggestion(item)"
                  >
                    查看变更
                  </el-button>
                  <el-button
                    type="primary"
                    size="small"
                    :disabled="item.adopted"
                    @click="handleAdoptSuggestion(item)"
                  >
                    <el-icon v-if="!item.adopted"><Check /></el-icon>
                    {{ item.adopted ? '已采纳' : '一键采纳建议' }}
                  </el-button>
                </div>
              </div>
            </div>

            <el-empty v-else description="未发现修改建议" />
          </div>

          <!-- Tab 3: 依据（标准引用/法律法条） -->
          <div v-if="activeTab === 'knowledge'" class="tab-pane">
            <div v-if="standardRefIssues.length > 0" class="knowledge-list">
              <div
                v-for="(item, index) in standardRefIssues"
                :key="item.id || index"
                class="knowledge-card"
              >
                <div class="knowledge-header">
                  <p class="knowledge-title">
                    {{ getStandardRefTitle(item) }}
                  </p>
                  <el-tag
                    type="success"
                    size="small"
                  >
                    当前可参考
                  </el-tag>
                </div>
                <p class="knowledge-content">{{ item.description }}</p>
              </div>
            </div>
            <el-empty v-else description="未命中相关标准引用" />
          </div>

          <!-- Tab 4: 工作台 -->
          <div v-if="activeTab === 'workspace'" class="tab-pane">
            <div class="workspace-content">
              <!-- 合同版本对比 -->
              <div class="workspace-section">
                <div class="section-header">
                  <h4 class="section-title">合同版本对比</h4>
                  <el-button
                    type="primary"
                    plain
                    size="small"
                    :loading="diffLoading"
                    @click="loadLatestDiff"
                  >
                    {{ diffLoading ? '加载中...' : '查看最近变更' }}
                  </el-button>
                </div>
                <div v-if="diffItems.length" class="diff-content">
                  <template v-for="(part, index) in diffItems" :key="index">
                    <span v-if="part.type === 'insert'" class="diff-insert">{{ part.text }}</span>
                    <span v-else-if="part.type === 'delete'" class="diff-delete">{{ part.text }}</span>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </div>
                <p v-else class="diff-placeholder">
                  采纳修改后会自动保存原始快照，可在这里查看新增和删除文本。
                </p>
              </div>

              <!-- 选中文本专项审查 -->
              <div class="workspace-section">
                <div class="section-header">
                  <h4 class="section-title">选中文本专项审查</h4>
                  <el-button
                    type="primary"
                    size="small"
                    @click="prepareFocusedReviewFromSelection"
                  >
                    从左侧读取选中文本
                  </el-button>
                </div>
                <el-input
                  v-model="focusedReviewText"
                  type="textarea"
                  :rows="6"
                  placeholder="可从左侧 OnlyOffice 选中文本后读取，也可手动粘贴某一条款或段落"
                  class="mt-3"
                />
                <el-input
                  v-model="focusedReviewQuestion"
                  placeholder="专项问题，例如：审查这段试用期条款是否合法，并给出可替换文本"
                  class="mt-3"
                />
                <div class="section-footer">
                  <el-button
                    type="primary"
                    :loading="focusedReviewLoading"
                    :disabled="!focusedReviewText.trim()"
                    @click="submitFocusedReview"
                  >
                    {{ focusedReviewLoading ? '审查中...' : '开始专项审查' }}
                  </el-button>
                </div>
              </div>

              <!-- 专项审查结果 -->
              <div v-if="focusedReviewResult" class="workspace-section result-section">
                <h4 class="section-title">专项审查结论</h4>
                <p class="result-text">{{ focusedReviewResult.risk_summary }}</p>
                
                <div v-if="focusedReviewResult.plain_language" class="plain-language-result">
                  <p class="plain-label">大白话说明</p>
                  <p>{{ focusedReviewResult.plain_language }}</p>
                </div>

                <div v-if="focusedReviewResult.suggested_text" class="suggestion-result">
                  <p class="suggestion-label">建议替换文本</p>
                  <div class="suggestion-text">{{ focusedReviewResult.suggested_text }}</div>
                  <el-button
                    type="primary"
                    size="small"
                    class="mt-3"
                    @click="applyFocusedSuggestion"
                  >
                    替换左侧选中文本
                  </el-button>
                </div>

                <div v-if="focusedReviewResult.relevant_laws?.length" class="laws-result">
                  <p class="laws-label">检索依据</p>
                  <div
                    v-for="(item, index) in focusedReviewResult.relevant_laws"
                    :key="index"
                    class="law-item"
                  >
                    <p><strong>【{{ item.law }}】</strong>{{ item.clause }}：{{ item.content }}</p>
                  </div>
                </div>
              </div>

              <!-- 重审表单 -->
              <div class="workspace-section re-review-form">
                <div class="form-group">
                  <label class="form-label">合同类型</label>
                  <el-input v-model="preAnalysisData.contract_type" />
                </div>
                <div class="form-group">
                  <label class="form-label">审查立场</label>
                  <el-select
                    v-model="perspective"
                    placeholder="请选择或输入您的立场"
                    class="w-full"
                    filterable
                    allow-create
                  >
                    <el-option
                      v-for="party in allPotentialParties"
                      :key="party"
                      :label="party"
                      :value="party"
                    />
                  </el-select>
                </div>
                <div class="form-group">
                  <label class="form-label">审查点选择</label>
                  <div class="review-points-wrapper">
                    <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group">
                      <el-checkbox
                        v-for="point in allSuggestedReviewPoints"
                        :key="point"
                        :label="point"
                        :value="point"
                        border
                      >
                        {{ point }}
                      </el-checkbox>
                    </el-checkbox-group>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">审查核心目的</label>
                  <div
                    v-for="(purpose, index) in customPurposes"
                    :key="index"
                    class="purpose-row"
                  >
                    <el-autocomplete
                      v-model="purpose.value"
                      :fetch-suggestions="querySearchCorePurposes"
                      placeholder="搜索或输入新目的"
                      class="w-full"
                      trigger-on-focus
                    />
                    <el-button
                      type="danger"
                      link
                      class="purpose-remove-btn"
                      @click="removePurpose(index)"
                    >
                      <el-icon><Remove /></el-icon>
                    </el-button>
                  </div>
                  <el-button
                    type="primary"
                    link
                    class="add-purpose-btn"
                    @click="addPurpose"
                  >
                    <el-icon class="mr-1"><CirclePlus /></el-icon>
                    添加目的
                  </el-button>
                </div>
                <div class="form-actions">
                  <el-button
                    type="primary"
                    :loading="reAnalyzing"
                    :disabled="!perspective || selectedReviewPoints.length === 0 || reAnalyzing"
                    class="w-full"
                    @click="startReAnalysis"
                  >
                    {{ reAnalyzing ? '正在重审...' : '确认重审' }}
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 误报标记对话框 -->
    <FalsePositiveDialog
      v-model="fpDialogVisible"
      :submitting="fpSubmitting"
      @confirm="handleConfirmFalsePositive"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Search,
  WarningFilled,
  Check,
  Remove,
  CirclePlus,
} from '@element-plus/icons-vue'
import {
  getTaskByIdApi,
  getTaskDetailsApi,
  exportTaskReportApi,
  exportTaskReportWordApi,
  toggleFalsePositiveApi,
} from '@/api/task'
import { replaceTextApi } from '@/api/onlyoffice'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import OnlyOfficeEditor from '@/components/OnlyOfficeEditor.vue'
import DwgPreviewPanel from '@/views/TaskDetails/DwgPreviewPanel.vue'
import TextPreviewPanel from '@/views/TaskDetails/TextPreviewPanel.vue'
import FalsePositiveDialog from '@/views/TaskDetails/FalsePositiveDialog.vue'

const route = useRoute()
const router = useRouter()

// ===== 基础状态 =====
const taskId = computed(() => route.params.id as string)
const task = ref<Task | null>(null)
const allDetails = ref<TaskDetail[]>([])
const files = ref<TaskFile[]>([])
const loading = ref(false)
const loadingMessage = ref('正在加载审查结果...')
const currentStep = ref(2)
const activeTab = ref('suggestions')
const showPlainLanguage = ref(false)

// ===== 文件预览相关 =====
const selectedFileId = ref<string | null>(null)
const locateTarget = ref<{ originalText: string; textPosition: any; cadHandleId?: string } | null>(null)
const onlyOfficeEditorRef = ref<InstanceType<typeof OnlyOfficeEditor> | null>(null)

const isDocxFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  const ft = (file?.fileType || file?.file_type || '').toLowerCase()
  return ft === 'docx' || ft === 'doc'
})

const isDwgFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  return file?.fileType === 'dwg' || file?.file_type === 'dwg'
})

const dwgFileForPreview = ref<File | null>(null)
const dwgParseFailed = ref(false)
const dwgLocateTarget = computed(() => {
  if (!locateTarget.value) return null
  return {
    cadHandleId: locateTarget.value.cadHandleId,
    originalText: locateTarget.value.originalText,
    description: '',
  }
})

// ===== Tab 配置 =====
const tabs = [
  { key: 'overview', label: '审查概览' },
  { key: 'suggestions', label: '问题明细' },
  { key: 'knowledge', label: '依据' },
  { key: 'workspace', label: '工作台' },
]

// ===== 采纳预览 =====
const selectedSuggestionPreview = ref<{
  before: string
  after: string
  status: string
} | null>(null)

// ===== 批量操作 =====
const selectAll = ref(false)
const selectedIndexes = ref<number[]>([])
const batchApplying = ref(false)

// ===== 误报标记 =====
const fpDialogVisible = ref(false)
const fpSubmitting = ref(false)
const fpTargetDetail = ref<TaskDetail | null>(null)

// ===== 数据过滤 =====
const errorIssues = computed(() => allDetails.value.filter((d: any) => d.severity === 'error'))
const warningIssues = computed(() => allDetails.value.filter((d: any) => d.severity === 'warning'))
const infoIssues = computed(() => allDetails.value.filter((d: any) => d.severity === 'info'))
const standardRefIssues = computed(() => allDetails.value.filter((d: any) => d.standardRef || d.standardRefId))

// ===== 工作台功能 =====
const focusedReviewText = ref('')
const focusedReviewQuestion = ref('')
const focusedReviewResult = ref<any>(null)
const focusedReviewLoading = ref(false)
const diffItems = ref<any[]>([])
const diffLoading = ref(false)
const reAnalyzing = ref(false)

// ===== 重审表单 =====
const perspective = ref('')
const allPotentialParties = ref<string[]>([])
const allSuggestedReviewPoints = ref<string[]>([])
const allSuggestedCorePurposes = ref<string[]>([])
const selectedReviewPoints = ref<string[]>([])
const customPurposes = ref<Array<{ value: string }>>([{ value: '' }])
const preAnalysisData = reactive({
  contract_type: '',
  potential_parties: [] as string[],
  suggested_review_points: [] as string[],
  suggested_core_purposes: [] as string[],
  template_id: '',
  template_name: '',
})

// ===== 工具函数 =====
const getIssueTitle = (item: TaskDetail, index: number): string => {
  return item.description?.slice(0, 50) || `问题 ${index + 1}`
}

const getStandardRefTitle = (item: TaskDetail): string => {
  const ref = item.standardRef || item.standardRefId
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object') {
    return (ref as any).standardName || (ref as any).name || '标准引用'
  }
  return '标准引用'
}

const getIssueTypeLabel = (type: string): string => {
  const m: Record<string, string> = {
    TYPO: '错别字',
    VIOLATION: '合规违规',
    NAMING: '命名规范',
    ENCODING: '编码一致性',
    ATTRIBUTE: '封面属性',
    HEADER: '页眉检查',
    PAGE: '页码检查',
    SCAN: '图纸扫描',
    TEMPLATE: '模板统一',
    FORMAT: '格式规范',
    COMPLETENESS: '数据完整性',
    CONSISTENCY: '一致性',
    LAYOUT: '排版布局',
    STD_REF: '标准引用',
  }
  return m[type] || type
}

const getCategoryTagType = (type: string): any => {
  const m: Record<string, any> = {
    TYPO: 'warning',
    VIOLATION: 'danger',
    NAMING: '',
    ENCODING: 'danger',
    ATTRIBUTE: 'warning',
    HEADER: 'success',
    PAGE: 'info',
    SCAN: 'info',
    TEMPLATE: 'warning',
    FORMAT: 'warning',
    COMPLETENESS: 'danger',
    CONSISTENCY: 'info',
    LAYOUT: 'info',
    STD_REF: 'warning',
  }
  return m[type] || 'info'
}

// ===== 数据加载 =====
const fetchData = async () => {
  loading.value = true
  try {
    const [taskRes, detailsRes] = await Promise.all([
      getTaskByIdApi(taskId.value),
      getTaskDetailsApi(taskId.value),
    ])
    task.value = taskRes.data
    const rawDetails = detailsRes.data as any
    const detailsData = rawDetails?.details || rawDetails || []
    allDetails.value = (Array.isArray(detailsData) ? detailsData : []).map((d: any) => ({
      id: d.id,
      issueType: d.issueType,
      ruleCode: d.ruleCode,
      severity: d.severity,
      originalText: d.originalText,
      suggestedText: d.suggestedText,
      description: d.description,
      plainLanguage: d.plainLanguage || null,
      cadHandleId: d.cadHandleId,
      standardRefId: d.standardRefId,
      standardRef: d.standardRef,
      fileId: d.fileId,
      file: d.file,
      isFalsePositive: d.isFalsePositive || false,
      adopted: d.adopted || false,
      taskId: d.taskId || taskId.value,
      taskFileId: d.taskFileId || '',
    }))
    files.value = task.value?.files || []

    // 默认选中第一个文件
    if (files.value.length > 0 && !selectedFileId.value) {
      selectedFileId.value = files.value[0].id
    }
  } catch (e: any) {
    ElMessage.error('加载审查结果失败')
    console.error(e)
  } finally {
    loading.value = false
  }
}

// ===== 操作函数 =====
const handleLocateText = (item: TaskDetail) => {
  locateTarget.value = {
    originalText: item.originalText || '',
    textPosition: item.textPosition || null,
    cadHandleId: item.cadHandleId,
  }
}

const handleAdoptSuggestion = async (item: TaskDetail) => {
  if (!item.fileId || !item.originalText || !item.suggestedText) {
    ElMessage.warning('缺少替换信息')
    return
  }

  try {
    const res = await replaceTextApi(item.fileId, {
      originalText: item.originalText,
      suggestedText: item.suggestedText,
    })

    const result = res.data
    if (result.replacements > 0) {
      item.adopted = true
      ElMessage.success(`已采纳建议（替换了 ${result.replacements} 处）`)

      // 更新采纳预览
      selectedSuggestionPreview.value = {
        before: item.originalText,
        after: item.suggestedText,
        status: 'success',
      }

      // 刷新编辑器
      onlyOfficeEditorRef.value?.refresh()
    } else {
      ElMessage.warning('未找到匹配的文本，请手动替换')
    }
  } catch (e: any) {
    const msg = e?.response?.data?.message || '采纳建议失败'
    ElMessage.error(msg)
  }
}

const handlePreviewSuggestion = (item: TaskDetail) => {
  selectedSuggestionPreview.value = {
    before: item.originalText || '',
    after: item.suggestedText || '',
    status: 'preview',
  }
}

const handleFalsePositive = (item: TaskDetail) => {
  fpTargetDetail.value = item
  fpDialogVisible.value = true
}

const handleConfirmFalsePositive = async (reason: string) => {
  if (!fpTargetDetail.value) return
  fpSubmitting.value = true
  try {
    await toggleFalsePositiveApi(fpTargetDetail.value.id, {
      isFalsePositive: true,
      reason: reason || undefined,
    })
    const detail = allDetails.value.find((d: any) => d.id === fpTargetDetail.value!.id)
    if (detail) {
      detail.isFalsePositive = true
    }
    ElMessage.success('已标记为误报')
    fpDialogVisible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '标记误报失败')
  } finally {
    fpSubmitting.value = false
  }
}

// ===== 批量操作 =====
const toggleSelect = (index: number, checked: boolean) => {
  if (checked) {
    if (!selectedIndexes.value.includes(index)) {
      selectedIndexes.value.push(index)
    }
  } else {
    selectedIndexes.value = selectedIndexes.value.filter(i => i !== index)
  }
}

const handleSelectAll = (val: boolean) => {
  if (val) {
    selectedIndexes.value = allDetails.value.map((_, i) => i)
  } else {
    selectedIndexes.value = []
  }
}

const handleBatchAdopt = async () => {
  if (selectedIndexes.value.length === 0) return

  batchApplying.value = true
  let successCount = 0
  let failCount = 0

  for (const idx of selectedIndexes.value) {
    const item = allDetails.value[idx]
    if (!item.adopted && item.suggestedText) {
      try {
        await handleAdoptSuggestion(item)
        successCount++
      } catch {
        failCount++
      }
    }
  }

  batchApplying.value = false
  ElMessage.success(`批量完成：成功 ${successCount} 条，失败 ${failCount} 条`)
  selectedIndexes.value = []
  selectAll.value = false
}

// ===== 导出功能 =====
const handleExportWord = async () => {
  try {
    const res = await exportTaskReportWordApi(taskId.value)
    const blob = res.data
    if (!blob || blob.size === 0) {
      ElMessage.warning('暂无可导出的内容')
      return
    }
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${task.value?.title || '审查报告'}_Word版.docx`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('Word导出成功')
  } catch (e) {
    ElMessage.error('导出Word失败')
  }
}

const handleExportExcel = async () => {
  try {
    const res = await exportTaskReportApi(taskId.value)
    const blob = res.data
    if (!blob || blob.size === 0) {
      ElMessage.warning('暂无可导出的内容')
      return
    }
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${task.value?.title || '审查报告'}_Excel版.xlsx`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('Excel导出成功')
  } catch (e) {
    ElMessage.error('导出Excel失败')
  }
}

// ===== 工作台功能 =====
const loadLatestDiff = async () => {
  activeTab.value = 'workspace'
  diffLoading.value = true
  try {
    // TODO: 调用后端API获取最新的diff
    // const res = await getTaskDiffApi(taskId.value)
    // diffItems.value = res.data.diffItems || []
    
    // 临时模拟数据
    diffItems.value = [
      { type: 'delete', text: '原文被删除的部分' },
      { type: 'insert', text: '新文本插入的部分' },
    ]
    
    ElMessage.success('已加载最近变更')
  } catch (e: any) {
    ElMessage.info(e?.response?.data?.message || '暂无可对比的合同版本')
  } finally {
    diffLoading.value = false
  }
}

const prepareFocusedReviewFromSelection = async () => {
  activeTab.value = 'workspace'
  if (!onlyOfficeEditorRef.value) {
    ElMessage.warning('编辑器未就绪')
    return
  }

  try {
    // 尝试从 OnlyOffice 获取选中文本
    const editor = onlyOfficeEditorRef.value as any
    const selectedText = await editor.getSelectedText?.()
    
    if (selectedText && selectedText.trim()) {
      focusedReviewText.value = selectedText.trim()
      ElMessage.success('已读取左侧选中文本')
    } else {
      ElMessage.info('未读取到选中文本，可在专项审查框中手动粘贴条款')
    }
  } catch (error) {
    ElMessage.info('当前 OnlyOffice 版本未暴露选中文本接口，请手动粘贴条款进行专项审查')
  }
}

const submitFocusedReview = async () => {
  if (!focusedReviewText.value.trim()) {
    ElMessage.warning('请输入需要审查的文本')
    return
  }

  focusedReviewLoading.value = true
  try {
    // TODO: 调用专项审查API
    // const response = await reviewSelectedTextApi({
    //   text: focusedReviewText.value,
    //   question: focusedReviewQuestion.value,
    //   perspective: perspective.value,
    //   contractType: preAnalysisData.contract_type,
    // })
    // focusedReviewResult.value = res.data
    
    // 临时模拟数据
    focusedReviewResult.value = {
      risk_summary: '该条款存在以下风险：1. 违约责任约定不明确；2. 缺少争议解决条款；3. 赔偿上限设置过低。',
      plain_language: '大白话：这条款对您不太有利，建议增加明确的违约责任和争议解决方式。',
      suggested_text: '建议修改为：如一方违约，应承担违约责任，并向守约方赔偿因此造成的全部损失。争议应提交甲方所在地人民法院管辖。',
      relevant_laws: [
        {
          law: '《民法典》',
          clause: '第五百七十七条',
          content: '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。',
        },
      ],
    }
    
    ElMessage.success('专项审查完成')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '专项审查失败，请稍后重试')
  } finally {
    focusedReviewLoading.value = false
  }
}

const applyFocusedSuggestion = async () => {
  if (!focusedReviewResult.value?.suggested_text) {
    ElMessage.warning('没有可应用的建议')
    return
  }

  const originalText = focusedReviewText.value
  const suggestedText = focusedReviewResult.value.suggested_text

  try {
    // 尝试实时替换到 OnlyOffice 编辑器
    if (onlyOfficeEditorRef.value && originalText) {
      const editor = onlyOfficeEditorRef.value as any
      await editor.replaceText?.(originalText, suggestedText)

      selectedSuggestionPreview.value = {
        before: originalText,
        after: suggestedText,
        status: '专项审查建议已替换到左侧文档',
      }

      focusedReviewText.value = suggestedText
      ElMessage.success('专项审查建议已更新到左侧文档')
    } else {
      // 编辑器中未匹配到原文，仍然展示预览
      selectedSuggestionPreview.value = {
        before: originalText,
        after: suggestedText,
        status: '未连接到编辑器，建议已展示在预览区',
      }
      ElMessage.warning('未连接到编辑器，请在文档中手动替换')
    }
  } catch (e: any) {
    // 无论成功或失败，都更新采纳预览面板
    selectedSuggestionPreview.value = {
      before: originalText,
      after: suggestedText,
      status: e?.response?.data?.message || e?.message || '应用建议失败',
    }
    ElMessage.error(e?.response?.data?.message || '应用建议失败，请手动替换')
  }
}

// ===== 重审表单功能 =====
const addPurpose = () => {
  customPurposes.value.push({ value: '' })
}

const removePurpose = (index: number) => {
  customPurposes.value.splice(index, 1)
}

const querySearchCorePurposes = (queryString: string, cb: (results: Array<{ value: string }>) => void) => {
  const results = queryString
    ? allSuggestedCorePurposes.value.filter((p: string) => p.toLowerCase().includes(queryString.toLowerCase()))
    : allSuggestedCorePurposes.value
  cb(results.map((p: string) => ({ value: p })))
}

const startReAnalysis = async () => {
  if (!perspective.value) {
    ElMessage.warning('请选择您的审查立场')
    return
  }

  reAnalyzing.value = true
  try {
    // TODO: 调用后端重审API
    // const analysisPayload = {
    //   taskId: taskId.value,
    //   perspective: perspective.value,
    //   preAnalysisData: {
    //     contract_type: preAnalysisData.contract_type,
    //     potential_parties: allPotentialParties.value,
    //     suggested_review_points: allSuggestedReviewPoints.value,
    //     suggested_core_purposes: allSuggestedCorePurposes.value,
    //     reviewPoints: selectedReviewPoints.value,
    //     core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
    //   },
    // }
    // const res = await reAnalyzeTaskApi(analysisPayload)

    // 临时模拟
    await new Promise(resolve => setTimeout(resolve, 2000))
    ElMessage.success('重审完成！')
    activeTab.value = 'suggestions' // 切换到问题明细查看结果
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '重审失败，请稍后重试')
  } finally {
    reAnalyzing.value = false
  }
}

const goBack = () => {
  router.push('/tasks/history')
}

// ===== 生命周期 =====
onMounted(() => {
  fetchData()
})

onUnmounted(() => {
  // 清理资源
})
</script>

<style scoped>
.task-results-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
}

/* 步骤条 */
.step-header {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: white;
  border-bottom: 1px solid #E5E7EB;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #D1D5DB;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #9CA3AF;
}

.step-item.active .step-circle {
  border-color: #3B82F6;
  color: #3B82F6;
}

.step-item.completed .step-circle {
  background: #10B981;
  border-color: #10B981;
  color: white;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
  color: #9CA3AF;
}

.step-item.active .step-label {
  color: #3B82F6;
}

.step-item.completed .step-label {
  color: #10B981;
}

.step-line {
  flex: 1;
  height: 2px;
  background: #D1D5DB;
  margin: 0 12px;
}

.step-line.active {
  background: #3B82F6;
}

/* 加载状态 */
.loading-overlay {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #909399;
}

.loading-text {
  font-size: 14px;
}

/* 主内容区 */
.main-content {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}

/* 左侧面板 */
.left-panel {
  flex: 2;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
}

.hint-text {
  font-size: 12px;
  color: #6B7280;
}

.editor-container {
  flex: 1;
  overflow: hidden;
}

.adopt-preview-panel {
  border-top: 1px solid #E5E7EB;
  padding: 12px 16px;
  max-height: 180px;
  overflow-y: auto;
  background: #F9FAFB;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.preview-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.preview-label {
  font-size: 11px;
  color: #6B7280;
  margin-bottom: 4px;
  font-weight: 500;
}

.preview-text {
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.preview-text.before {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #991B1B;
}

.preview-text.after {
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  color: #166534;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #E5E7EB;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.plain-mode-switch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.switch-label {
  font-size: 12px;
  color: #6B7280;
}

.header-right {
  display: flex;
  gap: 8px;
}

/* Tab导航 */
.tab-navigation {
  display: flex;
  border-bottom: 1px solid #E5E7EB;
  padding: 0 16px;
}

.tab-item {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-item:hover {
  color: #3B82F6;
}

.tab-item.active {
  color: #3B82F6;
  border-bottom-color: #3B82F6;
}

/* Tab内容 */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #E5E7EB;
}

/* 问题卡片 */
.issue-section {
  margin-bottom: 20px;
}

.issue-card {
  padding: 12px;
  background: #FEF2F2;
  border-radius: 6px;
  border: 1px solid #FECACA;
  border-left: 3px solid #EF4444;
  margin-bottom: 8px;
}

.issue-card.warning {
  background: #FFFBEB;
  border-color: #FDE68A;
  border-left-color: #F59E0B;
}

.issue-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 6px;
}

.issue-desc {
  font-size: 12px;
  color: #6B7280;
  margin: 0;
  line-height: 1.6;
}

/* 大白话模式 */
.plain-language-box {
  padding: 12px;
  background: #EFF6FF;
  border-radius: 6px;
  border-left: 3px solid #3B82F6;
  margin-bottom: 8px;
}

.plain-label {
  font-size: 11px;
  font-weight: 700;
  color: #1E40AF;
  margin: 0 0 6px;
}

.plain-language-box p {
  font-size: 12px;
  color: #1E3A5F;
  margin: 0;
  line-height: 1.6;
}

/* 批量工具栏 */
.batch-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  margin-bottom: 12px;
  border-bottom: 1px solid #E5E7EB;
}

.selected-info {
  font-size: 12px;
  color: #6B7280;
}

/* 建议卡片列表 */
.suggestions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.suggestion-card {
  padding: 16px;
  background: white;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  transition: all 0.2s;
}

.suggestion-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.suggestion-card.adopted {
  background: #F0FDF4;
  border-color: #BBF7D0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 0;
}

.card-actions {
  display: flex;
  gap: 4px;
}

.suggestion-detail {
  margin-bottom: 12px;
}

.detail-block {
  margin-bottom: 8px;
}

.block-label {
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 4px;
}

.original-text {
  padding: 8px;
  background: #FEF2F2;
  border-left: 3px solid #EF4444;
  color: #991B1B;
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
  border-radius: 4px;
}

.suggested-text {
  padding: 8px;
  background: #F0FDF4;
  border-left: 3px solid #10B981;
  color: #166534;
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
  border-radius: 4px;
}

.suggested-text.adopted {
  background: white;
  border-left-color: #D1D5DB;
  color: #6B7280;
}

.reason-text {
  font-size: 12px;
  color: #6B7280;
  margin: 0;
  line-height: 1.6;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #E5E7EB;
}

/* 知识库卡片 */
.knowledge-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-card {
  padding: 12px;
  background: #EFF6FF;
  border-radius: 6px;
  border: 1px solid #BFDBFE;
}

.knowledge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.knowledge-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E40AF;
  margin: 0;
}

.knowledge-content {
  font-size: 12px;
  color: #374151;
  line-height: 1.6;
  margin: 0;
}

/* 统计分析 */
.analytics-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
}

.stat-card.total {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.stat-card.error {
  background: #FEF2F2;
  border-color: #FECACA;
}

.stat-card.warning {
  background: #FFFBEB;
  border-color: #FDE68A;
}

.stat-card.info {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-card.total .stat-number {
  color: #3B82F6;
}

.stat-card.error .stat-number {
  color: #EF4444;
}

.stat-card.warning .stat-number {
  color: #F59E0B;
}

.stat-card.info .stat-number {
  color: #3B82F6;
}

.stat-label {
  font-size: 12px;
  color: #6B7280;
}

.analytics-section {
  margin-bottom: 24px;
}

.severity-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.severity-bar-item {
  display: grid;
  grid-template-columns: 60px 1fr 100px;
  align-items: center;
  gap: 12px;
}

.severity-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.severity-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.severity-bar-track {
  height: 8px;
  background: #F3F4F6;
  border-radius: 4px;
  overflow: hidden;
}

.severity-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.severity-count {
  font-size: 12px;
  color: #6B7280;
  text-align: right;
}

.category-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.category-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
}

.category-count {
  font-size: 13px;
  font-weight: 600;
  color: #3B82F6;
}

/* 工作台样式 */
.workspace-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workspace-section {
  padding: 16px;
  background: white;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.diff-content {
  padding: 12px;
  background: #F9FAFB;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.8;
  max-height: 224px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.diff-insert {
  background: #DCFCE7;
  color: #166534;
  padding: 2px 4px;
  border-radius: 3px;
}

.diff-delete {
  background: #FEE2E2;
  color: #991B1B;
  padding: 2px 4px;
  border-radius: 3px;
  text-decoration: line-through;
}

.diff-placeholder {
  font-size: 12px;
  color: #9CA3AF;
  text-align: center;
  padding: 16px;
}

.result-section {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.result-text {
  font-size: 13px;
  color: #374151;
  line-height: 1.8;
  margin: 0;
}

.plain-language-result {
  margin-top: 12px;
  padding: 12px;
  background: #EFF6FF;
  border-radius: 6px;
  border-left: 3px solid #3B82F6;
}

.suggestion-result {
  margin-top: 12px;
}

.suggestion-label {
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 8px;
}

.suggestion-text {
  padding: 12px;
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  border-radius: 6px;
  color: #166534;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.laws-result {
  margin-top: 12px;
}

.laws-label {
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 8px;
}

.law-item {
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  margin-bottom: 8px;
  font-size: 12px;
  color: #374151;
  line-height: 1.6;
}

.law-item p {
  margin: 0;
}

/* 重审表单样式 */
.re-review-form {
  background: #F9FAFB;
  border-color: #D1D5DB;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.review-points-wrapper {
  padding: 12px;
  background: #F9FAFB;
  border-radius: 6px;
}

.review-points-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.purpose-row {
  display: flex;
  align-items: center;
  margin-top: 8px;
  gap: 8px;
}

.purpose-remove-btn {
  color: #9CA3AF;
}

.purpose-remove-btn:hover {
  color: #EF4444;
}

.add-purpose-btn {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.form-actions {
  padding-top: 16px;
}

/* 工具类 */
.w-full {
  width: 100%;
}

.mr-1 {
  margin-right: 4px;
}

.mt-3 {
  margin-top: 12px;
}

/* 响应式 */
@media (max-width: 1200px) {
  .main-content {
    flex-direction: column;
  }

  .left-panel,
  .right-panel {
    flex: none;
    height: 50vh;
  }

  .analytics-overview {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
