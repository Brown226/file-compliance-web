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
const textHandleMap = ref<Record<string, string>>({})
const fileName = ref('')
/** SVG 完全加载并注入 handle 完毕，可安全进行定位 */
const svgReady = ref(false)

/** 解析是否失败，供父组件降级到 TextPreviewPanel */
const parseFailed = ref(false)
defineExpose({
  parseFailed,
  /** 获取文本→handle 映射表（用于外部定位查询） */
  getTextHandleMap: () => textHandleMap.value,
})

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

// 基础 viewBox（归一化时记录，用于 viewBox 缩放的基准）
let baseVbX = 0, baseVbY = 0, baseVbW = 0, baseVbH = 0

/** 读取当前 SVG 元素 */
function getSvgEl(): SVGSVGElement | null {
  return canvasRef.value?.querySelector('svg') as unknown as SVGSVGElement | null
}

/** 根据 zoom（scale.value）和 pan（translateX/Y, SVG 单位）更新 SVG viewBox */
function applyViewBox() {
  const svgEl = getSvgEl()
  if (!svgEl || !baseVbW) return
  const cx = baseVbX + baseVbW / 2 - (translateX.value || 0)
  const cy = baseVbY + baseVbH / 2 - (translateY.value || 0)
  const vbW = baseVbW / (scale.value || 1)
  const vbH = baseVbH / (scale.value || 1)
  svgEl.setAttribute('viewBox', `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`)
}

// ★ 不再使用 CSS transform 缩放（位图缩放导致文字模糊）
// 缩放/平移改为修改 SVG viewBox，让 SVG 引擎重新矢量渲染
const canvasTransform = computed(() => ({
  transform: 'translate(0px, 0px) scale(1)',
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

    // ★ 关键修复：先结束 loading 状态释放 v-else-if 链，让 .svg-viewport 渲染
    //   之前 loading=true 阻塞了 v-else-if 链，导致 svgContent 虽设置但 viewport
    //     DOM 不渲染，canvasRef 为 null，SVG 注入全部失效。
    loading.value = false
    error.value = false
    svgContent.value = 'active'
    handleMap.value = result.handleMap
    textHandleMap.value = result.textHandleMap || {}
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

          // ★ 主线程 DOM 遍历注入 handle
          // 遍历所有 <g> 元素，找到叶子 <g>（不包含子 <g> 的实体包裹），
          // 跳过在 <defs>/<clipPath>/<pattern>/<marker>/<filter> 等非实体容器中的 <g>，
          // 按 DOM 顺序为前 N 个注入 data-handle/id 属性。
          try {
            const allGs = svgEl.querySelectorAll('g')
            const leafGs: SVGElement[] = []

            // 判断一个 <g> 是否在非实体容器（defs/pattern/clipPath/marker/filter）中
            function isInNonEntityContainer(el: Element): boolean {
              const parent = el.closest('defs, clipPath, pattern, marker, filter, linearGradient, radialGradient, symbol')
              return parent !== null
            }

            for (const g of allGs) {
              // 只取叶子 <g>（不含子 <g>），且不在非实体容器内
              if (!g.querySelector('g') && !isInNonEntityContainer(g)) {
                leafGs.push(g)
              }
            }

            const handles: string[] = result.handles || []
            const injectCount = Math.min(leafGs.length, handles.length)
            for (let i = 0; i < injectCount; i++) {
              const handle = handles[i]
              if (!handle) continue
              const g = leafGs[i]
              g.setAttribute('data-handle', handle)
              g.setAttribute('id', `dwg-entity-${i}`)
            }
            console.log('[DwgPreview] DOM handle 注入:',
              '叶子<g>=' + leafGs.length,
              '实体=' + handles.length,
              '注入=' + injectCount,
            )
          } catch (handleErr: any) {
            console.warn('[DwgPreview] DOM handle 注入失败:', handleErr?.message || handleErr)
          }
        }
      }
    } catch (innerErr: any) {
      console.error('[DwgPreview] innerHTML 注入失败:', innerErr)
    }

    // ★ 视图归一化：将 SVG 的 viewBox 重设为实际内容包围盒，
    //   让 SVG 自身的 viewBox → viewport 映射负责适配，
    //   消除 CSS transform scale 与 SVG viewBox 之间的「双重缩放」。
    //   (之前：viewBox=250k宽 → SVG填充470px → canvas scale(0.02) → 9px)
    //   (现在：viewBox=内容包围盒 → SVG填充470px → canvas scale(1) → 470px)
    try {
      if (canvasRef.value) {
        const svgEl = canvasRef.value.querySelector('svg') as unknown as SVGSVGElement | null
        if (svgEl) {
          // 计算所有 <g> 子元素的实际包围盒（排除 <defs> 等非渲染元素）
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          let found = false
          const contentGs = svgEl.querySelectorAll('g:not(defs > g):not(clipPath > g):not(pattern > g):not(marker > g):not(filter > g)')
          for (const g of contentGs) {
            try {
              const bbox = (g as SVGGraphicsElement).getBBox()
              if (bbox && bbox.width > 0 && bbox.height > 0) {
                minX = Math.min(minX, bbox.x)
                minY = Math.min(minY, bbox.y)
                maxX = Math.max(maxX, bbox.x + bbox.width)
                maxY = Math.max(maxY, bbox.y + bbox.height)
                found = true
              }
            } catch { /* skip */ }
          }
          if (found && isFinite(minX)) {
            const cw = maxX - minX
            const ch = maxY - minY
            if (cw > 0 && ch > 0) {
              // 边距留 5%
              const margin = 1.05
              const wm = cw * margin
              const hm = ch * margin
              const newVb = `${minX} ${minY} ${wm} ${hm}`
              svgEl.setAttribute('viewBox', newVb)
              // 改为居中对齐（原为 xMinYMin，内容偏左上角）
              svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
              // 记录基础 viewBox（含边距），供 applyViewBox 缩放/平移使用
              baseVbX = minX; baseVbY = minY; baseVbW = wm; baseVbH = hm
              console.log('[DwgPreview] viewBox 归一化:', newVb,
                '旧viewBox:', svgEl.getAttribute('viewBox'),
                'baseVb:', baseVbX, baseVbY, baseVbW, baseVbH)
            }
          }
        }
      }
    } catch (normErr: any) {
      console.warn('[DwgPreview] viewBox 归一化失败:', normErr?.message || normErr)
    }

    // 恢复视图参数为自然状态：scale=1 让 SVG viewBox 适配视口
    scale.value = 1
    translateX.value = 0
    translateY.value = 0

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

    // SVG 加载完毕，标记可安全定位（watch(locateTarget) 会等待此标记）
    svgReady.value = true

    // SVG 生成后检查是否有待定位的图元
    // 有 cadHandleId 直接定位；否则从 SVG DOM 搜索 originalText
    if (props.locateTarget?.cadHandleId) {
      await nextTick()
      highlightEntity(props.locateTarget.cadHandleId, props.locateTarget.description)
    } else if (props.locateTarget?.originalText) {
      await nextTick()
      const rs = canvasRef.value?.querySelector('svg')
      if (rs) {
        const searchText = props.locateTarget.originalText.trim()
        for (const g of rs.querySelectorAll('g[data-handle]')) {
          if ((g.textContent || '').trim().includes(searchText)) {
            const h = g.getAttribute('data-handle')
            if (h) { highlightEntity(h, props.locateTarget.description); break }
          }
        }
      }
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
    // 重置视图参数（viewBox 归一化后 scale=1 恰好适配视口）
    scale.value = 1
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

// svgContent 仅用于触发 viewport 显示/隐藏，不自动调用 fitToWindow
// 适应窗口由 generateSvg() 末尾的 fitToWindowWithRetry() 统一负责
watch(svgContent, (newContent) => {
  console.log('[DwgPreview] svgContent 变化，长度:', newContent?.length || 0)
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
  applyViewBox()
}

function zoomOut() {
  scale.value = Math.max(MIN_SCALE, scale.value / ZOOM_FACTOR)
  applyViewBox()
}

function resetView() {
  fitToWindow()
}

function fitToWindow() {
  console.log('[DwgPreview] fitToWindow 开始执行')

  if (!viewportRef.value || !canvasRef.value) {
    console.warn('[DwgPreview] fitToWindow: 容器未准备好')
    return
  }

  // 重置缩放/平移并应用 viewBox
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  applyViewBox()

  console.log('[DwgPreview] fitToWindow: 重置为 scale=1, translate=(0,0)')
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

  // ★ viewBox 缩放（以鼠标位置为中心）
  // 将鼠标在视口中的像素位置映射为 SVG 坐标，缩放后保持该点不动
  if (viewportRef.value && baseVbW) {
    const vpRect = viewportRef.value.getBoundingClientRect()
    const mouseX = (e.clientX - vpRect.left) / vpRect.width  // 0~1
    const mouseY = (e.clientY - vpRect.top) / vpRect.height  // 0~1

    const oldVbW = baseVbW / scale.value
    const oldVbH = baseVbH / scale.value
    const svgAtMouseX = oldVbW * mouseX + baseVbX + baseVbW / 2 - (translateX.value || 0) - oldVbW / 2
    const svgAtMouseY = oldVbH * mouseY + baseVbY + baseVbH / 2 - (translateY.value || 0) - oldVbH / 2

    scale.value = newScale

    const newVbW = baseVbW / newScale
    const newVbH = baseVbH / newScale
    const newCenterX = svgAtMouseX + (0.5 - mouseX) * newVbW
    const newCenterY = svgAtMouseY + (0.5 - mouseY) * newVbH

    translateX.value = baseVbX + baseVbW / 2 - newCenterX
    translateY.value = baseVbY + baseVbH / 2 - newCenterY
  } else {
    scale.value = newScale
  }

  applyViewBox()
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
    // ★ viewBox 平移：像素差 → SVG 单位偏移
    if (viewportRef.value && baseVbW) {
      const vpRect = viewportRef.value.getBoundingClientRect()
      const pxPerSvgX = vpRect.width / (baseVbW / scale.value)
      const pxPerSvgY = vpRect.height / (baseVbH / scale.value)
      translateX.value = dragStartTX + (dragStartX - ev.clientX) / pxPerSvgX
      translateY.value = dragStartTY + (dragStartY - ev.clientY) / pxPerSvgY
      applyViewBox()
    }
  }

  const onMouseUp = () => {
    isDragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    // 拖拽结束后立即应用最终 viewBox 并去掉 transition
    applyViewBox()
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

  // ★ viewBox 定位：将图元居中到视口，自动适度放大
  const bbox = (el as SVGGraphicsElement).getBBox?.()
  if (bbox && bbox.width > 0 && bbox.height > 0 && viewportRef.value && baseVbW) {
    const entityCx = bbox.x + bbox.width / 2
    const entityCy = bbox.y + bbox.height / 2

    // 居中放大图元，但保留上下文可见范围
    // 目标 viewBox 尺寸 = max(图元包围盒×10, 基础 viewBox × 5%)
    // 确保既能看到图元，又能看到它在图纸中的位置
    const minVbW = Math.max(bbox.width * 2, baseVbW * 0.03)
    const minVbH = Math.max(bbox.height * 2, baseVbH * 0.03)
    const targetScale = Math.min(
      baseVbW / minVbW,
      MAX_SCALE,
    )
    scale.value = Math.max(targetScale, 1)
    translateX.value = baseVbX + baseVbW / 2 - entityCx
    translateY.value = baseVbY + baseVbH / 2 - entityCy
    applyViewBox()
  }

  // 高亮浮层（通过 DOM getBoundingClientRect 映射到屏幕坐标，与 viewBox / 缩放无关）
  if (viewportRef.value) {
    highlightInfo.value = {
      handle,
      description: description || '',
    }
    const elRect = (el as Element).getBoundingClientRect()
    const vpRect = viewportRef.value.getBoundingClientRect()
    highlightTooltipStyle.value = {
      left: `${elRect.left - vpRect.left + elRect.width / 2}px`,
      top: `${elRect.top - vpRect.top - 8}px`,
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
  // SVG 尚未加载完成时跳过（generateSvg 末尾会检查并处理）
  if (!svgReady.value) return

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

// SVG 加载完毕时重试待处理的定位
watch(svgReady, (ready) => {
  if (ready && props.locateTarget?.cadHandleId) {
    nextTick(() => {
      highlightEntity(props.locateTarget!.cadHandleId!, props.locateTarget!.description || '')
    })
  }
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
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #1e293b; /* 深色背景 - 类似 AutoCAD 经典界面 */
  cursor: grab;
  min-height: 0; /* 由父 flex 决定高度 */
}

.svg-viewport:active {
  cursor: grabbing;
}

.svg-canvas {
  flex: 1;
  position: relative;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
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
