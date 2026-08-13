<template>
  <div class="self-check-container">
    <!-- 头部：标题 + 步骤条 -->
    <div class="check-header">
      <div class="header-top">
        <div class="header-title">
          <el-icon :size="26"><Checked /></el-icon>
          <span>标准引用自检</span>
        </div>
        <el-button v-if="report" type="primary" link size="small" @click="handleGoToDetail">
          <el-icon><Document /></el-icon> 查看详细结果
        </el-button>
      </div>
      <p class="header-desc">上传设计文件，自动提取其中的标准引用并与标准库比对，生成自检报告</p>

      <!-- 步骤引导条 -->
      <div class="step-bar">
        <div class="step-item" :class="{ active: true, completed: fileList.length > 0 }">
          <span class="step-circle"><UploadFilled v-if="!fileList.length" /><Check v-else /></span>
          <span class="step-label">上传文件</span>
        </div>
        <div class="step-line" :class="{ active: fileList.length > 0 }"></div>
        <div class="step-item" :class="{ active: fileList.length > 0, completed: checkRunning || report }">
          <span class="step-circle"><Search v-if="!checkRunning && !report" :size="12" /><Loading v-else-if="checkRunning" :size="12" class="is-loading" /><Check v-else /></span>
          <span class="step-label">{{ checkRunning ? '检查中...' : report ? '完成' : '执行自检' }}</span>
        </div>
        <div class="step-line" :class="{ active: !!report }"></div>
        <div class="step-item" :class="{ active: !!report, completed: !!report }">
          <span class="step-circle"><Document /></span>
          <span class="step-label">查看报告</span>
        </div>
      </div>
    </div>

    <!-- 主内容区：双栏布局 -->
    <div class="main-layout">
      <!-- 左栏：参照标准库 -->
      <div class="panel-left">
        <div class="panel-card">
          <div class="panel-card__header">
            <h4 class="panel-card__title">
              <el-icon><FolderOpened /></el-icon> 参照标准库
            </h4>
            <el-tag type="success" effect="plain" size="small" round>{{ libraryTotal.toLocaleString() }} 条</el-tag>
          </div>

          <!-- 简洁信息展示 -->
          <div class="library-info">
            <div class="library-info__icon">
              <el-icon :size="32"><FolderOpened /></el-icon>
            </div>
            <div class="library-info__content">
              <p class="library-info__text">标准库中共有 <strong>{{ libraryTotal.toLocaleString() }}</strong> 条标准引用数据</p>
              <p class="library-info__hint">系统将自动与全部标准清单进行比对分析</p>
            </div>
            <el-button type="primary" plain size="small" @click="$router.push('/standards')">
              <el-icon><View /></el-icon> 查看标准库
            </el-button>
          </div>
        </div>
      </div>

      <!-- 右栏：文件上传 + 操作 + 结果 -->
      <div class="panel-right">
        <!-- 上传区域 -->
        <div class="panel-card upload-card">
          <div class="panel-card__header">
            <h4 class="panel-card__title">
              <el-icon><UploadFilled /></el-icon> 待检设计文件
            </h4>
            <span class="upload-count" v-if="fileList.length">
              已选 {{ fileList.length }} / 20 个
            </span>
          </div>

          <div class="upload-body">
            <!-- 格式标签 -->
            <div class="format-tags">
              <span class="format-tag" v-for="fmt in supportedFormats" :key="fmt.ext">
                <span class="format-dot" :style="{ background: fmt.color }"></span>
                {{ fmt.ext }}
              </span>
            </div>

            <!-- 拖拽上传区（紧凑型） -->
            <el-upload
              ref="uploadRef"
              v-model:file-list="fileList"
              :auto-upload="false"
              :accept="'.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.dwg,.txt'"
              :limit="20"
              :on-exceed="handleExceed"
              multiple
              drag
              class="upload-area--compact"
            >
              <div class="upload-compact-inner">
                <el-icon class="upload-icon" :size="32" color="var(--color-gray-400)"><UploadFilled /></el-icon>
                <p class="upload-text">将文件拖到此处，或 <em>点击选择</em></p>
              </div>
            </el-upload>

            <!-- 文件列表预览 -->
            <div v-if="fileList.length" class="file-list-preview">
              <div v-for="file in fileList" :key="file.uid" class="file-item">
                <el-icon class="file-icon" :style="{ color: getFileIconColor(file) }"><Document /></el-icon>
                <span class="file-name" :title="file.name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size) }}</span>
                <el-icon class="file-remove" @click="removeFile(file)"><Close /></el-icon>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮栏 -->
        <div class="action-bar">
          <el-button
            type="primary"
            size="large"
            :loading="checkRunning"
            :disabled="!canRunCheck"
            class="action-btn--primary"
            @click="handleRunCheck"
          >
            <el-icon><Search /></el-icon>
            {{ checkRunning ? '正在自检...' : '开始自检' }}
          </el-button>
        </div>

        <!-- 结果展示卡片 -->
        <transition name="result-fade">
          <div v-if="report" class="panel-card result-card">
            <div class="result-header">
              <div class="result-status" :class="report.errorCount === 0 ? 'result-status--ok' : 'result-status--warn'">
                <el-icon :size="20"><CircleCheckFilled v-if="report.errorCount === 0" /><WarningFilled v-else /></el-icon>
                <span>{{ report.errorCount === 0 ? '全部通过' : `发现 ${report.errorCount} 处问题` }}</span>
              </div>
            </div>

            <div class="result-stats">
              <div class="stat-item">
                <span class="stat-value">{{ report.totalChecked }}</span>
                <span class="stat-label">总引用数</span>
              </div>
              <div class="stat-divider"></div>
              <div class="stat-item stat-item--good">
                <span class="stat-value">{{ report.matchedCount }}</span>
                <span class="stat-label">完全匹配</span>
              </div>
              <div class="stat-divider"></div>
              <div class="stat-item" :class="report.errorCount > 0 ? 'stat-item--bad' : ''">
                <span class="stat-value">{{ report.errorCount }}</span>
                <span class="stat-label">存在问题</span>
              </div>
            </div>

            <!-- 匹配率进度条 -->
            <div class="match-progress">
              <div class="progress-info">
                <span class="progress-label">匹配率</span>
                <span class="progress-percent">{{ matchPercent }}%</span>
              </div>
              <el-progress
                :percentage="matchPercent"
                :color="progressColor"
                :stroke-width="10"
                :show-text="false"
              />
            </div>

            <div class="result-actions">
              <el-button type="primary" @click="handleGoToDetail">
                <el-icon><View /></el-icon> 查看详细结果
              </el-button>
              <el-button @click="handleExportReport">
                <el-icon><Download /></el-icon> 导出报告
              </el-button>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  FolderOpened, UploadFilled, Search, Download,
  RefreshRight, Check, Checked,
  Document, Close, Loading,
  CircleCheckFilled, WarningFilled, View,
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
import { createTaskApi } from '@/api/task'

const router = useRouter()

// JS 数据：Office 文件格式官方品牌专用色，无设计令牌对应，保持原值
const supportedFormats = [
  { ext: 'DOCX', color: '#2B579A' },
  { ext: 'DOC', color: '#2B579A' },
  { ext: 'XLSX', color: '#217346' },
  { ext: 'XLS', color: '#207245' },
  { ext: 'PDF', color: '#F40F02' },
  { ext: 'PPTX', color: '#D04423' },
  { ext: 'PPT', color: '#D04423' },
  { ext: 'DWG', color: '#E36C09' },
  { ext: 'TXT', color: '#909399' },
]

// ==================== 标准库信息（真实数据）====================
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

const canRunCheck = computed(() => fileList.value.length > 0 && !checkRunning.value)

const handleExceed = (files: File[]) => {
  const limit = 20
  const remaining = limit - fileList.value.length
  if (remaining <= 0) {
    ElMessage.warning(`已达最大文件数量限制（${limit} 个），无法继续添加。`)
    return
  }
  
  const filesToAdd = files.slice(0, remaining)
  const ignoredCount = files.length - remaining
  
  filesToAdd.forEach(file => {
    fileList.value.push({
      name: file.name,
      size: file.size,
      raw: file,
      uid: Date.now() + Math.random(),
    } as UploadFile)
  })
  
  if (ignoredCount > 0) {
    ElMessage.warning(`已添加前 ${remaining} 个文件，忽略 ${ignoredCount} 个超出限制的文件。`)
  } else {
    ElMessage.success(`已成功添加 ${remaining} 个文件。`)
  }
}

const removeFile = (file: UploadFile) => {
  const idx = fileList.value.findIndex(f => f.uid === file.uid)
  if (idx >= 0) fileList.value.splice(idx, 1)
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

// JS 逻辑：文件格式品牌专用色，无设计令牌对应，保持原值
const getFileIconColor = (file: UploadFile): string => {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.pdf')) return '#F40F02'
  if (name.endsWith('.docx') || name.endsWith('.doc')) return '#2B579A'
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '#217346'
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) return '#D04423'
  if (name.endsWith('.dwg')) return '#E36C09'
  return '#909399'
}

// ==================== 自检执行 ====================
const checkRunning = ref(false)
const report = ref<SelfCheckReportAPI | null>(null)

const matchPercent = computed(() => {
  if (!report.value || !report.value.totalChecked) return 0
  return Math.round((report.value.matchedCount / report.value.totalChecked) * 1000) / 10
})

// JS 逻辑：EP 语义色，可对齐 --corp-success/--corp-warning/--corp-danger，保持原值
const progressColor = computed(() => {
  const p = matchPercent.value
  if (p >= 95) return '#67C23A'
  if (p >= 80) return '#E6A23C'
  return '#F56C6C'
})

const handleRunCheck = async () => {
  if (fileList.value.length === 0) {
    ElMessage.warning('请先上传待检文件')
    return
  }

  checkRunning.value = true
  report.value = null

  try {
    const formData = new FormData()
    const dwgParsedData: Record<string, any> = {}

    for (const f of fileList.value) {
      if (f.raw) {
        formData.append('files', f.raw, f.name)
        // DWG 文件在前端 WASM 解析，提取文本后传给后端
        if (f.name.toLowerCase().endsWith('.dwg')) {
          try {
            const { parseDwgFile } = await import('@/utils/dwg-parser')
            const parsed = await parseDwgFile(f.raw)
            dwgParsedData[f.name] = parsed
          } catch (dwgErr: any) {
            console.error(`[SelfCheck] DWG 解析失败: ${f.name}`, dwgErr)
            const msg = dwgErr?.message || ''
            if (msg.includes('R2004') || msg.includes('decompress') || msg.includes('Assertion')) {
              ElMessage.warning({
                message: `图纸 ${f.name} 解析失败：DWG 版本格式不兼容（R2004/R2007 压缩编码）。请用 AutoCAD 另存为 R18 (2010) 或 R21 (2013) 格式后重试。`,
                duration: 8000,
              })
            } else {
              ElMessage.warning(`图纸 ${f.name} 解析失败：${msg || '未知错误'}`)
            }
          }
        }
      }
    }

    // 附带 DWG 解析数据
    if (Object.keys(dwgParsedData).length > 0) {
      formData.append('dwgParsedData', JSON.stringify(dwgParsedData))
    }

    const { data } = await runSelfCheckApi(formData)
    const taskId = data.taskId
    if (taskId) {
      ElMessage.success('自检任务已创建，正在后台执行')
      router.push(`/tasks/details/${taskId}`)
    } else {
      ElMessage.warning('任务创建成功，正在跳转到任务列表...')
      router.push('/tasks')
    }
  } catch (e: any) {
    console.error('自检失败:', e)
    ElMessage.error(e?.response?.data?.error || '自检执行失败，请重试')
  } finally {
    checkRunning.value = false
  }
}

const handleGoToDetail = () => {
  const taskId = (report.value as any)?.taskId
  if (taskId) {
    router.push(`/tasks/details/${taskId}`)
  }
}

// ==================== 自动创建任务 ====================
const handleCreateTask = async () => {
  if (fileList.value.length === 0) {
    ElMessage.warning('请先上传待检文件')
    return
  }

  checkRunning.value = true

  try {
    const formData = new FormData()
    const dwgParsedData: Record<string, any> = {}

    for (const f of fileList.value) {
      if (f.raw) {
        formData.append('files', f.raw, f.name)
        // DWG 文件在前端 WASM 解析，提取文本后传给后端
        if (f.name.toLowerCase().endsWith('.dwg')) {
          try {
            const { parseDwgFile } = await import('@/utils/dwg-parser')
            const parsed = await parseDwgFile(f.raw)
            dwgParsedData[f.name] = parsed
          } catch (dwgErr: any) {
            console.error(`[SelfCheck] DWG 解析失败: ${f.name}`, dwgErr)
            const msg = dwgErr?.message || ''
            if (msg.includes('R2004') || msg.includes('decompress') || msg.includes('Assertion')) {
              ElMessage.warning({
                message: `图纸 ${f.name} 解析失败：DWG 版本格式不兼容（R2004/R2007 压缩编码）。请用 AutoCAD 另存为 R18 (2010) 或 R21 (2013) 格式后重试。`,
                duration: 8000,
              })
            } else {
              ElMessage.warning(`图纸 ${f.name} 解析失败：${msg || '未知错误'}`)
            }
          }
        }
      }
    }

    // 附带 DWG 解析数据
    if (Object.keys(dwgParsedData).length > 0) {
      formData.append('dwgParsedData', JSON.stringify(dwgParsedData))
    }

    // 自动生成标题：取前3个文件名
    const fileNames = fileList.value.map(f => f.name)
    const titlePrefix = fileNames.length <= 3
      ? fileNames.join('、')
      : fileNames.slice(0, 3).join('、') + ` 等${fileNames.length}个文件`
    formData.append('title', `标准引用自检 - ${titlePrefix}`)
    formData.append('reviewMode', 'SELF_CHECK')

    // 创建任务
    const { data } = await createTaskApi(formData)
    ElMessage.success('任务创建成功，正在跳转...')

    // 立即跳转到任务详情页
    if (data?.id) {
      router.push(`/tasks/details/${data.id}`)
    } else {
      router.push('/tasks')
    }
  } catch (e: any) {
    console.error('创建任务失败:', e)
    ElMessage.error(e?.response?.data?.error || '创建任务失败，请重试')
  } finally {
    checkRunning.value = false
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

// ==================== 初始化 ====================
onMounted(() => {
  fetchLibraryInfo()
})
</script>

<style scoped>
.self-check-container {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
  background: var(--el-fill-color-lighter);
  min-height: calc(100vh - 84px);
  overflow: hidden;
}

/* ====== 头部区域 ====== */
.check-header {
  margin-bottom: 24px;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  margin: 8px 0 16px 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

/* 步骤条 */
.step-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 14px 24px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  transition: color 0.25s;
}

.step-item.active {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.step-item.completed {
  color: var(--el-color-success);
}

.step-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--el-border-color);
  font-size: 12px;
  transition: all 0.25s;
  flex-shrink: 0;
}

.step-item.active .step-circle {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.step-item.completed .step-circle {
  border-color: var(--el-color-success);
  color: #fff;
  background: var(--el-color-success);
}

.step-line {
  width: 48px;
  height: 2px;
  background: var(--el-border-color-lighter);
  margin: 0 8px;
  border-radius: 1px;
  transition: background 0.25s;
}

.step-line.active {
  background: var(--el-color-primary);
}

/* ====== 双栏主布局 ====== */
.main-layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 20px;
  align-items: stretch;
}

/* ====== 面板卡片通用样式 ====== */
.panel-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
  max-width: 100%;
}

.panel-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--el-fill-color-lighter);
}

.panel-card__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.panel-card__title .el-icon {
  color: var(--el-color-primary);
  font-size: 17px;
}

/* ====== 左栏：标准库 ====== */
.panel-left {
  position: sticky;
  top: 24px;
}

.library-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 20px 24px;
  text-align: center;
}

.library-info__icon {
  color: var(--el-color-primary);
  opacity: 0.45;
}

.library-info__content {
  width: 100%;
}

.library-info__text {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.library-info__text strong {
  color: var(--el-color-primary);
  font-size: 18px;
  font-weight: 700;
}

.library-info__hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  line-height: 1.5;
}

/* ====== 右栏 ====== */
.panel-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0; /* 防止 flex/grid 子元素溢出 */
}

/* --- 上传卡片 --- */
.upload-card .panel-card__header {
  padding-bottom: 10px;
}

.upload-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-color-primary-light-9);
  padding: 2px 10px;
  border-radius: 10px;
}

.upload-body {
  padding: 0 20px 18px;
}

.format-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.format-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 3px 10px;
  border-radius: 4px;
}

.format-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.upload-area--compact {
  width: 100%;
}

.upload-area--compact :deep(.el-upload-dragger) {
  padding: 28px 20px;
  border-radius: 10px;
  border-style: dashed;
  border-color: var(--el-border-color);
  background: var(--el-fill-color-blank);
  transition: all 0.2s;
}

.upload-area--compact :deep(.el-upload-dragger:hover) {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.upload-compact-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.upload-icon {
  color: var(--color-gray-400) !important;
}

.upload-text {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.upload-text em {
  color: var(--el-color-primary);
  font-style: normal;
  font-weight: 500;
}

/* 文件列表 */
.file-list-preview {
  margin-top: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  transition: background 0.15s;
}

.file-item:last-child {
  border-bottom: none;
}

.file-item:hover {
  background: var(--el-fill-color-lighter);
}

.file-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.file-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.file-size {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.file-remove {
  font-size: 14px;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}

.file-remove:hover {
  color: var(--el-color-danger);
}

/* --- 操作按钮栏 --- */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 4px 0;
}

.action-btn--primary {
  min-width: 140px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.action-btns--secondary {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* --- 结果卡片 --- */
.result-card {
  animation: resultSlideIn 0.35s ease-out;
}

@keyframes resultSlideIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.result-fade-enter-active {
  transition: all 0.35s ease-out;
}
.result-fade-leave-active {
  transition: all 0.2s ease-in;
}
.result-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.result-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.result-header {
  padding: 18px 20px 0;
}

.result-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 8px;
}

.result-status--ok {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.result-status--warn {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.result-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 20px 20px 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-value {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  color: var(--el-text-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.stat-item--good .stat-value {
  color: var(--el-color-success);
}

.stat-item--bad .stat-value {
  color: var(--el-color-danger);
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: var(--el-border-color-lighter);
}

.match-progress {
  padding: 0 20px 16px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.progress-percent {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 0 20px 20px;
  border-top: 1px solid var(--el-fill-color-lighter);
  padding-top: 16px;
}

/* ====== 响应式适配 ====== */
@media (max-width: 900px) {
  .main-layout {
    grid-template-columns: 1fr;
  }

  .panel-left {
    position: static;
  }

  .action-bar {
    flex-direction: column;
  }

  .action-btns--secondary {
    margin-left: 0;
    justify-content: stretch;
  }

  .action-btns--secondary .el-button {
    flex: 1;
  }
}
</style>
