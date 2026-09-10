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
      <!-- ===== 审查降级/缺失告警（2026-08-26 分级化：按影响程度排序 + 级别标签）=====
           critical > high > warning > info；渲染顺序即严重度降序，用户先看到最需要处理的 -->
      <!-- P1-7: 标准库/审点库为空告警（最严重：AI 可能完全没审） -->
      <div v-if="libEmptyWarnings.length > 0" class="degraded-banner degraded-banner--critical">
        <el-alert
          :title="`审查数据缺失：${libEmptyWarnings.length} 条告警 — 本次审查可能未完整执行`"
          type="warning"
          show-icon
          :closable="true"
          @close="libEmptyWarnings = []"
        >
          <template #default>
            <div class="degraded-banner__body">
              <el-tag size="small" type="danger" effect="dark" round class="degraded-banner__level">影响：高</el-tag>
              <div v-for="(w, i) in libEmptyWarnings" :key="i" class="degraded-banner__item">
                ⚠️ {{ w }}
              </div>
              <p class="degraded-banner__tip degraded-banner__tip--critical">「未发现问题」可能是「没审到」而非「真合规」，请补充标准库/审点库数据后重新审查。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- P0-4: 持久化降级原因横幅（task.degradedReason，刷新后依然可见） -->
      <div v-if="task?.degradedReason" class="degraded-banner degraded-banner--high">
        <el-alert
          :title="'本次审查存在降级：' + task.degradedReason.split('; ').length + ' 项环节未完整执行'"
          type="warning"
          show-icon
          :closable="true"
          @close="task.degradedReason = null"
        >
          <template #default>
            <div class="degraded-banner__body">
              <el-tag size="small" type="warning" effect="dark" round class="degraded-banner__level">影响：较高</el-tag>
              <div v-for="(r, i) in task.degradedReason.split('; ')" :key="i" class="degraded-banner__item">
                ⚠️ {{ r }}
              </div>
              <p class="degraded-banner__tip">「未发现问题」可能是「没审到」而非「真合规」，请结合人工检查确认。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- OCR 降级告警横幅 -->
      <div v-if="ocrDegradedFiles.length > 0" class="degraded-banner degraded-banner--warning">
        <el-alert
          :title="`OCR 服务不可用：${ocrDegradedFiles.length} 个文件为扫描件但未能识别图片中的文字`"
          type="warning"
          show-icon
          :closable="true"
          @close="ocrDegradedFiles = []"
        >
          <template #default>
            <div class="degraded-banner__body">
              <el-tag size="small" type="warning" effect="plain" round class="degraded-banner__level">影响：中</el-tag>
              <div v-for="f in ocrDegradedFiles" :key="f" class="degraded-banner__item">
                ⚠️ {{ f }}
              </div>
              <p class="degraded-banner__tip">请手动检查这些文件中可能的合规问题。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- OPT-027: RAG 降级告警横幅 -->
      <div v-if="ragDegradedFiles.length > 0" class="degraded-banner degraded-banner--info">
        <el-alert
          :title="`知识库检索降级：${ragDegradedFiles.length} 个文件的审查未使用 RAG 检索`"
          type="info"
          show-icon
          :closable="true"
          @close="ragDegradedFiles = []"
        >
          <template #default>
            <div class="degraded-banner__body">
              <el-tag size="small" type="info" effect="plain" round class="degraded-banner__level">影响：低</el-tag>
              <div v-for="f in ragDegradedFiles" :key="f" class="degraded-banner__item">
                ⚠️ {{ f }}
              </div>
              <p class="degraded-banner__tip degraded-banner__tip--info">RAG 不可用，已切换为 LLM 直审，结果可信度可能降低。</p>
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
            <el-icon :size="24" color="var(--corp-border)"><FolderOpened /></el-icon>
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
          icon-color="var(--corp-border-light)"
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
                <span style="float: right; color: var(--corp-text-tertiary); font-size: var(--text-sm);">{{ getFileIssueCount(f.id) }}</span>
              </el-option>
            </el-select>
          </div>
          <div class="header-right">
            <!-- 导出操作 -->
            <ExportMenu :is-self-check="isSelfCheck" @command="handleExportCommand" />

            <!-- LLM 推理回放（SELF_CHECK 为纯机械匹配无 LLM 日志，隐藏避免白挂按钮） -->
            <el-tooltip v-if="!isSelfCheck" content="查看本次审查的 LLM 调用全过程（Prompt / Completion / RAG 片段）" placement="bottom">
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

        <!-- 方案A：审查阶段进度（阶段状态机可视化） -->
        <ReviewStageProgress :stages="reviewStages" :reviewing="reviewing" />

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

          <!-- Tab 1: 审查摘要 —— 2026-09-10 改造 -->
          <!-- 用户反馈原「统计卡片 + 问题预览」聚合视图没什么用，改为直接呈现
               AI 撰写的 Markdown 审查报告（含导出 PDF / 重新生成）。
               有报告时只显示报告；无报告（历史任务）时保留原摘要视图并给出生成入口。 -->
          <div v-if="activeTab === 'overview'" class="tab-pane">
            <!-- 有 Markdown 报告：报告作为摘要页主体 -->
            <template v-if="taskReportMarkdown">
              <ReviewReportPanel
                :task-id="taskId"
                :report-markdown="taskReportMarkdown"
                @update:report-markdown="onReportUpdated"
              />
            </template>

            <!-- 无报告：保留原摘要视图（统计看板 + 问题预览）+ 生成入口 -->
            <template v-else>
              <!-- 已完成任务可一键生成（历史任务无报告） -->
              <div v-if="isTaskFinished" class="report-generate-bar">
                <div class="rgb-left">
                  <el-icon :size="15"><InfoFilled /></el-icon>
                  <span>该任务尚未生成 Markdown 审查报告（历史任务），可点击生成。</span>
                </div>
                <el-button type="primary" size="small" :loading="generatingReport" @click="generateReport">
                  <el-icon><DocumentIcon /></el-icon> 生成审查报告
                </el-button>
              </div>

              <!-- ===== 统计看板（无报告时的回落视图）===== -->
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
            <!-- P0-6：存在空库告警/跳过文件时，绿屏降级为警示态并展示原因（"没审到"≠"通过"） -->
            <div v-if="task?.status === 'COMPLETED' && issueDetails.length === 0" class="summary-pass" :class="{ 'summary-pass-warn': reviewIncomplete }">
              <el-icon :color="reviewIncomplete ? 'var(--color-warning)' : 'var(--color-success)'" :size="24">
                <component :is="reviewIncomplete ? WarningFilled : CircleCheckFilled" />
              </el-icon>
              <span>{{ reviewIncomplete
                ? '审查完成，未发现明确问题——但存在未完整审查项（见下方说明）'
                : '审查完成，未发现需要处理的问题' }}</span>
            </div>

            <!-- P0-6：未完整审查原因明细（空库告警 + 跳过文件 + NO_RESULT 覆盖范围说明） -->
            <div v-if="reviewIncomplete" class="incomplete-review-detail">
              <div v-for="(w, i) in libEmptyWarnings" :key="`lib-${i}`" class="incomplete-review-item">
                <el-icon :size="13"><WarningFilled /></el-icon>
                <span>{{ w }}</span>
              </div>
              <div v-if="fileStatusSummary.skipped > 0" class="incomplete-review-item">
                <el-icon :size="13"><WarningFilled /></el-icon>
                <span>{{ fileStatusSummary.skipped }} 个文件因无可用文本未执行 AI 审查，请人工检查</span>
              </div>
              <div v-for="item in noResultDetailItems" :key="item.fileId || item.reason" class="incomplete-review-item is-muted">
                <el-icon :size="13"><InfoFilled /></el-icon>
                <span><b>{{ item.fileName }}</b>：{{ item.reason }}</span>
              </div>
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
            </template>
          </div>

          <!-- Tab 2: 问题清单（DEC_REVIEW 时拆为完整性+遵从性双清单，共用此内容区）-->
          <div v-if="showIssueListTab" class="tab-pane" style="height:100%; display:flex; flex-direction:column;">
            <!-- 审查通过空状态（P0-6：存在未完整审查项时降级为警示态） -->
            <EmptyState
              v-if="!loading && task?.status === 'COMPLETED' && currentTabIssues.length === 0"
              :icon="reviewIncomplete ? WarningFilled : CircleCheckFilled"
              :title="reviewIncomplete ? '审查基本通过（部分未完整）' : '审查通过'"
              :description="reviewIncomplete
                ? '未发现需要处理的问题，但存在空库告警或跳过文件（见审查摘要页说明），请结合人工检查确认'
                : '未发现需要处理的问题，文档质量良好'"
              :variant="reviewIncomplete ? 'warning' : 'success'"
              :icon-color="reviewIncomplete ? 'var(--color-warning)' : 'var(--color-success)'"
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
              @locate-bbox="handleLocateBboxFromIssueList"
              @open-clause="handleOpenClauseFromIssueList"
              @cancel-fp="handleCancelFalsePositive"
              @open-fp-dialog="(detail) => handleFalsePositive(detail)"
              @toggle-adopt="handleToggleAdoptFromIssueList"
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
  getTaskProgressApi,
  toggleFalsePositiveApi,
  toggleAdoptApi,
  regenerateTaskReportApi,
  type ReviewStageItem,
} from '@/api/task'
import { useWebSocket, type WsMessage } from '@/composables/useWebSocket'
import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import FilePreviewPanel from '@/views/TaskDetails/FilePreviewPanel.vue'
import DwgPreviewPanel from '@/views/TaskDetails/DwgPreviewPanel.vue'
import FalsePositiveDialog from '@/views/TaskDetails/FalsePositiveDialog.vue'
import ExportMenu from '@/views/TaskDetails/ExportMenu.vue'
import ReviewProgressBar from '@/views/TaskDetails/ReviewProgressBar.vue'
import ReviewStageProgress from '@/views/TaskDetails/ReviewStageProgress.vue'
import SelfCheckReportPanel from '@/views/TaskDetails/SelfCheckReportPanel.vue'
import StatsDashboard from '@/views/TaskDetails/StatsDashboard.vue'
import OverviewIssueList from '@/views/TaskDetails/OverviewIssueList.vue'
import ReviewReportPanel from '@/views/TaskDetails/ReviewReportPanel.vue'
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

// ===== 2026-09-10：审查报告（「审查摘要」页主体）=====
// 报告由后端在任务完成时生成（AI 撰写优先 / 拼装兜底），落库 tasks.report_markdown。
// 这里用本地 ref 承载，便于「生成/重新生成」后立即刷新而不必重新拉取整个任务。
const reportMarkdownLocal = ref('')
const generatingReport = ref(false)
const taskReportMarkdown = computed(
  () => reportMarkdownLocal.value || ((task.value as any)?.reportMarkdown as string) || '',
)
const isTaskFinished = computed(() => {
  const s = task.value?.status
  return s === 'COMPLETED' || s === 'FAILED'
})
/** 子组件（报告面板）重新生成后同步到本地，模板立即切到报告视图 */
const onReportUpdated = (md: string) => {
  reportMarkdownLocal.value = md
  if (task.value) (task.value as any).reportMarkdown = md
}
/** 历史任务无报告时的手动生成入口 */
const generateReport = async () => {
  if (generatingReport.value) return
  generatingReport.value = true
  try {
    const res: any = await regenerateTaskReportApi(taskId.value)
    const md = res?.data?.reportMarkdown || ''
    if (md) {
      onReportUpdated(md)
      ElMessage.success('审查报告已生成')
    } else {
      ElMessage.warning('报告生成为空，请稍后重试')
    }
  } catch (e: any) {
    ElMessage.error('生成报告失败：' + (e?.message || e))
  } finally {
    generatingReport.value = false
  }
}

// ===== 方案A：审查阶段状态（stage_update 实时 + 轮询兜底） =====
const reviewStages = ref<ReviewStageItem[]>([])
const upsertStage = (stage: ReviewStageItem) => {
  const idx = reviewStages.value.findIndex((s) => s.stageKey === stage.stageKey)
  if (idx >= 0) {
    reviewStages.value[idx] = { ...reviewStages.value[idx], ...stage }
  } else {
    reviewStages.value.push(stage)
  }
}

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

// AI 审查空结果警告：审查模式需要 AI 但未产出任何 AI 来源的问题
// 修复（2026-08）：原逻辑依赖 REVIEW_SUMMARY 条目（后端无生产者），
// 导致每个 AI 模式任务都恒显示"AI 未产出结果"误报；改为按实际问题来源统计。
const AI_ISSUE_SOURCES = ['AI', 'AI_REVIEW', 'COMPLETENESS', 'COMPLIANCE', 'STANDARD_REF', 'RAG']
const showAiWarning = computed(() => {
  const mode = (task.value as any)?.reviewMode
  if (!mode || mode === 'RULE_ONLY' || mode === 'SELF_CHECK') return false
  const hasAiIssues = issueDetails.value.some((d: any) => {
    const src = String(d.reviewSource || '').toUpperCase()
    if (AI_ISSUE_SOURCES.includes(src)) return true
    const engine = String(d.engine || '').toLowerCase()
    return engine.includes('llm') || engine.includes('rag')
  })
  return !hasAiIssues
})

// ===== 合同审查评分 =====
const isContractReview = computed(() => (task.value as any)?.reviewMode === 'CONTRACT_REVIEW')

// 与后端 calculateContractScore 同口径的 clauseType 加权（ai-review.service.ts）
// 修复：此前前端统一 15/8/3，与后端 other 类 8/4/1 等权重不一致，同份结果两套分数
const CONTRACT_CLAUSE_WEIGHTS: Record<string, { high: number; medium: number; low: number }> = {
  payment: { high: 15, medium: 8, low: 3 },
  penalty: { high: 15, medium: 8, low: 3 },
  warranty: { high: 12, medium: 6, low: 2 },
  insurance: { high: 12, medium: 6, low: 2 },
  dispute: { high: 10, medium: 5, low: 2 },
  other: { high: 8, medium: 4, low: 1 },
}

/** 风险等级解析：riskLevel 优先，fallback severity（与后端 resolveLevel 同口径） */
const resolveRiskLevel = (d: any): 'high' | 'medium' | 'low' => {
  const rl = String(d.riskLevel || '').toUpperCase()
  if (rl === 'HIGH' || rl === 'CRITICAL') return 'high'
  if (rl === 'MEDIUM' || rl === 'MODERATE') return 'medium'
  if (rl === 'LOW' || rl === 'INFO') return 'low'
  if (d.severity === 'error') return 'high'
  if (d.severity === 'warning') return 'medium'
  return 'low'
}

const contractScoreData = computed(() => {
  let high = 0
  let medium = 0
  let low = 0
  let deduction = 0
  for (const d of issueDetails.value) {
    const level = resolveRiskLevel(d)
    if (level === 'high') high++
    else if (level === 'medium') medium++
    else low++
    const w = CONTRACT_CLAUSE_WEIGHTS[String(d.clauseType || 'other')] || CONTRACT_CLAUSE_WEIGHTS.other
    deduction += w[level]
  }
  const score = Math.max(0, 100 - deduction)
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
const libEmptyWarnings = ref<string[]>([]) // P1-7: 标准库/审点库为空告警列表
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
    { key: 'overview', label: '审查报告', icon: 'Document' },
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
  handleBatchFalsePositiveFromIssueList, handleCancelFalsePositive,
} = useFalsePositive(allDetails)

// ===== IssueCardList 组件引用 =====
const issueListRef = ref<InstanceType<typeof IssueCardList> | null>(null)

// ===== 审查统计（使用 Composable）=====
const {
  reviewSummary, reviewPlanSummary,
  filteredDetails, noResultEntries, issueDetails, noResultReasons, noResultDetailItems,
  totalIssuesExclSummary, errorIssues, warningIssues, infoIssues, standardRefIssues,
  fileStatusSummary, tabBadges, getTabBadge,
} = useReviewStats(task, allDetails, files, filterFileId, runtimeFileStatus)

// ===== P0-6（整改报告）：审查是否"未完整"——存在空库告警或跳过文件时，绿屏降级为警示态 =====
const reviewIncomplete = computed(() =>
  libEmptyWarnings.value.length > 0 || fileStatusSummary.value.skipped > 0
)

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
    // 2026-08 补全：与 fetchData 白名单一致，避免 WS 增量阶段字段缺失
    reviewSource: d.reviewSource || null,
    riskLevel: d.riskLevel || null,
    clauseType: d.clauseType || null,
    recommendation: d.recommendation || null,
    dwgMetadata: d.dwgMetadata || null,
    fpReason: d.fpReason || null,
    reviewStatus: d.reviewStatus || null,
    fileId: msg.fileId,
    isFalsePositive: false,
    adopted: false,
    taskId: taskId.value,
    taskFileId: msg.fileId || '',
  }))
  allDetails.value = [...allDetails.value, ...newIssues]

  // 去重：基于 (fileId + issueType + ruleCode + originalText) 去重（2026-08 加 ruleCode，
  // 与 DB 唯一约束 [taskId, fileId, issueType, ruleCode, originalText] 对齐，减少位置信息合并丢失）
  const seen = new Set<string>()
  allDetails.value = allDetails.value.filter((d: any) => {
    const key = `${d.fileId}:${d.issueType}:${d.ruleCode}:${d.originalText}`
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
      // 方案A：阶段状态更新（stage_update：{ step: stageKey, message, fileName }）
      if (msg.progressType === 'stage_update' && msg.step) {
        const stageKey = msg.step as string
        const message = msg.message as string
        const isFail = message.includes('阶段失败')
        const isDone = message.includes('阶段完成')
        upsertStage({
          stageKey,
          status: isFail ? 'FAILED' : isDone ? 'DONE' : 'RUNNING',
          attemptCount: 1,
          error: isFail ? message : null,
          fileName: msg.fileName ?? null,
        })
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
      // P1-7: 标准库/审点库为空告警
      if (msg.progressType === 'lib_empty' && msg.message) {
        if (!libEmptyWarnings.value.includes(msg.message)) {
          libEmptyWarnings.value.push(msg.message)
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
      // 方案A：阶段状态轮询兜底（WS 断连时进度条仍可更新）
      const progRes = await getTaskProgressApi(taskId.value).catch(() => null)
      const progData = progRes?.data as any
      if (progData?.stages?.length) {
        reviewStages.value = progData.stages
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
      // 2026-08 修复：此前静默截断，页面呈现部分结果且看似终态；现在明确提示
      ElMessage({
        type: 'warning',
        message: '审查超时（30 分钟），当前显示的结果可能不完整，请检查任务状态后重试',
        duration: 10000,
        showClose: true,
      })
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
    const [taskRes, detailsRes, progressRes] = await Promise.all([
      getTaskByIdApi(taskId.value),
      getTaskDetailsApi(taskId.value),
      // 方案A：阶段状态摘要（页面加载/重新审查后初始化展示）
      getTaskProgressApi(taskId.value).catch(() => null),
    ])
    const progressData = progressRes?.data as any
    if (progressData?.stages?.length) {
      reviewStages.value = progressData.stages
    }
    task.value = taskRes.data
    // P1-7: 从 stats.warnings 恢复空库告警（轮询/刷新页面后仍可见）
    const taskStatsWarnings = (task.value as any)?.stats?.warnings
    if (Array.isArray(taskStatsWarnings) && taskStatsWarnings.length > 0) {
      for (const w of taskStatsWarnings) {
        if (!libEmptyWarnings.value.includes(String(w))) {
          libEmptyWarnings.value.push(String(w))
        }
      }
    }
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
      // 2026-08 补全：合同/DWG/复核相关字段此前被白名单丢弃，导致页面不显示
      riskLevel: d.riskLevel || null,
      clauseType: d.clauseType || null,
      recommendation: d.recommendation || null,
      dwgMetadata: d.dwgMetadata || null,
      fpReason: d.fpReason || null,
      reviewStatus: d.reviewStatus || null,
      judgeConfidence: d.judgeConfidence || null,
      judgeReason: d.judgeReason || null,
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

/** 图纸区域定位（2026-08 接线：IssueCard 的 locate-bbox 按钮此前无父组件处理，点击无反应） */
const handleLocateBboxFromIssueList = (detail: any) => {
  if (!detail) return
  // DWG 图元定位复用文本定位链路（locateTarget → DwgPreviewPanel 高亮图元）
  if (detail.cadHandleId) {
    handleLocateText(detail)
    return
  }
  // 非 DWG 或无图元句柄：切到所属文件并提示
  if (detail.fileId) {
    switchToFileContext(detail.fileId)
  }
  ElMessage({
    type: 'warning',
    message: detail.cadHandleId ? '图纸定位失败，请尝试文本定位' : '该问题未关联图纸图元，无法进行区域定位',
    duration: 4000,
    showClose: true,
  })
}

/** 查看标准条文（2026-08 接线：IssueCard 的 open-clause 按钮此前无父组件处理，点击无反应） */
const handleOpenClauseFromIssueList = (detail: any) => {
  if (!detail) return
  const clauseText = detail.standardRef || detail.standardRefId || ''
  ElMessageBox.alert(
    clauseText || '该问题未关联标准条文内容。',
    '标准条文',
    {
      confirmButtonText: '知道了',
      customClass: 'clause-dialog',
      dangerouslyUseHTMLString: false,
      type: 'info',
    }
  )
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

// P2-2: 单条采纳/取消采纳（不限文件类型）
const handleToggleAdoptFromIssueList = async (detail: TaskDetail) => {
  const next = !detail.adopted
  try {
    await toggleAdoptApi(detail.id, { adopted: next })
    detail.adopted = next
    ElMessage.success(next ? '已采纳该建议' : '已取消采纳')
  } catch (e: any) {
    console.error('采纳操作失败:', e)
    ElMessage.error('采纳操作失败')
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
   * 100vh - header(var(--corp-header-height) = 52px)
   * 不依赖flex链路，确保任何情况下都填满可用空间 */
  height: calc(100vh - var(--corp-header-height));
  display: flex;
  flex-direction: column;
  background: var(--bg-surface-active);
  overflow: hidden;
}

/* 步骤条 */
.step-header {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--corp-border-light);
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
  border: 2px solid var(--corp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
}

.step-item.active .step-circle {
  border-color: var(--color-primary-500);
  color: var(--color-primary-500);
}

.step-item.completed .step-circle {
  background: var(--color-success);
  border-color: var(--color-success);
  color: var(--bg-surface);
}

.step-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
}

.step-item.active .step-label {
  color: var(--color-primary-500);
}

.step-item.completed .step-label {
  color: var(--color-success);
}

.step-line {
  flex: 1;
  height: 2px;
  background: var(--corp-border);
  margin: 0 12px;
}

.step-line.active {
  background: var(--color-primary-500);
}

/* 加载状态 */
.loading-overlay {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--corp-text-secondary);
}

.loading-text {
  font-size: 14px;
}

/* 审查进度（嵌入右侧面板，非阻塞）—— 紧凑模式 */
.inline-review-progress {
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-md);
  background: var(--bg-surface-hover);
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
  color: var(--corp-text-primary);
}

.progress-percent {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-primary-500);
  background: var(--color-primary-50);
  padding: 1px 8px;
  border-radius: var(--radius-lg);
}

.progress-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--corp-border-light);
}

.progress-step {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-gray-700);
  margin: 4px 0 1px;
}

.progress-message {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin: 0 0 6px;
  line-height: 1.4;
}

.chunk-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin-bottom: 6px;
  padding: 4px 8px;
  background: var(--bg-surface-active);
  border-radius: var(--radius-sm);
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
  color: var(--color-warning);
  font-weight: 600;
  margin: 0;
  padding: 4px 8px;
  background: var(--color-warning-bg);
  border-radius: var(--radius-sm);
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
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
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
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--bg-surface-hover);
}

.hint-text {
  font-size: 12px;
  color: var(--corp-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-file-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--corp-border);
}

.file-preview-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
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
  color: var(--corp-text-secondary);
  background: var(--bg-surface-active);
  border: 1px solid var(--corp-border-light);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.file-tab:hover {
  background: var(--color-primary-50);
  border-color: var(--color-primary-200);
  color: var(--color-primary-500);
}

.file-tab.active {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
  color: var(--bg-surface);
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
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
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
  color: var(--corp-text-secondary);
  font-size: 13px;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  min-width: 0; /* 关键：允许flex子项收缩 */
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
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
  border-bottom: 1px solid var(--corp-border-light);
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
  color: var(--color-gray-700) !important;
  background: var(--bg-surface) !important;
  border: 1px solid var(--corp-border) !important;
  transition: all 0.15s ease;
}

.export-action-btn:hover,
.export-action-btn:focus,
.header-action-btn:hover,
.header-action-btn:focus {
  color: var(--color-primary-600) !important;
  background: var(--bg-surface-hover) !important;
  border-color: var(--color-primary-300) !important;
}

/* ===== 分隔线：区分导出组和导航 ===== */
.header-divider {
  width: 1px;
  height: 22px;
  background: var(--corp-border-light);
  margin: 0 4px;
}

/* ===== 返回历史：导航类，最轻（纯文字按钮） ===== */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 7px 12px;
  border-radius: 6px;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.back-btn:hover {
  color: var(--color-gray-700);
  background: var(--bg-surface-active);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
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
  background: var(--bg-surface-hover);
  border-bottom: 1px solid var(--corp-border-light);
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-secondary);
  border: none;
  background: transparent;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-item:hover {
  color: var(--color-primary-600);
  background: rgba(37, 99, 235, 0.06);
}

.tab-item.active {
  color: var(--color-primary-600);
  background: var(--bg-surface);
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
  background: var(--color-primary-600);
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
  font-size: var(--text-sm);
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
  background: var(--color-primary-50);
  border: 1px solid var(--color-primary-200);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-primary-700);
  line-height: 1.5;
}

.tab-description-bar .el-icon {
  color: var(--color-primary-500);
  flex-shrink: 0;
}

/* ===== Overview Tab: 统计看板（样式已下沉到 StatsDashboard 子组件）===== */
/* ===== Overview Tab: 问题预览列表（样式已下沉到 OverviewIssueList 子组件）===== */

/* ===== 2026-09-10：审查报告缺失时的生成引导条 ===== */
.report-generate-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 14px;
  border: 1px solid var(--color-primary-200, #bfdbfe);
  border-radius: 8px;
  background: var(--color-primary-50, #eff6ff);
}
.report-generate-bar .rgb-left {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--color-primary-700, #1d4ed8);
  min-width: 0;
}
/* ===== Knowledge Tab: 知识库卡片（样式已下沉到 KnowledgeTab 子组件）===== */

/* 审查通过（无问题）横幅 — 摘要 Tab 使用 */
.summary-pass {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: rgba(103, 194, 58, 0.06);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--color-success);
  font-weight: 500;
}

/* P0-6：存在未完整审查项时绿屏降级为警示态 */
.summary-pass-warn {
  background: rgba(230, 162, 60, 0.08);
  color: var(--color-warning);
}

/* P0-6：未完整审查原因明细 */
.incomplete-review-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding: 12px 16px;
  background: rgba(230, 162, 60, 0.05);
  border: 1px solid rgba(230, 162, 60, 0.25);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--corp-text-secondary);
}

.incomplete-review-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.6;
}

.incomplete-review-item.is-muted {
  opacity: 0.85;
}

.incomplete-review-item b {
  color: var(--corp-text-primary);
  font-weight: 600;
}

/* 响应式（1200px 断点合并：column 布局优先；原重复断点的 left-panel 32% 宽度覆盖已删除） */
@media (max-width: 1200px) {
  .main-content {
    flex-direction: column;
    gap: 12px;
    padding: 8px;
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
  background-color: var(--corp-border-light);
  border-radius: 1px;
  transition: background-color 0.2s ease, width 0.2s ease;
}

.resize-divider:hover .divider-line,
.resize-divider.active .divider-line {
  background-color: var(--color-primary-500);
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
  color: var(--color-primary-500);
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
    font-size: 12px;
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
    font-size: 12px;
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
    border-radius: var(--radius-sm);
  }

  .right-panel {
    height: calc(65vh - 12px);
    min-height: 350px;
    border-radius: var(--radius-sm);
  }

  .panel-header {
    padding: 4px 6px;
  }

  .file-tab {
    padding: 3px 6px;
    font-size: 12px;
  }
}

/* ====== 标准引用自检报告样式（已下沉到 SelfCheckReportPanel 子组件）====== */

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
    font-size: 12px;
  }

  .progress-percent {
    font-size: 12px;
    padding: 0 6px;
  }

  .progress-details {
    margin-top: 6px;
    padding-top: 6px;
  }

  .progress-step {
    font-size: 12px;
    margin: 2px 0 0;
  }

  .progress-message {
    font-size: 12px;
    margin-bottom: 4px;
  }

  .chunk-progress {
    font-size: 12px;
    padding: 3px 6px;
    margin-bottom: 4px;
    gap: 4px;
  }

  .chunk-filename {
    max-width: 120px;
  }

  .live-issue-count {
    font-size: 12px;
    padding: 3px 6px;
  }
}

/* ===== 空状态样式（已统一到 EmptyState 组件）===== */

/* OPT-011: 封面信息卡片 */
.cover-info-card {
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--bg-surface-hover);
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
  color: var(--color-gray-800);
  white-space: nowrap;
}
.cover-title-text {
  color: var(--corp-text-secondary);
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
.degraded-banner {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 100;
}
.degraded-banner :deep(.el-alert) {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
/* 2026-08-26 分级化：严重度 → 左边框色 + 级别标签色，视觉可分辨优先级 */
.degraded-banner--critical :deep(.el-alert) { border-left: 3px solid var(--color-danger-600, #dc2626); }
.degraded-banner--high :deep(.el-alert) { border-left: 3px solid var(--color-warning-600, #d97706); }
.degraded-banner--warning :deep(.el-alert) { border-left: 3px solid var(--color-warning-400, #fbbf24); }
.degraded-banner--info :deep(.el-alert) { border-left: 3px solid var(--color-info, #409eff); }
.degraded-banner__body {
  margin-top: 4px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.degraded-banner__level {
  align-self: flex-start;
  margin-bottom: 2px;
}
.degraded-banner__item {
  margin-bottom: 2px;
}
.degraded-banner__tip {
  margin: 4px 0 0;
  color: var(--color-warning-text, #90640b);
}
.degraded-banner__tip--critical {
  color: var(--color-danger-600, #b91c1c);
  font-weight: 500;
}
.degraded-banner__tip--info {
  color: var(--color-info-text, #1d4ed8);
}
</style>

<!-- 全局样式：el-select popper 下拉框高度限制 -->
<style>
.file-filter-popper {
  max-height: 40vh !important;
  overflow-y: auto !important;
}
</style>

