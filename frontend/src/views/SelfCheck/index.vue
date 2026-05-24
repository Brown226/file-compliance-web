<template>
  <div class="self-check-container">
    <!-- 头部 -->
    <div class="check-header">
      <div class="header-title">
        <el-icon :size="28"><Checked /></el-icon>
        <span>标准引用自检</span>
      </div>
      <p class="header-desc">上传设计文件，自动提取其中的标准引用并与标准库比对，生成自检报告</p>
    </div>

    <!-- 操作区 -->
    <el-card shadow="never" class="config-card">
      <div class="config-section">
        <!-- 标准库信息 -->
        <div class="config-item">
          <label class="config-label">
            <el-icon><FolderOpened /></el-icon> 参照标准库
          </label>
          <span class="library-info">
            <el-icon><Check /></el-icon>
            全部标准清单
            <el-tag type="primary" effect="plain" size="small" style="margin-left: 8px;">{{ libraryTotal }} 条</el-tag>
          </span>
        </div>

        <!-- 文件上传 -->
        <div class="config-item">
          <label class="config-label">
            <el-icon><UploadFilled /></el-icon> 待检设计文件
          </label>
          <el-upload
            ref="uploadRef"
            v-model:file-list="fileList"
            :auto-upload="false"
            :accept="'.docx,.xlsx,.xls,.pdf'"
            :limit="20"
            multiple
            drag
            class="upload-area"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或 <em>点击选择</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持 DOCX / XLSX / XLS / PDF 格式，最多 20 个文件
              </div>
            </template>
          </el-upload>
        </div>

        <!-- 操作按钮 -->
        <div class="config-actions">
          <el-button
            type="primary"
            size="large"
            :loading="checkRunning"
            :disabled="!canRunCheck"
            @click="handleRunCheck"
          >
            <el-icon><Search /></el-icon>
            {{ checkRunning ? '正在检查中...' : '开始自检' }}
          </el-button>
          <el-button
            size="large"
            :disabled="!report"
            @click="handleExportReport"
          >
            <el-icon><Download /></el-icon> 导出报告（Excel）
          </el-button>
          <el-button size="large" @click="handleClearResult" :disabled="!report">
            <el-icon><RefreshRight /></el-icon> 清空结果
          </el-button>
        </div>
      </div>
    </el-card>



    <!-- 完成提示 -->
    <el-result
      v-if="report"
      icon="success"
      title="自检完成"
      :sub-title="`共检查 ${report.totalChecked} 条标准引用，完全匹配 ${report.matchedCount} 条，${report.errorCount > 0 ? `存在问题 ${report.errorCount} 条` : '全部正确'}`"
    >
      <template #extra>
        <el-button type="primary" size="large" @click="handleGoToDetail">
          <el-icon><Search /></el-icon> 查看审查结果详情
        </el-button>
        <el-button size="large" @click="handleExportReport">
          <el-icon><Download /></el-icon> 导出 Excel 报告
        </el-button>
        <el-button size="large" @click="handleClearResult">
          <el-icon><RefreshRight /></el-icon> 重新自检
        </el-button>
      </template>
    </el-result>


  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  FolderOpened, UploadFilled, Search, Download,
  RefreshRight, Check,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadInstance } from 'element-plus'
import {
  getSelfCheckLibraryInfoApi,
  runSelfCheckApi,
  exportSelfCheckReportApi,
  type LibraryInfoAPI,
  type SelfCheckReportAPI,
} from '@/api/self-check'

const router = useRouter()

// ==================== 标准库信息 ====================
const libraryTotal = ref(0)

const fetchLibraryInfo = async () => {
  try {
    const { data } = await getSelfCheckLibraryInfoApi()
    libraryTotal.value = data?.total || 0
  } catch (e) {
    console.error('获取标准库信息失败:', e)
  }
}

// ==================== 文件上传 ====================
const uploadRef = ref<UploadInstance>()
const fileList = ref<UploadFile[]>([])

const canRunCheck = computed(() => {
  return fileList.value.length > 0 && !checkRunning.value
})

// ==================== 自检执行 ====================
const checkRunning = ref(false)
const report = ref<SelfCheckReportAPI | null>(null)

const handleRunCheck = async () => {
  if (fileList.value.length === 0) {
    ElMessage.warning('请先上传待检文件')
    return
  }

  checkRunning.value = true
  report.value = null

  try {
    const formData = new FormData()
    for (const f of fileList.value) {
      if (f.raw) {
        formData.append('files', f.raw, f.name)
      }
    }

    const { data } = await runSelfCheckApi(formData)
    report.value = data
    ElMessage.success(`自检完成：${data.totalChecked} 条引用，${data.errorCount} 条存在问题`)
    // 跳转到 TaskResultsView 详情页
    const taskId = (data as any).taskId
    if (taskId) {
      router.push(`/tasks/details/${taskId}`)
    }
  } catch (e: any) {
    console.error('自检失败:', e)
    ElMessage.error(e?.response?.data?.error || '自检执行失败，请重试')
  } finally {
    checkRunning.value = false
  }
}

/** 手动跳转详情 */
const handleGoToDetail = () => {
  const taskId = (report.value as any)?.taskId
  if (taskId) {
    router.push(`/tasks/details/${taskId}`)
  }
}

// ==================== 导出 ====================
const handleExportReport = async () => {
  if (!report.value) return
  try {
    const taskId = (report.value as any).taskId || report.value.id
    const { data } = await exportSelfCheckReportApi(taskId)
    const blob = data as unknown as Blob
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `标准引用自检报告_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    ElMessage.success('报告导出成功')
  } catch (e: any) {
    console.error('导出失败:', e)
    ElMessage.error('导出报告失败')
  }
}

const handleClearResult = () => {
  report.value = null
  fileList.value = []
}

// ==================== 初始化 ====================
onMounted(() => {
  fetchLibraryInfo()
})
</script>

<style scoped>
.self-check-container {
  padding: 20px 24px;
  max-width: 1400px;
  margin: 0 auto;
  background: var(--el-fill-color-lighter);
}

.check-header {
  margin-bottom: 20px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.header-title .el-icon {
  color: var(--el-color-primary);
}

.header-desc {
  margin: 8px 0 0 38px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

/* 配置卡片 */
.config-card {
  margin-bottom: 20px;
  border-radius: 12px;
  border: none;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-item {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.config-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.config-label .el-icon {
  font-size: 16px;
  color: var(--el-color-primary);
}

.config-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.library-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--el-text-color-primary);
  padding: 6px 14px;
  background: var(--el-color-primary-light-9);
  border-radius: 8px;
}

.library-info .el-icon {
  color: var(--el-color-success);
}

.upload-area {
  flex: 1;
  min-width: 400px;
}

.config-actions {
  display: flex;
  gap: 12px;
  padding-left: 136px;
  flex-wrap: wrap;
}

/* 结果卡片 */
.result-card {
  border-radius: 12px;
  border: none;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
}

.result-summary {
  display: flex;
  gap: 8px;
}

.result-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 错误/正确文本样式 */
.error-text {
  color: var(--el-color-danger);
  font-weight: 600;
}

.correct-text {
  color: var(--el-color-success);
}

.no-match {
  color: var(--el-color-danger);
  font-weight: 700;
  font-size: 18px;
}

/* 表格优化 */
.result-card :deep(.el-table) {
  border-radius: 8px;
  overflow: hidden;
}

.result-card :deep(.el-table th.el-table__cell) {
  font-weight: 600;
  font-size: 13px;
  background: var(--el-fill-color-light);
}

.result-row:hover {
  background: var(--el-color-primary-light-9) !important;
}

/* ======== 原文定位预览面板 ======== */
.preview-panel {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 原文内容 */
.preview-content {
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
  font-family: 'Consolas', 'Courier New', 'SimSun', monospace;
}

.preview-no-content {
  color: var(--el-text-color-placeholder);
  font-style: italic;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 13px;
  line-height: 2;
  color: var(--el-text-color-primary);
}

.preview-line {
  display: block;
  min-height: 1.6em;
}

.line-num {
  display: inline-block;
  width: 48px;
  padding-right: 12px;
  text-align: right;
  color: var(--el-text-color-placeholder);
  font-weight: 400;
  font-size: 11px;
  user-select: none;
  margin-right: 8px;
}

/* 匹配高亮 */
.mark-highlight {
  padding: 1px 4px;
  border-radius: 3px;
  transition: box-shadow 0.2s;
}

.match-highlight {
  padding: 2px 4px;
  border-radius: 4px;
  font-weight: 600;
  scroll-margin: 60px;
  transition: box-shadow 0.3s;
}

.match-ok {
  background: #d4edda;
  color: #155724;
  border-bottom: 2px solid #28a745;
}

.match-error {
  background: #fff3cd;
  color: #856404;
  border-bottom: 2px solid #ffc107;
}

/* 字符级错误 */
mark.char-error {
  background: #f8d7da;
  color: #721c24;
  padding: 1px 2px;
  border-radius: 2px;
  cursor: help;
  border-bottom: 2px dashed #dc3545;
  position: relative;
}

mark.char-error:hover {
  background: #dc3545;
  color: #fff;
}

mark.char-error::after {
  content: '→ ' attr(data-correct);
  position: absolute;
  left: 0;
  top: 100%;
  white-space: nowrap;
  background: #333;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  z-index: 10;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

mark.char-error:hover::after {
  opacity: 1;
}

/* 错误详情卡片 */
.preview-errors {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 16px 16px;
}

.error-detail-card {
  flex: 1;
  min-width: 280px;
}

.error-detail-card :deep(.el-card__header) {
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
}

.error-detail-body {
  font-size: 13px;
}

.diff-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  flex-wrap: wrap;
  line-height: 1.8;
}

.diff-label {
  font-weight: 600;
  color: var(--el-text-color-secondary);
  min-width: 72px;
}

.diff-wrong {
  color: var(--el-color-danger);
  font-family: monospace;
  background: #fde8e8;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px dashed var(--el-color-danger);
}

.diff-arrow {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.diff-correct {
  color: var(--el-color-success);
  font-family: monospace;
  background: #e8f5e9;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}

/* 未选中条目占位 */
.preview-empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: var(--el-text-color-placeholder);
  gap: 12px;
}

.preview-empty-hint p {
  margin: 0;
  font-size: 14px;
}
</style>
