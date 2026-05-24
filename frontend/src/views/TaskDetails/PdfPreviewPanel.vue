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
    <div v-else class="pdf-viewer" ref="viewerRef">
      <div
        v-for="(page, pi) in pages"
        :key="pi"
        class="pdf-page-wrapper"
      >
        <canvas :ref="(el) => canvasRefs[pi] = el as HTMLCanvasElement" class="pdf-canvas" />
        <div :ref="(el) => textLayerRefs[pi] = el as HTMLElement" class="pdf-text-layer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'
import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileUrl?: string
  locateTarget?: { originalText: string; locateCandidates?: string[]; locateMeta?: any; locateHint?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

const loading = ref(false)
const error = ref('')
const viewerRef = ref<HTMLElement | null>(null)
const pages = ref<{ pageNum: number; width: number; height: number }[]>([])
const canvasRefs = ref<(HTMLCanvasElement | null)[]>([])
const textLayerRefs = ref<(HTMLElement | null)[]>([])

interface PdfPageData {
  textItems: { text: string; x: number; y: number; width: number; height: number; charIndexStart: number; charIndexEnd: number }[]
}

const pageDataMap = new Map<number, PdfPageData>()

const HIGHLIGHT_CLASS = 'pdf-highlight-yellow'

const calculateScale = (page: any, containerWidth: number): number => {
  const defaultWidth = Math.max(containerWidth || 800, 600)
  const viewport = page.getViewport({ scale: 1 })
  if (viewport.width < defaultWidth) {
    return defaultWidth / viewport.width
  }
  return 1.5
}

const renderPage = async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, containerWidth: number) => {
  const page = await pdfDoc.getPage(pageNum)
  const scale = calculateScale(page, containerWidth)
  const viewport = page.getViewport({ scale })

  const idx = pageNum - 1
  const canvas = canvasRefs.value[idx]
  const textLayer = textLayerRefs.value[idx]
  if (!canvas || !textLayer) return

  const ctx = canvas.getContext('2d')!
  const w = Math.floor(viewport.width)
  const h = Math.floor(viewport.height)
  canvas.width = w
  canvas.height = h
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'

  await page.render({ canvasContext: ctx, viewport }).promise

  pages.value[idx] = { pageNum, width: w, height: h }

  const textContent = await page.getTextContent()
  const textItems: any[] = []
  let accumulatedChars = 0
  for (const item of textContent.items) {
    if ((item as TextItem).str === undefined) continue
    const ti = item as TextItem
    const tx = pdfjsLib.Util.transform(viewport.transform, ti.transform)
    const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3])
    const x = tx[4]
    const y = viewport.height - tx[5] - fontSize * 0.15
    textItems.push({
      text: ti.str,
      x,
      y,
      width: ti.width * scale,
      height: fontSize,
      charIndexStart: accumulatedChars,
      charIndexEnd: accumulatedChars + ti.str.length,
    })
    accumulatedChars += ti.str.length
  }

  textLayer.style.position = 'absolute'
  textLayer.style.top = '0'
  textLayer.style.left = '0'
  textLayer.style.width = w + 'px'
  textLayer.style.height = h + 'px'
  textLayer.style.pointerEvents = 'none'
  textLayer.style.overflow = 'hidden'
  textLayer.innerHTML = ''

  for (const ti of textItems) {
    const span = document.createElement('span')
    span.className = 'pdf-text-char'
    span.textContent = ti.text
    span.style.position = 'absolute'
    span.style.left = ti.x + 'px'
    span.style.top = ti.y + 'px'
    span.style.fontSize = ti.height + 'px'
    span.style.lineHeight = ti.height + 'px'
    span.style.whiteSpace = 'pre'
    span.style.color = 'transparent'
    span.style.pointerEvents = 'none'
    textLayer.appendChild(span)
  }

  pageDataMap.set(idx, { textItems })
}

const buildSearchText = (): { fullText: string; charOffsets: { pageIdx: number; itemIdx: number; offset: number }[] } => {
  const charOffsets: { pageIdx: number; itemIdx: number; offset: number }[] = []
  let fullText = ''
  for (let pi = 0; pi < pages.value.length; pi++) {
    const data = pageDataMap.get(pi)
    if (!data) continue
    for (let ii = 0; ii < data.textItems.length; ii++) {
      const item = data.textItems[ii]
      for (let ci = 0; ci < item.text.length; ci++) {
        charOffsets.push({ pageIdx: pi, itemIdx: ii, offset: ci })
      }
      fullText += item.text
    }
  }
  return { fullText, charOffsets }
}

const normalizeForLocate = (text: string): string =>
  text.toLowerCase().replace(/[\s\u3000]/g, '').replace(/[，。！？；：、""''（）()\[\]【】《》〈〉,.;:!?\-_/\\|]/g, '')

const getLocateTerms = (): string[] => {
  const target = props.locateTarget
  if (!target) return []
  const list = Array.isArray(target.locateCandidates) ? target.locateCandidates : []
  const quote = target.locateMeta?.quote?.text ? [target.locateMeta.quote.text] : []
  const context = [target.locateMeta?.context?.prefix || '', target.locateMeta?.context?.suffix || ''].filter(Boolean)
  return [...new Set([...quote, ...list, target.originalText, ...context].map(s => String(s || '').trim()).filter(Boolean))]
}

const includesLoose = (haystack: string, needle: string): boolean => {
  const n = normalizeForLocate(needle)
  return n ? normalizeForLocate(haystack).includes(n) : false
}

const clearHighlights = () => {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS, 'pdf-highlight-active')
  })
}

const highlightText = (): boolean => {
  clearHighlights()
  const locateTerms = getLocateTerms()
  if (!locateTerms.length) return false

  const { fullText, charOffsets } = buildSearchText()
  const normFull = normalizeForLocate(fullText)

  let bestTerm = ''
  let bestIdx = -1
  for (const term of locateTerms) {
    const n = normalizeForLocate(term)
    if (!n) continue
    const i = normFull.indexOf(n)
    if (i !== -1) { bestTerm = term; bestIdx = i; break }
  }
  if (bestIdx === -1) {
    for (const term of locateTerms) {
      if (includesLoose(fullText, term)) {
        const n = normalizeForLocate(term)
        const i = normFull.indexOf(n)
        if (i !== -1) { bestTerm = term; bestIdx = i; break }
      }
    }
  }

  if (bestIdx === -1 || !bestTerm) return false

  const endIdx = bestIdx + normalizeForLocate(bestTerm).length
  const matchedItems = new Set<number>()
  let firstFoundKey = ''

  for (let ci = bestIdx; ci < endIdx && ci < charOffsets.length; ci++) {
    const co = charOffsets[ci]
    matchedItems.add(co.pageIdx * 10000 + co.itemIdx)
    if (!firstFoundKey) firstFoundKey = `${co.pageIdx}-${co.itemIdx}`
  }

  for (const key of matchedItems) {
    const data = pageDataMap.get(Math.floor(key / 10000))
    if (!data) continue
    const tl = textLayerRefs.value[Math.floor(key / 10000)]
    if (!tl) continue
    const spans = tl.querySelectorAll('.pdf-text-char')
    const span = spans[key % 10000] as HTMLElement
    if (span) span.classList.add(HIGHLIGHT_CLASS)
  }

  if (firstFoundKey) {
    const [fPi, fIi] = firstFoundKey.split('-').map(Number)
    const spans = textLayerRefs.value[fPi]?.querySelectorAll('.pdf-text-char')
    const firstSpan = spans?.[fIi] as HTMLElement
    if (firstSpan) {
      firstSpan.classList.add('pdf-highlight-active')
      firstSpan.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  return true
}

const doLocate = () => {
  if (!props.locateTarget?.originalText?.trim()) return
  nextTick(() => {
    const found = highlightText()
    emit('locateResult', {
      success: found,
      mode: found ? 'direct' : 'fallback',
      hint: found ? undefined : (props.locateTarget.locateHint || '未能在 PDF 文本层中精确匹配原文'),
    })
  })
}

let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null

const loadPdf = async () => {
  if (!props.fileId && !props.fileUrl) return
  loading.value = true
  error.value = ''
  pageDataMap.clear()
  pages.value = []
  canvasRefs.value = []
  textLayerRefs.value = []

  try {
    let data: ArrayBuffer
    if (props.fileUrl) {
      data = await (await fetch(props.fileUrl)).arrayBuffer()
    } else {
      const resp = await request.get(`/tasks/${props.taskId}/files/${props.fileId}/raw`, { responseType: 'arraybuffer' })
      data = resp.data as ArrayBuffer
    }
    if (!data?.byteLength) throw new Error('PDF 文件内容为空')

    pdfDoc = await pdfjsLib.getDocument({ data }).promise
    const numPages = pdfDoc.numPages

    pages.value = Array.from({ length: numPages }, () => ({ pageNum: 0, width: 0, height: 0 }))
    canvasRefs.value = new Array(numPages).fill(null)
    textLayerRefs.value = new Array(numPages).fill(null)

    await nextTick()
    await new Promise(r => setTimeout(r, 80))

    const cw = viewerRef.value?.clientWidth || 800
    for (let i = 0; i < numPages; i++) {
      try { await renderPage(pdfDoc, i + 1, cw) } catch (e: any) { console.error(`[PDF] 第${i+1}页失败:`, e.message || e) }
    }
    doLocate()
  } catch (e: any) {
    error.value = e?.message || 'PDF 加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.fileId, () => loadPdf(), { immediate: true })
watch(() => props.locateTarget, () => doLocate(), { deep: true })

onUnmounted(() => { pdfDoc?.destroy(); pdfDoc = null })
</script>

<style scoped>
.pdf-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.preview-loading, .preview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #6B7280;
  font-size: 13px;
}
.pdf-viewer {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #525659;
}
.pdf-page-wrapper {
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  position: relative;
}
.pdf-canvas {
  display: block;
}
.pdf-text-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
:deep(.pdf-text-char) {
  position: absolute;
  white-space: pre;
  pointer-events: none;
  color: transparent;
}
:deep(.pdf-highlight-yellow) {
  background: rgba(255,255,0,0.4) !important;
  border-radius: 2px;
}
:deep(.pdf-highlight-active) {
  background: rgba(255,200,0,0.6) !important;
  box-shadow: 0 0 0 2px rgba(255,165,0,0.5);
}
</style>