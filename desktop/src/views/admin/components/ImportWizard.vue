<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="handleClose"
    title="上传文档"
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
        :closable="true"
        @close="lastError = ''"
        class="iw-alert"
      />

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
          :on-exceed="handleExceed"
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
    </div>

    <template #footer>
      <div class="iw-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-tooltip
          :content="fileList.length === 0 ? '请先选择要上传的文件' : ''"
          placement="top"
          :disabled="fileList.length > 0"
        >
          <el-button
            type="primary"
            :disabled="fileList.length === 0 || submitting"
            :loading="submitting"
            @click="handleSubmit"
          >
            开始解析 ({{ fileList.length }} 个文件)
          </el-button>
        </el-tooltip>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  UploadFilled,
  Document,
  Delete,
  InfoFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { uploadAndProcessApi } from '@/api/knowledge-category'

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
  (e: 'imported'): void
}>()

const lastError = ref('')
const submitting = ref(false)

const acceptLabel = computed(() => {
  return props.accept.replace(/\./g, '').toUpperCase().replace(/,/g, '/')
})

// ===== 文件选择 =====
const uploadRef = ref()
const fileList = ref<any[]>([])

const handleFileChange = (_file: any, files: any[]) => {
  fileList.value = files
}

const handleExceed = (files: File[]) => {
  const remaining = props.limit - fileList.value.length
  if (remaining <= 0) {
    ElMessage.warning(`已达最大文件数量限制（${props.limit} 个），无法继续添加。`)
    return
  }

  const filesToAdd = files.slice(0, remaining)
  const ignoredCount = files.length - remaining

  filesToAdd.forEach(file => {
    fileList.value.push({
      name: file.name,
      size: file.size,
      raw: file,
    })
  })

  if (ignoredCount > 0) {
    ElMessage.warning(`已添加前 ${remaining} 个文件，忽略 ${ignoredCount} 个超出限制的文件。`)
  } else {
    ElMessage.success(`已成功添加 ${remaining} 个文件。`)
  }
}

const removeFileByIndex = (idx: number) => {
  fileList.value.splice(idx, 1)
}

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

// ===== 配置 =====
const chunkConfig = ref({
  mode: 'auto' as 'auto' | 'fixed' | 'paragraph',
  maxChars: 900,
  overlap: 120,
  contextualRetrieval: false,
})

const indexSettings = ref({
  titleToIndex: true,
})

// ===== 提交上传 =====
const handleSubmit = async () => {
  lastError.value = ''
  if (!props.targetId) { ElMessage.warning('未选择目标'); return }
  if (!fileList.value.length) { ElMessage.warning('请先选择文件'); return }

  submitting.value = true
  try {
    const fd = new FormData()
    fileList.value.forEach(f => fd.append('files', f.raw))
    fd.append('chunkMode', chunkConfig.value.mode)
    fd.append('maxChars', String(chunkConfig.value.maxChars))
    fd.append('overlap', String(chunkConfig.value.overlap))
    fd.append('embeddingUseDocumentTitle', String(indexSettings.value.titleToIndex))
    fd.append('contextualRetrieval', String(chunkConfig.value.contextualRetrieval))

    await uploadAndProcessApi(props.targetId, fd)
    ElMessage.success(`${fileList.value.length} 个文件已提交，正在后台处理`)
    emit('imported')
    resetAndClose()
  } catch (err: any) {
    lastError.value = err?.response?.data?.message || err?.message || '上传失败'
    ElMessage.error(lastError.value)
  } finally {
    submitting.value = false
  }
}

// ===== 对话框管理 =====
const resetState = () => {
  lastError.value = ''
  fileList.value = []
  chunkConfig.value = { mode: 'auto', maxChars: 900, overlap: 120, contextualRetrieval: false }
  indexSettings.value = { titleToIndex: true }
}

const resetAndClose = () => {
  resetState()
  emit('update:modelValue', false)
}

const handleClose = () => {
  if (fileList.value.length > 0) {
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
  min-height: 280px;
  max-height: 58vh;
  overflow-y: auto;
}

/* ========== 文件选择 ========== */
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

/* 文件卡片 */
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
}
.iw-file-card__del { flex-shrink: 0; opacity: 0.5; }
.iw-file-card__del:hover { opacity: 1; }

/* ========== 配置表单 ========== */
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
.iw-radio-desc {
  display: block;
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  font-weight: normal;
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
.iw-tip-icon {
  color: #c0c4cc;
  cursor: help;
  font-size: 14px;
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