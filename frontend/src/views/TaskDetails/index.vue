<template>
  <div class="task-details">
    <TaskInfoHeader
      :task="task"
      :details="allDetails"
      :headerCollapsed="headerCollapsed"
      @goBack="goBack"
      @expandHeader="expandHeader"
      @exportReport="handleExportReport"
    />

    <!-- WebSocket 实时进度条 -->
    <div v-if="wsProgress && !wsProgressDismissed" class="ws-progress-bar" :class="{ 'ws-progress-done': wsProgress.progress === 100 }">
      <el-progress
        :percentage="wsProgress.progress"
        :stroke-width="6"
        :status="wsProgress.progress === 100 ? 'success' : undefined"
      />
      <div class="ws-progress-info">
        <span class="ws-progress-step">{{ wsProgress.step }}</span>
        <span class="ws-progress-msg">{{ wsProgress.message }}</span>
      </div>
      <el-icon v-if="wsProgress.progress === 100" class="ws-progress-close" @click="wsProgressDismissed = true"><Close /></el-icon>
    </div>

    <div class="content-layout">
      <!-- 左侧边栏 -->
      <div class="sidebar-wrapper" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-content" v-show="!sidebarCollapsed">
          <FileTreePanel
            v-model="selectedFileId"
            :files="files"
            :loading="loading"
          />
        </div>
        <div class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed">
          <el-icon :size="16" class="toggle-icon">
            <DArrowLeft v-if="!sidebarCollapsed" />
            <DArrowRight v-else />
          </el-icon>
        </div>
      </div>

      <div class="right-area">
        <!-- 视图切换工具栏 -->
        <div class="view-toolbar">
          <div class="toolbar-left">
            <el-radio-group v-model="detailViewMode" size="small">
              <el-radio-button value="detail">
                <el-icon><List /></el-icon> 审查明细
              </el-radio-button>
              <el-radio-button value="summary">
                <el-icon><Document /></el-icon> 问题汇总
                <el-badge v-if="allIssues.length > 0" :value="allIssues.length" type="danger" :max="999" />
              </el-radio-button>
            </el-radio-group>
            <span class="detail-count" v-if="detailViewMode === 'detail'">
              共 <strong>{{ allDetails.length }}</strong> 条问题
            </span>
          </div>
          <div class="toolbar-right">
            <!-- 当前预览文件指示器 -->
            <span class="preview-file-indicator" v-if="previewFileName">
              <el-icon><Document v-if="detailViewMode === 'detail'" /><View v-else /></el-icon>
              {{ previewFileName }}
            </span>
          </div>
        </div>

        <!-- 分屏主内容区 -->
        <div class="split-container" :class="{ 'summary-mode': detailViewMode === 'summary' }">
          <!-- 左侧：问题列表 -->
          <div class="split-left" v-show="detailViewMode === 'detail'" 
               :style="{ flex: '0 0 ' + splitLeftWidth + '%' }">
            <IssueCardList
              ref="issueCardListRef"
              :details="allDetails"
              :loading="loading"
              :selectedFileId="selectedFileId"
              @update:selectedFileId="selectedFileId = $event"
              @selectFileById="selectFileById"
              @copyHandleId="copyHandleId"
              @openFpDialog="openFpDialog"
              @cancelFp="handleCancelFp"
              @locateText="handleLocateText"
            />
          </div>

          <!-- 左侧：问题汇总表格 -->
          <div class="split-left summary-mode-panel" v-show="detailViewMode === 'summary'">
            <div class="summary-toolbar">
              <el-select v-model="summaryFilterSeverity" placeholder="按严重度筛选" clearable size="small" style="width: 130px">
                <el-option label="错误" value="error" />
                <el-option label="警告" value="warning" />
                <el-option label="提示" value="info" />
              </el-select>
              <el-select v-model="summaryFilterType" placeholder="按分类筛选" clearable size="small" style="width: 140px">
                <el-option v-for="t in summaryCategories" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
              <span class="summary-count">共 {{ filteredSummaryIssues.length }} 条问题</span>
            </div>
            <el-table
              :data="filteredSummaryIssues"
              style="width: 100%"
              size="small"
              border
              stripe
              max-height="calc(100vh - 380px)"
              @row-click="handleSummaryRowClick"
              class="summary-table"
            >
              <el-table-column prop="fileName" label="文件名" width="180" show-overflow-tooltip />
              <el-table-column prop="description" label="问题描述" min-width="200" show-overflow-tooltip />
              <el-table-column prop="severity" label="级别" width="80" align="center">
                <template #default="{ row }">
                  <el-tag :type="getSeverityTagType(row.severity)" size="small" effect="dark" round>
                    {{ getSeverityLabel(row.severity) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="issueType" label="分类" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="getCategoryTagType(row.issueType)" size="small" effect="plain" round>
                    {{ getIssueTypeLabel(row.issueType) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="isFalsePositive" label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.isFalsePositive" type="info" size="small" effect="plain" round>误报</el-tag>
                  <el-tag v-else type="danger" size="small" effect="plain" round>待处理</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="70" align="center">
                <template #default="{ row }">
                  <el-button type="primary" link size="small" @click.stop="handleViewIssue(row)">查看</el-button>
                </template>
              </el-table-column>
            </el-table>
            <EmptyState v-if="filteredSummaryIssues.length === 0 && !loading" icon="🎉" title="暂无问题" description="所有文件审查通过，未发现合规问题" />
          </div>

          <!-- 可拖拽分隔线 -->
          <div 
            class="split-divider" 
            v-show="detailViewMode === 'detail'"
            :class="{ dragging: isDragging }"
          >
            <div 
              class="divider-handle"
              @mousedown.stop="startDrag"
            ></div>
          </div>

          <!-- 右侧：原文预览 / DWG图纸预览 -->
          <div class="split-right" v-show="detailViewMode === 'detail'" 
               :style="{ flex: '0 0 ' + (100 - splitLeftWidth) + '%' }">
            <!-- DWG 文件且 SVG 预览成功：图纸预览 -->
            <DwgPreviewPanel
              v-if="isDwgFileSelected && !dwgParseFailed"
              ref="dwgPreviewRef"
              :file="dwgFileForPreview"
              :locateTarget="dwgLocateTarget"
            />
            <!-- 非 DWG 文件 或 DWG 解析失败降级：原文预览 -->
            <TextPreviewPanel
              v-else
              :taskId="taskId"
              :fileId="selectedFileId"
              :locateTarget="locateTarget"
            />
            <!-- DWG 降级提示 -->
            <div v-if="isDwgFileSelected && dwgParseFailed" class="dwg-fallback-hint">
              <el-icon :size="14" color="var(--el-color-warning)"><WarningFilled /></el-icon>
              <span>图纸预览不可用，已切换为文本预览模式</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <FalsePositiveDialog
      v-model="fpDialogVisible"
      :submitting="fpSubmitting"
      @confirm="handleConfirmFp"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { List, Document, View, DArrowLeft, DArrowRight, Close, WarningFilled } from '@element-plus/icons-vue'
import { getTaskByIdApi, getTaskDetailsApi, exportTaskReportApi, toggleFalsePositiveApi } from '@/api/task'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import TaskInfoHeader from './TaskInfoHeader.vue'
import FileTreePanel from './FileTreePanel.vue'
import IssueCardList from './IssueCardList.vue'
import FalsePositiveDialog from './FalsePositiveDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import TextPreviewPanel from './TextPreviewPanel.vue'
import DwgPreviewPanel from './DwgPreviewPanel.vue'
import { wsManager } from '@/composables/useWebSocket'

const route = useRoute()
const router = useRouter()

// Refs
const issueCardListRef = ref<InstanceType<typeof IssueCardList> | null>(null)

const taskId = computed(() => route.params.id as string)
const task = ref<Task | null>(null)
const details = ref<TaskDetail[]>([])
const files = ref<TaskFile[]>([])
const loading = ref(false)
const selectedFileId = ref<string | null>(null)
const wsProgress = ref<{ step: string; progress: number; message: string } | null>(null)
const wsProgressDismissed = ref(false)
/** 分片增量结果：尚未入库但已通过 WebSocket 推送的待追加问题 */
const pendingChunkIssues = ref<TaskDetail[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null
let wsUnsubscribe: (() => void) | null = null

/**
 * 合并后的完整问题列表
 * - API 数据（来自数据库）
 * - 分片增量数据（来自 WebSocket 推送，尚未被 fetchData 刷新覆盖）
 * - 自动去重（以 id 为 key）
 */
const allDetails = computed(() => {
  const apiMap = new Map<string, TaskDetail>()
  details.value.forEach(d => { if (d.id) apiMap.set(d.id, d) })
  // pendingChunkIssues 中已有 id 的不重复添加
  const merged = [...details.value]
  pendingChunkIssues.value.forEach(p => {
    if (p.id && !apiMap.has(p.id)) {
      merged.push(p)
    }
  })
  return merged
})

// ===== 文本定位处理 =====
const locateTarget = ref<{ originalText: string; textPosition: any; cadHandleId?: string; description?: string } | null>(null)

// ===== DWG 图纸预览 =====

/** 当前选中的文件是否为 DWG */
const isDwgFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value)
  return file?.fileType === 'dwg' || file?.file_type === 'dwg'
})

/** DWG 预览用原始文件对象 */
const dwgFileForPreview = ref<File | null>(null)
let dwgFileAbortController: AbortController | null = null
/** DWG SVG 预览是否解析失败，失败时降级到 TextPreviewPanel */
const dwgParseFailed = ref(false)
/** DwgPreviewPanel 组件引用 */
const dwgPreviewRef = ref<InstanceType<typeof DwgPreviewPanel> | null>(null)

/** 当选中 DWG 文件时，从后端下载原始文件用于 SVG 预览 */
const loadDwgFileForPreview = async (fileId: string) => {
  // 取消之前的下载
  if (dwgFileAbortController) {
    dwgFileAbortController.abort()
  }
  dwgFileForPreview.value = null

  const file = files.value.find((f: any) => f.id === fileId)
  if (!file) return

  const filePath = (file as any).filePath || (file as any).file_path
  const fileName = (file as any).fileName || (file as any).file_name || 'drawing.dwg'
  if (!filePath) return

  dwgFileAbortController = new AbortController()
  try {
    const url = `/uploads/${filePath}`
    const response = await fetch(url, { signal: dwgFileAbortController.signal })
    if (!response.ok) throw new Error(`下载 DWG 文件失败: ${response.statusText}`)
    const blob = await response.blob()
    dwgFileForPreview.value = new File([blob], fileName, { type: 'application/dwg' })
  } catch (e: any) {
    if (e?.name === 'AbortError') return
    console.error('[TaskDetails] 下载 DWG 文件用于预览失败:', e)
  }
}

// 监听文件选择变化，加载 DWG 预览
watch(selectedFileId, (fileId) => {
  dwgParseFailed.value = false  // 切换文件时重置降级状态
  if (!fileId) { dwgFileForPreview.value = null; return }
  const file = files.value.find((f: any) => f.id === fileId)
  if (file?.fileType === 'dwg' || file?.file_type === 'dwg') {
    loadDwgFileForPreview(fileId)
  } else {
    dwgFileForPreview.value = null
  }
})

// 监听 DwgPreviewPanel 解析失败状态，自动降级到 TextPreviewPanel
watch(() => dwgPreviewRef.value?.parseFailed, (failed) => {
  if (failed) {
    dwgParseFailed.value = true
  }
}, { immediate: true })

/** DWG 定位目标（将审查问题的 cadHandleId 映射到 DwgPreviewPanel 的 locateTarget） */
const dwgLocateTarget = computed(() => {
  if (!locateTarget.value) return null
  return {
    cadHandleId: locateTarget.value.cadHandleId,
    originalText: locateTarget.value.originalText,
    description: locateTarget.value.description,
  }
})

/** 当前选中文件的审查问题 */
const selectedFileDetails = computed(() => {
  if (!selectedFileId.value) return allDetails.value
  return allDetails.value.filter((d: any) => d.fileId === selectedFileId.value)
})

/** 当前选中文件的 DWG 元数据 */
const selectedFileDwgMetadata = computed(() => {
  if (!selectedFileId.value) return null
  const file = files.value.find((f: any) => f.id === selectedFileId.value)
  return file?.dwgMetadata || file?.dwg_metadata || null
})

const handleLocateText = ({ detail }: { detail: any; elementId: string }) => {
  // 设置定位目标
  locateTarget.value = {
    originalText: detail.originalText,
    textPosition: detail.textPosition || null,
    cadHandleId: detail.cadHandleId,
    description: detail.description,
  }

  // 切换到分屏明细视图（确保右侧预览面板可见）
  detailViewMode.value = 'detail'

  // 如果没有选中文件，自动选中该问题所属的文件
  if (!selectedFileId.value && detail.fileId) {
    selectedFileId.value = detail.fileId
  }
}

// ===== WebSocket 实时进度 =====
const setupWsSubscription = () => {
  if (wsUnsubscribe) wsUnsubscribe()
  wsUnsubscribe = wsManager.subscribe(taskId.value, (msg) => {
    if (msg.progressType || msg.type === 'task_progress') {
      wsProgress.value = {
        step: msg.step || '',
        progress: msg.progress ?? 0,
        message: msg.message || '',
      }

      // 根据 WebSocket 消息决定是否停止轮询
      if (msg.progressType === 'completed' || msg.progressType === 'failed' || msg.progressType === 'error') {
        stopPolling()
        if (msg.progressType === 'completed') ElMessage.success('审查任务已完成')
        else if (msg.progressType === 'failed') ElMessage.error('审查任务失败')
        fetchData() // 刷新数据
        // 审查完成后清空待追加列表
        pendingChunkIssues.value = []
        // 完成后 8 秒自动隐藏进度条
        setTimeout(() => { wsProgressDismissed.value = true }, 8000)
      } else if (msg.progressType === 'fast_result_ready') {
        // 阶段1（规则+标准引用）快速结果已入库，刷新展示
        fetchData()
      }
    }

    // ===== 分片增量结果：AI 分片审查完成后立即追加展示 =====
    if (msg.type === 'chunk_result' && msg.issues && msg.issues.length > 0) {
      const chunkIndex = (msg.chunkIndex ?? 0) + 1
      const total = msg.totalChunks ?? '?'
      const count = msg.issueCount ?? msg.issues.length

      // 追加到待追加列表（入库后会自动显示）
      pendingChunkIssues.value.push(...msg.issues)

      // 显示实时通知
      ElMessage({
        type: 'info',
        message: `AI 分片 ${chunkIndex}/${total}：发现 ${count} 个问题（已追加）`,
        duration: 3000,
      })
    }
  })

  // 连接 WebSocket
  wsManager.connect()
}

// ===== 视图切换 =====
/** 右侧视图模式：detail=分屏明细视图, summary=汇总表格视图 */
const detailViewMode = ref<'detail' | 'summary'>('detail')

/** 当前右侧预览面板对应的文件名 */
const previewFileName = computed(() => {
  const file = files.value.find((f: any) => f.id === selectedFileId.value)
  return file ? (file.fileName || file.file_name || '') : ''
})

const summaryFilterSeverity = ref('')
const summaryFilterType = ref('')

const summaryCategories = [
  { value: 'TYPO', label: '错别字' },
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'ENCODING', label: '编码一致性' },
  { value: 'ATTRIBUTE', label: '封面属性' },
  { value: 'HEADER', label: '页眉检查' },
  { value: 'PAGE', label: '页码检查' },
  { value: 'SCAN', label: '图纸扫描' },
  { value: 'TEMPLATE', label: '模板统一' },
  { value: 'FORMAT', label: '格式规范' },
  { value: 'COMPLETENESS', label: '数据完整性' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'LAYOUT', label: '排版布局' },
  { value: 'STD_REF', label: '标准引用' },
]

// ===== 问题汇总数据 =====
const allIssues = computed(() => {
  const fileMap: Record<string, string> = {}
  files.value.forEach((f: any) => { fileMap[f.id] = f.fileName || f.file_name || '未知文件' })
  return allDetails.value.map((d: any) => ({
    id: d.id,
    fileId: d.fileId,
    fileName: fileMap[d.fileId] || d.file?.fileName || '未知文件',
    description: d.description || '-',
    severity: d.severity,
    issueType: d.issueType,
    isFalsePositive: d.isFalsePositive || false,
    originalText: d.originalText,
  }))
})

const filteredSummaryIssues = computed(() => {
  let list = allIssues.value
  if (summaryFilterSeverity.value) {
    list = list.filter((d: any) => d.severity === summaryFilterSeverity.value)
  }
  if (summaryFilterType.value) {
    list = list.filter((d: any) => d.issueType === summaryFilterType.value)
  }
  return list
})

const getSeverityTagType = (s: string) => s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info'
const getSeverityLabel = (s: string) => s === 'error' ? '错误' : s === 'warning' ? '警告' : '提示'
const getIssueTypeLabel = (type: string): string => {
  const m: Record<string, string> = {
    TYPO: '错别字', VIOLATION: '合规违规', NAMING: '命名规范',
    ENCODING: '编码一致性', ATTRIBUTE: '封面属性', HEADER: '页眉检查',
    PAGE: '页码检查', SCAN: '图纸扫描', TEMPLATE: '模板统一',
    FORMAT: '格式规范', COMPLETENESS: '数据完整性', CONSISTENCY: '一致性',
    LAYOUT: '排版布局', STD_REF: '标准引用',
  }
  return m[type] || type
}
const getCategoryTagType = (type: string): any => {
  const m: Record<string, any> = {
    TYPO: 'warning', VIOLATION: 'danger', NAMING: '',
    ENCODING: 'danger', ATTRIBUTE: 'warning', HEADER: 'success',
    PAGE: 'info', SCAN: 'info', TEMPLATE: 'warning',
    FORMAT: 'warning', COMPLETENESS: 'danger', CONSISTENCY: 'info',
    LAYOUT: 'info', STD_REF: 'warning',
  }
  return m[type] || 'info'
}

const handleSummaryRowClick = (row: any) => {
  selectFileById(row.fileId)
  detailViewMode.value = 'detail'
}

const handleViewIssue = (row: any) => {
  selectFileById(row.fileId)
  detailViewMode.value = 'detail'
}

// ===== 左侧边栏折叠 =====
const sidebarCollapsed = ref(false)
const sidebarWidth = 260 // 展开时的宽度(px)

// ===== 可拖拽分割条 =====
const splitLeftWidth = ref(45) // 左侧百分比
const MIN_LEFT_WIDTH = 20 // 最小左侧宽度百分比
const MAX_LEFT_WIDTH = 75 // 最大左侧宽度百分比
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartLeftWidth = ref(45)

const startDrag = (e: MouseEvent) => {
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartLeftWidth.value = splitLeftWidth.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return
  const container = document.querySelector('.split-container') as HTMLElement
  if (!container) return
  
  const containerRect = container.getBoundingClientRect()
  const containerWidth = containerRect.width
  const deltaX = e.clientX - dragStartX.value
  const deltaPercent = (deltaX / containerWidth) * 100
  const newLeftWidth = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, dragStartLeftWidth.value + deltaPercent))
  splitLeftWidth.value = newLeftWidth
}

const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// ===== 滚动时头部自动收起/展开 =====
const headerCollapsed = ref(false)
let lastScrollTop = 0
const COLLAPSE_THRESHOLD = 40
const EXPAND_THRESHOLD = 20

// 误报标记状态
const fpDialogVisible = ref(false)
const fpReasonInput = ref('')
const fpTargetDetail = ref<any>(null)
const fpSubmitting = ref(false)

// ===== 方法 =====
const goBack = () => {
  router.push('/tasks/history')
}

const selectFileById = (fileId: string) => {
  selectedFileId.value = fileId
}

const copyHandleId = async (handleId: string) => {
  try {
    await navigator.clipboard.writeText(handleId)
    ElMessage.success(`已复制 Handle ID: ${handleId}，请在 CAD 中使用快捷键定位`)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = handleId
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success(`已复制 Handle ID: ${handleId}，请在 CAD 中使用快捷键定位`)
  }
}

// ===== 误报标记方法 =====
const openFpDialog = (detail: any) => {
  fpTargetDetail.value = detail
  fpReasonInput.value = ''
  fpDialogVisible.value = true
}

const handleConfirmFp = async (reason: string) => {
  if (!fpTargetDetail.value) return
  fpSubmitting.value = true
  try {
    await toggleFalsePositiveApi(fpTargetDetail.value.id, {
      isFalsePositive: true,
      reason: reason || undefined,
    })
    const detail = details.value.find((d: any) => d.id === fpTargetDetail.value.id)
    if (detail) {
      detail.isFalsePositive = true
      detail.fpReason = reason || null
    }
    ElMessage.success('已标记为误报')
    fpDialogVisible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '标记误报失败')
  } finally {
    fpSubmitting.value = false
  }
}

const handleCancelFp = async (detail: any) => {
  try {
    await toggleFalsePositiveApi(detail.id, {
      isFalsePositive: false,
    })
    const d = details.value.find((item: any) => item.id === detail.id)
    if (d) {
      d.isFalsePositive = false
      d.fpReason = null
    }
    ElMessage.success('已取消误报标记')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '取消误报标记失败')
  }
}

// ===== 数据获取 =====
const mapDetailData = (d: any) => ({
  id: d.id,
  issueType: d.issueType,
  ruleCode: d.ruleCode,
  severity: d.severity,
  originalText: d.originalText,
  suggestedText: d.suggestedText,
  description: d.description,
  cadHandleId: d.cadHandleId,
  diffRanges: d.diffRanges,
  standardRefId: d.standardRefId,
  standardRef: d.standardRef,
  sourceReferences: d.sourceReferences || null,
  fileId: d.fileId,
  file: d.file,
  isFalsePositive: d.isFalsePositive || false,
  fpReason: d.fpReason || null,
  matchLevel: d.matchLevel,
  similarity: d.similarity,
  textPosition: d.textPosition || null,
  dwgMetadata: d.dwgMetadata || null,
})

const fetchData = async () => {
  loading.value = true
  try {
    const [taskRes, detailsRes] = await Promise.all([
      getTaskByIdApi(taskId.value),
      getTaskDetailsApi(taskId.value),
    ])
    task.value = taskRes.data
    const detailsData = detailsRes.data?.details || detailsRes.data || []
    details.value = (Array.isArray(detailsData) ? detailsData : []).map(mapDetailData)
    files.value = task.value?.files || []

    if (task.value?.status === 'PROCESSING' || task.value?.status === 'PENDING') {
      startPolling()
    } else {
      stopPolling()
    }
  } catch (e: any) {
    if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
  } finally {
    loading.value = false
  }
}

const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const [taskRes, detailsRes] = await Promise.all([
        getTaskByIdApi(taskId.value),
        getTaskDetailsApi(taskId.value),
      ])
      task.value = taskRes.data
      const detailsData = detailsRes.data?.details || detailsRes.data || []
      details.value = (Array.isArray(detailsData) ? detailsData : []).map(mapDetailData)
      files.value = task.value?.files || []

      if (task.value?.status !== 'PROCESSING' && task.value?.status !== 'PENDING') {
        stopPolling()
        if (task.value?.status === 'COMPLETED') ElMessage.success('审查任务已完成')
        else if (task.value?.status === 'FAILED') ElMessage.error('审查任务处理失败')
      }
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') {
        stopPolling()
      }
    }
  }, 5000)
}

const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ===== 滚动收起/展开头部 =====
let scrollHandler: (() => void) | null = null
const scrollContainer = ref<HTMLElement | null>(null)
let scrollInitTimer: ReturnType<typeof setTimeout> | null = null
const isUnmounted = ref(false)

const initScrollListener = () => {
  scrollInitTimer = setTimeout(() => {
    if (isUnmounted.value) return
    const el = document.querySelector('.error-content') as HTMLElement
    if (el) {
      scrollContainer.value = el
      scrollHandler = () => handleScroll()
      el.addEventListener('scroll', scrollHandler, { passive: true })
    }
  }, 500)
}

const removeScrollListener = () => {
  const el = scrollContainer.value
  if (el && scrollHandler) {
    el.removeEventListener('scroll', scrollHandler)
    scrollHandler = null
  }
}

const handleScroll = () => {
  const el = scrollContainer.value || document.documentElement
  const scrollTop = el === document.documentElement ? el.scrollTop : el.scrollTop
  const delta = scrollTop - lastScrollTop

  if (delta > COLLAPSE_THRESHOLD && !headerCollapsed.value && scrollTop > 80) {
    headerCollapsed.value = true
  } else if (delta < -EXPAND_THRESHOLD && headerCollapsed.value) {
    headerCollapsed.value = false
  }
  lastScrollTop = Math.max(0, scrollTop)
}

const expandHeader = () => {
  headerCollapsed.value = false
  const el = scrollContainer.value || document.documentElement
  if (el.scrollTo) {
    el.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

const handleExportReport = async () => {
  try {
    const res = await exportTaskReportApi(taskId.value)
    const blob = res.data
    if (!blob || blob.size === 0) {
      ElMessage.warning('暂无可导出的审查结果')
      return
    }
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${task.value?.title || '审查报告'}_审查报告.xlsx`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('报告导出成功')
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

onMounted(() => { fetchData(); initScrollListener(); setupWsSubscription() })
onUnmounted(() => {
  stopPolling()
  if (wsUnsubscribe) wsUnsubscribe()
  if (dwgFileAbortController) { dwgFileAbortController.abort(); dwgFileAbortController = null }
  isUnmounted.value = true
  if (scrollInitTimer) { clearTimeout(scrollInitTimer); scrollInitTimer = null }
  removeScrollListener()
})
</script>

<style scoped>
.task-details {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: transparent;
}

.content-layout {
  flex: 1;
  display: flex;
  gap: 12px;
  overflow: hidden;
  min-height: 0;
}

/* ===== 左侧边栏折叠 ===== */
.sidebar-wrapper {
  display: flex;
  flex-shrink: 0;
  position: relative;
  transition: width 0.3s ease;
}

.sidebar-wrapper.collapsed {
  width: 0 !important;
}

.sidebar-content {
  width: 260px;
  min-width: 260px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.sidebar-toggle {
  position: absolute;
  right: -18px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 48px;
  background: var(--corp-bg-panel);
  border: 1px solid var(--corp-border-light);
  border-left: none;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.2s ease;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.05);
}

.sidebar-toggle:hover {
  background: var(--corp-bg-sunken);
}

.sidebar-wrapper.collapsed .sidebar-toggle {
  right: -18px;
}

.toggle-icon {
  color: var(--corp-text-secondary);
  transition: transform 0.3s ease;
}

.sidebar-toggle:hover .toggle-icon {
  color: var(--corp-primary);
}

.right-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--corp-bg-panel);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  box-shadow: var(--corp-shadow-sm);
}

/* ===== 视图切换工具栏 ===== */
.view-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--corp-bg-sunken);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-right {
  display: flex;
  align-items: center;
}

.detail-count {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.detail-count strong {
  color: var(--corp-primary);
  font-weight: 600;
}

.preview-file-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--corp-text-secondary);
  padding: 4px 10px;
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-file-indicator .el-icon {
  flex-shrink: 0;
  color: var(--corp-primary);
}

/* ===== 分屏容器 ===== */
.split-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.split-left {
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.split-divider {
  width: 12px;
  background: transparent;
  flex-shrink: 0;
  margin: 0;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
  position: relative;
  z-index: 100;
  pointer-events: auto;
}

.split-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  background: var(--corp-border-light);
  transition: background 0.2s ease, width 0.2s ease;
}

.split-divider:hover::before,
.split-divider.dragging::before {
  background: var(--corp-primary);
  width: 3px;
}

.divider-handle {
  width: 20px;
  height: 40px;
  border-radius: 10px;
  background: var(--corp-bg-sunken);
  border: 1px solid var(--corp-border-light);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex-direction: column;
  transition: all 0.2s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.divider-handle::before,
.divider-handle::after {
  content: '';
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--corp-text-hint);
  transition: background 0.2s ease;
}

.split-divider:hover .divider-handle,
.split-divider.dragging .divider-handle {
  background: var(--corp-primary-light-9);
  border-color: var(--corp-primary-light-5);
}

.split-divider:hover .divider-handle::before,
.split-divider:hover .divider-handle::after,
.split-divider.dragging .divider-handle::before,
.split-divider.dragging .divider-handle::after {
  background: var(--corp-primary);
}

.split-right {
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--corp-border-light);
  position: relative;
}

.dwg-fallback-hint {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-5, #f5dab1);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-color-warning-dark-2, #a16207);
  z-index: 10;
  white-space: nowrap;
}

/* 汇总模式：左侧全宽 */
.split-container.summary-mode .split-left {
  flex: none;
  width: 100% !important;
}

/* ===== 汇总视图 ===== */
.summary-mode-panel {
  padding: 12px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.summary-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.summary-count {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-left: auto;
}

.summary-table {
  flex: 1;
}

.summary-table :deep(.el-table__row) {
  cursor: pointer;
}

@media (max-width: 900px) {
  .content-layout { flex-direction: column; }
  .sidebar-wrapper { display: none; }
  .split-container { flex-direction: column; }
  .split-right { border-left: none; border-top: 1px solid var(--corp-border-light); }
  .split-divider { display: none; }
}

/* WebSocket 实时进度条 */
.ws-progress-bar {
  margin: 8px 0;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
  position: relative;
}

.ws-progress-bar.ws-progress-done {
  border-color: var(--el-color-success-light-5);
  background: linear-gradient(135deg, #f0fdf4 0%, var(--bg-surface) 100%);
}

.ws-progress-close {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 16px;
  color: var(--corp-text-hint);
  cursor: pointer;
  transition: color 0.2s ease;
}

.ws-progress-close:hover {
  color: var(--corp-text-secondary);
}

.ws-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
}

.ws-progress-step {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.ws-progress-msg {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
