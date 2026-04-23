<template>
  <div class="dwg-preview-panel">
    <!-- 工具栏 -->
    <div class="preview-toolbar">
      <div class="toolbar-left">
        <span class="preview-title">图纸预览</span>
        <span class="preview-filename" v-if="fileName" :title="fileName">{{ fileName }}</span>
      </div>
      <div class="toolbar-right">
        <el-tooltip content="放大" placement="bottom">
          <el-button size="small" :icon="ZoomIn" circle @click="zoomIn" />
        </el-tooltip>
        <el-tooltip content="缩小" placement="bottom">
          <el-button size="small" :icon="ZoomOut" circle @click="zoomOut" />
        </el-tooltip>
        <el-tooltip content="适应窗口" placement="bottom">
          <el-button size="small" :icon="FullScreen" circle @click="fitToWindow" />
        </el-tooltip>
        <el-tooltip content="重置" placement="bottom">
          <el-button size="small" :icon="RefreshRight" circle @click="resetView" />
        </el-tooltip>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="28"><Loading /></el-icon>
      <span>正在解析图纸并生成预览...</span>
      <span class="loading-hint">首次解析较大 DWG 文件可能需要 10-30 秒</span>
    </div>

    <!-- 解析失败 -->
    <div v-else-if="error" class="preview-error">
      <el-icon :size="28" color="var(--el-color-warning)"><WarningFilled /></el-icon>
      <span>图纸预览生成失败</span>
      <span class="error-msg">{{ errorMsg }}</span>
    </div>

    <!-- SVG 预览区域 -->
    <div
      v-else-if="svgContent"
      class="svg-viewport"
      ref="viewportRef"
      @wheel.prevent="onWheel"
      @mousedown.prevent="onMouseDown"
    >
      <div
        class="svg-canvas"
        ref="canvasRef"
        :style="canvasTransform"
        v-html="svgContent"
      />
    </div>

    <!-- 空状态 -->
    <div v-else class="preview-empty">
      <el-icon :size="32" color="#94a3b8"><Picture /></el-icon>
      <p>暂无图纸预览</p>
      <p class="empty-hint">请先选择一个 DWG 文件查看原图预览</p>
    </div>

    <!-- 缩放比例指示 -->
    <div class="zoom-indicator" v-if="svgContent && !loading">
      {{ Math.round(scale * 100) }}%
    </div>

    <!-- 问题定位浮层 -->
    <transition name="fade">
      <div
        v-if="highlightInfo"
        class="highlight-tooltip"
        :style="highlightTooltipStyle"
      >
        <div class="highlight-tooltip-content">
          <el-icon color="#ef4444" :size="14"><WarningFilled /></el-icon>
          <span class="highlight-text">{{ highlightInfo.description }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Loading, WarningFilled, Picture, ZoomIn, ZoomOut, FullScreen, RefreshRight } from '@element-plus/icons-vue'
import { dwgToSvg, type DwgSvgResult } from '@/utils/dwg-parser'
import DOMPurify from 'dompurify'

interface HighlightInfo {
  handle: string
  description: string
}

const props = defineProps<{
  /** DWG 原始文件（需从后端下载或前端缓存） */
  file: File | null
  /** 当前需要高亮定位的错误信息 */
  locateTarget?: {
    cadHandleId?: string
    originalText?: string
    description?: string
  } | null
}>()

const loading = ref(false)
const error = ref(false)
const errorMsg = ref('')
const svgContent = ref<string>('')
const handleMap = ref<Record<string, string>>({})
const fileName = ref('')

/** 解析是否失败，供父组件降级到 TextPreviewPanel */
const parseFailed = ref(false)
defineExpose({ parseFailed })

// 视图变换参数
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const viewportRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)

// 高亮状态
const highlightInfo = ref<HighlightInfo | null>(null)
const highlightTooltipStyle = ref<Record<string, string>>({})

// 拖拽状态
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragStartTX = 0
let dragStartTY = 0

const canvasTransform = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  transition: isDragging ? 'none' : 'transform 0.2s ease',
}))

// ==================== SVG 生成 ====================

async function generateSvg(file: File) {
  loading.value = true
  error.value = false
  parseFailed.value = false
  svgContent.value = ''
  handleMap.value = {}
  fileName.value = file.name

  try {
    const result: DwgSvgResult = await dwgToSvg(file)

    // 安全过滤 SVG（保留 data-handle 和 data-entity-type 属性）
    svgContent.value = DOMPurify.sanitize(result.svg, {
      ADD_TAGS: ['svg', 'path', 'g', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'defs', 'use', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'marker'],
      ADD_ATTR: ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'text-anchor', 'dominant-baseline', 'viewbox', 'preserveaspectratio', 'xmlns', 'id', 'class', 'style', 'data-handle', 'data-entity-type', 'href', 'clip-path', 'offset', 'stop-color', 'stop-opacity', 'marker-start', 'marker-end', 'ref-x', 'ref-y', 'marker-width', 'marker-height', 'orient', 'markerunits'],
    })
    handleMap.value = result.handleMap

    // 初始适应窗口
    await nextTick()
    setTimeout(fitToWindow, 100)
  } catch (e: any) {
    console.error('[DwgPreviewPanel] SVG 生成失败:', e)
    error.value = true
    errorMsg.value = e?.message || '未知错误'
    parseFailed.value = true
  } finally {
    loading.value = false
  }
}

// 监听文件变化
watch(() => props.file, (newFile) => {
  if (newFile) {
    generateSvg(newFile)
  } else {
    svgContent.value = ''
    handleMap.value = {}
  }
}, { immediate: true })

// ==================== 缩放和平移 ====================

const MIN_SCALE = 0.05
const MAX_SCALE = 20
const ZOOM_FACTOR = 1.15

function zoomIn() {
  scale.value = Math.min(MAX_SCALE, scale.value * ZOOM_FACTOR)
}

function zoomOut() {
  scale.value = Math.max(MIN_SCALE, scale.value / ZOOM_FACTOR)
}

function resetView() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function fitToWindow() {
  if (!viewportRef.value || !canvasRef.value) return

  const vpRect = viewportRef.value.getBoundingClientRect()
  const svgEl = canvasRef.value.querySelector('svg')
  if (!svgEl) return

  // 获取 SVG 视图框
  const vb = svgEl.getAttribute('viewBox')
  let svgW: number, svgH: number

  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number)
    svgW = parts[2] || 800
    svgH = parts[3] || 600
  } else {
    svgW = parseFloat(svgEl.getAttribute('width') || '800')
    svgH = parseFloat(svgEl.getAttribute('height') || '600')
  }

  const vpW = vpRect.width - 20  // 留边距
  const vpH = vpRect.height - 20
  const scaleX = vpW / svgW
  const scaleY = vpH / svgH
  scale.value = Math.min(scaleX, scaleY, 2) // 不超过 200%

  // 居中
  translateX.value = (vpRect.width - svgW * scale.value) / 2
  translateY.value = (vpRect.height - svgH * scale.value) / 2
}

function onWheel(e: WheelEvent) {
  const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))

  // 以鼠标位置为中心缩放
  if (viewportRef.value) {
    const rect = viewportRef.value.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const ratio = newScale / scale.value
    translateX.value = mouseX - ratio * (mouseX - translateX.value)
    translateY.value = mouseY - ratio * (mouseY - translateY.value)
  }

  scale.value = newScale
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return // 仅左键
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartTX = translateX.value
  dragStartTY = translateY.value

  const onMouseMove = (ev: MouseEvent) => {
    if (!isDragging) return
    translateX.value = dragStartTX + (ev.clientX - dragStartX)
    translateY.value = dragStartTY + (ev.clientY - dragStartY)
  }

  const onMouseUp = () => {
    isDragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// ==================== 错误定位高亮 ====================

function clearHighlight() {
  if (!canvasRef.value) return
  // 移除所有高亮类
  canvasRef.value.querySelectorAll('.dwg-entity-highlight').forEach(el => {
    el.classList.remove('dwg-entity-highlight')
    // 恢复原始样式
    const g = el as SVGElement
    g.style.filter = ''
    g.style.opacity = ''
  })
}

function highlightEntity(handle: string, description?: string) {
  if (!canvasRef.value) return

  clearHighlight()

  // 通过 data-handle 属性查找图元
  const el = canvasRef.value.querySelector(`[data-handle="${handle}"]`) as SVGElement | null
  if (!el) {
    console.warn('[DwgPreviewPanel] 未找到 handle:', handle)
    return
  }

  // 添加高亮样式
  el.classList.add('dwg-entity-highlight')
  ;(el as SVGElement).style.filter = 'drop-shadow(0 0 6px #ef4444) drop-shadow(0 0 12px #ef4444)'
  ;(el as SVGElement).style.opacity = '1'

  // 滚动到该图元位置
  const bbox = (el as SVGGraphicsElement).getBBox?.()
  if (bbox && viewportRef.value) {
    const vpRect = viewportRef.value.getBoundingClientRect()
    // 计算图元中心在 viewport 中的位置
    const centerX = translateX.value + (bbox.x + bbox.width / 2) * scale.value
    const centerY = translateY.value + (bbox.y + bbox.height / 2) * scale.value

    // 如果图元不在可视区域，平移到中心
    if (
      centerX < 0 || centerX > vpRect.width ||
      centerY < 0 || centerY > vpRect.height
    ) {
      translateX.value = vpRect.width / 2 - (bbox.x + bbox.width / 2) * scale.value
      translateY.value = vpRect.height / 2 - (bbox.y + bbox.height / 2) * scale.value
    }

    // 显示高亮浮层
    highlightInfo.value = {
      handle,
      description: description || '',
    }

    // 计算浮层位置
    const elRect = (el as Element).getBoundingClientRect()
    const vpRect2 = viewportRef.value.getBoundingClientRect()
    highlightTooltipStyle.value = {
      left: `${elRect.left - vpRect2.left + elRect.width / 2}px`,
      top: `${elRect.top - vpRect2.top - 8}px`,
    }
  }
}

// 监听定位目标变化
watch(() => props.locateTarget, (target) => {
  if (!target) {
    clearHighlight()
    highlightInfo.value = null
    return
  }

  const handle = target.cadHandleId
  if (handle) {
    nextTick(() => {
      highlightEntity(handle, target.description)
    })
  }
}, { deep: true })

onUnmounted(() => {
  clearHighlight()
  highlightInfo.value = null
})
</script>

<style scoped>
.dwg-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--corp-bg-panel, #f8fafc);
  overflow: hidden;
  min-width: 0;
  position: relative;
}

/* ===== 工具栏 ===== */
.preview-toolbar {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  border-bottom: 1px solid var(--corp-border-light, #e5e7eb);
  background: var(--corp-bg-sunken, #f1f5f9);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--corp-text-primary, #1f2937);
}

.preview-filename {
  font-size: 12px;
  color: var(--corp-text-secondary, #6b7280);
  background: var(--color-gray-50, #f9fafb);
  padding: 3px 10px;
  border-radius: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--corp-border-light, #e5e7eb);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-right .el-button {
  border-color: var(--corp-border-light, #e5e7eb);
}

/* ===== 加载/错误/空状态 ===== */
.preview-loading,
.preview-error,
.preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--corp-text-secondary, #6b7280);
  font-size: 13px;
}

.loading-hint {
  font-size: 12px;
  opacity: 0.7;
}

.error-msg {
  font-size: 12px;
  color: var(--el-color-warning, #e6a23c);
  max-width: 300px;
  text-align: center;
}

.empty-hint {
  font-size: 12px;
  opacity: 0.7;
}

/* ===== SVG 视口 ===== */
.svg-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #ffffff;
  cursor: grab;
  background-image:
    linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
    linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
    linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}

.svg-viewport:active {
  cursor: grabbing;
}

.svg-canvas {
  position: absolute;
  top: 0;
  left: 0;
}

.svg-canvas :deep(svg) {
  display: block;
}

/* ===== 高亮样式 ===== */
.svg-canvas :deep(.dwg-entity-highlight) {
  filter: drop-shadow(0 0 6px #ef4444) drop-shadow(0 0 12px #ef4444) !important;
  opacity: 1 !important;
}

.svg-canvas :deep(.dwg-entity-highlight path),
.svg-canvas :deep(.dwg-entity-highlight line),
.svg-canvas :deep(.dwg-entity-highlight circle),
.svg-canvas :deep(.dwg-entity-highlight ellipse),
.svg-canvas :deep(.dwg-entity-highlight polyline),
.svg-canvas :deep(.dwg-entity-highlight polygon),
.svg-canvas :deep(.dwg-entity-highlight rect) {
  stroke: #ef4444 !important;
  stroke-width: 3 !important;
  filter: drop-shadow(0 0 8px #ef4444) !important;
}

.svg-canvas :deep(.dwg-entity-highlight text) {
  fill: #ef4444 !important;
  filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.5)) !important;
  font-weight: bold !important;
}

/* ===== 缩放指示器 ===== */
.zoom-indicator {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: rgba(15, 23, 42, 0.75);
  color: #fff;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  pointer-events: none;
  backdrop-filter: blur(4px);
}

/* ===== 高亮浮层 ===== */
.highlight-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  z-index: 100;
  pointer-events: none;
}

.highlight-tooltip-content {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(239, 68, 68, 0.95);
  color: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.highlight-tooltip-content::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(239, 68, 68, 0.95);
  border-bottom: 0;
}

.highlight-text {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
