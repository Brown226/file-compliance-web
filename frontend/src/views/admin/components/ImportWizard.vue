<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="handleClose"
    title="导入文档"
    width="900px"
    destroy-on-close
    :close-on-click-modal="false"
    class="import-wizard"
  >
    <div class="iw-body">
      <el-alert
        v-if="lastError"
        :title="lastError"
        type="error"
        show-icon
        :closable="false"
        class="iw-alert"
      />

      <!-- 自定义 Step Bar（2 步） -->
      <div class="step-bar">
        <template v-for="(step, idx) in steps" :key="idx">
          <div
            class="step-item"
            :class="{
              'is-active': currentStep === idx,
              'is-done': currentStep > idx,
            }"
          >
            <span class="step-num">{{ idx + 1 }}</span>
            <span class="step-label">{{ step }}</span>
          </div>
          <span
            v-if="idx < steps.length - 1"
            class="step-line"
            :class="{
              'is-active': currentStep === idx + 1,
              'is-done': currentStep > idx + 1,
            }"
          />
        </template>
      </div>

      <!-- ========== Step 0: 选择文件 + 配置参数 ========== -->
      <div v-if="currentStep === 0" class="iw-step iw-step--setup">
        <div v-if="processing" class="iw-progress-overlay">
          <div class="iw-progress-card">
            <el-icon class="is-loading iw-progress-card__icon" :size="28"><Loading /></el-icon>
            <div class="iw-progress-card__title">正在解析文件</div>
            <div class="iw-progress-card__file">{{ parseProgress.currentFile || '准备中...' }}</div>
            <el-progress
              :percentage="parseProgress.percent"
              :stroke-width="8"
              :show-text="false"
              color="#409eff"
              style="width: 100%"
            />
            <span class="iw-progress-card__text">{{ parseProgress.currentIdx }} / {{ parseProgress.total }} 个文件</span>
          </div>
        </div>

        <template v-else>
          <!-- 文件区域 -->
          <div class="iw-setup-section">
            <div class="iw-setup-section__label">文件</div>
            <el-upload
              ref="uploadRef"
              drag
              multiple
              :auto-upload="false"
              :limit="limit"
              :accept="accept"
              :show-file-list="false"
              :on-change="handleFileChange"
              :file-list="fileList"
              class="iw-upload"
              :class="{ 'iw-upload--compact': fileList.length > 0 }"
            >
              <div class="iw-upload__content">
                <el-icon class="iw-upload__icon" :size="36"><UploadFilled /></el-icon>
                <div class="iw-upload__text">点击或拖动文件到此处上传</div>
                <div class="iw-upload__tip">支持 {{ acceptLabel }} 格式，单次最多 {{ limit }} 个文件</div>
              </div>
            </el-upload>
            <div v-if="fileList.length > 0" class="iw-file-cards">
              <div v-for="(file, idx) in fileList" :key="idx" class="iw-file-card">
                <div class="iw-file-card__icon">
                  <el-icon :size="22" :color="getFileColor(file.name)"><Document /></el-icon>
                </div>
                <div class="iw-file-card__info">
                  <div class="iw-file-card__name" :title="file.name">{{ file.name }}</div>
                  <div class="iw-file-card__meta">{{ formatFileSize(file.size) }}</div>
                </div>
                <el-button type="danger" text size="small" class="iw-file-card__del" @click="removeFileByIndex(idx)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>

          <!-- 分割线 -->
          <div class="iw-setup-divider" />

          <!-- 配置区域 -->
          <div class="iw-setup-section iw-setup-section--config">
            <div class="iw-form-row iw-form-row--block">
              <label class="iw-form-label">分块模式</label>
              <div class="iw-radio-group">
                <div class="iw-radio-card" :class="{ 'is-active': chunkConfig.mode === 'auto' }" @click="chunkConfig.mode = 'auto'">
                  <span class="iw-radio-dot" :class="{ 'is-active': chunkConfig.mode === 'auto' }" />
                  <span class="iw-radio-text">智能分段</span>
                  <span class="iw-radio-desc">自动识别标题层级进行分段</span>
                </div>
                <div class="iw-radio-card" :class="{ 'is-active': chunkConfig.mode === 'fixed' }" @click="chunkConfig.mode = 'fixed'">
                  <span class="iw-radio-dot" :class="{ 'is-active': chunkConfig.mode === 'fixed' }" />
                  <span class="iw-radio-text">固定长度</span>
                  <span class="iw-radio-desc">按指定字符数均匀切分</span>
                </div>
                <div class="iw-radio-card" :class="{ 'is-active': chunkConfig.mode === 'paragraph' }" @click="chunkConfig.mode = 'paragraph'">
                  <span class="iw-radio-dot" :class="{ 'is-active': chunkConfig.mode === 'paragraph' }" />
                  <span class="iw-radio-text">按段落分割</span>
                  <span class="iw-radio-desc">以双换行符为边界分段</span>
                </div>
              </div>
            </div>

            <div class="iw-form-row">
              <label class="iw-form-label">分块大小</label>
              <div class="iw-inline-inputs">
                <el-input-number v-model="chunkConfig.maxChars" :min="100" :max="8000" :step="100" size="small" controls-position="right" style="width: 150px;" />
                <span class="iw-form-hint">每段最多字符</span>
                <span class="iw-form-sep" />
                <label class="iw-form-label iw-form-label--inline">重叠</label>
                <el-input-number v-model="chunkConfig.overlap" :min="0" :max="1000" :step="20" size="small" controls-position="right" style="width: 120px;" />
                <span class="iw-form-hint">相邻段重复长度</span>
              </div>
            </div>

            <div class="iw-form-row">
              <label class="iw-form-label">索引增强</label>
              <div class="iw-check-group">
                <el-checkbox v-model="indexSettings.titleToIndex">将标题加入索引</el-checkbox>
                <el-tooltip content="在向量嵌入时包含文档标题，提高检索准确率" placement="top">
                  <el-icon class="iw-tip-icon"><InfoFilled /></el-icon>
                </el-tooltip>
                <span class="iw-form-sep" />
                <label class="iw-form-label iw-form-label--inline">高级</label>
                <el-checkbox v-model="chunkConfig.contextualRetrieval">上下文感知分块</el-checkbox>
                <el-tooltip content="使用 LLM 为每个分段生成上下文摘要后再嵌入，效果更好但速度较慢" placement="top">
                  <el-icon class="iw-tip-icon"><InfoFilled /></el-icon>
                </el-tooltip>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ========== Step 1: 预览 & 确认导入（合并） ========== -->
      <div v-if="currentStep === 1" class="iw-step iw-step--preview">
        <template v-if="previewFileResults.length > 0">
          <div class="iw-preview-layout">
            <div class="iw-preview-sidebar">
              <div class="iw-preview-sidebar__title">文件列表</div>
              <div
                v-for="(f, fIdx) in previewFiles"
                :key="fIdx"
                class="iw-preview-file-item"
                :class="{ 'is-selected': selectedPreviewFileIdx === fIdx }"
                @click="selectedPreviewFileIdx = fIdx"
              >
                <el-icon :size="16"><Document /></el-icon>
                <span class="iw-preview-file-item__name">{{ f.name }}</span>
              </div>
            </div>
            <div class="iw-preview-main">
              <div class="iw-preview-main__header">
                <span>分块预览</span>
                <span class="iw-preview-main__count">共 {{ currentFileChunkCount }} 个分段</span>
              </div>
              <div class="iw-preview-stream">
                <div
                  v-for="(chunk, cIdx) in displayChunks"
                  :key="cIdx"
                  class="iw-chunk-item"
                  :class="{ 'iw-chunk-item--last': cIdx === displayChunks.length - 1 }"
                >
                  <div class="iw-chunk-item__content" v-html="renderMarkdown(chunk.content)" />
                </div>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else description="未能生成有效分段" />
      </div>
    </div>

    <template #footer>
      <div class="iw-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-tooltip
          v-if="currentStep === 0"
          :content="!canProceedFromStep1 ? '请先选择要上传的文件' : ''"
          placement="top"
          :disabled="canProceedFromStep1"
        >
          <el-button
            type="primary"
            :disabled="!canProceedFromStep1 || processing"
            :loading="processing"
            @click="handleStartParse"
          >
            开始解析
          </el-button>
        </el-tooltip>
        <el-tooltip
          v-if="currentStep === 1"
          :content="previewFileResults.length === 0 ? '没有可导入的分段数据' : ''"
          placement="top"
          :disabled="previewFileResults.length > 0"
        >
          <el-button
            type="primary"
            :loading="importing"
            :disabled="previewFileResults.length === 0"
            @click="handleConfirmImport"
          >
            确认导入 ({{ fileList.length }} 个文件)
          </el-button>
        </el-tooltip>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue'
import {
  UploadFilled,
  Document,
  Delete,
  FolderOpened,
  Setting,
  InfoFilled,
  Loading,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  uploadDocumentAsyncApi,
  previewDocumentApi,
  confirmImportApi,
  type PreviewResult,
  type ParagraphSegment,
} from '@/api/knowledge-category'

const props = withDefaults(defineProps<{
  modelValue: boolean
  targetId: string
  targetName?: string
  accept?: string
  limit?: number
}>(), {
  accept: '.docx,.doc,.pdf,.xlsx,.xls,.txt,.md',
  limit: 10,
})

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'imported', taskIds?: string[]): void
}>()

const steps = ['选择配置', '预览确认']
const currentStep = ref(0)
const lastError = ref('')
const importing = ref(false)

const acceptLabel = computed(() => {
  return props.accept.replace(/\./g, '').toUpperCase().replace(/,/g, '/')
})

// ===== Step 1: 文件选择 =====
const uploadRef = ref()
const fileList = ref<any[]>([])

const handleFileChange = (_file: any, files: any[]) => {
  fileList.value = files
}

const removeFileByIndex = (idx: number) => {
  fileList.value.splice(idx, 1)
}

const canProceedFromStep1 = computed(() => {
  return fileList.value.length > 0
})

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const getFileColor = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const colors: Record<string, string> = {
    pdf: '#f56c6c', docx: '#409eff', doc: '#409eff',
    xlsx: '#67c23a', xls: '#67c23a', txt: '#909399',
    md: '#e6a23c', html: '#e6a23c', pptx: '#f56c6c',
  }
  return colors[ext] || '#909399'
}

// ===== 解析 & 导入 =====
const processing = ref(false)
const parseProgress = reactive({ currentIdx: 0, total: 0, currentFile: '', percent: 0 })

const chunkConfig = ref({
  mode: 'auto' as 'auto' | 'fixed' | 'paragraph',
  maxChars: 900,
  overlap: 120,
  contextualRetrieval: false,
})

const indexSettings = ref({
  titleToIndex: true,
})

interface FilePreviewResult { name: string; title: string; chunks: ParagraphSegment[] }
const previewFileResults = ref<FilePreviewResult[]>([])
const selectedPreviewFileIdx = ref(0)
const renderMarkdown = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

const previewFiles = computed(() => previewFileResults.value)

const displayChunks = computed(() => {
  const files = previewFileResults.value
  if (!files.length) return []
  const idx = selectedPreviewFileIdx.value
  return (files[idx]?.chunks || []).slice(0, 50)
})

const currentFileChunkCount = computed(() => {
  const files = previewFileResults.value
  if (!files.length) return 0
  return (files[selectedPreviewFileIdx.value]?.chunks || []).length
})

const activeFileChunks = computed(() => {
  const files = previewFileResults.value
  if (!files.length) return []
  return files[selectedPreviewFileIdx.value]?.chunks || []
})

const removeChunk = (idx: number) => {
  const fileIdx = selectedPreviewFileIdx.value
  if (previewFileResults.value[fileIdx]) {
    previewFileResults.value[fileIdx].chunks.splice(idx, 1)
  }
}

const handleStartParse = async () => {
  lastError.value = ''
  if (!props.targetId) { ElMessage.warning('未选择目标'); return }
  if (!fileList.value.length) { ElMessage.warning('请先选择文件'); return }

  processing.value = true
  previewFileResults.value = []

  const totalFiles = fileList.value.length
  parseProgress.total = totalFiles
  parseProgress.currentIdx = 0
  parseProgress.currentFile = fileList.value[0]?.name || ''
  parseProgress.percent = 5

  const progressTimer = setInterval(() => {
    if (parseProgress.percent < 85) {
      parseProgress.percent += Math.random() * 4 + 2
      const nextIdx = Math.min(Math.floor(parseProgress.percent / 90 * totalFiles), totalFiles - 1)
      if (nextIdx !== parseProgress.currentIdx) {
        parseProgress.currentIdx = nextIdx
        parseProgress.currentFile = fileList.value[nextIdx]?.name || ''
      }
    }
  }, 500)

  try {
    const fd = new FormData()
    fileList.value.forEach(f => fd.append('file', f.raw))
    fd.append('chunkMode', chunkConfig.value.mode)
    fd.append('maxChars', String(chunkConfig.value.maxChars))
    fd.append('overlap', String(chunkConfig.value.overlap))
    fd.append('embeddingUseDocumentTitle', String(indexSettings.value.titleToIndex))
    fd.append('contextualRetrieval', String(chunkConfig.value.contextualRetrieval))

    const { data } = await previewDocumentApi(props.targetId, fd) as any
    clearInterval(progressTimer)
    previewFileResults.value = (data.files || [])
    selectedPreviewFileIdx.value = 0
    parseProgress.currentIdx = totalFiles
    parseProgress.currentFile = '解析完成'
    parseProgress.percent = 100
    setTimeout(() => {
      processing.value = false
      currentStep.value = 1
    }, 400)
  } catch (err: any) {
    clearInterval(progressTimer)
    lastError.value = err?.response?.data?.message || err?.message || '解析失败'
    ElMessage.error(lastError.value)
    processing.value = false
  }
}

// ===== 确认导入 =====
const handleConfirmImport = async () => {
  if (!fileList.value.length || !previewFileResults.value.length) return
  importing.value = true
  try {
    const documents = previewFileResults.value.map(f => ({
      title: f.title,
      chunks: f.chunks,
    }))
    await confirmImportApi(props.targetId, {
      documents,
      metadata: {
        chunkMode: chunkConfig.value.mode,
        maxChars: chunkConfig.value.maxChars,
        overlap: chunkConfig.value.overlap,
        embeddingUseDocumentTitle: indexSettings.value.titleToIndex,
        contextualRetrieval: chunkConfig.value.contextualRetrieval,
      },
    })
    ElMessage.success(`导入成功，${fileList.value.length} 个文档`)
    emit('imported')
    resetAndClose()
  } catch (err: any) {
    lastError.value = err?.response?.data?.message || err?.message || '导入失败'
    ElMessage.error(lastError.value)
  } finally {
    importing.value = false
  }
}

// ===== 对话框管理 =====
const resetState = () => {
  currentStep.value = 0
  lastError.value = ''
  fileList.value = []
  previewFileResults.value = []
  selectedPreviewFileIdx.value = 0
  chunkConfig.value = { mode: 'auto', maxChars: 900, overlap: 120, contextualRetrieval: false }
  indexSettings.value = { titleToIndex: true }
}

const resetAndClose = () => {
  resetState()
  emit('update:modelValue', false)
}

const handleClose = () => {
  if (currentStep.value > 0 && (fileList.value.length > 0 || previewFileResults.value.length > 0)) {
    resetAndClose()
    return
  }
  resetState()
  emit('update:modelValue', false)
}
</script>

<style scoped>
.import-wizard :deep(.el-dialog__body) {
  padding: 20px 24px;
}

.iw-alert {
  margin-bottom: 16px;
}

.iw-body {
  min-height: 360px;
  max-height: 58vh;
  overflow-y: auto;
}

.iw-step {
  min-height: 280px;
}

/* ========== 自定义 Step Bar ========== */
.step-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 16px 24px;
  background: #f7f8fa;
  border-radius: 8px;
  margin-bottom: 20px;
}
.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
  transition: all 0.25s;
  border: 1px solid #dcdfe6;
  background: white;
  color: #909399;
  box-sizing: border-box;
}
.step-item.is-active .step-num {
  background: #409eff;
  color: white;
  border-color: #409eff;
  box-shadow: 0 2px 6px rgba(64,158,255,0.35);
}
.step-item.is-done .step-num {
  background: #67c23a;
  color: white;
  border-color: #67c23a;
}
.step-label {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  color: #909399;
}
.step-item.is-active .step-label {
  color: #303133;
  font-weight: 600;
}
.step-line {
  width: 60px;
  height: 2px;
  background: #e4e7ed;
  margin: 0 12px;
  flex-shrink: 0;
  border-radius: 1px;
}
.step-line.is-active {
  background: #409eff;
}
.step-line.is-done {
  background: #67c23a;
}

/* ========== Step 1: 选择文件 ========== */
.iw-upload :deep(.el-upload-dragger) {
  border-radius: 12px;
  border: 2px dashed #dcdfe6;
  background: #fafbfc;
  padding: 48px 32px;
  transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
}
.iw-upload :deep(.el-upload-dragger:hover) {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 3px rgba(64,158,255,0.08);
}
.iw-upload__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.iw-upload__icon {
  color: #c0c4cc;
}
.iw-upload__text {
  font-size: 14px;
  color: #606266;
  font-weight: 500;
}
.iw-upload__tip {
  font-size: 12px;
  color: #909399;
  font-weight: 500;
}

/* Step 1 文件卡片网格 - 响应式自适应布局 */
.iw-file-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
  margin-top: 16px;
  overflow: hidden;
}
.iw-file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: white;
  transition: all 0.2s;
  min-width: 0;
  overflow: hidden;
}
.iw-file-card:hover { border-color: #c0c4cc; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.iw-file-card__icon { flex-shrink: 0; }
.iw-file-card__info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.iw-file-card__name {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
  max-width: 100%;
}
.iw-file-card__meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.iw-file-card__done { color: #67c23a; font-weight: 700; }
.iw-file-card__progress { color: #409eff; font-weight: 500; }
.iw-file-card__del { flex-shrink: 0; opacity: 0.5; }
.iw-file-card__del:hover { opacity: 1; }

/* ========== Step 0: 选择配置（上下分栏） ========== */
.iw-step--setup {
  padding: 4px 0;
  position: relative;
}
.iw-setup-section {
  margin-bottom: 8px;
}
.iw-setup-section__label {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 10px;
}
.iw-setup-section--config {
  padding-top: 4px;
}
.iw-setup-divider {
  height: 1px;
  background: #e4e7ed;
  margin: 18px 0 16px;
}
.iw-upload--compact :deep(.el-upload-dragger) {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
}
.iw-upload--compact .iw-upload__icon {
  display: none;
}
.iw-upload--compact .iw-upload__text {
  font-size: 13px;
}
.iw-upload--compact .iw-upload__tip {
  display: none;
}

/* ========== 进度遮罩 ========== */
.iw-progress-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
  border-radius: 4px;
}
.iw-progress-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 40px 28px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
  min-width: 300px;
}
.iw-progress-card__icon {
  color: #409eff;
}
.iw-progress-card__title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.iw-progress-card__file {
  font-size: 13px;
  color: #606266;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.iw-progress-card__text {
  font-size: 12px;
  color: #909399;
}
.iw-tip-icon {
  color: #c0c4cc;
  cursor: help;
  font-size: 14px;
}
.iw-form-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}
.iw-form-row--block {
  align-items: flex-start;
  margin-bottom: 22px;
}
.iw-form-row:last-child {
  margin-bottom: 0;
}
.iw-form-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  line-height: 32px;
}
.iw-form-label--inline {
  width: auto;
  color: #909399;
  font-weight: 500;
}
.iw-radio-group {
  display: flex;
  gap: 14px;
}
.iw-radio-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 18px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s;
  background: white;
  user-select: none;
}
.iw-radio-card:hover {
  border-color: #409eff;
}
.iw-radio-card.is-active {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 1px #409eff;
}
.iw-radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #dcdfe6;
  position: relative;
  flex-shrink: 0;
  transition: all 0.25s;
}
.iw-radio-dot::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #409eff;
  transition: transform 0.2s;
}
.iw-radio-dot.is-active {
  border-color: #409eff;
}
.iw-radio-dot.is-active::after {
  transform: translate(-50%, -50%) scale(1);
}
.iw-radio-text {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}
.iw-radio-card.is-active .iw-radio-text {
  color: #409eff;
  font-weight: 600;
}
.iw-inline-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.iw-form-sep {
  display: inline-block;
  width: 1px;
  height: 20px;
  background: #dcdfe6;
  margin: 0 6px;
  flex-shrink: 0;
}
.iw-check-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.iw-form-hint {
  font-size: 12px;
  color: #909399;
  margin-left: 4px;
  white-space: nowrap;
}
.iw-radio-desc {
  display: block;
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  font-weight: normal;
}

/* ========== Step 1: 预览确认 ========== */
.iw-step--preview {
  padding: 0 4px;
}
.iw-preview-layout {
  display: flex;
  gap: 20px;
  min-height: 340px;
}
.iw-preview-sidebar {
  width: 200px;
  flex-shrink: 0;
}
.iw-preview-sidebar__title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
  padding-left: 4px;
}
.iw-preview-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.2s;
  background: white;
}
.iw-preview-file-item:hover {
  border-color: #c0c4cc;
  background: #fafbfc;
}
.iw-preview-file-item.is-selected {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 1px rgba(64,158,255,0.2);
}
.iw-preview-file-item__name {
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.iw-preview-main {
  flex: 1;
  min-width: 0;
}
.iw-preview-main__header {
  font-size: 13px;
  color: #909399;
  margin-bottom: 12px;
  font-weight: 500;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.iw-preview-main__count {
  font-size: 12px;
  color: #c0c4cc;
}

/* 分段文本流 */
.iw-preview-stream {
  overflow-y: auto;
  max-height: 400px;
  padding-right: 4px;
}
.iw-chunk-item {
  padding: 12px 0;
  border-bottom: 1px solid #ebeef5;
  font-size: 13px;
  color: #606266;
  line-height: 1.7;
  transition: background 0.15s;
}
.iw-chunk-item:hover {
  background: #f5f7fa;
  margin: 0 -12px;
  padding-left: 12px;
  padding-right: 12px;
}
.iw-chunk-item--last {
  border-bottom: none;
}
.iw-chunk-item__content {
  word-break: break-word;
  white-space: pre-wrap;
}

/* ========== Footer ========== */
.iw-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.iw-footer .el-button:first-child {
  margin-right: auto;
}
</style>
