<template>
  <div class="document-preview">
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p>正在加载文档预览...</p>
    </div>
    <div v-else-if="error" class="preview-error">
      <el-icon :size="32" color="#dc2626"><CircleCloseFilled /></el-icon>
      <p>{{ error }}</p>
      <el-button size="small" @click="loadDocument">重试</el-button>
    </div>
    <template v-else>
      <DocxPreview
        v-if="resolvedFileType === 'docx'"
        :src="fileUrl"
        @rendered="onRendered"
        @error="onError"
      />
      <PdfPreview
        v-else-if="resolvedFileType === 'pdf'"
        :src="fileUrl"
        @rendered="onRendered"
        @error="onError"
      />
      <div v-else class="preview-unsupported">
        <el-icon :size="32" color="#94a3b8"><Document /></el-icon>
        <p>暂不支持预览 {{ resolvedFileType }} 格式文件</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Loading, CircleCloseFilled, Document } from '@element-plus/icons-vue'
import DocxPreview from '@vue-office/docx'
import PdfPreview from '@vue-office/pdf'

const props = defineProps<{
  /** 文件 URL */
  src: string
  /** 文件类型（docx/pdf 等） */
  fileType: string
}>()

const loading = ref(false)
const error = ref('')

const fileUrl = computed(() => props.src)
const resolvedFileType = computed(() => props.fileType?.toLowerCase() || '')

const loadDocument = () => {
  loading.value = true
  error.value = ''
}

const onRendered = () => {
  loading.value = false
}

const onError = (err: any) => {
  loading.value = false
  error.value = err?.message || '文档加载失败'
}

watch(() => props.src, () => {
  if (props.src) loadDocument()
}, { immediate: true })
</script>

<style scoped>
.document-preview {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.preview-loading,
.preview-error,
.preview-unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
  color: #64748b;
}

.preview-error p {
  color: #dc2626;
  font-size: 13px;
}
</style>
