<!--
  @deprecated 此组件已被 ImportWizard.vue 替代，功能已整合到分步导入向导的 Step 2 和 Step 3。
  保留此文件仅作参考，不再被任何页面引用。
-->
<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="分段预览确认"
    width="800px"
    destroy-on-close
    class="preview-dialog"
  >
    <el-alert
      v-if="errorMessage"
      :title="errorMessage"
      type="error"
      show-icon
      :closable="false"
      class="preview-dialog__alert"
    />

    <!-- 步骤1：上传文件 -->
    <div v-if="step === 'upload'" class="preview-step">
      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :limit="1"
        :accept="accept"
        :on-change="handleFileChange"
        class="preview-upload"
      >
        <div class="preview-upload__content">
          <el-icon class="preview-upload__icon" :size="40"><UploadFilled /></el-icon>
          <div class="preview-upload__text">
            拖拽文件到此处，或 <em>点击选择</em>
          </div>
          <div class="preview-upload__tip">
            支持 DOCX/PDF/XLSX/PPTX 格式
          </div>
        </div>
      </el-upload>
    </div>

    <!-- 步骤2：加载中 -->
    <div v-else-if="step === 'loading'" class="preview-step preview-loading">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p>正在解析文档并生成分段...</p>
    </div>

    <div v-else-if="step === 'error'" class="preview-step preview-error">
      <el-result icon="error" title="解析失败" :sub-title="errorMessage || '请检查文件格式、文件大小或解析服务状态'">
        <template #extra>
          <el-button type="primary" @click="step = 'upload'">重新选择文件</el-button>
        </template>
      </el-result>
    </div>

    <!-- 步骤3：预览分段结果 -->
    <div v-else-if="step === 'preview'" class="preview-step">
      <div class="preview-doc-title" v-if="previewResult.title">
        <el-icon><Document /></el-icon>
        <span>{{ previewResult.title }}</span>
      </div>
      <div class="preview-stats">
        <el-tag type="info" effect="plain">{{ previewResult.chunks.length }} 个分段</el-tag>
        <el-tag type="info" effect="plain">
          {{ previewResult.chunks.reduce((s, c) => s + c.content.length, 0).toLocaleString() }} 字符
        </el-tag>
        <el-tag v-if="previewResult.metadata?.has_tables" type="warning" effect="plain">含表格</el-tag>
      </div>

      <div class="preview-chunks">
        <div
          v-for="(chunk, idx) in previewResult.chunks"
          :key="idx"
          class="preview-chunk"
        >
          <div class="preview-chunk__header">
            <span class="preview-chunk__idx">#{{ idx + 1 }}</span>
            <span v-if="chunk.title" class="preview-chunk__title">{{ chunk.title }}</span>
            <span class="preview-chunk__len">{{ chunk.content.length }} 字符</span>
            <el-button
              size="small"
              type="danger"
              text
              @click="removeChunk(idx)"
            >
              删除
            </el-button>
            <el-button size="small" type="primary" text @click="startEditChunk(idx, chunk.content)">
              编辑
            </el-button>
          </div>
          <div class="preview-chunk__content" v-if="editingChunkIdx !== idx">
            {{ chunk.content.substring(0, 300) }}{{ chunk.content.length > 300 ? '...' : '' }}
          </div>
          <div class="preview-chunk__edit" v-else>
            <el-input v-model="editingChunkContent" type="textarea" :rows="4" />
            <div class="preview-chunk__edit-actions">
              <el-button size="small" @click="editingChunkIdx = -1">取消</el-button>
              <el-button size="small" type="primary" @click="saveChunkEdit(idx)">保存</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="preview-footer">
        <div v-if="step === 'preview'" class="preview-footer__left">
          <el-button @click="step = 'upload'; previewResult = { title: '', chunks: [], metadata: {} }">
            <el-icon><ArrowLeft /></el-icon> 重新选择
          </el-button>
        </div>
        <div class="preview-footer__right">
          <el-button @click="$emit('update:modelValue', false)">取消</el-button>
          <el-button
            v-if="step === 'preview'"
            type="primary"
            @click="handleConfirm"
            :loading="confirming"
            :disabled="previewResult.chunks.length === 0"
          >
            确认导入 ({{ previewResult.chunks.length }} 段)
          </el-button>
          <el-button
            v-if="step === 'upload'"
            type="primary"
            @click="handlePreview"
            :disabled="!selectedFile"
          >
            解析预览
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { UploadFilled, Loading, ArrowLeft, Document } from '@element-plus/icons-vue'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import { ElMessage } from 'element-plus'
import { previewDocumentApi, confirmImportApi, type PreviewResult, type ParagraphSegment } from '@/api/knowledge-category'

const props = withDefaults(defineProps<{
  modelValue: boolean
  categoryId: string
  accept?: string
}>(), {
  accept: '.docx,.doc,.pdf,.xlsx,.xls,.pptx',
})

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'imported'): void
}>()

const step = ref<'upload' | 'loading' | 'preview'>('upload')
const selectedFile = ref<File | null>(null)
const previewResult = ref<PreviewResult>({ title: '', chunks: [] as ParagraphSegment[], metadata: {} })
const confirming = ref(false)
const errorMessage = ref('')

const editingChunkIdx = ref(-1)
const editingChunkContent = ref('')

const startEditChunk = (idx: number, content: string) => {
  editingChunkIdx.value = idx
  editingChunkContent.value = content
}

const saveChunkEdit = (idx: number) => {
  if (editingChunkContent.value.trim()) {
    previewResult.value.chunks[idx].content = editingChunkContent.value.trim()
  }
  editingChunkIdx.value = -1
  editingChunkContent.value = ''
}

const handleFileChange = (file: any) => {
  selectedFile.value = file?.raw || null
}

const handlePreview = async () => {
  if (!selectedFile.value || !props.categoryId) return
  step.value = 'loading'
  errorMessage.value = ''
  try {
    const fd = new FormData()
    fd.append('file', selectedFile.value)
    const res = await previewDocumentApi(props.categoryId, fd)
    previewResult.value = res.data
    step.value = 'preview'
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || err?.message || '预览失败'
    ElMessage.error(errorMessage.value)
    step.value = 'error'
  }
}

const removeChunk = (idx: number) => {
  previewResult.value.chunks.splice(idx, 1)
}

const handleConfirm = async () => {
  if (!previewResult.value.chunks.length) return
  confirming.value = true
  try {
    await confirmImportApi(props.categoryId, {
      title: previewResult.value.title,
      chunks: previewResult.value.chunks,
      metadata: previewResult.value.metadata,
    })
    ElMessage.success(`导入成功，${previewResult.value.chunks.length} 个分段`)
    emit('update:modelValue', false)
    emit('imported')
    step.value = 'upload'
    selectedFile.value = null
    previewResult.value = { title: '', chunks: [] as ParagraphSegment[], metadata: {} }
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || err?.message || '导入失败'
    ElMessage.error(errorMessage.value)
  } finally {
    confirming.value = false
  }
}

useEnterToConfirm(computed(() => props.modelValue), handleConfirm, { disabled: computed(() => confirming.value || step.value !== 'preview') })
</script>

<style scoped>
.preview-dialog :deep(.el-dialog__body) {
  padding: var(--space-6) var(--space-8);
  max-height: 60vh;
  overflow-y: auto;
}

.preview-dialog__alert {
  margin-bottom: var(--space-4);
}
.preview-step {
  min-height: 200px;
}
.preview-upload :deep(.el-upload-dragger) {
  border-radius: var(--radius-md);
  border: 2px dashed var(--corp-border);
  background: linear-gradient(180deg, var(--bg-surface-hover) 0%, var(--bg-surface) 100%);
  padding: var(--space-10) var(--space-8);
  transition: border-color var(--corp-transition-fast);
}
.preview-upload :deep(.el-upload-dragger:hover) {
  border-color: var(--corp-primary);
}
.preview-upload__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.preview-upload__icon { color: var(--corp-text-tertiary); opacity: 0.6; }
.preview-upload__text { font-size: var(--text-base); color: var(--corp-text-secondary); font-weight: 500; }
.preview-upload__text em { color: var(--corp-primary); font-style: normal; font-weight: 700; }
.preview-upload__tip { font-size: var(--text-xs); color: var(--corp-text-tertiary); }

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--corp-text-secondary);
}

.preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.preview-chunks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}
.preview-chunk {
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  border: 1px solid var(--corp-border-light);
}
.preview-chunk__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.preview-chunk__idx {
  font-weight: 700;
  color: var(--color-primary-500);
  font-size: 13px;
}
.preview-chunk__title {
  font-size: 12px;
  color: var(--color-primary-600);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}
.preview-chunk__len {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  flex: 1;
}
.preview-chunk__content {
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.preview-doc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--corp-border-light);
}
.preview-chunk__edit {
  margin-top: 6px;
}
.preview-chunk__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.preview-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.preview-footer__left,
.preview-footer__right {
  display: flex;
  gap: 8px;
}
</style>
