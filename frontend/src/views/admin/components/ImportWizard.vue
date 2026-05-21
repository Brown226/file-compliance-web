<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="handleClose"
    :title="dialogTitle"
    width="800px"
    destroy-on-close
    :close-on-click-modal="false"
    class="import-wizard"
  >
    <el-steps :active="currentStep" align-center class="iw-steps">
      <el-step title="选择内容" />
      <el-step title="预览与设置" />
      <el-step title="确认导入" />
    </el-steps>

    <el-alert
      v-if="lastError"
      :title="lastError"
      type="error"
      show-icon
      :closable="false"
      class="iw-alert"
    />

    <div class="iw-body">
      <!-- Step 1: 选择文件/输入文本 -->
      <div v-if="currentStep === 0" class="iw-step">
        <el-tabs v-model="inputMode" class="iw-input-tabs">
          <el-tab-pane label="上传文件" name="file">
            <el-upload
              ref="uploadRef"
              drag
              multiple
              :auto-upload="false"
              :limit="limit"
              :accept="accept"
              :on-change="handleFileChange"
              :on-remove="handleFileRemove"
              :file-list="fileList"
              class="iw-upload"
            >
              <div class="iw-upload__content">
                <el-icon class="iw-upload__icon" :size="40"><UploadFilled /></el-icon>
                <div class="iw-upload__text">
                  拖拽文件到此处，或 <em>点击选择</em>
                </div>
                <div class="iw-upload__tip">
                  支持 {{ acceptLabel }} 格式，单次最多{{ limit }}个文件
                </div>
              </div>
            </el-upload>
            <div v-if="fileList.length > 0" class="iw-file-list">
              <div v-for="f in fileList" :key="f.uid" class="iw-file-item">
                <el-icon :size="16"><Document /></el-icon>
                <span class="iw-file-item__name">{{ f.name }}</span>
                <span class="iw-file-item__size">{{ formatFileSize(f.size) }}</span>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="自定义文本" name="text">
            <el-input
              v-model="customText"
              type="textarea"
              :rows="10"
              placeholder="输入或粘贴文本内容，将自动分块后导入知识库"
              class="iw-custom-text"
            />
          </el-tab-pane>
        </el-tabs>
      </div>

      <!-- Step 2: 预览 + 分块设置 -->
      <div v-if="currentStep === 1" class="iw-step iw-step--preview">
        <div v-if="processing" class="iw-processing">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <p>正在解析内容并生成分段...</p>
        </div>

        <template v-else-if="previewChunks.length > 0">
          <div class="iw-preview-header">
            <el-icon><Document /></el-icon>
            <span class="iw-preview-title">{{ previewTitle || '预览' }}</span>
            <span class="iw-preview-stats">
              {{ previewChunks.length }} 个分段 · {{ totalPreviewChars.toLocaleString() }} 字符
            </span>
          </div>

          <el-collapse v-model="settingsCollapse" class="iw-settings">
            <el-collapse-item title="分块参数设置" name="chunk">
              <div class="iw-chunk-config">
                <el-form label-position="top" size="small">
                  <el-form-item label="分段策略">
                    <el-radio-group v-model="chunkConfig.mode" class="iw-strategy-group">
                      <el-radio value="auto">
                        <div class="iw-strategy-opt">
                          <span class="iw-strategy-opt__title">智能分段</span>
                          <span class="iw-strategy-opt__desc">按标题和段落边界智能划分</span>
                        </div>
                      </el-radio>
                      <el-radio value="fixed">
                        <div class="iw-strategy-opt">
                          <span class="iw-strategy-opt__title">固定长度</span>
                          <span class="iw-strategy-opt__desc">按字符数均匀分割</span>
                        </div>
                      </el-radio>
                      <el-radio value="paragraph">
                        <div class="iw-strategy-opt">
                          <span class="iw-strategy-opt__title">按段落</span>
                          <span class="iw-strategy-opt__desc">按已有段落划分</span>
                        </div>
                      </el-radio>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="最大字符数">
                    <el-input-number v-model="chunkConfig.maxChars" :min="200" :max="4000" :step="100" style="width: 180px;" />
                    <span class="iw-form-tip">推荐 800-1500</span>
                  </el-form-item>
                  <el-form-item label="重叠字符数" v-if="chunkConfig.mode !== 'paragraph'">
                    <el-input-number v-model="chunkConfig.overlap" :min="0" :max="500" :step="50" style="width: 180px;" />
                    <span class="iw-form-tip">推荐 100-200</span>
                  </el-form-item>
                </el-form>
              </div>
            </el-collapse-item>
          </el-collapse>

          <div class="iw-chunks">
            <div
              v-for="(chunk, idx) in previewChunks"
              :key="idx"
              class="iw-chunk"
            >
              <div class="iw-chunk__header">
                <span class="iw-chunk__idx">#{{ idx + 1 }}</span>
                <span v-if="chunk.title" class="iw-chunk__ctitle">{{ chunk.title }}</span>
                <span class="iw-chunk__len">{{ chunk.content.length }} 字符</span>
                <el-button size="small" type="danger" text @click="removeChunk(idx)">删除</el-button>
                <el-button size="small" type="primary" text @click="startEditChunk(idx, chunk.content)">编辑</el-button>
              </div>
              <div class="iw-chunk__body" v-if="editingChunkIdx !== idx">
                {{ chunk.content.substring(0, 300) }}{{ chunk.content.length > 300 ? '...' : '' }}
              </div>
              <div class="iw-chunk__edit" v-else>
                <el-input v-model="editingChunkContent" type="textarea" :rows="4" />
                <div class="iw-chunk__edit-actions">
                  <el-button size="small" @click="editingChunkIdx = -1">取消</el-button>
                  <el-button size="small" type="primary" @click="saveChunkEdit(idx)">保存</el-button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <el-empty v-else description="未能生成有效分段" />
      </div>

      <!-- Step 3: 确认导入 -->
      <div v-if="currentStep === 2" class="iw-step iw-step--confirm">
        <div class="iw-confirm-summary">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="内容来源">
              {{ inputMode === 'file' ? `${fileList.length} 个文件` : '自定义文本' }}
            </el-descriptions-item>
            <el-descriptions-item label="分段数">
              {{ previewChunks.length }}
            </el-descriptions-item>
            <el-descriptions-item label="总字符数">
              {{ totalPreviewChars.toLocaleString() }}
            </el-descriptions-item>
            <el-descriptions-item label="分段策略">
              {{ chunkModeLabel }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
        <div v-if="inputMode === 'file'" class="iw-confirm-files">
          <div v-for="f in fileList" :key="f.uid" class="iw-confirm-file">
            <el-icon :size="14"><Document /></el-icon>
            <span>{{ f.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="iw-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button v-if="currentStep > 0" @click="currentStep--">上一步</el-button>
        <el-button
          v-if="currentStep === 0"
          type="primary"
          :disabled="!canProceedFromStep1"
          @click="handleStep1Next"
        >
          下一步
        </el-button>
        <el-button
          v-if="currentStep === 1"
          type="primary"
          :disabled="previewChunks.length === 0"
          @click="currentStep = 2"
        >
          下一步
        </el-button>
        <el-button
          v-if="currentStep === 2"
          type="primary"
          :loading="importing"
          :disabled="previewChunks.length === 0"
          @click="handleConfirmImport"
        >
          确认导入 ({{ previewChunks.length }} 段)
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { UploadFilled, Document, Loading } from '@element-plus/icons-vue'
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

const currentStep = ref(0)
const lastError = ref('')
const importing = ref(false)

const acceptLabel = computed(() => {
  return props.accept.replace(/\./g, '').toUpperCase().replace(/,/g, '/')
})

// ===== Step 1: 内容选择 =====
const inputMode = ref<'file' | 'text'>('file')
const fileList = ref<any[]>([])
const customText = ref('')

const handleFileChange = (_file: any, files: any[]) => {
  fileList.value = files
}
const handleFileRemove = (_file: any, files: any[]) => {
  fileList.value = files
}

const canProceedFromStep1 = computed(() => {
  if (inputMode.value === 'file') return fileList.value.length > 0
  return customText.value.trim().length > 0
})

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ===== Step 2: 预览与设置 =====
const processing = ref(false)
const previewTitle = ref('')
const previewChunks = ref<ParagraphSegment[]>([])
const totalPreviewChars = computed(() => previewChunks.value.reduce((s, c) => s + c.content.length, 0))

const chunkConfig = ref({
  mode: 'auto' as 'auto' | 'fixed' | 'paragraph',
  maxChars: 1500,
  overlap: 120,
})
const settingsCollapse = ref<string[]>([])

const chunkModeLabel = computed(() => {
  const map: Record<string, string> = { auto: '智能分段', fixed: '固定长度', paragraph: '按段落' }
  return map[chunkConfig.value.mode] || chunkConfig.value.mode
})

const editingChunkIdx = ref(-1)
const editingChunkContent = ref('')

const startEditChunk = (idx: number, content: string) => {
  editingChunkIdx.value = idx
  editingChunkContent.value = content
}
const saveChunkEdit = (idx: number) => {
  if (editingChunkContent.value.trim()) {
    previewChunks.value[idx].content = editingChunkContent.value.trim()
  }
  editingChunkIdx.value = -1
  editingChunkContent.value = ''
}
const removeChunk = (idx: number) => {
  previewChunks.value.splice(idx, 1)
}

const handleStep1Next = async () => {
  lastError.value = ''
  if (!props.targetId) {
    ElMessage.warning('未选择目标')
    return
  }

  if (inputMode.value === 'text') {
    previewTitle.value = '自定义文本'
    const text = customText.value.trim()
    const size = chunkConfig.value.maxChars
    const chunks: ParagraphSegment[] = []
    for (let i = 0; i < text.length; i += size - Math.floor(chunkConfig.value.overlap / 2)) {
      chunks.push({ content: text.substring(i, i + size), title: '' })
    }
    previewChunks.value = chunks
    currentStep.value = 1
    return
  }

  processing.value = true
  currentStep.value = 1
  previewChunks.value = []

  try {
    const fd = new FormData()
    fileList.value.forEach(f => fd.append('file', f.raw))
    const { data } = await previewDocumentApi(props.targetId, fd) as any
    const result: PreviewResult = data
    previewTitle.value = result.title || fileList.value.map(f => f.name).join(', ')
    previewChunks.value = result.chunks || []
  } catch (err: any) {
    lastError.value = err?.response?.data?.message || err?.message || '解析失败'
    ElMessage.error(lastError.value)
  } finally {
    processing.value = false
  }
}

// ===== Step 3: 确认导入 =====
const handleConfirmImport = async () => {
  if (!previewChunks.value.length) return
  importing.value = true
  try {
    await confirmImportApi(props.targetId, {
      title: previewTitle.value,
      chunks: previewChunks.value,
    })
    ElMessage.success(`导入成功，${previewChunks.value.length} 个分段`)
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
const dialogTitle = computed(() => {
  if (currentStep.value === 0) return '导入文档'
  if (currentStep.value === 1) return '预览与设置'
  return '确认导入'
})

const resetState = () => {
  currentStep.value = 0
  lastError.value = ''
  inputMode.value = 'file'
  fileList.value = []
  customText.value = ''
  previewChunks.value = []
  previewTitle.value = ''
  editingChunkIdx.value = -1
}

const resetAndClose = () => {
  resetState()
  emit('update:modelValue', false)
}

const handleClose = () => {
  if (currentStep.value > 0 && previewChunks.value.length > 0) {
    resetAndClose()
    return
  }
  resetState()
  emit('update:modelValue', false)
}
</script>

<style scoped>
.import-wizard :deep(.el-dialog__body) {
  padding: var(--space-6) var(--space-8);
}

.iw-steps {
  margin-bottom: var(--space-6);
}

.iw-alert {
  margin-bottom: var(--space-4);
}

.iw-body {
  min-height: 200px;
  max-height: 52vh;
  overflow-y: auto;
}

.iw-step {
  min-height: 180px;
}

/* Step 1 */
.iw-input-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}

.iw-upload :deep(.el-upload-dragger) {
  border-radius: var(--radius-md);
  border: 2px dashed var(--corp-border);
  background: linear-gradient(180deg, var(--bg-surface-hover) 0%, var(--bg-surface) 100%);
  padding: var(--space-10) var(--space-8);
  transition: border-color var(--corp-transition-fast), background var(--corp-transition-fast), box-shadow var(--corp-transition-fast);
}
.iw-upload :deep(.el-upload-dragger:hover) {
  border-color: var(--corp-primary);
  background: var(--color-primary-50);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.08);
}
.iw-upload__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.iw-upload__icon {
  color: var(--corp-text-tertiary);
  opacity: 0.6;
}
.iw-upload__text {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.iw-upload__text em {
  color: var(--corp-primary);
  font-style: normal;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}
.iw-upload__tip {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 500;
}

.iw-file-list {
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.iw-file-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--corp-text-primary);
  font-weight: 500;
}
.iw-file-item__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-file-item__size {
  color: var(--corp-text-tertiary);
  font-weight: 500;
}
.iw-custom-text :deep(.el-textarea__inner) {
  font-family: inherit;
  font-size: var(--text-sm);
}

/* Step 2 */
.iw-processing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--corp-text-secondary);
  min-height: 200px;
}

.iw-preview-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--corp-border-light);
}
.iw-preview-stats {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 500;
}

.iw-settings {
  margin-bottom: var(--space-4);
}
.iw-chunk-config {
  padding: var(--space-2) 0;
}
.iw-strategy-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}
.iw-strategy-group :deep(.el-radio) {
  margin-right: 0;
  height: auto;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
  transition: all var(--corp-transition-fast);
  background: var(--bg-surface);
}
.iw-strategy-group :deep(.el-radio:hover) {
  border-color: var(--corp-border);
  background: var(--bg-surface-hover);
}
.iw-strategy-group :deep(.el-radio.is-checked) {
  border-color: var(--corp-primary);
  background: var(--color-primary-50);
  box-shadow: 0 0 0 1px var(--corp-primary);
}
.iw-strategy-opt {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.iw-strategy-opt__title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--corp-text-primary);
}
.iw-strategy-opt__desc {
  font-size: var(--text-xs);
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.iw-form-tip {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-left: var(--space-3);
  font-weight: 500;
}

.iw-chunks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 300px;
  overflow-y: auto;
}
.iw-chunk {
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--corp-border-light);
}
.iw-chunk__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}
.iw-chunk__idx {
  font-weight: 700;
  color: var(--color-primary-500);
  font-size: var(--text-sm);
}
.iw-chunk__ctitle {
  font-size: var(--text-xs);
  color: var(--color-primary-600);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.iw-chunk__len {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  flex: 1;
}
.iw-chunk__body {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.iw-chunk__edit {
  margin-top: var(--space-2);
}
.iw-chunk__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

/* Step 3 */
.iw-confirm-summary {
  margin-bottom: var(--space-4);
}
.iw-confirm-files {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.iw-confirm-file {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  padding: var(--space-1) var(--space-3);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-sm);
}

/* Footer */
.iw-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>