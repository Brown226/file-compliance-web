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
      <template v-if="!showTimeoutFallback">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <span>正在解析图纸并生成预览...</span>
        <span class="loading-hint">首次解析较大 DWG 文件可能需要 10-30 秒</span>
      </template>
      <template v-else>
        <el-icon :size="28" color="var(--el-color-warning)"><WarningFilled /></el-icon>
        <span>图纸解析时间较长</span>
        <span class="loading-hint">可先查看文本内容，解析完成后可切换回图纸预览</span>
        <el-button type="primary" size="small" @click="fallbackToText">查看文本内容</el-button>
      </template>
    </div>

    <!-- 解析失败 -->
    <div v-else-if="error" class="preview-error">
      <el-icon :size="28" color="var(--el-color-warning)"><WarningFilled /></el-icon>
      <span>图纸预览生成失败</span>
      <span class="error-msg">{{ errorMsg }}</span>
      <span class="version-hint">libredwg 支持格式：DWG R13-R14 (1994-1998)、R15 (2000-2002)、R18 (2010-2012)、R21 (2013-2016)、R24 (2018-2020)。如文件为更高版本或其他格式，建议另存为 R24 以下版本后重新上传。</span>
      <el-button type="primary" size="small" @click="fallbackToText">查看文本内容</el-button>
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
      >
        <!-- SVG 通过 DOM API 直接插入，避免 v-html + XMLSerializer 的命名空间丢失问题 -->
      </div>
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
import { dwgToSvg, terminateDwgWorker, type DwgSvgResult } from '@/utils/dwg-parser'
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

/** 超时降级：解析超过 30 秒时允许用户跳过图纸预览 */
const showTimeoutFallback = ref(false)
const FALLBACK_TIMEOUT_MS = 30000
let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null

const emit = defineEmits<{
  fallbackToText: []
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

// 视图变换参数
const scale = ref(0.05)  // 初始设为 5%，确保能看到图纸
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
  showTimeoutFallback.value = false
  svgContent.value = ''       // 先清空，触发 v-if 隐藏 viewport
  handleMap.value = {}
  fileName.value = file.name

  // 30 秒超时降级：如果 WASM 解析耗时过长，允许用户跳过
  fallbackTimeoutId = setTimeout(() => {
    showTimeoutFallback.value = true
  }, FALLBACK_TIMEOUT_MS)

  try {
    const result: DwgSvgResult = await dwgToSvg(file)

    const rawSvg = result.svg
    console.log('[DwgPreview] 原始 SVG 长度:', rawSvg.length, '前200字符:', rawSvg.slice(0, 200))

    // ★ 第一步：先设置 svgContent 以触发 viewport 渲染，等待 canvasRef 挂载
    svgContent.value = 'active'
    handleMap.value = result.handleMap
    await nextTick()

    // 清理 canvasRef 中上次的 SVG
    if (canvasRef.value) canvasRef.value.innerHTML = ''

    // ★ 渲染策略：优先 innerHTML 直接注入（HTML 解析器对编码容错更好），
    // DOMParser('image/svg+xml') 严格模式遇到非法 UTF-8 字节会直接失败。
    // DOMPurify 消毒在 innerHTML 渲染后对 DOM 节点进行，保证安全。
    let svgInserted = false
    try {
      // 步骤1：编码清洗 — 移除非法 XML/HTML 控制字符（保留 \t\n\r）
      const cleanSvg = rawSvg
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')

      if (canvasRef.value) {
        canvasRef.value.innerHTML = cleanSvg
        const svgEl = canvasRef.value.querySelector('svg')
        if (svgEl) {
          // 步骤2：DOM 节点消毒（innerHTML 渲染后再对 DOM 节点消毒，保留命名空间）
          try {
            DOMPurify.sanitize(svgEl, {
              ADD_TAGS: ['svg', 'path', 'g', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'defs', 'use', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'marker', 'pattern', 'filter', 'fecolormatrix', 'fegaussianblur', 'femerge', 'femergenode', 'feoffset', 'fedropshadow', 'feflood', 'fecomposite', 'feblend', 'symbol', 'textpath', 'tspan', 'foreignobject', 'switch', 'image'],
              ADD_ATTR: ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'text-decoration', 'letter-spacing', 'word-spacing', 'viewBox', 'viewbox', 'preserveAspectRatio', 'preserveaspectratio', 'xmlns', 'version', 'id', 'class', 'style', 'data-handle', 'data-entity-type', 'href', 'xlink:href', 'clip-path', 'clip-rule', 'offset', 'stop-color', 'stop-opacity', 'marker-start', 'marker-end', 'marker-mid', 'ref-x', 'ref-y', 'marker-width', 'marker-height', 'orient', 'markerunits', 'patternUnits', 'patternTransform', 'patternunits', 'patterntransform', 'filterUnits', 'filterunits', 'result', 'in', 'in2', 'stdDeviation', 'stddeviation', 'dx', 'dy', 'rotate', 'textLength', 'textlength', 'lengthAdjust', 'lengthadjust', 'z-index', 'vector-effect', 'overflow', 'display', 'visibility', 'color'],
            })
          } catch (purifyErr: any) {
            console.warn('[DwgPreview] DOMPurify 后消毒失败（DOM 节点仍保留）:', purifyErr?.message)
          }
          svgInserted = true
          console.log('[DwgPreview] SVG innerHTML 注入 + DOMPurify DOM 消毒完成')
        }
      }
    } catch (innerErr: any) {
      console.error('[DwgPreview] innerHTML 注入失败:', innerErr)
    }

    // 诊断：打印实际渲染到 DOM 中的 SVG 信息
    await nextTick()
    if (canvasRef.value) {
      const svgEl = canvasRef.value.querySelector('svg')
      if (svgEl) {
        const vb = svgEl.getAttribute('viewBox') || svgEl.getAttribute('viewbox')
        const w = svgEl.getAttribute('width')
        const h = svgEl.getAttribute('height')
        const vpRect = viewportRef.value?.getBoundingClientRect()
        console.log('[DwgPreview] ✓ SVG 渲染成功:', {
          viewBox: vb || '(无)',
          width: w, height: h,
          childElementCount: svgEl.children.length,
          innerHTML_len: svgEl.innerHTML.length,
          viewportSize: vpRect ? `${Math.round(vpRect.width)}x${Math.round(vpRect.height)}` : 'N/A',
          currentScale: scale.value.toFixed(4),
          currentTranslate: `${translateX.value.toFixed(0)}, ${translateY.value.toFixed(0)}`,
        })
      } else {
        console.error('[DwgPreview] ★ SVG 渲染失败！canvasRef 子节点数:', canvasRef.value.children.length,
          'innerHTML 长度:', canvasRef.value.innerHTML.length,
          '前300字符:', canvasRef.value.innerHTML.slice(0, 300))
      }
    } else {
      console.error('[DwgPreview] ★ canvasRef 为 null！viewer 容器未挂载')
    }

    // SVG 生成后检查是否有待定位的图元（locateTarget 可能在解析期间被设置）
    if (props.locateTarget?.cadHandleId) {
      await nextTick()
      highlightEntity(props.locateTarget.cadHandleId, props.locateTarget.description)
    }

    // 初始适应窗口 - 添加重试机制确保 DOM 更新完成
    setTimeout(() => {
      fitToWindowWithRetry()
    }, 150)
  } catch (e: any) {
    console.error('[DwgPreviewPanel] SVG 生成失败:', e)
    error.value = true
    const msg = e?.message || ''
    if (msg.includes('R2004') || msg.includes('decompress') || msg.includes('Assertion')) {
      errorMsg.value = 'DWG R2004/R2007 压缩编码不兼容，请用 AutoCAD 另存为 R18 (2010) 或 R21 (2013) 格式后重试'
    } else {
      errorMsg.value = msg || '未知错误'
    }
    parseFailed.value = true
  } finally {
    if (fallbackTimeoutId) {
      clearTimeout(fallbackTimeoutId)
      fallbackTimeoutId = null
    }
    loading.value = false
  }
}

// 监听文件变化
watch(() => props.file, (newFile) => {
  console.log('[DwgPreview] 监听到文件变化:', newFile?.name || 'null')
  if (newFile) {
    // 重置视图参数
    scale.value = 0.05
    translateX.value = 0
    translateY.value = 0
    console.log('[DwgPreview] 重置视图参数:', { scale: scale.value, tx: translateX.value, ty: translateY.value })
    generateSvg(newFile)
  } else {
    svgContent.value = ''
    handleMap.value = {}
    if (canvasRef.value) canvasRef.value.innerHTML = ''
  }
}, { immediate: true })

// 确保 SVG 内容更新后自动适应窗口
watch(svgContent, (newContent) => {
  console.log('[DwgPreview] svgContent 变化，长度:', newContent?.length || 0)
  if (newContent && newContent.length > 0) {
    setTimeout(fitToWindow, 150)
  }
})

/** 用户主动降级：点击"查看文本内容"时通知父组件切换到文本预览 */
function fallbackToText() {
  if (fallbackTimeoutId) {
    clearTimeout(fallbackTimeoutId)
    fallbackTimeoutId = null
  }
  loading.value = false
  showTimeoutFallback.value = false
  parseFailed.value = true
  emit('fallbackToText')
}

// ==================== 缩放和平移 ====================
// 缩放参数
const MIN_SCALE = 0.001  // 允许更小的缩放，适应大图纸
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
  console.log('[DwgPreview] fitToWindow 开始执行')
  
  if (!viewportRef.value || !canvasRef.value) {
    console.warn('[DwgPreview] fitToWindow: 容器未准备好')
    return
  }

  const vpRect = viewportRef.value.getBoundingClientRect()
  if (vpRect.width <= 0 || vpRect.height <= 0) {
    console.warn('[DwgPreview] fitToWindow: 视口尺寸为0，跳过')
    return
  }
  console.log('[DwgPreview] fitToWindow: 视口尺寸', vpRect.width, 'x', vpRect.height)

  const svgEl = canvasRef.value.querySelector('svg')
  if (!svgEl) {
    console.warn('[DwgPreview] fitToWindow: SVG 元素未找到（v-html 尚未渲染？）')
    return
  }

  // 留边距
  const vpW = vpRect.width - 20
  const vpH = vpRect.height - 20

  // 获取 SVG 尺寸：优先 viewBox，其次 width/height 属性，最后用元素自身宽高
  let vbX = 0, vbY = 0, vbW = 0, vbH = 0
  let hasSize = false

  const vb = svgEl.getAttribute('viewBox') || svgEl.getAttribute('viewbox')
  if (vb) {
    console.log('[DwgPreview] fitToWindow: viewBox =', vb)
    const parts = vb.split(/[\s,]+/).map(Number)
    vbX = parts[0] || 0
    vbY = parts[1] || 0
    vbW = Math.abs(parts[2]) || 0
    vbH = Math.abs(parts[3]) || 0
    if (vbW > 0 && vbH > 0) hasSize = true
  }

  // viewBox 无效时尝试 width/height 属性
  if (!hasSize) {
    const w = parseFloat(svgEl.getAttribute('width') || '')
    const h = parseFloat(svgEl.getAttribute('height') || '')
    if (w > 0 && h > 0) {
      console.log('[DwgPreview] fitToWindow: 使用 width/height =', w, 'x', h)
      vbW = w; vbH = h; hasSize = true
    }
  }

  // 仍然无效时用元素实际渲染尺寸
  if (!hasSize) {
    const bbox = svgEl.getBBox?.()
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      console.log('[DwgPreview] fitToWindow: 使用 getBBox =', bbox.width, 'x', bbox.height)
      vbX = bbox.x; vbY = bbox.y
      vbW = bbox.width; vbH = bbox.height; hasSize = true
    }
  }

  // 所有方法都失败时使用默认尺寸并警告
  if (!hasSize) {
    console.warn('[DwgPreview] fitToWindow: 无法获取 SVG 尺寸，使用默认 800x600')
    vbW = 800; vbH = 600; hasSize = true
  }

  console.log('[DwgPreview] fitToWindow: 图纸尺寸', vbW, 'x', vbH)

  // 计算缩放比例（保持宽高比，适应视口）
  const scaleX = vpW / vbW
  const scaleY = vpH / vbH
  const naturalScale = Math.min(scaleX, scaleY)

  console.log('[DwgPreview] fitToWindow: 计算比例', { scaleX: scaleX.toFixed(6), scaleY: scaleY.toFixed(6), natural: naturalScale.toFixed(6) })

  // 如果缩放比例太小，设置一个最小值确保能看到图纸
  const isForcedScale = naturalScale < 0.05
  const finalScale = Math.max(naturalScale, 0.05) // 最小 5%
  scale.value = finalScale

  // 居中策略：
  // - 如果缩放是强制的（图纸太大），优先显示左上角区域
  // - 如果缩放是自然计算的，正常居中
  if (isForcedScale) {
    translateX.value = -vbX * scale.value
    translateY.value = -vbY * scale.value
  } else {
    translateX.value = (vpRect.width - vbW * scale.value) / 2 - vbX * scale.value
    translateY.value = (vpRect.height - vbH * scale.value) / 2 - vbY * scale.value
  }

  console.log('[DwgPreview] fitToWindow: 最终结果', { scale: scale.value.toFixed(6), tx: translateX.value.toFixed(0), ty: translateY.value.toFixed(0), isForcedScale })
}

// 带重试机制的 fitToWindow，确保 DOM 更新完成后执行
function fitToWindowWithRetry(retries = 3, delay = 200) {
  console.log('[DwgPreview] fitToWindowWithRetry 开始，剩余重试:', retries)
  
  const svgEl = canvasRef.value?.querySelector('svg')
  
  if (svgEl) {
    fitToWindow()
    return
  }
  
  if (retries > 0) {
    setTimeout(() => {
      fitToWindowWithRetry(retries - 1, delay * 1.5)
    }, delay)
  } else {
    console.warn('[DwgPreview] fitToWindowWithRetry: 重试耗尽，SVG 仍未找到')
  }
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

function highlightEntity(handle: string, description?: string): boolean {
  if (!canvasRef.value) return false

  clearHighlight()

  // 通过 data-handle 属性查找图元
  const el = canvasRef.value.querySelector(`[data-handle="${handle}"]`) as SVGElement | null
  if (!el) {
    console.warn('[DwgPreviewPanel] 未找到 handle:', handle)
    return false
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

  return true
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
      const found = highlightEntity(handle, target.description)
      emit('locateResult', {
        success: found,
        mode: found ? 'direct' : 'fallback',
        hint: found ? undefined : (target.description || '未找到对应图元，请按“页/段/句+关键词”提示辅助定位。'),
      })
    })
    return
  }

  emit('locateResult', {
    success: false,
    mode: 'fallback',
    hint: target.description || '缺少 CAD 句柄，已降级到文本线索定位。',
  })
})

onUnmounted(() => {
  if (fallbackTimeoutId) {
    clearTimeout(fallbackTimeoutId)
    fallbackTimeoutId = null
  }
  clearHighlight()
  highlightInfo.value = null
  terminateDwgWorker()
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
  min-height: 0; /* 关键修复：允许在 flex 容器中正确收缩 */
  position: relative;
}

/* ===== 工具栏 ===== */
.preview-toolbar {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  border-bottom: 1px solid var(--corp-border-light, #475569);
  background: var(--corp-bg-sunken, #334155);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--corp-text-primary, #e2e8f0);
}

.preview-filename {
  font-size: 12px;
  color: var(--corp-text-secondary, #94a3b8);
  background: rgba(255, 255, 255, 0.08);
  padding: 3px 10px;
  border-radius: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-right .el-button {
  border-color: var(--corp-border-light, #475569);
  color: var(--corp-text-primary, #e2e8f0);
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

.version-hint {
  font-size: 11px;
  color: var(--corp-text-secondary, #6b7280);
  max-width: 360px;
  text-align: center;
  line-height: 1.5;
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
  background: #1e293b; /* 深色背景 - 类似 AutoCAD 经典界面 */
  cursor: grab;
  min-height: 400px; /* 关键修复：防止高度塌陷为 0 */
}

.svg-viewport:active {
  cursor: grabbing;
}

.svg-canvas {
  position: absolute;
  top: 0;
  left: 0;
}

/* SVG 保持原始尺寸，通过 transform 进行缩放 - 防止模糊 */
.svg-canvas :deep(svg) {
  display: block;
  overflow: visible;
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
