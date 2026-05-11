<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="title"
    width="560px"
    destroy-on-close
    class="upload-dialog"
  >
    <div class="upload-area">
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
        class="upload-dragger"
      >
        <div class="upload-dragger__content">
          <el-icon class="upload-dragger__icon" :size="40"><UploadFilled /></el-icon>
          <div class="upload-dragger__text">
            拖拽文件到此处，或 <em>点击选择</em>
          </div>
          <div class="upload-dragger__tip">
            支持 {{ acceptLabel }} 格式，单次最多{{ limit }}个文件
          </div>
        </div>
      </el-upload>
    </div>

    <!-- 上传进度 -->
    <transition name="el-fade-in">
      <div v-if="progress.length > 0" class="upload-progress">
        <div v-for="item in progress" :key="item.name" class="upload-progress__item">
          <el-icon class="upload-progress__file-icon" :size="16"><Document /></el-icon>
          <span class="upload-progress__name">{{ item.name }}</span>
          <el-progress
            :percentage="item.status === 'done' ? 100 : item.status === 'error' ? 0 : 50"
            :status="item.status === 'done' ? 'success' : item.status === 'error' ? 'exception' : undefined"
            :stroke-width="5"
            style="flex: 1; margin: 0 12px;"
          />
          <el-tag v-if="item.status === 'done'" type="success" size="small" effect="plain">完成</el-tag>
          <el-tag v-else-if="item.status === 'error'" type="danger" size="small" effect="plain">失败</el-tag>
          <el-tag v-else type="warning" size="small" effect="plain">处理中</el-tag>
        </div>
      </div>
    </transition>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        @click="handleUpload"
        :loading="uploading"
        :disabled="fileList.length === 0"
      >
        <el-icon><Upload /></el-icon>
        上传 ({{ fileList.length }})
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { UploadFilled, Upload, Document } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { uploadDocumentAsyncApi } from '@/api/knowledge-category'

export interface UploadProgressItem {
  name: string
  status: 'pending' | 'done' | 'error'
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  targetId: string
  targetName?: string
  accept?: string
  limit?: number
  uploadFn: (targetId: string, formData: FormData) => Promise<any>
}>(), {
  title: '上传文档',
  accept: '.docx,.doc,.pdf,.xlsx,.xls,.txt,.md',
  limit: 10,
})

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'uploaded', taskIds?: string[]): void
}>()

const uploadRef = ref<any>()
const fileList = ref<any[]>([])
const uploading = ref(false)
const progress = ref<UploadProgressItem[]>([])

const acceptLabel = computed(() => {
  return props.accept.replace(/\./g, '').toUpperCase().replace(/,/g, '/')
})

const handleFileChange = (_uploadFile: any, files: any[]) => {
  fileList.value = files
}

const handleFileRemove = (_uploadFile: any, files: any[]) => {
  fileList.value = files
}

const handleUpload = async () => {
  if (fileList.value.length === 0) {
    ElMessage.warning('请选择文件')
    return
  }
  if (!props.targetId) {
    ElMessage.warning('未选择目标')
    return
  }

  uploading.value = true

  try {
    const fd = new FormData()
    fileList.value.forEach(f => fd.append('files', f.raw))
    const { data } = await uploadDocumentAsyncApi(props.targetId, fd)
    ElMessage.success(`${fileList.value.length} 个文件已提交，正在后台处理`)
    emit('uploaded', data.taskIds)
    emit('update:modelValue', false)
    fileList.value = []
    progress.value = []
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.upload-dialog :deep(.el-dialog__body) {
  padding: var(--space-6) var(--space-8);
}

.upload-dragger {
  width: 100%;
}
.upload-dragger :deep(.el-upload-dragger) {
  border-radius: var(--radius-md);
  border: 2px dashed var(--corp-border);
  background: linear-gradient(180deg, var(--bg-surface-hover) 0%, var(--bg-surface) 100%);
  padding: var(--space-10) var(--space-8);
  transition: border-color var(--corp-transition-fast), background var(--corp-transition-fast), box-shadow var(--corp-transition-fast);
}
.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: var(--corp-primary);
  background: var(--color-primary-50);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.08);
}

.upload-dragger__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.upload-dragger__icon {
  color: var(--corp-text-tertiary);
  opacity: 0.6;
}
.upload-dragger__text {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.upload-dragger__text em {
  color: var(--corp-primary);
  font-style: normal;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}
.upload-dragger__tip {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 500;
}

.upload-progress {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.upload-progress__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-sm);
  border: 1px solid var(--corp-border-light);
}
.upload-progress__file-icon {
  color: var(--corp-text-tertiary);
  flex-shrink: 0;
}
.upload-progress__name {
  width: 140px;
  font-size: var(--text-sm);
  color: var(--corp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  font-weight: 500;
}
</style>
