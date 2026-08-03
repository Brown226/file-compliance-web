/**
 * 可拖拽面板 Composable（移植自 pi-web 0.8.5 hooks/useResizablePanel.ts）
 * Pointer Events 拖拽 + localStorage 持久化 + CSS 变量动态设置
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export interface UseResizablePanelOptions {
  /** 挂载到 .agent-layout 上的 CSS 变量名，如 '--sidebar-width' */
  cssVariable: `--${string}`
  /** 默认宽度（px） */
  defaultWidth: number
  /** 最小宽度（px） */
  minWidth: number
  /** 最大宽度（px） */
  maxWidth: number
  /** localStorage 存储键 */
  storageKey: string
  /** 生长方向：右侧面板向左生长用 'left'，左侧面板向右生长用 'right' */
  growthDirection: 'left' | 'right'
  /** 容器元素 ref（可选；不传则用 panelRef 返回值） */
  containerRef?: Ref<HTMLElement | null>
  /** 最大宽度的动态获取函数（如根据窗口宽度计算），不传则用 maxWidth */
  getMaxWidth?: () => number
}

export interface SeparatorProps {
  role: 'separator'
  'aria-orientation': 'vertical'
  'aria-label': string
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-valuenow': number
  'aria-valuetext': string
  tabindex: number
  onPointerdown: (e: PointerEvent) => void
  onPointermove: (e: PointerEvent) => void
  onPointerup: (e: PointerEvent) => void
  onPointercancel: (e: PointerEvent) => void
  onLostpointercapture: (e: PointerEvent) => void
  onKeydown: (e: KeyboardEvent) => void
  onDblclick: () => void
}

export interface UseResizablePanelReturn {
  panelRef: Ref<HTMLElement | null>
  width: Ref<number>
  isResizing: Ref<boolean>
  separatorProps: SeparatorProps
  resetWidth: () => void
  reclampWidth: () => void
}

interface DragState {
  pointerId: number
  startX: number
  startWidth: number
  target: HTMLElement
  previousCursor: string
  previousUserSelect: string
}

function clampPanelWidth(candidate: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, candidate))
}

function readStoredWidth(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null) return null
    const parsed = Number.parseInt(stored, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(width))
  } catch {
    /* 存储不可用时拖拽仍可用 */
  }
}

export function useResizablePanel(options: UseResizablePanelOptions): UseResizablePanelReturn {
  const {
    cssVariable,
    defaultWidth,
    minWidth,
    maxWidth,
    storageKey,
    growthDirection,
    containerRef,
    getMaxWidth,
  } = options

  const panelRef = ref<HTMLElement | null>(null)
  const width = ref(defaultWidth)
  const isResizing = ref(false)
  let dragState: DragState | null = null
  let restored = false
  // 用一个普通对象当作 widthRef（保持与 React 版语义一致：实时值，不触发渲染）
  const widthRef = { current: defaultWidth }

  const effectiveMaxWidth = (): number => {
    if (getMaxWidth) return Math.min(maxWidth, Math.max(minWidth, getMaxWidth()))
    return maxWidth
  }

  const clampWidth = (candidate: number): number =>
    clampPanelWidth(candidate, minWidth, effectiveMaxWidth())

  const getTargetEl = (): HTMLElement | null => containerRef?.value ?? panelRef.value

  const applyLiveWidth = (nextWidth: number): void => {
    widthRef.current = nextWidth
    const el = getTargetEl()
    el?.style.setProperty(cssVariable, `${nextWidth}px`)
  }

  const commitWidth = (candidate: number, opts: { persist?: boolean; forcePersist?: boolean } = {}): number => {
    const { persist = true, forcePersist = false } = opts
    const nextWidth = clampWidth(candidate)
    const changed = nextWidth !== widthRef.current
    applyLiveWidth(nextWidth)
    width.value = nextWidth
    if (persist && (changed || forcePersist)) writeStoredWidth(storageKey, nextWidth)
    return nextWidth
  }

  const restoreBodyState = (drag: DragState): void => {
    document.body.style.cursor = drag.previousCursor
    document.body.style.userSelect = drag.previousUserSelect
  }

  const finishResize = (pointerId: number): void => {
    const drag = dragState
    if (!drag || drag.pointerId !== pointerId) return
    dragState = null
    restoreBodyState(drag)
    isResizing.value = false
    commitWidth(widthRef.current, { forcePersist: true })
    try {
      if (drag.target.hasPointerCapture(pointerId)) {
        drag.target.releasePointerCapture(pointerId)
      }
    } catch {
      /* 浏览器可能已释放 */
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const activeDrag = dragState
    if (activeDrag) finishResize(activeDrag.pointerId)
    const target = event.currentTarget as HTMLElement
    target.focus({ preventScroll: true })
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      /* setPointerCapture 在某些浏览器可能失败 */
    }
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      target,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    isResizing.value = true
  }

  const onPointerMove = (event: PointerEvent): void => {
    const drag = dragState
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      finishResize(event.pointerId)
      return
    }
    event.preventDefault()
    const direction = growthDirection === 'right' ? 1 : -1
    const nextWidth = clampWidth(drag.startWidth + (event.clientX - drag.startX) * direction)
    applyLiveWidth(nextWidth)
    const target = event.currentTarget as HTMLElement
    target.setAttribute('aria-valuenow', String(nextWidth))
    target.setAttribute('aria-valuetext', `${nextWidth} px`)
  }

  const onPointerUp = (event: PointerEvent): void => finishResize(event.pointerId)
  const onPointerCancel = (event: PointerEvent): void => finishResize(event.pointerId)
  const onLostPointerCapture = (event: PointerEvent): void => finishResize(event.pointerId)

  const resetWidth = (): void => {
    commitWidth(defaultWidth, { forcePersist: true })
  }

  const reclampWidth = (): void => {
    commitWidth(widthRef.current)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 32 : 12
    const growKey = growthDirection === 'right' ? 'ArrowRight' : 'ArrowLeft'
    const shrinkKey = growthDirection === 'right' ? 'ArrowLeft' : 'ArrowRight'
    if (event.key === growKey) {
      event.preventDefault()
      commitWidth(widthRef.current + step, { forcePersist: true })
    } else if (event.key === shrinkKey) {
      event.preventDefault()
      commitWidth(widthRef.current - step, { forcePersist: true })
    } else if (event.key === 'Home') {
      event.preventDefault()
      commitWidth(minWidth, { forcePersist: true })
    } else if (event.key === 'End') {
      event.preventDefault()
      commitWidth(effectiveMaxWidth(), { forcePersist: true })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      resetWidth()
    }
  }

  // 初始化：从 localStorage 恢复宽度
  onMounted(() => {
    if (restored) return
    restored = true
    const storedWidth = readStoredWidth(storageKey)
    const candidate = storedWidth ?? defaultWidth
    const restoredWidth = commitWidth(candidate, { persist: false })
    if (storedWidth !== null && storedWidth !== restoredWidth) {
      writeStoredWidth(storageKey, restoredWidth)
    }
  })

  // 窗口 resize 时重新 clamp
  const onWindowResize = (): void => reclampWidth()
  window.addEventListener('resize', onWindowResize)

  // 拖拽中如果窗口失焦/切换 tab，取消拖拽
  const cancelResize = (): void => {
    const drag = dragState
    if (drag) finishResize(drag.pointerId)
  }
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') cancelResize()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('blur', cancelResize)

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onWindowResize)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('blur', cancelResize)
    const drag = dragState
    if (drag) {
      dragState = null
      restoreBodyState(drag)
    }
  })

  const separatorProps: SeparatorProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': '面板宽度调整',
    'aria-valuemin': minWidth,
    'aria-valuemax': effectiveMaxWidth(),
    'aria-valuenow': width.value,
    'aria-valuetext': `${width.value} px`,
    tabindex: 0,
    onPointerdown: onPointerDown,
    onPointermove: onPointerMove,
    onPointerup: onPointerUp,
    onPointercancel: onPointerCancel,
    onLostpointercapture: onLostPointerCapture,
    onKeydown: onKeyDown,
    onDblclick: resetWidth,
  }

  return {
    panelRef,
    width,
    isResizing,
    separatorProps,
    resetWidth,
    reclampWidth,
  }
}
