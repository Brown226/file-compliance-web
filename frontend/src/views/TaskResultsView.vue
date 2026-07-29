<template>
  <div class="task-results-view">
    <!-- 步骤条头部（仅在新任务流程中显示；本组件专用于 /review/:id 历史记录入口，故默认隐藏） -->
    <!-- <div class="step-header">
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
    </div> -->

    <!-- 加载状态（仅首屏加载时显示，不阻塞审查中结果页） -->
    <div v-if="loading && !reviewing" class="loading-overlay">
      <el-icon class="is-loading" :size="48"><Loading /></el-icon>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>

    <!-- 主内容区：左右分栏 -->
    <div class="main-content">
      <!-- OCR 降级告警横幅 -->
      <div v-if="ocrDegradedFiles.length > 0" class="ocr-degraded-banner">
        <el-alert
          :title="`OCR 服务不可用：${ocrDegradedFiles.length} 个文件为扫描件但未能识别图片中的文字`"
          type="warning"
          show-icon
          :closable="true"
          @close="ocrDegradedFiles = []"
        >
          <template #default>
            <div style="margin-top:4px; font-size:13px;">
              <div v-for="f in ocrDegradedFiles" :key="f" style="margin-bottom:2px;">
                ⚠️ {{ f }}
              </div>
              <p style="margin:4px 0 0; color:#856404;">请手动检查这些文件中可能的合规问题。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- OPT-027: RAG 降级告警横幅 -->
      <div v-if="ragDegradedFiles.length > 0" class="ocr-degraded-banner">
        <el-alert
          :title="`知识库检索降级：${ragDegradedFiles.length} 个文件的审查未使用 RAG 检索`"
          type="info"
          show-icon
          :closable="true"
          @close="ragDegradedFiles = []"
        >
          <template #default>
            <div style="margin-top:4px; font-size:13px;">
              <div v-for="f in ragDegradedFiles" :key="f" style="margin-bottom:2px;">
                ⚠️ {{ f }}
              </div>
              <p style="margin:4px 0 0; color:#0c5460;">RAG 不可用，已切换为 LLM 直审，结果可信度可能降低。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- 左侧：文件预览 -->
      <div class="left-panel" :style="leftPanelStyle" ref="leftPanel">
        <div class="panel-header">
          <!-- 文件切换 Tab -->
          <div class="file-tabs" v-if="files.length > 1">
            <button
              v-for="f in files"
              :key="f.id"
              :class="['file-tab', { active: selectedFileId === f.id }]"
              @click="selectFile(f.id)"
              :title="f.fileName"
            >
              <span class="file-tab-icon"><el-icon :size="14"><component :is="getFileIconComponent(f.fileType)" /></el-icon></span>
              <span class="file-tab-name">{{ f.fileName }}</span>
              <span class="file-tab-count" v-if="getFileIssueCount(f.id) > 0">{{ getFileIssueCount(f.id) }}</span>
            </button>
          </div>
          <div v-else-if="files.length === 0" class="empty-file-hint">
            <el-icon :size="24" color="#C0C4CC"><FolderOpened /></el-icon>
            <span>暂无文件，请先上传文档</span>
          </div>
          <span v-else class="hint-text"><el-icon :size="14"><Document /></el-icon> 文件预览区 · 选中文本可进行专项审查</span>
        </div>

        <!-- OPT-011: 封面结构化信息卡片（PDF 图片封面页 OCR 提取） -->
        <div v-if="selectedFile?.coverInfo" class="cover-info-card">
          <el-collapse>
            <el-collapse-item name="cover">
              <template #title>
                <div class="cover-header">
                  <el-icon><Document /></el-icon>
                  <span class="cover-label">封面信息</span>
                  <el-tag v-if="selectedFile.coverInfo.doc_no" size="small" type="primary" effect="plain">
                    {{ selectedFile.coverInfo.doc_no }}
                  </el-tag>
                  <span v-if="selectedFile.coverInfo.title" class="cover-title-text" :title="selectedFile.coverInfo.title">
                    {{ selectedFile.coverInfo.title }}
                  </span>
                </div>
              </template>
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="文档编号">
                  {{ selectedFile.coverInfo.doc_no || '—' }}
                </el-descriptions-item>
                <el-descriptions-item label="版本号">
                  {{ selectedFile.coverInfo.revision || '—' }}
                </el-descriptions-item>
                <el-descriptions-item label="文档标题" :span="2">
                  {{ selectedFile.coverInfo.title || '—' }}
                </el-descriptions-item>
                <el-descriptions-item label="比例">
                  {{ selectedFile.coverInfo.scale || '—' }}
                </el-descriptions-item>
                <el-descriptions-item label="审批信息">
                  <template v-if="selectedFile.coverInfo.approval && Object.keys(selectedFile.coverInfo.approval).length > 0">
                    <el-tag
                      v-for="(name, role) in selectedFile.coverInfo.approval"
                      :key="role"
                      size="small"
                      class="approval-tag"
                    >
                      {{ role }}：{{ name }}
                    </el-tag>
                  </template>
                  <span v-else>—</span>
                </el-descriptions-item>
              </el-descriptions>
            </el-collapse-item>
          </el-collapse>
        </div>

        <!-- 空状态提示（无文件时） -->
        <EmptyState
          v-if="files.length === 0"
          :icon="Document"
          title="等待文件加载"
          description="上传文件后将在此处显示预览内容"
          :icon-size="64"
          icon-color="#DCDFE6"
          class="file-preview-empty-state"
        />

        <div v-else class="editor-container">
          <!-- DWG图纸预览（保留专用组件，支持图纸交互） -->
          <DwgPreviewPanel
            ref="dwgPreviewRef"
            v-if="isDwgFileSelected && !dwgParseFailed"
            :file="dwgFileForPreview"
            :locateTarget="dwgLocateTarget"
            @locateResult="handleLocateResult"
            @fallbackToText="dwgParseFailed = true"
          />
          <!-- 统一文件预览（Word/PDF/Excel/PPT/其他） -->
          <FilePreviewPanel
            v-else
            :taskId="taskId"
            :fileId="selectedFileId"
            :fileType="selectedFileType"
            :fileName="selectedFileName"
            :locateTarget="locateTarget"
            @locateResult="handleLocateResult"
          />
        </div>

      </div>

      <!-- 可拖拽分割条 -->
      <div
        class="resize-divider"
        :class="{ active: isResizing }"
        @mousedown="startResize"
      >
        <div class="divider-line"></div>
        <div class="divider-handle">
          <span class="handle-dots">⋮</span>
        </div>
      </div>

      <!-- 右侧：审查报告面板 -->
      <div class="right-panel" :style="rightPanelStyle">
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="header-left">
            <h3 class="panel-title">{{ isSelfCheck ? '标准引用自检报告' : 'AI 审查报告' }}</h3>
            <!-- 文件筛选下拉（多文件时显示） -->
            <el-select
              v-if="files.length > 1"
              v-model="filterFileId"
              size="small"
              style="width: 160px;"
              clearable
              placeholder="全部文件"
              popper-class="file-filter-popper"
              @change="(val: string) => { if (val) switchToFileContext(val); else { selectedFileId.value = files.value[0]?.id || null } }"
            >
              <el-option
                v-for="f in files"
                :key="f.id"
                :label="f.fileName"
                :value="f.id"
              >
                <span><el-icon :size="14"><component :is="getFileIconComponent(f.fileType)" /></el-icon> {{ f.fileName }}</span>
                <span style="float: right; color: #9CA3AF; font-size: 11px;">{{ getFileIssueCount(f.id) }}</span>
              </el-option>
            </el-select>
          </div>
          <div class="header-right">
            <!-- 导出操作 -->
            <ExportMenu :is-self-check="isSelfCheck" @command="handleExportCommand" />

            <!-- LLM 推理回放 -->
            <el-tooltip content="查看本次审查的 LLM 调用全过程（Prompt / Completion / RAG 片段）" placement="bottom">
              <el-button size="small" class="header-action-btn" @click="llmReplayVisible = true">
                <el-icon><View /></el-icon>&nbsp;推理回放
              </el-button>
            </el-tooltip>

            <!-- 分隔 + 导航 -->
            <div class="header-divider"></div>
            <el-tooltip content="返回任务列表" placement="bottom">
              <button class="back-btn" @click="goBack">
                返回历史
              </button>
            </el-tooltip>
          </div>
        </div>

        <!-- 审查中进度（非阻塞，嵌入结果面板） -->
        <ReviewProgressBar
          :reviewing="reviewing"
          :review-progress="reviewProgress"
          :review-step="reviewStep"
          :review-message="reviewMessage"
          :is-self-check="isSelfCheck"
          :file-progress="reviewFileProgress"
          :live-issue-count="totalLiveIssueCount"
        />

        <div v-if="locateFeedback" class="locate-feedback">
          <el-alert
            :title="locateFeedback.message"
            :type="locateFeedback.type"
            :closable="false"
            show-icon
          />
        </div>

        <!-- Tab导航 -->
        <div v-if="!isSelfCheck" class="tab-navigation">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-item', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            <el-icon v-if="tab.icon" class="tab-icon"><component :is="tab.icon" /></el-icon>
            <span class="tab-label">{{ tab.label }}</span>

            <el-badge
              v-if="getTabBadge(tab.key)"
              :value="getTabBadge(tab.key).value"
              :type="getTabBadge(tab.key).type"
              :max="99"
              class="tab-badge"
            />
          </button>
        </div>

        <!-- ====== 标准引用自检报告（SELF_CHECK） ====== -->
        <SelfCheckReportPanel
          v-if="isSelfCheck"
          :report="scReport"
          :items="scFilteredItems"
          :error-tag-type="scErrorTagType"
          :error-label="scErrorLabel"
          @select-item="scSelectItem"
          @export="handleExportScReport"
        />

        <!-- Tab内容区 -->
        <div v-if="!isSelfCheck" class="tab-content">
          <!-- 当前 Tab 说明条（DEC 双清单等含 description 的 Tab 显示） -->
          <div v-if="currentTabDescription" class="tab-description-bar">
            <el-icon :size="14"><InfoFilled /></el-icon>
            <span>{{ currentTabDescription }}</span>
          </div>

          <!-- Tab 1: 审查摘要 -->
          <div v-if="activeTab === 'overview'" class="tab-pane">
            <!-- ===== 统计看板（始终可见）===== -->
            <StatsDashboard
              :total-files="reviewSummary?.totalFiles || files.length || 0"
              :task-mode="reviewPlanSummary.taskMode"
              :issue-count="issueDetails.length"
              :objective="reviewSummary?.reviewMode ? getModeLabel(reviewSummary.reviewMode) : reviewPlanSummary.objective"
              :is-contract-review="isContractReview"
              :contract-score="contractScoreData"
              :show-ai-warning="showAiWarning"
              :review-mode="(task as any)?.reviewMode"
              :ai-engine-used="(task as any)?.aiEngineUsed"
            />

            <!-- ===== 审查通过（无问题）===== -->
            <div v-if="task?.status === 'COMPLETED' && issueDetails.length === 0" class="summary-pass">
              <el-icon color="#67c23a" :size="24"><CircleCheckFilled /></el-icon>
              <span>审查完成，未发现需要处理的问题</span>
            </div>

            <!-- ===== 问题预览列表 ===== -->
            <OverviewIssueList
              :issue-count="issueDetails.length"
              :error-issues="errorIssues"
              :warning-issues="warningIssues"
              v-model:show-plain-language="showPlainLanguage"
              @navigate="navigateToIssue"
              @view-all="activeTab = defaultIssueTabKey"
            />
          </div>

          <!-- Tab 2: 问题清单（DEC_REVIEW 时拆为完整性+遵从性双清单，共用此内容区）-->
          <div v-if="showIssueListTab" class="tab-pane" style="height:100%; display:flex; flex-direction:column;">
            <!-- 审查通过空状态 -->
            <EmptyState
              v-if="!loading && task?.status === 'COMPLETED' && currentTabIssues.length === 0"
              :icon="CircleCheckFilled"
              title="审查通过"
              description="未发现需要处理的问题，文档质量良好"
              variant="success"
              icon-color="#67C23A"
              :icon-size="56"
            >
              <template #actions>
                <el-button type="primary" size="large" @click="handleExportReport">
                  <el-icon><Download /></el-icon> 导出审查报告
                </el-button>
                <el-button size="large" @click="activeTab = 'overview'">
                  <el-icon><DataAnalysis /></el-icon> 查看审查摘要
                </el-button>
                <el-button size="large" @click="$router.push('/tasks/new')">
                  <el-icon><Plus /></el-icon> 新建任务
                </el-button>
              </template>
            </EmptyState>

            <!-- 有问题时显示问题列表 -->
            <IssueCardList
              v-else
              ref="issueListRef"
              :details="currentTabIssues"
              :loading="loading"
              :selected-file-id="selectedFileId"
              :is-docx-selected="isDocxFileSelected"
              :review-mode="(task as any)?.reviewMode"
              :enabled-prefixes="(task as any)?.reviewPlan?.evidence?.enabledPrefixes"
              :task-id="taskId"
              @update:selected-file-id="(id) => { selectedFileId.value = id; if (id) switchToFileContext(id) }"
              @select-file-by-id="switchToFileContext"
              @copy-handle-id="handleCopyCadHandle"
              @locate-text="handleLocateTextFromIssueList"
              @open-fp-dialog="(detail) => handleFalsePositive(detail)"
              @batch-false-positive="handleBatchFalsePositiveFromIssueList"
              @batch-adopt="handleBatchAdoptFromIssueList"
            />
          </div>

          <!-- Tab 3: 标准引用 -->
          <KnowledgeTab
            v-if="activeTab === 'knowledge'"
            :standard-ref-issues="standardRefIssues"
            @locate-item="handleLocateKnowledgeItem"
            @back-to-overview="activeTab = 'overview'"
          />


        </div>
      </div>
    </div>

    <!-- 误报标记对话框 -->
    <FalsePositiveDialog
      v-model="fpDialogVisible"
      :submitting="fpSubmitting"
      @confirm="handleConfirmFalsePositive"
    />

    <!-- LLM 推理回放抽屉 -->
    <LlmReplayDrawer
      v-model="llmReplayVisible"
      :task-id="taskId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Loading,
  ArrowRightBold, ArrowRight,
  WarningFilled,
  Check,
  Remove,
  CirclePlus,
  CircleCheckFilled,
  Download,
  MagicStick,
  EditPen,
  DataAnalysis,
  FolderOpened,
  Files,
  Link,
  Document,
  PictureFilled,
  Grid,
  Plus,
  View,
  InfoFilled,
} from '@element-plus/icons-vue'
import {
  getTaskByIdApi,
  getTaskDetailsApi,
  toggleFalsePositiveApi,
  toggleAdoptApi,
} from '@/api/task'
import { useWebSocket, type WsMessage } from '@/composables/useWebSocket'
import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import FilePreviewPanel from '@/views/TaskDetails/FilePreviewPanel.vue'
import DwgPreviewPanel from '@/views/TaskDetails/DwgPreviewPanel.vue'
import FalsePositiveDialog from '@/views/TaskDetails/FalsePositiveDialog.vue'
import ExportMenu from '@/views/TaskDetails/ExportMenu.vue'
import ReviewProgressBar from '@/views/TaskDetails/ReviewProgressBar.vue'
import SelfCheckReportPanel from '@/views/TaskDetails/SelfCheckReportPanel.vue'
import StatsDashboard from '@/views/TaskDetails/StatsDashboard.vue'
import OverviewIssueList from '@/views/TaskDetails/OverviewIssueList.vue'
import KnowledgeTab from '@/views/TaskDetails/KnowledgeTab.vue'
import IssueCardList from './TaskDetails/IssueCardList.vue'
import LlmReplayDrawer from '@/views/TaskDetails/LlmReplayDrawer.vue'
import EmptyState from '@/views/TaskDetails/EmptyState.vue'
import { useTaskExport, useTextLocator, useReviewStats, useWsProgress, useFalsePositive, useSelfCheck, getModeLabel } from './TaskDetails/composables'

const route = useRoute()
const router = useRouter()

// ===== 基础状态 =====
const taskId = computed(() => route.params.id as string)
const task = ref<Task | null>(null)
const llmReplayVisible = ref(false)
const allDetails = ref<TaskDetail[]>([])
const files = ref<TaskFile[]>([])
const loading = ref(false)
const loadingMessage = ref('正在加载审查结果...')

// ===== 文件预览/选择（提前声明，供 useSelfCheck 和 useTextLocator 使用）=====
const selectedFileId = ref<string | null>(null)
const filterFileId = ref<string>('')
const selectFile = (fileId: string) => {
  selectedFileId.value = fileId
  filterFileId.value = fileId
}

// ===== 定位系统（使用 Composable）=====
const {
  locateTarget,
  locateFeedback,
  dwgLocateTarget,
  getLocateStatus,
  handleLocateResult,
  handleLocateText,
} = useTextLocator(files, selectedFileId, (fileId, options) => {
  // 基础文件上下文切换
  selectedFileId.value = fileId
  filterFileId.value = fileId

  // 如果有定位选项，触发定位
  if (options?.locate) {
    console.log('[DEBUG locateTarget SET by callback] cadHandleId =', options.locate.cadHandleId)
    locateTarget.value = {
      originalText: options.locate.originalText || '',
      locateCandidates: options.locate.locateCandidates || [],
      textPosition: options.locate.textPosition || null,
      locateMeta: options.locate.locateMeta || null,
      cadHandleId: options.locate.cadHandleId,
      locateHint: options.locate.locateHint,
    }
  }
})

// ===== 导出功能（使用 Composable）=====
const { exportToWord: handleExportWord, exportToExcel: handleExportExcel, handleExportCommand } = useTaskExport(
  () => taskId.value,
  () => task.value?.title || '审查报告'
)

/** 快捷导出报告（无参数时默认导出 Word） */
const handleExportReport = () => handleExportWord()

// ===== 标准引用自检（SELF_CHECK）=====
const {
  isSelfCheck, scReport, scSelected, scFilteredItems, scSelectItem,
  scErrorTagType, scErrorLabel, handleExportScReport,
} = useSelfCheck(task, taskId, files, filterFileId, selectFile, locateTarget)

// AI 审查空结果警告：审查模式需要 AI 但 AI 未产出结果
const showAiWarning = computed(() => {
  const mode = (task.value as any)?.reviewMode
  if (!mode || mode === 'RULE_ONLY' || mode === 'SELF_CHECK') return false
  return (reviewSummary.value?.aiIssues ?? 0) === 0
})

// ===== 合同审查评分 =====
const isContractReview = computed(() => (task.value as any)?.reviewMode === 'CONTRACT_REVIEW')

const contractScoreData = computed(() => {
  const high = issueDetails.value.filter((d: any) => {
    const desc = (d.description || '').toLowerCase()
    return /高风险|严重|重大|high/i.test(desc) || d.severity === 'error'
  }).length
  const medium = issueDetails.value.filter((d: any) => {
    const desc = (d.description || '').toLowerCase()
    return (/中风险|一般|medium/i.test(desc) || d.severity === 'warning') && !(/高风险|严重|重大|high/i.test(desc) || d.severity === 'error')
  }).length
  const low = issueDetails.value.length - high - medium
  const score = Math.max(0, 100 - high * 15 - medium * 8 - low * 3)
  return { score, high, medium, low: Math.max(0, low) }
})

// 默认左侧面板宽度：自检模式 40%（右侧表格需要更多空间），普通审查 55%
const SELF_CHECK_LEFT_WIDTH = 40
const NORMAL_LEFT_WIDTH = 55
const leftPanelWidth = ref(localStorage.getItem('reviewLeftPanelWidth') ? Number(localStorage.getItem('reviewLeftPanelWidth')) : NORMAL_LEFT_WIDTH)

// 任务加载后，自检模式统一用 40% 左面板
watch(isSelfCheck, (val) => {
  if (val) {
    leftPanelWidth.value = SELF_CHECK_LEFT_WIDTH
  }
}, { immediate: true })

// ===== 审查实时进度（WebSocket 推送） =====
const { subscribeTask, connected: wsConnected } = useWebSocket()
const reviewing = ref(false)
const reviewProgress = ref(0)
const reviewStep = ref('')
const reviewMessage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null
let reviewTimeoutTimer: ReturnType<typeof setTimeout> | null = null
const reviewFileProgress = reactive({
  fileName: '',
  chunkIndex: 0,
  totalChunks: 0,
  issueCount: 0,
})
const totalLiveIssueCount = ref(0)
const skippedNoTextFiles = ref<string[]>([])
const ocrDegradedFiles = ref<string[]>([])
const ragDegradedFiles = ref<string[]>([]) // OPT-027: RAG 降级文件列表
const runtimeFileStatus = ref<Record<string, 'completed' | 'failed' | 'skipped'>>({})
let unsubscribeWs: (() => void) | null = null
const currentStep = ref(2)
const activeTab = ref((route.query.tab as string) || 'overview')
const showPlainLanguage = ref(false)
const leftPanel = ref<HTMLDivElement | null>(null)

// ===== 可拖拽分割条相关 =====
const isResizing = ref(false)
const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing.value = true

  const startX = e.clientX
  const startWidth = leftPanel.value?.offsetWidth || 0
  const mainContent = (e.currentTarget as HTMLElement).parentElement
  if (!mainContent) return
  const containerRect = mainContent.getBoundingClientRect()
  const containerWidth = containerRect.width

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizing.value) return

    const deltaX = moveEvent.clientX - startX
    const newWidthPercent = ((startWidth + deltaX) / containerWidth) * 100

    leftPanelWidth.value = Math.max(20, Math.min(80, newWidthPercent))
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    localStorage.setItem('reviewLeftPanelWidth', String(leftPanelWidth.value))
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 左侧面板的动态样式
const leftPanelStyle = computed(() => ({
  flex: 'none',
  width: `${leftPanelWidth.value}%`,
}))

// 右侧面板：自动填充剩余空间
const rightPanelStyle = computed(() => ({
  flex: '1',
  minWidth: '0',
  overflow: 'hidden',
}))

const selectedFile = computed(() => files.value.find((f: any) => f.id === selectedFileId.value) as any)
const selectedFileType = computed(() => selectedFile.value?.fileType || selectedFile.value?.file_type || '')
const selectedFileName = computed(() => selectedFile.value?.fileName || '')

// 兼容性包装：供模板使用（内部调用 selectFile）
const switchToFileContext = (fileId: string, options?: any) => {
  selectFile(fileId)
}

const getFileNameById = (fileId: string): string => {
  const f = files.value.find((f: any) => f.id === fileId)
  return f?.fileName || '未知文件'
}

const getFileIconComponent = (fileType: string): any => {
  const t = (fileType || '').toLowerCase()
  if (t === 'docx' || t === 'doc') return Document
  if (t === 'dwg' || t === 'dxf') return Files
  if (t === 'pdf') return PictureFilled
  if (t === 'xlsx' || t === 'xls') return Grid
  return Document
}

const getFileIssueCount = (fileId: string): number => {
  return allDetails.value.filter((d: any) => d.fileId === fileId).length
}

const isDwgFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  return file?.fileType === 'dwg' || file?.file_type === 'dwg'
})

const isDocxFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  const fileType = (file?.fileType || file?.file_type || '').toLowerCase()
  return fileType === 'docx' || fileType === 'doc'
})

const dwgFileForPreview = ref<File | null>(null)
const dwgParseFailed = ref(false)
const dwgPreviewRef = ref<any>(null)

/** 下载 DWG 原始文件并在前端创建 File 对象供 WASM 解析 */
async function loadDwgFile(fileId: string) {
  dwgParseFailed.value = false
  dwgFileForPreview.value = null

  try {
    const resp = await request.get(
      `/tasks/${taskId.value}/files/${fileId}/raw`,
      { responseType: 'arraybuffer' }
    )
    const file = files.value.find((f: any) => f.id === fileId) as any
    const fileName = file?.fileName || 'drawing.dwg'
    const blob = new Blob([resp.data])
    dwgFileForPreview.value = new File([blob], fileName, { type: 'application/octet-stream' })
  } catch (e: any) {
    console.error('[TaskResultsView] DWG 文件下载失败:', e)
    dwgParseFailed.value = true
  }
}

// 监听文件切换：选中 DWG 时自动下载原始文件
watch(() => selectedFileId.value, (fileId) => {
  if (!fileId) {
    dwgFileForPreview.value = null
    dwgParseFailed.value = false
    return
  }
  const file = files.value.find((f: any) => f.id === fileId) as any
  const isDwg = file?.fileType === 'dwg' || file?.file_type === 'dwg'
  if (isDwg) {
    loadDwgFile(fileId)
  } else {
    dwgFileForPreview.value = null
    dwgParseFailed.value = false
  }
})

// ===== Tab 配置（DEC_REVIEW 模式下显示完整性+遵从性双清单）=====
const isDecReviewMode = computed(() => (task.value as any)?.reviewMode === 'DEC_REVIEW')

interface TabConfig {
  key: string
  label: string
  icon: string
  description?: string
}

const tabs = computed<TabConfig[]>(() => {
  const result: TabConfig[] = [
    { key: 'overview', label: '审查摘要', icon: 'DataAnalysis' },
  ]
  if (isDecReviewMode.value) {
    result.push(
      {
        key: 'completeness',
        label: '完整性核查',
        icon: 'CircleCheck',
        description: '检查设计文档的章节结构是否齐全，对照规范要求识别缺失的必备章节与内容',
      },
      {
        key: 'compliance',
        label: '合规性核查',
        icon: 'WarningFilled',
        description: '检查文档内容是否符合相关标准条款，包含分项合规、事实维度与文本表述三层交叉复核',
      },
    )
  } else {
    result.push({ key: 'suggestions', label: '问题清单', icon: 'WarningFilled' })
  }
  result.push({ key: 'knowledge', label: '标准引用', icon: 'Reading' })
  return result
})

/** 当前 Tab 的说明文字（用于 Tab 内容区顶部展示） */
const currentTabDescription = computed(() => {
  const tab = tabs.value.find(t => t.key === activeTab.value)
  return tab?.description || ''
})

// ===== Tab Badge / getTabBadge 已迁移到 useReviewStats composable =====

// 默认问题 Tab key（DEC_REVIEW 时跳遵从性，其他跳问题清单）
const defaultIssueTabKey = computed(() => isDecReviewMode.value ? 'compliance' : 'suggestions')

// 从审查摘要跳转到问题明细
const navigateToIssue = (issue: TaskDetail) => {
  activeTab.value = defaultIssueTabKey.value

  nextTick(() => {
    issueListRef.value?.scrollToIssue?.(issue.id)
  })

  if (issue.fileId) {
    switchToFileContext(issue.fileId)
  }

  router.replace({
    query: { ...route.query, tab: defaultIssueTabKey.value, issueId: issue.id }
  })
}

// ===== 误报标记（使用 Composable）=====
const {
  fpDialogVisible, fpSubmitting, fpTargetDetail,
  handleFalsePositive, handleConfirmFalsePositive,
  handleBatchFalsePositiveFromIssueList,
} = useFalsePositive(allDetails)

// ===== IssueCardList 组件引用 =====
const issueListRef = ref<InstanceType<typeof IssueCardList> | null>(null)

// ===== 审查统计（使用 Composable）=====
const {
  reviewSummary, reviewPlanSummary,
  filteredDetails, noResultEntries, issueDetails, noResultReasons,
  totalIssuesExclSummary, errorIssues, warningIssues, infoIssues, standardRefIssues,
  fileStatusSummary, tabBadges, getTabBadge,
} = useReviewStats(task, allDetails, files, filterFileId, runtimeFileStatus)

// ===== DEC_REVIEW 双清单过滤（依赖 issueDetails，须在 useReviewStats 之后）=====
const completenessIssues = computed(() =>
  isDecReviewMode.value
    ? issueDetails.value.filter((d: any) => d.reviewSource === 'COMPLETENESS')
    : []
)

const complianceIssues = computed(() =>
  isDecReviewMode.value
    ? issueDetails.value.filter((d: any) => ['COMPLIANCE', 'RULE_FALLBACK'].includes(d.reviewSource || ''))
    : []
)

// 当前 Tab 对应的 issues（suggestions/completeness/compliance 共用一个内容区）
const currentTabIssues = computed(() => {
  if (activeTab.value === 'completeness') return completenessIssues.value
  if (activeTab.value === 'compliance') return complianceIssues.value
  return issueDetails.value
})

const showIssueListTab = computed(() =>
  ['suggestions', 'completeness', 'compliance'].includes(activeTab.value)
)

// ===== 工具函数 =====
// 标签类函数（getCategoryTagType / getIssueTypeLabel / truncateText / getStandardRefTitle 等）
// 已下沉到子组件（OverviewIssueList / KnowledgeTab / IssueCard）直接 import useIssueHelpers，
// 父层不再透传，避免"改一处忘两处"的同步问题。

// ===== WebSocket 实时进度处理 =====

/** 增量追加 WS 推送的 issues 到结果列表 */
const appendNewIssues = (msg: WsMessage) => {
  if (!msg.issues?.length) return
  const newIssues = msg.issues.map((d: any) => ({
    id: d.id || `live_${Date.now()}_${Math.random()}`,
    issueType: d.issueType,
    ruleCode: d.ruleCode,
    severity: d.severity,
    originalText: d.originalText,
    suggestedText: d.suggestedText,
    description: d.description,
    plainLanguage: d.plainLanguage || null,
    cadHandleId: d.cadHandleId || null,
    standardRef: d.standardRef,
    sourceReferences: d.sourceReferences,
    matchLevel: d.matchLevel,
    similarity: d.similarity,
    diffRanges: d.diffRanges,
    textPosition: d.textPosition,
    locateMeta: d.locateMeta || null,
    fileId: msg.fileId,
    isFalsePositive: false,
    adopted: false,
    taskId: taskId.value,
    taskFileId: msg.fileId || '',
  }))
  allDetails.value = [...allDetails.value, ...newIssues]

  // 去重：基于 (fileId + issueType + originalText) 去重，移除 WS 临时 ID 和 API 真实 ID 的重复
  const seen = new Set<string>()
  allDetails.value = allDetails.value.filter((d: any) => {
    const key = `${d.fileId}:${d.issueType}:${d.originalText}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 处理 WebSocket 推送的消息 */
const handleWsMessage = (msg: WsMessage) => {
  switch (msg.type) {
    case 'task_progress':
      reviewProgress.value = msg.progress ?? reviewProgress.value
      reviewStep.value = msg.step ?? reviewStep.value
      reviewMessage.value = msg.message ?? reviewMessage.value

      // 审查完成
      if (msg.progressType === 'completed' || msg.progressType === 'failed') {
        finishReview()
      }
      // P0-4: OCR 降级告警
      if (msg.progressType === 'ocr_degraded' && msg.fileName) {
        if (!ocrDegradedFiles.value.includes(msg.fileName)) {
          ocrDegradedFiles.value.push(msg.fileName)
        }
      }
      // OPT-027: RAG 降级告警
      if (msg.progressType === 'rag_degraded' && msg.fileName) {
        if (!ragDegradedFiles.value.includes(msg.fileName)) {
          ragDegradedFiles.value.push(msg.fileName)
        }
      }
      break

    case 'chunk_result':
      reviewFileProgress.fileName = msg.fileName ?? reviewFileProgress.fileName
      reviewFileProgress.chunkIndex = (msg.chunkIndex ?? -1) + 1
      reviewFileProgress.totalChunks = msg.totalChunks ?? reviewFileProgress.totalChunks
      reviewFileProgress.issueCount += msg.issueCount ?? 0
      totalLiveIssueCount.value += msg.issueCount ?? 0
      reviewStep.value = `AI 审查中`
      reviewMessage.value = `正在审查 ${msg.fileName}（分片 ${reviewFileProgress.chunkIndex}/${reviewFileProgress.totalChunks}）`
      appendNewIssues(msg)
      break
  }
}

/** 轮询兜底检测任务完成状态（不依赖 WS 连接状态） */
const startPollFallback = () => {
  if (!reviewing.value || pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const res = await getTaskByIdApi(taskId.value)
      const status = res.data?.status
      if (status === 'COMPLETED' || status === 'FAILED') {
        task.value = res.data
        files.value = task.value?.files || []
        if (files.value.length > 0 && !selectedFileId.value) {
          switchToFileContext(files.value[0].id)
        }
        finishReview()
      }
    } catch (_) {
      // polling error — swallow, retry next tick
    }
  }, 3000)
}

/** 超时强制完成审查（防止 reviewing 永不退出） */
const startReviewTimeout = () => {
  // 30分钟后强制退出 reviewing 状态
  reviewTimeoutTimer = setTimeout(() => {
    if (reviewing.value) {
      console.warn('[TaskResultsView] ⏰ 审查超时，强制退出 reviewing 状态')
      finishReview()
    }
  }, 30 * 60 * 1000)
}

const stopPollFallback = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (reviewTimeoutTimer) {
    clearTimeout(reviewTimeoutTimer)
    reviewTimeoutTimer = null
  }
}

/** 审查完成：清理 WS 订阅 + 轮询 + 最终加载 */
const finishReview = async () => {
  reviewing.value = false
  reviewProgress.value = 100
  reviewStep.value = '审查完成'
  reviewMessage.value = '正在加载最终结果...'
  stopPollFallback()
  if (unsubscribeWs) {
    unsubscribeWs()
    unsubscribeWs = null
  }
  // 给后端一点时间完成最后的 DB 写入
  setTimeout(async () => {
    await fetchData(true)
  }, 800)
}

// ===== 数据加载 =====
const fetchData = async (silent = false) => {
  if (!silent) {
    loading.value = true
  }
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
      reviewSource: d.reviewSource || null,
      ruleLibraryItemId: d.ruleLibraryItemId || null,
      originalText: d.originalText,
      suggestedText: d.suggestedText,
      description: d.description,
      plainLanguage: d.plainLanguage || null,
      cadHandleId: d.cadHandleId,
      textPosition: d.textPosition || null,
      locateMeta: d.locateMeta || null,
      confidence: d.confidence || null,
      confidenceSource: d.confidenceSource || null,
      diffRanges: d.diffRanges || null,
      sourceReferences: d.sourceReferences || null,
      standardRefId: d.standardRefId,
      standardRef: d.standardRef,
      fileId: d.fileId,
      file: d.file,
      isFalsePositive: d.isFalsePositive || false,
      adopted: d.adopted || false,
      adoptedBy: d.adoptedBy || null,
      adoptedAt: d.adoptedAt || null,
      taskId: d.taskId || taskId.value,
      taskFileId: d.taskFileId || '',
    }))
    files.value = task.value?.files || []

    // ===== 状态同步：如果任务已完成但 reviewing 仍为 true，清理状态 =====
    if ((task.value?.status === 'COMPLETED' || task.value?.status === 'FAILED') && reviewing.value) {
      finishReview()
      return
    }

    // ===== 结果完整性校验（增强版） =====
    if (task.value?.status === 'COMPLETED' && files.value.length > 0) {
      const totalDetails = allDetails.value.length
      const noResultCount = allDetails.value.filter(d => d.ruleCode === 'NO_RESULT').length
      const errorDetails = allDetails.value.filter(d => d.description?.includes('审查过程中发生错误') || d.description?.includes('保存失败'))
      const validResults = totalDetails - noResultCount - errorDetails.length

      // P0-4: 检测 OCR 降级 issue
      const ocrDegradedIssues = allDetails.value.filter((d: any) => d.ruleCode === 'OCR_DEGRADED')
      for (const issue of ocrDegradedIssues) {
        const fileName = issue.originalText || issue.file?.fileName || issue.taskFileId || '未知文件'
        if (!ocrDegradedFiles.value.includes(fileName)) {
          ocrDegradedFiles.value.push(fileName)
        }
      }

      console.log(`[TaskResultsView] 📊 结果校验: 总计=${totalDetails}, 有效=${validResults}, 无结果标记=${noResultCount}, 错误记录=${errorDetails.length}`)

      // 场景0：检查是否有文件完全没有结果（既无 NO_RESULT 也无有效结果）
      const filesWithResults = new Set(allDetails.value.map((d: any) => d.fileId))
      const filesWithoutAnyResult = files.value.filter((f: any) => !filesWithResults.has(f.id))
      if (filesWithoutAnyResult.length > 0) {
        console.warn(`[TaskResultsView] ⚠️ ${filesWithoutAnyResult.length} 个文件无任何审查结果:`, filesWithoutAnyResult.map((f: any) => f.fileName).join(', '))
        if (!silent) {
          ElMessage({
            type: 'warning',
            message: `${filesWithoutAnyResult.length} 个文件无审查结果（可能解析失败或无文本内容）: ${filesWithoutAnyResult.map((f: any) => f.fileName).join('、')}`,
            duration: 8000,
            showClose: true,
          })
        }
      }

      // 场景1：有错误记录（保存失败）
      if (errorDetails.length > 0) {
        console.warn(`[TaskResultsView] ⚠️ 发现${errorDetails.length}条错误记录`)

        ElMessage({
          type: 'warning',
          message: `部分审查结果可能未成功保存（${errorDetails.length}条异常）。当前显示${validResults}条有效结果。`,
          duration: 6000,
          showClose: true,
        })
      }
      // 场景3：任务卡在PROCESSING状态超过5分钟（可能入队失败）
    } else if (task.value?.status === 'PROCESSING') {
      const taskCreatedAt = new Date(task.value.createdAt).getTime()
      const now = Date.now()
      const elapsedMinutes = (now - taskCreatedAt) / 60000

      if (elapsedMinutes > 5) {
        console.warn(`[TaskResultsView] ⚠️ 任务已处理${elapsedMinutes.toFixed(1)}分钟仍为PROCESSING状态`)

        // 仅在非静默加载时提示
        if (!silent) {
          ElMessage({
            type: 'info',
            message: '任务处理时间较长，可能遇到队列阻塞。系统将自动轮询检测完成状态...',
            duration: 5000,
            showClose: true,
          })
        }
      }
    }

    // 默认选中第一个文件
    if (files.value.length > 0 && !selectedFileId.value) {
      switchToFileContext(files.value[0].id)
    }
  } catch (e: any) {
    ElMessage.error('加载审查结果失败')
    console.error(e)
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

// ===== 操作函数 =====
// pickLocateKeyword, collectLocateAnchors 已迁移到 useIssueHelpers composable =====

// ===== IssueCardList 桥接事件处理 =====

const handleCopyCadHandle = (handleId: string) => {
  navigator.clipboard.writeText(handleId).then(() => {
    ElMessage.success('CAD句柄已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败，请手动复制')
  })
}

const handleLocateTextFromIssueList = (payload: { detail: any; elementId: string }) => {
  handleLocateText(payload.detail)
}

/** 知识库 Tab：点击标准引用卡片 → 定位到文件原文 */
const handleLocateKnowledgeItem = (item: TaskDetail) => {
  // 切换到对应文件
  if (item.fileId) {
    switchToFileContext(item.fileId)
  }
  // 定位到原文
  handleLocateText(item)
  // 切到左侧文件预览
  nextTick(() => {
    const leftPanel = document.querySelector('.left-panel')
    leftPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const handleBatchAdoptFromIssueList = async (issueIds: string[]) => {
  if (!issueIds.length) return
  try {
    await Promise.all(issueIds.map(id => toggleAdoptApi(id, { adopted: true })))
    ElMessage.success(`已采纳 ${issueIds.length} 条建议`)
    // 刷新数据
    await fetchData(true)
  } catch (e: any) {
    console.error('批量采纳失败:', e)
    ElMessage.error('批量采纳失败')
  }
}

// handleBatchFalsePositiveFromIssueList 已迁移到 useFalsePositive composable

const goBack = () => {
  // 优先返回上一页，无历史记录时回退到任务列表
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/tasks')
  }
}

// Tab 切换时同步 URL 参数（支持浏览器前进/后退）
watch(activeTab, (newTab) => {
  if (route.query.tab !== newTab) {
    router.replace({ query: { ...route.query, tab: newTab } })
  }
})

// ===== 生命周期 =====
onMounted(async () => {
  // 进入结果页时自动收起侧边栏，给更多显示空间
  localStorage.setItem('sidebar_collapsed', 'true')
  // 触发 storage 事件让 AppLayout 响应（同页面内手动同步）
  window.dispatchEvent(new StorageEvent('storage', { key: 'sidebar_collapsed', newValue: 'true' }))

  await fetchData()

  // 如果任务状态不是 COMPLETED/FAILED，进入审查中模式，订阅 WS 实时更新
  if (task.value?.status !== 'COMPLETED' && task.value?.status !== 'FAILED') {
    reviewing.value = true
    reviewMessage.value = isSelfCheck.value ? '正在初始化自检...' : '正在初始化审查...'
    unsubscribeWs = subscribeTask(taskId.value, handleWsMessage)

    // WS 断连时使用轮询兜底（立即启动，不等待 WS 连接状态）
    startPollFallback()
    // 超时强制退出（防止 reviewing 永不退出）
    startReviewTimeout()
  }
})

onUnmounted(() => {
  stopPollFallback()
  if (unsubscribeWs) {
    unsubscribeWs()
    unsubscribeWs = null
  }
})
</script>

<style scoped>
.task-results-view {
  /* 使用视口高度精确计算：
   * 100vh - header(52px) - main-content上下padding(12px*2=24px)
   * 不依赖flex链路，确保任何情况下都填满可用空间 */
  height: calc(100vh - 76px);
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  overflow: hidden;
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

/* 审查进度（嵌入右侧面板，非阻塞）—— 紧凑模式 */
.inline-review-progress {
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  background: #FAFBFC;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.progress-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.progress-percent {
  font-size: 13px;
  font-weight: 700;
  color: #409EFF;
  background: #ECF5FF;
  padding: 1px 8px;
  border-radius: 10px;
}

.progress-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #EBEEF5;
}

.progress-step {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin: 4px 0 1px;
}

.progress-message {
  font-size: 11px;
  color: #909399;
  margin: 0 0 6px;
  line-height: 1.4;
}

.chunk-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #909399;
  margin-bottom: 6px;
  padding: 4px 8px;
  background: #F5F7FA;
  border-radius: 4px;
}

.chunk-filename {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.live-issue-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #E6A23C;
  font-weight: 600;
  margin: 0;
  padding: 4px 8px;
  background: #FDF6EC;
  border-radius: 4px;
}

/* 主内容区（紧凑模式：最大化核心内容展示） */
.main-content {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 12px;
  overflow: hidden;
  min-height: 0; /* 关键：允许flex子项收缩到小于内容高度 */
  position: relative; /* OCR 降级告警横幅定位基准 */
}

/* 左侧面板 - 尺寸由 JS leftPanelStyle 动态控制 */
.left-panel {
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E4E7ED;
  overflow: hidden;
  min-height: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.left-panel :deep(.file-preview-panel) {
  overflow-x: auto;
  overflow-y: auto;
}

.panel-header {
  padding: 8px 12px;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
}

.hint-text {
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-file-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #C0C4CC;
}

.file-preview-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: #FAFCFF;
  border-radius: 8px;
  margin: 12px;
  min-height: 400px;
}

/* 文件切换 Tab */
.file-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.file-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: #6B7280;
  background: #F3F4F6;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.file-tab:hover {
  background: #EFF6FF;
  border-color: #BFDBFE;
  color: #3B82F6;
}

.file-tab.active {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

.file-tab-icon {
  font-size: 13px;
}

.file-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tab-count {
  background: rgba(0, 0, 0, 0.1);
  padding: 0 5px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
}

.file-tab.active .file-tab-count {
  background: rgba(255, 255, 255, 0.25);
}

.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.dwg-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--corp-text-secondary, #6B7280);
  font-size: 13px;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  min-width: 0; /* 关键：允许flex子项收缩 */
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E4E7ED;
  overflow-y: hidden;
  overflow-x: auto;
  min-height: 0; /* 关键：允许在flex容器中正确收缩 */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #E5E7EB;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
}

/* ===== 导出报告 / 推理回放：统一的次级按钮 ===== */
.export-action-btn,
.header-action-btn {
  font-weight: 500;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  color: #374151 !important;
  background: #FFFFFF !important;
  border: 1px solid #D1D5DB !important;
  transition: all 0.15s ease;
}

.export-action-btn:hover,
.export-action-btn:focus,
.header-action-btn:hover,
.header-action-btn:focus {
  color: #2563EB !important;
  background: #F9FAFB !important;
  border-color: #93C5FD !important;
}

/* ===== 分隔线：区分导出组和导航 ===== */
.header-divider {
  width: 1px;
  height: 22px;
  background: #E2E8F0;
  margin: 0 4px;
}

/* ===== 返回历史：导航类，最轻（纯文字按钮） ===== */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #64748B;
  background: none;
  border: none;
  cursor: pointer;
  padding: 7px 12px;
  border-radius: 6px;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.back-btn:hover {
  color: #334155;
  background: #F1F5F9;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0;
  white-space: nowrap;
}

/* Tab导航 */
.tab-navigation {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: transparent;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-item:hover {
  color: #2563EB;
  background: rgba(37, 99, 235, 0.06);
}

.tab-item.active {
  color: #2563EB;
  background: #FFFFFF;
  font-weight: 600;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 0;
  z-index: 3;
  height: 3px;
  background: #2563EB;
  border-radius: 3px 3px 0 0;
  box-shadow: 0 -1px 4px rgba(37, 99, 235, 0.25);
}

.tab-icon {
  font-size: 14px;
}

.tab-label {
  white-space: nowrap;
}

.tab-badge {
  margin-left: 2px;
}

.tab-badge :deep(.el-badge__content) {
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 16px;
}

/* Tab内容 */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ===== Tab 说明条（DEC 双清单等含描述的 Tab 顶部展示）===== */
.tab-description-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #F0F9FF;
  border: 1px solid #BAE6FD;
  border-radius: 6px;
  font-size: 12px;
  color: #0369A1;
  line-height: 1.5;
}

.tab-description-bar .el-icon {
  color: #0EA5E9;
  flex-shrink: 0;
}

/* ===== Overview Tab: 统计看板（样式已下沉到 StatsDashboard 子组件）===== */
/* ===== Overview Tab: 问题预览列表（样式已下沉到 OverviewIssueList 子组件）===== */
/* ===== Knowledge Tab: 知识库卡片（样式已下沉到 KnowledgeTab 子组件）===== */

/* 审查通过（无问题）横幅 — 摘要 Tab 使用 */
.summary-pass {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: rgba(103, 194, 58, 0.06);
  border-radius: 8px;
  font-size: 14px;
  color: #67c23a;
  font-weight: 500;
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
}

/* ==================== 可拖拽分割条 ==================== */
.resize-divider {
  flex: none;
  width: 8px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background-color 0.2s ease;
  position: relative;
  user-select: none; /* 防止拖拽时选中文本 */
  z-index: 10;
}

.resize-divider:hover {
  background-color: rgba(59, 130, 246, 0.08);
}

.resize-divider.active {
  background-color: rgba(59, 130, 246, 0.12);
}

.divider-line {
  width: 2px;
  height: 100%;
  background-color: #E5E7EB;
  border-radius: 1px;
  transition: background-color 0.2s ease, width 0.2s ease;
}

.resize-divider:hover .divider-line,
.resize-divider.active .divider-line {
  background-color: #3B82F6;
  width: 3px;
}

.divider-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.resize-divider:hover .divider-handle,
.resize-divider.active .divider-handle {
  opacity: 1;
}

.handle-dots {
  font-size: 14px;
  color: #3B82F6;
  font-weight: bold;
  letter-spacing: -1px;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* 拖拽时的全局样式（禁用文本选择） */
.resizing-active * {
  cursor: col-resize !important;
  user-select: none !important;
}

/* ==================== 响应式布局优化 ==================== */

/*
 * 断点设计：
 * - ≥ 1400px：大屏桌面，左右分栏（文件预览 55% : AI审查 45%）
 * - 1200px - 1399px：中屏/笔记本（如1268x800），调整比例（45% : 55%）
 * - 768px - 1199px：小窗口，左右分栏但更紧凑
 * - < 768px：小屏/手机，上下堆叠
 */

/* 笔记本/中等屏幕（1200px - 1399px）：优化1268x800等常见分辨率 */
@media (max-width: 1399px) and (min-width: 1200px) {
  .main-content {
    gap: 10px;
    padding: 10px;
  }

  .left-panel {
    flex: none;
    width: 45%;
    min-width: 320px;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
  }

  .panel-header {
    padding: 6px 10px;
  }

  .header-left {
    gap: 8px;
  }

  .header-right {
    gap: 10px;
  }

  .resize-divider {
    width: 6px;
  }

  .tab-navigation {
    padding: 4px 8px;
    gap: 2px;
  }

  .tab-item {
    padding: 6px 10px;
    font-size: 12px;
  }

  .tab-content {
    padding: 12px;
  }

  .inline-review-progress {
    margin: 10px 12px 0;
    padding: 12px;
  }

  .file-tab-name {
    max-width: 90px;
  }

  .file-tab {
    padding: 3px 8px;
    font-size: 11px;
  }
}

/* 中等屏幕（768px - 1199px）：优化窗口缩小时的体验 */
@media (max-width: 1199px) and (min-width: 769px) {
  .main-content {
    flex-direction: row;
    gap: 8px;
    padding: 6px;
  }

  .left-panel {
    flex: none;
    min-width: 20%;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
  }

  .panel-header {
    padding: 6px 10px;
  }

  .resize-divider {
    width: 6px;
  }
}

/* 小屏幕（< 768px）：完全切换为上下堆叠布局 */
@media (max-width: 768px) {
  .main-content {
    flex-direction: column;      /* 关键：改为上下堆叠 */
    gap: 8px;
    padding: 6px;
    /* 不设置height:auto，保持flex填充 */
  }

  /* 隐藏分割条（上下堆叠时不需要） */
  .resize-divider {
    display: none;
  }

  /* 左侧文件预览区：限制最大高度，可滚动 */
  .left-panel {
    flex: none;                  /* 取消flex伸缩 */
    width: 100%;
    height: 40vh;               /* 占据40%视口高度 */
    min-height: 200px;
    max-height: 350px;
  }

  /* 右侧AI审查报告：优先显示，占据剩余空间（使用calc确保填满） */
  .right-panel {
    flex: none;
    width: 100%;
    height: calc(60vh - 16px); /* 减去gap(8px)*2 */
    min-height: 300px;
  }

  /* 面板头部超紧凑 */
  .panel-header {
    padding: 6px 8px;
  }

  .hint-text {
    font-size: 11px;
  }

  /* 文件Tab适配小屏 */
  .file-tab-name {
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 超小屏幕（< 480px）：极致紧凑模式 */
@media (max-width: 480px) {
  .main-content {
    gap: 4px;
    padding: 4px;
  }

  .left-panel {
    height: 35vh;
    min-height: 200px;
    border-radius: 4px;
  }

  .right-panel {
    height: calc(65vh - 12px);
    min-height: 350px;
    border-radius: 4px;
  }

  .panel-header {
    padding: 4px 6px;
  }

  .file-tab {
    padding: 3px 6px;
    font-size: 11px;
  }
}

/* ====== 标准引用自检报告样式（已下沉到 SelfCheckReportPanel 子组件）====== */

/* 响应式布局优化 */
@media (max-width: 1200px) {
  .main-content {
    gap: 12px;
    padding: 8px;
  }

  .left-panel {
    flex: 0 0 32%;
    max-width: 360px;
  }
}

@media (max-width: 1024px) {
  .main-content {
    flex-direction: column;
    gap: 12px;
  }

  .left-panel {
    flex: 0 0 auto;
    max-width: none;
    max-height: 45vh;
    min-height: 300px;
  }

  .right-panel {
    flex: 1;
    min-height: 50vh;
  }

  .resize-divider {
    display: none;
  }
}

@media (max-width: 1024px) {
  .inline-review-progress {
    margin: 6px 10px 0;
    padding: 8px 10px;
  }

  .progress-title {
    font-size: 12px;
  }

  .progress-percent {
    font-size: 12px;
    padding: 1px 6px;
  }

  .chunk-filename {
    max-width: 160px;
  }
}

@media (max-width: 768px) {
  .main-content {
    padding: 6px;
    gap: 8px;
  }

  .left-panel {
    max-height: 35vh;
    min-height: 250px;
  }

  .inline-review-progress {
    margin: 6px 8px 0;
    padding: 8px;
    border-radius: 6px;
  }

  .progress-top {
    margin-bottom: 6px;
  }

  .progress-status {
    gap: 4px;
  }

  .progress-title {
    font-size: 11px;
  }

  .progress-percent {
    font-size: 11px;
    padding: 0 6px;
  }

  .progress-details {
    margin-top: 6px;
    padding-top: 6px;
  }

  .progress-step {
    font-size: 11px;
    margin: 2px 0 0;
  }

  .progress-message {
    font-size: 10px;
    margin-bottom: 4px;
  }

  .chunk-progress {
    font-size: 10px;
    padding: 3px 6px;
    margin-bottom: 4px;
    gap: 4px;
  }

  .chunk-filename {
    max-width: 120px;
  }

  .live-issue-count {
    font-size: 11px;
    padding: 3px 6px;
  }
}

/* ===== 空状态样式（已统一到 EmptyState 组件）===== */

/* OPT-011: 封面信息卡片 */
.cover-info-card {
  border-bottom: 1px solid #ebeef5;
  background: #fafbfc;
}
.cover-info-card :deep(.el-collapse) {
  border: none;
}
.cover-info-card :deep(.el-collapse-item__header) {
  height: 38px;
  line-height: 38px;
  padding: 0 12px;
  border-bottom: none;
  background: transparent;
  font-size: 13px;
}
.cover-info-card :deep(.el-collapse-item__wrap) {
  border-bottom: none;
  background: transparent;
}
.cover-info-card :deep(.el-collapse-item__content) {
  padding: 8px 12px 12px;
}
.cover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.cover-label {
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
}
.cover-title-text {
  color: #6b7280;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}
.approval-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}

/* OCR 降级告警横幅 */
.ocr-degraded-banner {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 100;
}
.ocr-degraded-banner :deep(.el-alert) {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>

<!-- 全局样式：el-select popper 下拉框高度限制 -->
<style>
.file-filter-popper {
  max-height: 40vh !important;
  overflow-y: auto !important;
}
</style>

