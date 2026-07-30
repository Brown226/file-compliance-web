/**
 * Task 26: SVG 缩放/平移 composable
 *
 * 抽取自 DwgPreviewPanel.vue 的缩放/平移算法，适配 dwg-vision 场景：
 * - 基于 CSS transform（scale + translate）实现，不依赖 SVG viewBox
 * - 适配 0-1000 归一化坐标系（dwg-vision 后端 SVG 的 bbox 坐标系）
 * - 提供 focusBbox 方法，支持 pan/zoom 到指定 bbox 区域（Task 27 联动用）
 *
 * 使用方式：
 *   const viewportRef = ref<HTMLElement | null>(null)
 *   const canvasRef = ref<HTMLElement | null>(null)
 *   const { scale, translateX, translateY, zoomIn, zoomOut, resetView, focusBbox, onWheel, onMouseDown, canvasTransform } = useSvgZoomPan({ viewportRef, canvasRef })
 */

import { ref, computed, type Ref } from 'vue'

export interface BboxOverlay {
  id: string
  bbox: [number, number, number, number] // 0-1000 归一化坐标
  severity: 'error' | 'warning' | 'info'
}

export interface UseSvgZoomPanOptions {
  /** 视口容器（用于计算鼠标位置、限制拖拽范围） */
  viewportRef: Ref<HTMLElement | null>
  /** 画布容器（应用 transform 的元素） */
  canvasRef: Ref<HTMLElement | null>
  /** 最小缩放比例（默认 0.2） */
  minScale?: number
  /** 最大缩放比例（默认 10） */
  maxScale?: number
  /** 缩放因子（每次缩放倍率，默认 1.15） */
  zoomFactor?: number
}

export function useSvgZoomPan(options: UseSvgZoomPanOptions) {
  const {
    viewportRef,
    canvasRef,
    minScale = 0.2,
    maxScale = 10,
    zoomFactor = 1.15,
  } = options

  // 视图变换参数
  const scale = ref(1)
  const translateX = ref(0)  // 像素
  const translateY = ref(0)  // 像素

  // 拖拽状态
  let isDragging = false
  let dragStartX = 0
  let dragStartY = 0
  let dragStartTX = 0
  let dragStartTY = 0

  /** canvas 的 CSS transform 样式 */
  const canvasTransform = computed(() => ({
    transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
    transformOrigin: '0 0',
    transition: isDragging ? 'none' : 'transform 0.3s ease-out',
  }))

  /** 放大 */
  function zoomIn() {
    scale.value = Math.min(maxScale, scale.value * zoomFactor)
  }

  /** 缩小 */
  function zoomOut() {
    scale.value = Math.max(minScale, scale.value / zoomFactor)
  }

  /** 重置视图（scale=1, translate=0,0） */
  function resetView() {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  }

  /** 适应窗口（重置到默认视图） */
  function fitToWindow() {
    resetView()
  }

  /**
   * Task 27: pan/zoom 到指定 bbox 区域
   * - bbox 为 0-1000 归一化坐标
   * - 计算 bbox 中心点在画布中的像素位置，translate 使其居中
   * - scale 放大到合适倍数（让 bbox 占视口约 30%）
   */
  function focusBbox(bbox: [number, number, number, number]) {
    const viewport = viewportRef.value
    const canvas = canvasRef.value
    if (!viewport || !canvas) return

    const [x1, y1, x2, y2] = bbox
    const cxNorm = (x1 + x2) / 2  // 0-1000
    const cyNorm = (y1 + y2) / 2

    // canvas 的原始尺寸（未缩放时）
    const canvasW = canvas.offsetWidth
    const canvasH = canvas.offsetHeight
    if (!canvasW || !canvasH) return

    // bbox 中心点在 canvas 中的像素坐标（未缩放）
    const cxPx = (cxNorm / 1000) * canvasW
    const cyPx = (cyNorm / 1000) * canvasH

    // 视口尺寸
    const vpW = viewport.offsetWidth
    const vpH = viewport.offsetHeight

    // 目标 scale：让 bbox 宽度占视口约 30%（bbox 宽度归一化值 / 1000 × canvasW × scale = vpW × 0.3）
    const bboxWNorm = Math.max(1, x2 - x1)
    const bboxHNorm = Math.max(1, y2 - y1)
    const targetScaleW = (vpW * 0.3) / (bboxWNorm / 1000 * canvasW)
    const targetScaleH = (vpH * 0.3) / (bboxHNorm / 1000 * canvasH)
    const targetScale = Math.min(targetScaleW, targetScaleH, maxScale)
    scale.value = Math.max(targetScale, 1)  // 至少 1 倍，避免缩小

    // translate：让 bbox 中心点居中
    // 屏幕坐标 = translate + (canvasPx × scale)
    // 屏幕中心 = vpW/2
    // 所以 translate = vpW/2 - cxPx × scale
    translateX.value = vpW / 2 - cxPx * scale.value
    translateY.value = vpH / 2 - cyPx * scale.value
  }

  /** 滚轮缩放（Ctrl+滚轮） */
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? zoomFactor : 1 / zoomFactor
    const newScale = Math.min(maxScale, Math.max(minScale, scale.value * factor))

    // 以鼠标位置为中心缩放
    const viewport = viewportRef.value
    if (viewport) {
      const vpRect = viewport.getBoundingClientRect()
      const mouseX = e.clientX - vpRect.left  // 鼠标在视口中的像素位置
      const mouseY = e.clientY - vpRect.top

      // 鼠标在 canvas 中的坐标（缩放前）：(mouseX - translateX) / scale
      const canvasX = (mouseX - translateX.value) / scale.value
      const canvasY = (mouseY - translateY.value) / scale.value

      scale.value = newScale

      // 缩放后保持鼠标位置不动：mouseX = translateX + canvasX × newScale
      translateX.value = mouseX - canvasX * newScale
      translateY.value = mouseY - canvasY * newScale
    } else {
      scale.value = newScale
    }
  }

  /** 鼠标按下开始拖拽 */
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return  // 仅左键
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

  return {
    scale,
    translateX,
    translateY,
    canvasTransform,
    zoomIn,
    zoomOut,
    resetView,
    fitToWindow,
    focusBbox,
    onWheel,
    onMouseDown,
  }
}
