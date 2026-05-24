<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'
import VuePdfEmbed from 'vue-pdf-embed'
import 'vue-pdf-embed/dist/styles/textLayer.css'

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileUrl?: string
  locateTarget?: {
    originalText: string
    locateCandidates?: string[]
    locateMeta?: any
    locateHint?: string
    triggerId?: string
  } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

const loading = ref(false)
const error = ref('')
const containerRef = ref<HTMLElement | null>(null)
const pdfEmbedRef = ref<any>(null)

const pdfSource = ref<any>(null)
const totalPages = ref(0)
const currentPage = ref(1)
const scale = ref(1)
const containerWidth = ref(800)

const HIGHLIGHT_CLASS = 'pdf-highlight-yellow'
const lastLocateTriggerId = ref('')

const goPage = (p: number) => {
  currentPage.value = p
}

const zoomIn = () => {
  scale.value = Math.min(scale.value + 0.25, 3)
}
const zoomOut = () => {
  scale.value = Math.max(scale.value - 0.25, 0.5)
}

watch(scale, () => {})

const updateContainerWidth = () => {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth || 800
  }
}

onMounted(() => {
  updateContainerWidth()
  window.addEventListener('resize', updateContainerWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateContainerWidth)
  clearHighlights()
})

// ===== PDF 加载 =====

const loadPdf = async () => {
  console.log('[PDF] loadPdf called', { taskId: props.taskId, fileId: props.fileId })
  if (!props.fileId) {
    console.warn('[PDF] loadPdf 跳过: fileId 为空')
    return
  }

  loading.value = true
  error.value = ''
  pdfSource.value = null
  totalPages.value = 0

  try {
    const res = await request.get(`/tasks/${props.taskId}/files/${props.fileId}/raw`, {
      responseType: 'arraybuffer',
    })

    const data = res.data as ArrayBuffer
    console.log('[PDF] API 返回数据大小:', data?.byteLength || 0)
    if (!data || data.byteLength === 0) throw new Error('PDF 文件内容为空')

    pdfSource.value = { data: new Uint8Array(data) }
    console.log('[PDF] pdfSource 已设置, 类型:', typeof pdfSource.value)
  } catch (e: any) {
    console.error('[PDF] 加载失败:', e?.message || e)
    error.value = e?.message || e || 'PDF 加载失败'
  } finally {
    loading.value = false
    console.log('[PDF] 加载结束', { loading: loading.value, error: error.value, hasSource: !!pdfSource.value })
  }
}

function clearHighlights() {
  if (!containerRef.value) return
  containerRef.value.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS)
  })
}

watch(
  () => props.fileId,
  async (newId) => {
    if (!newId) return
    clearHighlights()
    await loadPdf()
  },
  { immediate: true }
)

// ===== 渲染回调 =====

const onPdfRendered = (event?: any) => {
  console.log('[PDF] vue-pdf-embed 渲染完成', event)

  // 渲染完成后立即尝试定位
  nextTick(() => {
    attemptLocate()
  })
}

const onLoadingFailed = (err: any) => {
  console.error('[PDF] 加载失败:', err)
  error.value = err?.message || 'PDF 加载失败'
}

// ===== 定位核心：对齐 Word 的 TreeWalker 方案 =====

function getLocateTerms(): string[] {
  const target = props.locateTarget
  if (!target) return []

  const candidates = Array.isArray(target.locateCandidates) ? target.locateCandidates : []
  const quoteText = target.locateMeta?.quote?.text ? [target.locateMeta.quote.text] : []
  const context = [
    target.locateMeta?.context?.prefix || '',
    target.locateMeta?.context?.suffix || '',
  ].filter(Boolean)

  const terms = [...quoteText, ...candidates, target.originalText, ...context]
    .map(s => String(s || '').trim())
    .filter(Boolean)

  return [...new Set(terms)]
}

function normalizeForLocate(text: string): string {
  return text
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[·•–—_]/g, '')
    .replace(/[（）【】《》""''「」『』〔〕]/g, '')
    .replace(/[，。、；：！？]/g, '')
    .trim()
    .toLowerCase()
}

function includesLoose(haystack: string, needle: string): boolean {
  if (!needle) return false
  const h = normalizeForLocate(haystack)
  const n = needle.toLowerCase().trim()

  if (h.includes(n)) return true

  // 紧凑模式：去掉所有非字母数字中文的字符再比较
  const compactH = h.replace(/\s+/g, '').replace(/[^\w\u4e00-\u9fff\-]/g, '')
  const compactN = n.replace(/\s+/g, '').replace(/[^\w\u4e00-\u9fff\-]/g, '')

  if (compactN && compactH.includes(compactN)) return true

  // 关键词覆盖率匹配
  const wordsN = n.split(/\s+/).filter(Boolean)
  if (wordsN.length > 2) {
    const matchCount = wordsN.filter((w) => h.includes(w)).length
    if (matchCount >= Math.ceil(wordsN.length * 0.7)) return true
  }

  return false
}

/**
 * 核心：在 textLayer 的 span 中查找并高亮目标文本
 * 与 DocxPreviewPanel.highlightAndScroll() 使用相同的 TreeWalker 思路，
 * 但针对 PDF 的绝对定位 span 结构做了适配
 */
function attemptLocate(): boolean {
  if (!containerRef.value || !props.locateTarget?.originalText?.trim()) return false

  const currentTriggerId = props.locateTarget.triggerId || ''
  if (currentTriggerId && currentTriggerId === lastLocateTriggerId.value) {
    return true
  }

  clearHighlights()

  const locateTerms = getLocateTerms()
  if (!locateTerms.length) {
    emit('locateResult', { success: false, mode: 'fallback', hint: '无可定位的目标文本' })
    return false
  }

  const textLayers = containerRef.value.querySelectorAll('.textLayer')
  let found = false

  for (let li = 0; li < textLayers.length && !found; li++) {
    const textLayer = textLayers[li] as HTMLElement
    const pageEl = textLayer.closest('.page') as HTMLElement | null
    const pageNum = pageEl ? parseInt(pageEl.getAttribute('data-page-number') || `${li + 1}`) : li + 1

    // 收集所有有文本的 span 及其在 TreeWalker 中的顺序
    const allSpans: { el: HTMLElement; text: string }[] = []
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        return node.nodeName === 'SPAN' && node.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })
    while (walker.nextNode()) {
      allSpans.push({ el: walker.currentNode as HTMLElement, text: walker.currentNode.textContent || '' })
    }

    // 第一轮：精确匹配（支持跨多span）
    for (const term of locateTerms) {
      const result = findAndHighlightSpans(allSpans, term, pageNum, pageEl, 'direct', currentTriggerId)
      if (result) { found = true; break }
    }

    // 第二轮：模糊匹配（仅当精确未命中时）
    if (!found) {
      for (const term of locateTerms) {
        const result = findAndHighlightSpans(allSpans, term, pageNum, pageEl, 'fallback', currentTriggerId)
        if (result) { found = true; break }
      }
    }
  }

  if (!found) {
    console.warn(`[PDF] 未找到文本: "${props.locateTarget.originalText.slice(0, 60)}", 共 ${textLayers.length} 个 textLayer`)
    emit('locateResult', {
      success: false,
      mode: 'fallback',
      hint: props.locateTarget?.locateHint || `文档中未找到 "${props.locateTarget.originalText.slice(0, 40)}"`,
    })
  }

  return found
}

/**
 * 在 span 列表中查找目标文本并高亮所有匹配的 span（支持跨多span）
 */
function findAndHighlightSpans(
  allSpans: { el: HTMLElement; text: string }[],
  term: string,
  pageNum: number,
  pageEl: HTMLElement | null,
  mode: 'direct' | 'fallback',
  triggerId: string
): boolean {
  const useLoose = mode === 'fallback'
  const matchedIndices: number[] = []

  for (let i = 0; i < allSpans.length; i++) {
    const spanText = allSpans[i].text
    const isMatch = useLoose ? includesLoose(spanText, term) : spanText.includes(term)

    if (isMatch) {
      // 单个 span 完全包含目标文本
      matchedIndices.push(i)
    } else if (term.length > 3 && spanText.includes(term[0])) {
      // 可能跨多个 span：尝试从当前 span 开始拼接
      let concatenated = spanText
      let j = i
      const startIdx = i

      while (j < allSpans.length - 1 && concatenated.length < term.length * 2) {
        j++
        concatenated += allSpans[j].text
        const checkFn = useLoose ? () => includesLoose(concatenated, term) : () => concatenated.includes(term)
        if (checkFn()) {
          for (let k = startIdx; k <= j; k++) matchedIndices.push(k)
          break
        }
      }
    }

    if (matchedIndices.length > 0) break
  }

  if (matchedIndices.length === 0) return false

  // 执行高亮
  currentPage.value = pageNum
  matchedIndices.forEach(idx => {
    allSpans[idx].el.classList.add(HIGHLIGHT_CLASS)
  })

  scrollSpanIntoView(allSpans[matchedIndices[0]].el, pageEl)
  if (triggerId) lastLocateTriggerId.value = triggerId
  emit('locateResult', { success: true, mode })
  console.log(`[PDF] 高亮完成: 第${pageNum}页, ${matchedIndices.length}个span, 关键词="${term.slice(0, 40)}"`)

  return true
}

function scrollSpanIntoView(spanEl: HTMLElement, pageEl: HTMLElement | null) {
  // 先滚动到页面位置
  if (pageEl) {
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // 再微调到高亮元素
  setTimeout(() => {
    spanEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, 350)
}

// ===== 监听 locateTarget 变化（与 Word 一致的关键修复）=====

watch(
  () => props.locateTarget,
  () => {
    nextTick(() => {
      setTimeout(() => attemptLocate(), 100)
    })
  }
)

defineExpose({ clearHighlights, loadPdf })
</script>

<template>
  <div class="pdf-preview-panel">
    <div v-if="loading" class="pdf-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在加载 PDF...</span>
    </div>

    <div v-else-if="error" class="pdf-error">
      <el-icon :size="20"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
    </div>

    <template v-else-if="pdfSource">
      <div ref="containerRef" class="pdf-container">
        <VuePdfEmbed
          ref="pdfEmbedRef"
          :source="pdfSource"
          text-layer
          :width="containerWidth"
          @rendered="onPdfRendered"
          @loading-failed="onLoadingFailed"
        />
      </div>

      <div class="pdf-toolbar" v-if="totalPages > 0">
        <span class="page-info">第 {{ currentPage }} / {{ totalPages }} 页</span>
        <div class="page-nav">
          <el-button size="small" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">上一页</el-button>
          <el-button size="small" :disabled="currentPage >= totalPages" @click="goPage(currentPage + 1)">下一页</el-button>
        </div>
        <div class="zoom-controls">
          <el-button size="small" @click="zoomOut">-</el-button>
          <span>{{ Math.round(scale * 100) }}%</span>
          <el-button size="small" @click="zoomIn">+</el-button>
        </div>
      </div>
    </template>

    <div v-else class="pdf-empty">
      <el-icon :size="32" color="#999"><WarningFilled /></el-icon>
      <span>暂无 PDF 文件预览</span>
      <span class="pdf-empty__detail">fileId: {{ props.fileId || '(未指定)' }}</span>
    </div>
  </div>
</template>

<style scoped>
.pdf-preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #525659;
  position: relative;
}

.pdf-loading,
.pdf-error,
.pdf-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  height: 400px;
  color: rgba(255, 255, 255, 0.85);
  font-size: var(--text-base);
  background: #525659;
  border-radius: var(--radius-lg);
}

.pdf-empty {
  flex-direction: column;
  gap: var(--space-2);
}

.pdf-empty__detail {
  font-size: var(--text-xs);
  color: rgba(255, 255, 255, 0.4);
  font-family: ui-monospace, monospace;
}

.pdf-container {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8) var(--space-6);
  background: #525659;
}

.pdf-container :deep(.vue-pdf-embed) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-6);
}

.pdf-container :deep(.page) {
  position: relative;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  background: #fff;
  border-radius: 2px;
}

.pdf-container :deep(.page canvas) {
  display: block;
  width: 100% !important;
  height: auto !important;
}

.pdf-container :deep(.textLayer) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  opacity: 0.05;
  line-height: 1;
}

.pdf-container :deep(.textLayer > span) {
  color: transparent;
  position: absolute;
  white-space: pre;
  transform-origin: 0% 0%;
}

/* 高亮样式 - 实色不透明，确保在任何 opacity 父级下都清晰可见 */
.pdf-container :deep(.textLayer > span.pdf-highlight-yellow) {
  background-color: #FFD700 !important;
  color: transparent !important;
  box-shadow: 0 0 12px rgba(255, 180, 0, 1), 0 0 4px rgba(255, 150, 0, 1), inset 0 0 8px rgba(255, 220, 0, 0.5);
  border-radius: 3px;
  outline: 2px solid #FF9500;
  outline-offset: -1px;
  animation: pdf-highlight-pulse 1.2s ease-in-out 4;
}

@keyframes pdf-highlight-pulse {
  0%, 100% { box-shadow: 0 0 12px rgba(255, 180, 0, 1), 0 0 4px rgba(255, 150, 0, 1); outline-color: #FF9500; }
  50% { box-shadow: 0 0 24px rgba(255, 200, 0, 1), 0 0 8px rgba(255, 120, 0, 1), inset 0 0 12px rgba(255, 230, 0, 0.6); outline-color: #FF6600; }
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  background: var(--bg-elevated);
  border-top: 1px solid var(--corp-border-light);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  flex-shrink: 0;
}

.page-info {
  min-width: 120px;
  text-align: center;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.page-nav {
  display: flex;
  gap: var(--space-2);
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 120px;
  justify-content: flex-end;
}
</style>
