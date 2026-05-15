<template>
  <div class="pdf-preview-panel">
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在加载 PDF 文件...</span>
    </div>
    <div v-else-if="error" class="preview-error">
      <el-icon :size="24" color="#EF4444"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
    </div>
    <iframe
      v-else-if="pdfUrl"
      ref="iframeRef"
      :src="effectivePdfUrl"
      class="pdf-iframe"
      frameborder="0"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileUrl?: string
  locateTarget?: { originalText: string; locateCandidates?: string[]; locateHint?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

const loading = ref(false)
const error = ref('')
const pdfUrl = ref('')
const iframeRef = ref<HTMLIFrameElement | null>(null)

// PDF URL 拼接 #search= 片段，使浏览器原生 PDF 查看器自动搜索定位
const effectivePdfUrl = computed(() => {
  if (!pdfUrl.value) return ''
  const candidates = props.locateTarget?.locateCandidates || []
  const primary = (candidates.find(s => String(s || '').trim()) || props.locateTarget?.originalText || '').trim()
  if (!primary) return pdfUrl.value
  const base = pdfUrl.value.split('#')[0]
  return `${base}#search=${encodeURIComponent(primary)}`
})

const loadPdf = async () => {
  if (!props.fileId && !props.fileUrl) return
  loading.value = true
  error.value = ''

  try {
    // 释放旧 URL
    if (pdfUrl.value && pdfUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(pdfUrl.value)
    }

    let url: string
    if (props.fileUrl) {
      url = props.fileUrl
    } else {
      const resp = await request.get(
        `/tasks/${props.taskId}/files/${props.fileId}/raw`,
        { responseType: 'arraybuffer' }
      )
      const blob = new Blob([resp.data], { type: 'application/pdf' })
      url = URL.createObjectURL(blob)
    }
    pdfUrl.value = url
  } catch (e: any) {
    error.value = e?.message || 'PDF 加载失败'
    console.error('[PdfPreview] 加载失败:', e)
  } finally {
    loading.value = false
  }
}

watch(() => props.fileId, () => loadPdf(), { immediate: true })

watch(() => props.locateTarget, (target) => {
  if (!target?.originalText?.trim()) return
  const kw = (target.locateCandidates?.[0] || target.originalText || '').trim()
  emit('locateResult', {
    success: false,
    mode: 'fallback',
    hint: target.locateHint || `PDF 预览器仅支持关键词检索，请优先搜索“${kw}”并结合页段提示定位。`,
  })
})

onUnmounted(() => {
  if (pdfUrl.value && pdfUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(pdfUrl.value)
  }
})
</script>

<style scoped>
.pdf-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.preview-loading,
.preview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #6B7280;
  font-size: 13px;
}

.pdf-iframe {
  flex: 1;
  width: 100%;
  border: none;
}
</style>
