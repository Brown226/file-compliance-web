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
              <span class="file-tab-icon">{{ getFileIcon(f.fileType) }}</span>
              <span class="file-tab-name">{{ f.fileName }}</span>
              <span class="file-tab-count" v-if="getFileIssueCount(f.id) > 0">{{ getFileIssueCount(f.id) }}</span>
            </button>
          </div>
          <span v-else class="hint-text">左侧为文件实时预览与编辑区。可选中文本后进行专项审查。</span>
        </div>
        <div class="editor-container">
          <!-- DWG图纸预览（保留专用组件，支持图纸交互） -->
          <DwgPreviewPanel
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

      <!-- 右侧：AI审查报告面板 -->
      <div class="right-panel" :style="rightPanelStyle">
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="header-left">
            <h3 class="panel-title">AI 审查报告</h3>
            <!-- 文件筛选下拉（多文件时显示） -->
            <el-select
              v-if="files.length > 1"
              v-model="filterFileId"
              size="small"
              style="width: 160px;"
              clearable
              placeholder="全部文件"
            >
              <el-option
                v-for="f in files"
                :key="f.id"
                :label="f.fileName"
                :value="f.id"
              >
                <span>{{ getFileIcon(f.fileType) }} {{ f.fileName }}</span>
                <span style="float: right; color: #9CA3AF; font-size: 11px;">{{ getFileIssueCount(f.id) }}</span>
              </el-option>
            </el-select>
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

        <!-- 审查中进度（非阻塞，嵌入结果面板） -->
        <div v-if="reviewing" class="inline-review-progress">
          <div class="progress-top">
            <span class="progress-title">AI 审查进行中</span>
            <span class="progress-percent">{{ reviewProgress }}%</span>
          </div>
          <el-progress
            :percentage="reviewProgress"
            :stroke-width="6"
            :show-text="false"
            :status="reviewProgress >= 100 ? 'success' : ''"
          />
          <p class="progress-step">{{ reviewStep || '准备中...' }}</p>
          <p class="progress-message">{{ reviewMessage }}</p>
          <div v-if="reviewFileProgress.fileName" class="chunk-progress">
            <span>{{ reviewFileProgress.fileName }}</span>
            <span>分片 {{ reviewFileProgress.chunkIndex }}/{{ reviewFileProgress.totalChunks }}</span>
          </div>
          <p v-if="totalLiveIssueCount > 0" class="live-issue-count">
            已实时发现 {{ totalLiveIssueCount }} 个问题
          </p>
        </div>

        <div v-if="locateFeedback" class="locate-feedback">
          <el-alert
            :title="locateFeedback.message"
            :type="locateFeedback.type"
            :closable="false"
            show-icon
          />
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

            <div v-if="issueDetails.length === 0" class="review-summary">
              <h3 class="summary-title">审查摘要</h3>
              <div v-if="reviewSummary" class="summary-cards">
                <div class="summary-card">
                  <span class="summary-label">审查目标</span>
                  <span class="summary-value">{{ reviewPlanSummary.objective }}</span>
                </div>
                <div class="summary-card">
                  <span class="summary-label">审查依据</span>
                  <span class="summary-value">{{ reviewPlanSummary.evidence }}</span>
                </div>
                <div class="summary-card">
                  <span class="summary-label">执行强度</span>
                  <span class="summary-value">{{ reviewPlanSummary.execution }}</span>
                </div>
                <div class="summary-card" v-if="reviewPlanSummary.enhancements !== '无'">
                  <span class="summary-label">增强项</span>
                  <span class="summary-value">{{ reviewPlanSummary.enhancements }}</span>
                </div>
                <div class="summary-card sub">
                  <span class="summary-label">兼容模式</span>
                  <span class="summary-value">{{ reviewPlanSummary.legacyMode }}</span>
                </div>
                <div class="summary-card">
                  <span class="summary-label">审查文件</span>
                  <span class="summary-value">{{ reviewSummary.totalFiles }}个 ({{ (reviewSummary.fileTypes || []).join(', ') || '—' }})</span>
                </div>
                <div class="summary-card" :class="{ 'has-issues': reviewSummary.totalIssues > 0 }">
                  <span class="summary-label">发现问题</span>
                  <span class="summary-value">{{ reviewSummary.totalIssues }}条</span>
                </div>
                <div class="summary-card sub" v-if="reviewSummary.ruleIssues > 0">
                  <span class="summary-label">· 规则引擎</span>
                  <span class="summary-value">{{ reviewSummary.ruleIssues }}条</span>
                </div>
                <div class="summary-card sub" v-if="reviewSummary.stdRefIssues > 0">
                  <span class="summary-label">· 标准引用</span>
                  <span class="summary-value">{{ reviewSummary.stdRefIssues }}条</span>
                </div>
                <div class="summary-card sub" v-if="reviewSummary.aiIssues > 0">
                  <span class="summary-label">· AI 审查</span>
                  <span class="summary-value">{{ reviewSummary.aiIssues }}条</span>
                </div>
                <div class="summary-card" v-if="reviewSummary.fastFailedCount > 0 || reviewSummary.slowFailedCount > 0">
                  <span class="summary-label" style="color: var(--el-color-danger)">处理异常</span>
                  <span class="summary-value" style="color: var(--el-color-danger)">
                    {{ reviewSummary.fastFailedCount + reviewSummary.slowFailedCount }}个文件处理失败
                  </span>
                </div>
              </div>
              <div v-if="totalIssuesExclSummary === 0" class="summary-pass">
                <el-icon color="#67c23a" :size="24"><CircleCheckFilled /></el-icon>
                <span>审查完成，未发现需要处理的问题</span>
              </div>
            </div>
          </div>

          <!-- Tab 2: 问题明细（核心功能） -->
          <div v-if="activeTab === 'suggestions'" class="tab-pane">
            <!-- 批量操作工具栏 -->
            <div v-if="issueDetails.length > 0" class="batch-toolbar">
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
            <div v-if="noResultReasons.length > 0" class="explanation-panel">
              <div class="explanation-title">审查说明</div>
              <p
                v-for="(reason, idx) in noResultReasons"
                :key="`reason-${idx}`"
                class="explanation-text"
              >
                {{ reason }}
              </p>
            </div>

            <div v-if="issueDetails.length > 0" class="suggestions-list">
              <div
                v-for="(item, index) in issueDetails"
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
                        link
                        size="small"
                        :class="[
                          'locate-btn',
                          getLocateStatus(item) === 'direct' ? 'locate-btn-direct' : 'locate-btn-fallback',
                        ]"
                        @click="handleLocateText(item)"
                      >
                        <el-icon><ArrowRightBold /></el-icon>
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

            <el-empty v-else :description="noResultReasons.length > 0 ? '当前无可直接修改的问题项' : '未发现修改建议'" />
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
                  placeholder="可从左侧预览区选中文本后读取，也可手动粘贴某一条款或段落"
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
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Loading,
  ArrowRightBold,
  WarningFilled,
  Check,
  Remove,
  CirclePlus,
  CircleCheckFilled,
} from '@element-plus/icons-vue'
import {
  getTaskByIdApi,
  getTaskDetailsApi,
  exportTaskReportApi,
  exportTaskReportWordApi,
  toggleFalsePositiveApi,
} from '@/api/task'
import { replaceTextApi } from '@/api/onlyoffice'
import { useWebSocket, type WsMessage } from '@/composables/useWebSocket'
import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import FilePreviewPanel from '@/views/TaskDetails/FilePreviewPanel.vue'
import DwgPreviewPanel from '@/views/TaskDetails/DwgPreviewPanel.vue'
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

// ===== 审查实时进度（WebSocket 推送） =====
const { subscribeTask } = useWebSocket()
const reviewing = ref(false)
const reviewProgress = ref(0)
const reviewStep = ref('')
const reviewMessage = ref('')
const reviewFileProgress = reactive({
  fileName: '',
  chunkIndex: 0,
  totalChunks: 0,
  issueCount: 0,
})
const totalLiveIssueCount = ref(0)
const skippedNoTextFiles = ref<string[]>([])
const runtimeFileStatus = ref<Record<string, 'completed' | 'failed' | 'skipped'>>({})
let unsubscribeWs: (() => void) | null = null
const currentStep = ref(2)
const activeTab = ref('suggestions')
const showPlainLanguage = ref(false)
const leftPanel = ref<HTMLDivElement | null>(null)

// ===== 可拖拽分割条相关 =====
const isResizing = ref(false)
const leftPanelWidth = ref(localStorage.getItem('reviewLeftPanelWidth') ? Number(localStorage.getItem('reviewLeftPanelWidth')) : 55) // 默认左侧占55%

const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing.value = true

  const startX = e.clientX
  const startWidth = leftPanel.value?.offsetWidth || 0
  const containerWidth = (e.currentTarget as HTMLElement).parentElement?.offsetWidth || window.innerWidth

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizing.value) return

    const deltaX = moveEvent.clientX - startX
    const newWidthPercent = ((startWidth + deltaX) / containerWidth) * 100

    // 限制范围：20% - 80%
    leftPanelWidth.value = Math.max(20, Math.min(80, newWidthPercent))
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)

    // 保存用户偏好
    localStorage.setItem('reviewLeftPanelWidth', String(leftPanelWidth.value))
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 左侧面板的动态样式
const leftPanelStyle = computed(() => ({
  flex: 'none',
  width: `${leftPanelWidth.value}%`,
}))

// 右侧面板的动态样式
const rightPanelStyle = computed(() => ({
  flex: 'none',
  width: `${100 - leftPanelWidth.value}%`,
}))

// ===== 文件预览相关 =====
const selectedFileId = ref<string | null>(null)
const filterFileId = ref<string>('')
const locateTarget = ref<{ originalText: string; locateCandidates?: string[]; textPosition: any; locateMeta?: any; cadHandleId?: string; locateHint?: string; triggerId?: string } | null>(null)
const locateFeedback = ref<{ type: 'success' | 'warning'; message: string } | null>(null)
const locateStatusMap = ref<Record<string, 'direct' | 'fallback'>>({})
const locatingIssueId = ref<string | null>(null)

const selectedFile = computed(() => files.value.find((f: any) => f.id === selectedFileId.value) as any)
const selectedFileType = computed(() => selectedFile.value?.fileType || selectedFile.value?.file_type || '')
const selectedFileName = computed(() => selectedFile.value?.fileName || '')

const switchToFileContext = (
  fileId: string,
  options?: { locate?: { originalText: string; locateCandidates?: string[]; textPosition: any; locateMeta?: any; cadHandleId?: string; locateHint?: string } }
) => {
  selectedFileId.value = fileId
  filterFileId.value = fileId

  if (options?.locate) {
    // 先清空再设置，确保重复点击同一问题也会触发子预览组件定位
    locateTarget.value = null
    setTimeout(() => {
      locateTarget.value = {
        originalText: options.locate!.originalText || '',
        locateCandidates: options.locate!.locateCandidates || [],
        textPosition: options.locate!.textPosition || null,
        locateMeta: options.locate!.locateMeta || null,
        cadHandleId: options.locate!.cadHandleId,
        locateHint: options.locate!.locateHint,
        triggerId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }
    }, 0)
  }
}

const selectFile = (fileId: string) => {
  switchToFileContext(fileId)
}

const getLocateStatus = (item: TaskDetail): 'direct' | 'fallback' => {
  const key = item.id || ''
  return locateStatusMap.value[key] || 'fallback'
}

const handleLocateResult = (payload: { success: boolean; mode: 'direct' | 'fallback'; hint?: string }) => {
  if (locatingIssueId.value) {
    locateStatusMap.value[locatingIssueId.value] = payload.success && payload.mode === 'direct' ? 'direct' : 'fallback'
  }

  if (payload.success && payload.mode === 'direct') {
    locateFeedback.value = { type: 'success', message: '已定位到原文位置并高亮显示' }
    locatingIssueId.value = null
    return
  }

  const fallbackHint = payload.hint || '未能直接定位，请按“页/段/句”提示快速查找。'
  locateFeedback.value = { type: 'warning', message: `未能直接定位：${fallbackHint}` }
  locatingIssueId.value = null
}

const getFileNameById = (fileId: string): string => {
  const f = files.value.find((f: any) => f.id === fileId)
  return f?.fileName || '未知文件'
}

const getFileIcon = (fileType: string): string => {
  const t = (fileType || '').toLowerCase()
  if (t === 'docx' || t === 'doc') return '📄'
  if (t === 'dwg' || t === 'dxf') return '📐'
  if (t === 'pdf') return '📕'
  if (t === 'xlsx' || t === 'xls') return '📊'
  return '📎'
}

const getFileIssueCount = (fileId: string): number => {
  return allDetails.value.filter((d: any) => d.fileId === fileId).length
}

const fileStatusSummary = computed(() => {
  const ids = new Set(files.value.map((f: any) => f.id))
  let completed = 0
  let failed = 0
  let skipped = 0

  Object.entries(runtimeFileStatus.value).forEach(([fileId, status]) => {
    if (!ids.has(fileId)) return
    if (status === 'completed') completed++
    if (status === 'failed') failed++
    if (status === 'skipped') skipped++
  })

  return { completed, failed, skipped }
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
    description: locateTarget.value.locateHint || '',
  }
})

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
const reviewSummary = computed(() => {
  const detail = allDetails.value.find((d: any) => d.issueType === 'REVIEW_SUMMARY')
  if (detail?.description) return typeof detail.description === 'string' ? JSON.parse(detail.description) : detail.description
  return null
})

const objectiveLabelMap: Record<string, string> = {
  COMPLIANCE: '合规审查',
  COMPARE: '参照比对',
  PROOFREAD: '文本校对',
  STRUCTURED: '结构化审查',
}

const evidenceLabelMap: Record<string, string> = {
  STANDARD: '标准知识库',
  RULE_LIBRARY: '规则库',
  REFERENCE: '参考文件',
}

const executionLabelMap: Record<string, string> = {
  HYBRID: '混合执行（规则 + AI）',
  RULE_ONLY: '仅规则执行',
}

const getModeLabel = (mode: string) => {
  const map: Record<string, string> = {
    LIBRARY_REVIEW: '以库审文',
    DOC_REVIEW: '以文审文',
    CONSISTENCY: '一致性审查',
    TYPO_GRAMMAR: '错别字/语法',
    MULTIMODAL: '多模态识别',
    CUSTOM_RULE: '自定义规则',
  }
  return map[mode] || mode
}

const reviewPlanSummary = computed(() => {
  const plan = (task.value as any)?.reviewPlan
  const legacyMode = reviewSummary.value?.reviewMode || (task.value as any)?.reviewMode || '-'

  if (!plan || typeof plan !== 'object') {
    return {
      module: getModeLabel(legacyMode),
      objective: '—',
      evidence: '—',
      execution: '—',
      enhancements: '无',
      proofreadingEnhancement: '—',
      legacyMode: getModeLabel(legacyMode),
    }
  }

  const sources = Array.isArray(plan.evidence?.sources) ? plan.evidence.sources : []
  const evidence = sources.length > 0
    ? sources.map((item: string) => evidenceLabelMap[item] || item).join(' + ')
    : '无外部依据'

  const enhancements: string[] = []
  if (plan.enhancements?.intraFileConsistency) enhancements.push('文件内一致性')
  if (plan.enhancements?.crossFileConsistency) enhancements.push('跨文件一致性')

  const module = (() => {
    if (plan.objective === 'COMPARE') return '一致性审查（对照）'
    if (plan.objective === 'PROOFREAD') return '基础校对审查'
    if (plan.objective === 'STRUCTURED') return '多模态审查'
    if (plan.execution?.profile === 'RULE_ONLY' && sources.includes('RULE_LIBRARY')) return '规则库审查'
    if (sources.includes('RULE_LIBRARY') && sources.includes('STANDARD')) return '以库审文'
    if (sources.includes('RULE_LIBRARY')) return '规则库审查'
    return '以库审文'
  })()

  const proofreadingEnhancement = plan.execution?.profile === 'RULE_ONLY'
    ? '关闭（纯规则）'
    : (plan.enhancements?.intraFileConsistency ? '开启' : '关闭')

  return {
    module,
    objective: objectiveLabelMap[plan.objective] || plan.objective || '—',
    evidence,
    execution: executionLabelMap[plan.execution?.profile] || plan.execution?.profile || '—',
    enhancements: enhancements.length > 0 ? enhancements.join(' + ') : '无',
    proofreadingEnhancement,
    legacyMode: getModeLabel(legacyMode),
  }
})

const filteredDetails = computed(() => {
  let details = allDetails.value.filter((d: any) => d.issueType !== 'REVIEW_SUMMARY')
  if (filterFileId.value) details = details.filter((d: any) => d.fileId === filterFileId.value)
  return details
})
const noResultEntries = computed(() =>
  filteredDetails.value.filter((d: any) => d.ruleCode === 'NO_RESULT')
)
const issueDetails = computed(() =>
  filteredDetails.value.filter((d: any) => d.ruleCode !== 'NO_RESULT')
)
const noResultReasons = computed(() =>
  noResultEntries.value
    .map((d: any) => d.description)
    .filter(Boolean)
)
const totalIssuesExclSummary = computed(() => issueDetails.value.length)
const errorIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'error'))
const warningIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'warning'))
const infoIssues = computed(() => issueDetails.value.filter((d: any) => d.severity === 'info'))
const standardRefIssues = computed(() => issueDetails.value.filter((d: any) => d.standardRef || d.standardRefId))

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
const getIssueTitle = (item: any, index: number): string => {
  if (item.originalText && item.originalText.trim()) {
    const text = item.originalText.trim().slice(0, 45)
    return text.length < item.originalText.trim().length ? `${text}...` : text
  }
  if (item.suggestedText && item.suggestedText.trim()) {
    const text = item.suggestedText.trim().slice(0, 45)
    return text.length < item.suggestedText.trim().length ? `${text}...` : text
  }
  if (item.description && item.description.trim()) {
    return `问题 ${index + 1}：${item.description.trim().slice(0, 35)}`
  }
  return `问题 ${index + 1}`
}

const getConfidenceLabel = (confidence?: string | null): string => {
  const map: Record<string, string> = {
    RULE_EXACT: '规则命中',
    STD_MATCH: '标准比对',
    AI_INFERRED: 'AI推断',
    NO_RESULT: '无问题说明',
  }
  return confidence ? (map[confidence] || confidence) : ''
}

const getConfidenceTagType = (confidence?: string | null): 'success' | 'warning' | 'info' | 'danger' => {
  if (confidence === 'RULE_EXACT') return 'danger'
  if (confidence === 'STD_MATCH') return 'success'
  if (confidence === 'AI_INFERRED') return 'warning'
  return 'info'
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

/** 审查完成：清理 WS 订阅 + 最终加载 */
const finishReview = async () => {
  reviewing.value = false
  reviewProgress.value = 100
  reviewStep.value = '审查完成'
  reviewMessage.value = '正在加载最终结果...'
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
      taskId: d.taskId || taskId.value,
      taskFileId: d.taskFileId || '',
    }))
    files.value = task.value?.files || []

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
const pickLocateKeyword = (text: string): string => {
  const raw = (text || '').trim()
  if (!raw) return ''

  const candidates = raw
    .split(/[|｜\n\r\t]/)
    .map(s => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  // 优先使用长度适中的片段，避免整段表格文本导致无法命中
  const preferred = candidates.find(s => s.length >= 6 && s.length <= 40)
  if (preferred) return preferred

  return candidates[0] || raw.slice(0, 40)
}

const collectLocateAnchors = (item: TaskDetail): string[] => {
  const anchors: string[] = []

  if (item.originalText) anchors.push(item.originalText)

  const refs = Array.isArray(item.sourceReferences) ? item.sourceReferences : []
  refs.forEach((ref: any) => {
    if (typeof ref?.chunkContent === 'string' && ref.chunkContent.trim()) {
      anchors.push(ref.chunkContent)
    }
    if (typeof ref?.standardTitle === 'string' && ref.standardTitle.trim()) {
      anchors.push(ref.standardTitle)
    }
  })

  const diffRanges = item.diffRanges as any
  if (diffRanges && typeof diffRanges === 'object') {
    const maybeOriginal = diffRanges.originalText || diffRanges.original || diffRanges.rawText
    if (typeof maybeOriginal === 'string' && maybeOriginal.trim()) {
      anchors.push(maybeOriginal)
    }
  }

  const seen = new Set<string>()
  return anchors
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .filter(s => {
      const key = s.replace(/\s+/g, '').toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const buildLocatePayload = (item: TaskDetail): { originalText: string; locateCandidates: string[]; textPosition: any; locateMeta?: any; cadHandleId?: string; locateHint?: string } => {
  const anchors = collectLocateAnchors(item)
  const locateCandidates = anchors
    .map(pickLocateKeyword)
    .map(s => s.trim())
    .filter(Boolean)
  const uniqueCandidates = [...new Set(locateCandidates)]

  const bestAnchor = uniqueCandidates[0] || ''

  const textPos = item.textPosition as any
  const chunkNo = typeof textPos?.chunkIndex === 'number' ? textPos.chunkIndex + 1 : null
  const charNo = typeof textPos?.charOffset === 'number' ? textPos.charOffset + 1 : null
  const keyword = bestAnchor || item.originalText || item.description || ''

  const fallbackHint = chunkNo
    ? `建议先看第 ${chunkNo} 段${charNo ? `（约第 ${charNo} 字）` : ''}，再搜索“${keyword}”`
    : `建议搜索“${keyword}”并结合问题描述定位`

  return {
    originalText: keyword,
    locateCandidates: uniqueCandidates,
    textPosition: item.textPosition || null,
    locateMeta: item.locateMeta || null,
    cadHandleId: item.cadHandleId,
    locateHint: fallbackHint,
  }
}

const handleLocateText = (item: TaskDetail) => {
  locateFeedback.value = null

  if (!item.fileId) {
    locateFeedback.value = { type: 'warning', message: '该问题缺少文件归属，无法自动定位，请先切换到对应文件后手动检索。' }
    return
  }

  const locate = buildLocatePayload(item)
  if (!locate.originalText.trim()) {
    locateFeedback.value = { type: 'warning', message: '该问题缺少可检索原文，建议结合问题描述手动定位。' }
    return
  }

  locatingIssueId.value = item.id

  // 统一文件上下文切换，保持预览与列表一致
  switchToFileContext(item.fileId, { locate })
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
    selectedIndexes.value = filteredDetails.value.map((_, i) => i)
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
    const item = filteredDetails.value[idx]
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
  // 尝试从浏览器选区获取文本
  const selection = window.getSelection()
  const selectedText = selection?.toString()?.trim()
  if (selectedText) {
    focusedReviewText.value = selectedText
    ElMessage.success('已读取左侧选中文本')
  } else {
    ElMessage.info('请先在左侧预览区选中文本，再点击此按钮读取')
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
    // 尝试通过后端 API 替换文本
    if (selectedFileId.value && originalText) {
      const res = await replaceTextApi(selectedFileId.value, {
        originalText,
        suggestedText,
      })
      const result = res.data
      if (result.replacements > 0) {
        selectedSuggestionPreview.value = {
          before: originalText,
          after: suggestedText,
          status: '专项审查建议已替换',
        }
        focusedReviewText.value = suggestedText
        ElMessage.success('专项审查建议已更新')
      } else {
        selectedSuggestionPreview.value = {
          before: originalText,
          after: suggestedText,
          status: '未匹配到原文，建议已展示在预览区',
        }
        ElMessage.warning('未在文档中匹配到原文，请手动替换')
      }
    } else {
      selectedSuggestionPreview.value = {
        before: originalText,
        after: suggestedText,
        status: '建议已展示在预览区',
      }
    }
  } catch (e: any) {
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
onMounted(async () => {
  // 进入结果页时自动收起侧边栏，给更多显示空间
  localStorage.setItem('sidebar_collapsed', 'true')
  // 触发 storage 事件让 AppLayout 响应（同页面内手动同步）
  window.dispatchEvent(new StorageEvent('storage', { key: 'sidebar_collapsed', newValue: 'true' }))

  await fetchData()

  // 如果任务状态不是 COMPLETED/FAILED，进入审查中模式，订阅 WS 实时更新
  if (task.value?.status !== 'COMPLETED' && task.value?.status !== 'FAILED') {
    reviewing.value = true
    reviewMessage.value = '正在初始化审查...'
    unsubscribeWs = subscribeTask(taskId.value, handleWsMessage)
  }
})

onUnmounted(() => {
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

/* 审查进度（嵌入右侧面板，非阻塞） */
.inline-review-progress {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  background: #F9FAFB;
}

.progress-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-title {
  font-size: 13px;
  font-weight: 600;
  color: #1F2937;
}

.progress-percent {
  font-size: 12px;
  font-weight: 600;
  color: #3B82F6;
}

.progress-step {
  font-size: 13px;
  font-weight: 600;
  color: #1F2937;
  margin: 8px 0 4px;
}

.progress-message {
  font-size: 12px;
  color: #6B7280;
  margin: 0 0 8px;
}

.chunk-progress {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #9CA3AF;
  margin-bottom: 6px;
}

.live-issue-count {
  font-size: 12px;
  color: #3B82F6;
  font-weight: 600;
  margin: 0;
}

/* 主内容区（紧凑模式：最大化核心内容展示） */
.main-content {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 8px;
  overflow: hidden;
  min-height: 0; /* 关键：允许flex子项收缩到小于内容高度 */
}

/* 左侧面板 */
.left-panel {
  flex: 2;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  overflow: hidden;
  min-height: 0; /* 关键：允许在flex容器中正确收缩 */
}

.panel-header {
  padding: 8px 12px;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
}

.hint-text {
  font-size: 12px;
  color: #6B7280;
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
  overflow: hidden;
  min-height: 0;
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

.adopt-preview-panel {
  border-top: 1px solid #E5E7EB;
  padding: 8px 12px;
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
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  overflow: hidden;
  min-height: 0; /* 关键：允许在flex容器中正确收缩 */
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
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px 8px;
  flex: 1;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 0;
  flex: 1;
  min-width: 0;
}

/* 问题卡片上的文件标签 */
.file-tag {
  cursor: pointer;
  flex-basis: 100%;
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

/* 定位按钮状态 */
.locate-btn {
  border-radius: 50%;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
}

.locate-btn-direct {
  color: #16a34a;
  background: #dcfce7;
  border-color: #86efac;
}

.locate-btn-fallback {
  color: #ca8a04;
  background: #fef9c3;
  border-color: #fde047;
}

.locate-btn:hover {
  transform: scale(1.06);
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

/* 审查摘要 */
.review-summary {
  padding: 24px;
}

.summary-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 16px 0;
}

.summary-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  min-width: 140px;
  border: 1px solid var(--el-border-color-lighter);
}

.summary-card.sub {
  background: transparent;
  border: none;
  min-width: 100px;
  padding: 6px 12px;
}

.summary-card.has-issues {
  border-color: var(--el-color-warning);
  background: rgba(230, 162, 60, 0.06);
}

.summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

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

  .analytics-overview {
    grid-template-columns: repeat(2, 1fr);
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
 * - ≥ 1200px：大屏桌面，左右分栏（文件预览 55% : AI审查 45%）
 * - 768px - 1199px：中屏/平板/小窗口，左右分栏但比例调整（40% : 60%）
 * - < 768px：小屏/手机，上下堆叠（AI审查优先显示在上）
 */

/* 中等屏幕（768px - 1199px）：优化窗口缩小时的体验 */
@media (max-width: 1199px) and (min-width: 769px) {
  .main-content {
    flex-direction: row;
    gap: 8px;
    padding: 6px;
    /* 继承父元素高度，不使用height:auto */
  }

  /* 左侧面板缩小，给右侧AI报告更多空间 */
  .left-panel {
    flex: none; /* 不覆盖动态样式的width设置 */
    min-width: 280px;
    max-width: 45%;
  }

  /* 右侧AI审查报告优先扩展 */
  .right-panel {
    flex: none; /* 不覆盖动态样式的width设置 */
    min-width: 320px;
  }

  /* 面板头部更紧凑 */
  .panel-header {
    padding: 6px 10px;
  }

  /* 分割条保持可见但更窄 */
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
</style>
