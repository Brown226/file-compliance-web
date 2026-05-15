<template>
  <div class="docx-preview-panel">
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在渲染 Word 文档...</span>
    </div>
    <div v-else-if="error" class="preview-error">
      <el-icon :size="24" color="#EF4444"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
    </div>
    <div v-else class="docx-content" ref="contentRef" v-html="renderedHtml"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'
import mammoth from 'mammoth'

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileUrl?: string
  locateTarget?: { originalText: string } | null
}>()

const loading = ref(false)
const error = ref('')
const renderedHtml = ref('')
const contentRef = ref<HTMLElement | null>(null)

const loadDocx = async () => {
  if (!props.fileId && !props.fileUrl) return
  loading.value = true
  error.value = ''
  renderedHtml.value = ''

  try {
    let arrayBuffer: ArrayBuffer
    if (props.fileUrl) {
      const resp = await fetch(props.fileUrl)
      arrayBuffer = await resp.arrayBuffer()
    } else {
      const resp = await request.get(
        `/tasks/${props.taskId}/files/${props.fileId}/raw`,
        { responseType: 'arraybuffer' }
      )
      arrayBuffer = resp.data
    }

    const result = await mammoth.convertToHtml({ arrayBuffer })
    renderedHtml.value = result.value

    if (result.messages.length > 0) {
      console.warn('[DocxPreview] 转换警告:', result.messages)
    }

    // 内容加载完成后，检查是否有待定位的原文（locateTarget 可能在加载期间被设置）
    await nextTick()
    if (props.locateTarget?.originalText) {
      highlightAndScroll()
    }
  } catch (e: any) {
    error.value = e?.message || 'Word 文档渲染失败'
    console.error('[DocxPreview] 错误:', e)
  } finally {
    loading.value = false
  }
}

const highlightAndScroll = () => {
  if (!props.locateTarget?.originalText || !contentRef.value) return

  // 清除旧高亮
  contentRef.value.querySelectorAll('.docx-highlight').forEach(el => {
    const parent = el.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el)
      parent.normalize()
    }
  })

  const searchText = props.locateTarget.originalText.trim()
  if (!searchText) return

  // 在 DOM 中查找并高亮文本
  const walker = document.createTreeWalker(contentRef.value, NodeFilter.SHOW_TEXT)
  let found = false
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const idx = node.data.indexOf(searchText)
    if (idx !== -1) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + searchText.length)
      const mark = document.createElement('mark')
      mark.className = 'docx-highlight'
      range.surroundContents(mark)

      if (!found) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        found = true
      }
    }
  }
}

watch(() => props.fileId, () => loadDocx(), { immediate: true })
watch(() => props.locateTarget, () => nextTick(highlightAndScroll))
</script>

<style scoped>
.docx-preview-panel {
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

.docx-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  font-size: 14px;
  line-height: 1.8;
  color: #374151;
}

.docx-content :deep(h1) { font-size: 1.8em; font-weight: 700; margin: 20px 0 12px; color: #1F2937; }
.docx-content :deep(h2) { font-size: 1.5em; font-weight: 650; margin: 18px 0 10px; color: #1F2937; }
.docx-content :deep(h3) { font-size: 1.2em; font-weight: 600; margin: 16px 0 8px; color: #374151; }
.docx-content :deep(p) { margin: 0 0 10px; }
.docx-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}
.docx-content :deep(th),
.docx-content :deep(td) {
  border: 1px solid #E5E7EB;
  padding: 8px 12px;
  text-align: left;
}
.docx-content :deep(th) { background: #F9FAFB; font-weight: 600; }
.docx-content :deep(img) { max-width: 100%; height: auto; }
.docx-content :deep(ul),
.docx-content :deep(ol) { padding-left: 1.5em; margin: 8px 0; }
.docx-content :deep(blockquote) {
  border-left: 3px solid #3B82F6;
  padding-left: 12px;
  margin: 12px 0;
  color: #6B7280;
}

/* 高亮标记 */
.docx-content :deep(.docx-highlight) {
  background: rgba(239, 68, 68, 0.2);
  border-bottom: 2px solid #EF4444;
  padding: 1px 2px;
  border-radius: 3px;
  scroll-margin: 100px;
}
</style>
