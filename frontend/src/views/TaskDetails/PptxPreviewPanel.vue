<template>
  <div class="pptx-preview-panel">
    <div class="pptx-toolbar">
      <el-button-group size="small">
        <el-button :disabled="currentSlide <= 0" @click="prevSlide">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <el-button disabled style="min-width: 80px;">
          {{ slides.length ? currentSlide + 1 : 0 }} / {{ slides.length }}
        </el-button>
        <el-button :disabled="currentSlide >= slides.length - 1" @click="nextSlide">
          <el-icon><ArrowRight /></el-icon>
        </el-button>
      </el-button-group>
    </div>

    <div v-if="loading" class="pptx-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在解析 PPTX 文件...</span>
    </div>

    <div v-else-if="error" class="pptx-error">
      <el-icon :size="24" color="#EF4444"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
    </div>

    <div v-else-if="!slides.length" class="pptx-empty">
      <el-icon :size="32" color="#94a3b8"><Document /></el-icon>
      <p>未提取到文本内容</p>
    </div>

    <div v-else class="pptx-viewport">
      <div class="slide-card" ref="slideCardRef">
        <div class="slide-number">{{ currentSlide + 1 }}</div>
        <div class="slide-content">
          <p
            v-for="(line, idx) in currentSlideLines"
            :key="idx"
            class="slide-line"
            v-html="line"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { ArrowLeft, ArrowRight, Loading, WarningFilled, Document } from '@element-plus/icons-vue'
import request from '@/utils/request'

const props = defineProps<{
  taskId: string
  fileId: string | null
  locateTarget?: { originalText: string } | null
}>()

const loading = ref(false)
const error = ref('')
const slides = ref<string[]>([])
const currentSlide = ref(0)
const slideCardRef = ref<HTMLElement | null>(null)

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const highlightText = (text: string, search: string): string => {
  if (!search) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const escapedSearch = escapeHtml(search)
  const idx = escaped.toLowerCase().indexOf(escapedSearch.toLowerCase())
  if (idx === -1) return escaped
  return (
    escaped.substring(0, idx) +
    '<mark class="pptx-highlight">' +
    escaped.substring(idx, idx + escapedSearch.length) +
    '</mark>' +
    escaped.substring(idx + escapedSearch.length)
  )
}

const currentSlideLines = computed(() => {
  const raw = slides.value[currentSlide.value] || ''
  const search = props.locateTarget?.originalText || ''
  return raw
    .split('\n')
    .filter(l => l.trim())
    .map(line => highlightText(line, search))
})

const extractTextFromPptx = async (buffer: ArrayBuffer): Promise<string[]> => {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const slideTexts: string[] = []
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)![0])
      const numB = parseInt(b.match(/\d+/)![0])
      return numA - numB
    })

  for (const path of slideFiles) {
    const xml = await zip.files[path].async('text')
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const texts = [...doc.querySelectorAll('a\\:t, t')]
      .map(el => el.textContent || '')
      .filter(t => t.trim())
    slideTexts.push(texts.join('\n'))
  }
  return slideTexts
}

const prevSlide = () => {
  if (currentSlide.value > 0) currentSlide.value--
}

const nextSlide = () => {
  if (currentSlide.value < slides.value.length - 1) currentSlide.value++
}

const loadPptx = async () => {
  if (!props.fileId) {
    slides.value = []
    return
  }
  loading.value = true
  error.value = ''
  slides.value = []
  currentSlide.value = 0

  try {
    const resp = await request.get(
      `/tasks/${props.taskId}/files/${props.fileId}/raw`,
      { responseType: 'arraybuffer' }
    )
    const buffer = resp.data
    slides.value = await extractTextFromPptx(buffer)
    // 内容加载完成后，检查是否有待定位的原文
    if (props.locateTarget?.originalText) {
      const idx = findSlideWithText(props.locateTarget.originalText)
      if (idx !== -1 && idx !== currentSlide.value) {
        currentSlide.value = idx
      }
      scrollToHighlight()
    }
  } catch (e: any) {
    error.value = e?.message || 'PPTX 解析失败'
    console.error('[PptxPreview] 错误:', e)
  } finally {
    loading.value = false
  }
}

const findSlideWithText = (text: string): number => {
  const search = text.trim().toLowerCase()
  if (!search) return -1
  return slides.value.findIndex(s => s.toLowerCase().includes(search))
}

const scrollToHighlight = () => {
  nextTick(() => {
    if (!slideCardRef.value) return
    const mark = slideCardRef.value.querySelector('.pptx-highlight')
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

watch(() => props.fileId, () => loadPptx(), { immediate: true })

watch(() => props.locateTarget, (target) => {
  if (!target?.originalText || !slides.value.length) return
  const idx = findSlideWithText(target.originalText)
  if (idx !== -1 && idx !== currentSlide.value) {
    currentSlide.value = idx
  }
  scrollToHighlight()
})

watch(currentSlide, () => {
  if (props.locateTarget?.originalText) scrollToHighlight()
})
</script>

<style scoped>
.pptx-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: #f5f5f5;
}

.pptx-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
  flex-shrink: 0;
}

.pptx-loading,
.pptx-error,
.pptx-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #6B7280;
  font-size: 13px;
}

.pptx-viewport {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 24px 16px;
}

.slide-card {
  width: 100%;
  max-width: 720px;
  min-height: 300px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 32px 28px;
  position: relative;
}

.slide-number {
  position: absolute;
  top: 10px;
  right: 14px;
  font-size: 12px;
  color: #9ca3af;
  font-weight: 600;
}

.slide-content {
  font-size: 14px;
  line-height: 1.8;
  color: #374151;
}

.slide-line {
  margin: 0 0 8px 0;
  word-break: break-word;
}

.slide-content :deep(.pptx-highlight) {
  background: rgba(239, 68, 68, 0.2);
  border-bottom: 2px solid #EF4444;
  padding: 1px 2px;
  border-radius: 3px;
  color: #dc2626;
  font-weight: 600;
}
</style>
