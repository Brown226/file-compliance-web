<template>
  <div
    v-show="visible"
    ref="containerRef"
    class="chat-minimap"
    @mousedown="onMouseDown"
    @mouseenter="showPreview"
    @mouseleave="schedulePreviewHide"
    @mousemove="onMouseMove"
  >
    <!-- 轨线（对齐参考：1px 竖线，从 12px 到最后一个节点） -->
    <div class="minimap-rail" :style="{ top: `${PADDING}px`, height: `${railHeight}px` }" />

    <!-- 节点（对齐参考：8×8 圆角方块，激活/最近 状态） -->
    <div
      v-for="node in positionedNodes"
      :key="node.index"
      class="minimap-node"
      :style="{ top: `${node.topRatio * 100}%`, height: `${Math.max(1, nodeGap)}px` }"
    >
      <div
        class="minimap-dot"
        :class="{ active: activeIndex === node.index, nearest: minimapHovered && nearestNodeIndex === node.index }"
      />
    </div>

    <!-- 悬浮预览面板（对齐参考：320px 宽，轮次列表 + 大纲跳转） -->
    <div
      v-if="minimapHovered && allNodes.length > 0"
      ref="previewBoxRef"
      class="minimap-preview"
      @mouseenter="showPreview"
      @mousedown.stop
      @mousemove.stop
    >
      <div
        v-for="node in allNodes"
        :key="node.index"
        class="preview-turn"
        :class="{ located: nearestNodeIndex === node.index }"
        :ref="(el: any) => setPreviewItemRef(node.index, el)"
      >
        <span class="preview-number">{{ String(node.index + 1).padStart(2, '0') }}</span>
        <div class="preview-content">
          <button class="preview-user" @click="scrollToNode(node, 'smooth')">
            <span class="preview-user-text">{{ node.turn.userPreview || '（空消息）' }}</span>
          </button>
          <div
            v-for="(a, ai) in node.turn.assistantPreviews"
            :key="ai"
            class="preview-assistant"
          >
            <button
              class="preview-assistant-jump"
              title="定位助手消息"
              aria-label="定位助手消息"
              @click="scrollToAssistant(node, ai)"
            >A</button>
            <div class="preview-outline">
              <button
                v-for="(h, hi) in a.headings"
                :key="'h' + hi"
                class="preview-heading"
                :data-level="h.level"
                @click="scrollToHeading(node, ai, hi)"
              >{{ h.text }}</button>
              <button
                v-if="a.firstParagraph"
                class="preview-paragraph"
                @click="scrollToAssistant(node, ai)"
              >{{ a.firstParagraph }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'

/**
 * ChatMinimap —— 一比一复刻参考项目 pi-web-0.8.5 的 ChatMinimap：
 * - 以「turn」（用户消息 + 其后助手回复）为单位布局节点（12px 内边距 / 间距最大 50px）
 * - 滚动同步：以视口 30% 聚焦线取最近 turn 高亮；导航后 1600ms 激活锁定
 * - 点击 / 按住拖拽跳转（smooth / auto）
 * - hover 显示 320px 预览面板：轮次序号 + 用户消息 + 助手大纲（h1-h3 + 首段），
 *   点击可定位到用户消息 / 助手消息 / 具体标题
 * - 内容不可滚动（scrollable <= 20px）时整体隐藏
 */

export interface MinimapMessage {
  id: string
  role: string
  parts?: Array<{ type: string; text?: string }>
}

const PADDING = 12
const MAX_NODE_GAP = 50
const PREVIEW_HIDE_DELAY = 250
const NAVIGATION_ACTIVE_LOCK_MS = 1600

interface Heading { level: 1 | 2 | 3; text: string }
interface AssistantPreview {
  markdown: string
  msgIndex: number
  headings: Heading[]
  firstParagraph: string
}
interface Turn {
  userMsgIndex: number
  userPreview: string
  assistantPreviews: AssistantPreview[]
  scrollTop: number | null
}
interface NodeInfo {
  topRatio: number
  turn: Turn
  index: number
}

const props = defineProps<{
  messages: MinimapMessage[]
  getScrollContainer: () => HTMLElement | null
  getMessageRefs: () => (HTMLElement | null)[]
}>()

const visible = ref(false)
const allNodes = ref<NodeInfo[]>([])
const activeIndex = ref<number | null>(null)
const minimapHeight = ref(600)
const minimapHovered = ref(false)
const mouseYRatio = ref<number | null>(null)

const containerRef = ref<HTMLDivElement | null>(null)
const previewBoxRef = ref<HTMLDivElement | null>(null)
const previewItemRefs = new Map<number, HTMLElement>()

let dragging = false
let previewHideTimer: ReturnType<typeof setTimeout> | null = null
let activeLock: { index: number; until: number } | null = null
let measureThrottle: ReturnType<typeof setTimeout> | null = null
let scrollEl: HTMLElement | null = null
let ro: ResizeObserver | null = null

// ===== 文本提取 =====

function getMessageText(msg: MinimapMessage): string {
  if (!msg.parts) return ''
  return msg.parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('')
    .trim()
}

/** 从 markdown 提取 h1-h3 标题与首段（对齐参考的 remarkPreviewOutline） */
function extractOutline(markdown: string): { headings: Heading[]; firstParagraph: string } {
  const headings: Heading[] = []
  let firstParagraph = ''
  let inFence = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      headings.push({
        level: h[1].length as 1 | 2 | 3,
        text: h[2].replace(/[*_`[\]()]/g, '').trim(),
      })
      continue
    }
    if (
      !firstParagraph
      && line
      && !line.startsWith('#')
      && !line.startsWith('|')
      && !/^[-*+]\s/.test(line)
      && !/^\d+\.\s/.test(line)
      && !/^!\[/.test(line)
      && !/^>/.test(line)
      && !/^[-=]{2,}$/.test(line)
    ) {
      firstParagraph = line.slice(0, 140)
    }
  }
  return { headings, firstParagraph }
}

// ===== turn 构建（对齐参考 createTurnNodes） =====

function buildTurns(): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null
  props.messages.forEach((msg, idx) => {
    if (msg.role !== 'user' && msg.role !== 'assistant') return
    if (msg.role === 'user') {
      current = {
        userMsgIndex: idx,
        userPreview: getMessageText(msg).slice(0, 240),
        assistantPreviews: [],
        scrollTop: null,
      }
      turns.push(current)
      return
    }
    if (!current) return
    const md = getMessageText(msg)
    if (!md) return
    const outline = extractOutline(md)
    current.assistantPreviews.push({
      markdown: md,
      msgIndex: idx,
      headings: outline.headings,
      firstParagraph: outline.firstParagraph,
    })
  })
  return turns
}

// ===== 布局算法（对齐参考 layoutNodes） =====

interface NodeLayout {
  nodes: NodeInfo[]
  gap: number
  fillsHeight: boolean
}

function layoutNodes(nodes: NodeInfo[], height: number): NodeLayout {
  if (nodes.length === 0) return { nodes: [], gap: MAX_NODE_GAP, fillsHeight: false }
  const h = Math.max(1, height)
  const usable = Math.max(0, h - PADDING * 2)
  if (nodes.length === 1) {
    return { nodes: [{ ...nodes[0], topRatio: PADDING / h }], gap: MAX_NODE_GAP, fillsHeight: false }
  }
  const naturalGap = usable / (nodes.length - 1)
  const gap = Math.min(MAX_NODE_GAP, naturalGap)
  return {
    nodes: nodes.map((n, i) => ({ ...n, topRatio: (PADDING + i * gap) / h })),
    gap,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  }
}

const nodeLayout = computed(() => layoutNodes(allNodes.value, minimapHeight.value))
const positionedNodes = computed(() => nodeLayout.value.nodes)
const nodeGap = computed(() => nodeLayout.value.gap)
const railHeight = computed(() => {
  const last = positionedNodes.value[positionedNodes.value.length - 1]
  return last ? Math.max(1, last.topRatio * minimapHeight.value - PADDING) : 1
})

// ===== 激活同步（对齐参考 syncActiveNode：30% 聚焦线 + 1600ms 锁定） =====

function lockActiveNode(index: number) {
  activeLock = { index, until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS }
  activeIndex.value = index
}

function syncActiveNode(el: HTMLElement) {
  if (activeLock && Date.now() < activeLock.until) {
    activeIndex.value = activeLock.index
    return
  }
  activeLock = null
  const measured = allNodes.value.filter(n => n.turn.scrollTop !== null)
  if (measured.length === 0) { activeIndex.value = null; return }
  const focusTop = el.scrollTop + el.clientHeight * 0.3
  let best = measured[0]
  let bestDist = Infinity
  for (const n of measured) {
    const d = Math.abs((n.turn.scrollTop ?? 0) - focusTop)
    if (d < bestDist) { bestDist = d; best = n }
  }
  activeIndex.value = best.index
}

// ===== 测量（对齐参考 measureNodes：150ms 节流 + ResizeObserver） =====

function measureNodes() {
  const el = props.getScrollContainer()
  const minimapEl = containerRef.value
  if (!el || !minimapEl) return
  const refs = props.getMessageRefs()
  const containerRect = el.getBoundingClientRect()
  const turns = buildTurns()
  const nextNodes: NodeInfo[] = []
  for (const [i, turn] of turns.entries()) {
    const userEl = refs[turn.userMsgIndex]
    const rect = userEl?.getBoundingClientRect()
    nextNodes.push({
      topRatio: 0,
      turn: {
        ...turn,
        scrollTop: rect
          ? rect.top - containerRect.top + el.scrollTop
          : null,
      },
      index: i,
    })
  }
  // display:none 时 clientHeight 为 0，用滚动容器高度兜底
  minimapHeight.value = minimapEl.clientHeight || el.clientHeight
  allNodes.value = nextNodes
  visible.value = el.scrollHeight - el.clientHeight > 20
  syncActiveNode(el)
}

function updateScroll() {
  const el = props.getScrollContainer()
  if (!el) return
  visible.value = el.scrollHeight - el.clientHeight > 20
  syncActiveNode(el)
}

function scheduleMeasure() {
  if (measureThrottle) return
  measureThrottle = setTimeout(() => {
    measureThrottle = null
    measureNodes()
    updateScroll()
  }, 150)
}

onMounted(() => {
  scrollEl = props.getScrollContainer()
  if (!scrollEl) return
  scrollEl.addEventListener('scroll', updateScroll, { passive: true })
  ro = new ResizeObserver(() => { measureNodes(); updateScroll() })
  ro.observe(scrollEl)
  if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild)
  measureNodes()
  updateScroll()
  // 首帧后再次测量（DOM 尺寸稳定）
  setTimeout(() => { measureNodes(); updateScroll() }, 50)
})

watch(() => props.messages, () => scheduleMeasure(), { deep: true })

// v-show 由隐藏转可见后重新测量，保证布局正确
watch(visible, (v) => {
  if (v) setTimeout(() => { measureNodes(); updateScroll() }, 30)
})

onBeforeUnmount(() => {
  scrollEl?.removeEventListener('scroll', updateScroll)
  ro?.disconnect()
  if (measureThrottle) clearTimeout(measureThrottle)
  cancelPreviewHide()
})

// ===== 跳转（对齐参考 scrollToNode / scrollToAssistant / scrollToHeading） =====

function scrollToNode(node: NodeInfo, behavior: 'smooth' | 'auto') {
  const el = props.getScrollContainer()
  if (!el) return
  lockActiveNode(node.index)
  if (node.turn.scrollTop === null) return
  const targetTop = Math.max(0, node.turn.scrollTop - el.clientHeight * 0.3)
  el.scrollTo({ top: targetTop, behavior })
}

function scrollToAssistant(node: NodeInfo, ai: number) {
  const el = props.getScrollContainer()
  if (!el) return
  const a = node.turn.assistantPreviews[ai]
  const target = a ? props.getMessageRefs()[a.msgIndex] : null
  if (!target) return
  const containerRect = el.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  const targetTop = rect.top - containerRect.top + el.scrollTop - el.clientHeight * 0.3
  lockActiveNode(node.index)
  el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
}

function scrollToHeading(node: NodeInfo, ai: number, hi: number) {
  const el = props.getScrollContainer()
  if (!el) return
  const a = node.turn.assistantPreviews[ai]
  const target = a ? props.getMessageRefs()[a.msgIndex] : null
  if (!target) return
  const heading = target.querySelectorAll<HTMLElement>('h1, h2, h3').item(hi)
  if (!heading) return
  const containerRect = el.getBoundingClientRect()
  const rect = heading.getBoundingClientRect()
  const targetTop = rect.top - containerRect.top + el.scrollTop - el.clientHeight * 0.3
  lockActiveNode(node.index)
  el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
}

// ===== 最近节点（对齐参考 findNearestNode：按比例取整 + 命中半径） =====

function findNearestNode(ratio: number): NodeInfo | null {
  const { nodes, gap, fillsHeight } = nodeLayout.value
  const height = containerRef.value?.clientHeight ?? 0
  if (nodes.length === 0 || height <= 0) return null
  const pointerY = Math.max(0, Math.min(height, ratio * height))
  const firstY = nodes[0].topRatio * height
  const rawIndex = gap > 0 ? Math.round((pointerY - firstY) / gap) : 0
  const idx = Math.max(0, Math.min(nodes.length - 1, rawIndex))
  const nearest = nodes[idx]
  if (!fillsHeight) {
    const nodeY = nearest.topRatio * height
    const hitRadius = Math.max(10, gap / 2)
    if (Math.abs(pointerY - nodeY) > hitRadius) return null
  }
  return nearest
}

const nearestNodeIndex = computed(() => {
  if (mouseYRatio.value === null) return null
  return findNearestNode(mouseYRatio.value)?.index ?? null
})

// ===== 鼠标交互（对齐参考：点击跳转 + 拖拽跟随 + hover 预览） =====

function jumpToPointer(clientY: number, behavior: 'smooth' | 'auto') {
  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) return
  const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  const node = findNearestNode(ratio)
  if (node) scrollToNode(node, behavior)
}

function onMouseDown(e: MouseEvent) {
  if (!visible.value) return
  dragging = true
  showPreview()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  mouseYRatio.value = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  jumpToPointer(e.clientY, 'smooth')
  const onMove = (ev: MouseEvent) => {
    if (dragging) jumpToPointer(ev.clientY, 'auto')
  }
  const onUp = () => {
    dragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onMouseMove(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  mouseYRatio.value = (e.clientY - rect.top) / rect.height
}

function showPreview() {
  cancelPreviewHide()
  minimapHovered.value = true
}

function schedulePreviewHide() {
  cancelPreviewHide()
  previewHideTimer = setTimeout(() => {
    previewHideTimer = null
    minimapHovered.value = false
    mouseYRatio.value = null
  }, PREVIEW_HIDE_DELAY)
}

function cancelPreviewHide() {
  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
    previewHideTimer = null
  }
}

function setPreviewItemRef(index: number, el: unknown) {
  if (el) previewItemRefs.set(index, el as HTMLElement)
  else previewItemRefs.delete(index)
}

// 预览面板滚动跟随当前节点（对齐参考 useEffect）
watch([minimapHovered, nearestNodeIndex], () => {
  if (!minimapHovered.value || nearestNodeIndex.value === null) return
  const box = previewBoxRef.value
  const item = previewItemRefs.get(nearestNodeIndex.value)
  if (!box || !item) return
  const targetTop = item.offsetTop - (box.clientHeight - item.offsetHeight) / 2
  box.scrollTop = Math.max(0, targetTop)
})
</script>

<style scoped>
/* ===== 列容器（对齐参考：36px 宽、border-left、bg-panel） ===== */
.chat-minimap {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 36px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  overflow: visible;
  z-index: 5;
}

.minimap-rail {
  position: absolute;
  left: 50%;
  width: 1px;
  background: var(--border);
  transform: translateX(-50%);
  z-index: 0;
}

/* ===== 节点（对齐参考：8×8 圆角 2px 方块 + 状态色） ===== */
.minimap-node {
  position: absolute;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}

.minimap-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: rgba(128, 128, 128, 0.16);
  border: 1.5px solid rgba(128, 128, 128, 0.58);
  transition: transform 0.1s, background 0.1s;
}

.minimap-dot.active {
  background: rgba(128, 128, 128, 0.42);
  border-color: rgba(128, 128, 128, 0.95);
  box-shadow: 0 0 0 2px var(--bg-panel);
}

.minimap-dot.nearest {
  transform: scale(1.25);
}

/* ===== 预览面板（对齐参考：320px、右弹出、轮次列表） ===== */
.minimap-preview {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 100%;
  z-index: 100;
  width: 320px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  background: var(--bg);
  border-left: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  box-shadow: -10px 0 26px rgba(0, 0, 0, 0.07);
  pointer-events: auto;
  cursor: default;
  user-select: text;
}

.preview-turn {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  padding: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  background: transparent;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.preview-turn.located {
  background: color-mix(in srgb, var(--text) 4%, var(--bg));
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.preview-number {
  position: relative;
  z-index: 1;
  grid-column: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 32px;
  padding: 0;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  text-align: center;
}

.preview-turn.located .preview-number {
  color: var(--text-muted);
}

.preview-content {
  grid-column: 2;
  min-width: 0;
}

.preview-user {
  display: block;
  width: calc(100% + 34px);
  min-height: 32px;
  max-height: 86px;
  margin: 0 0 0 -34px;
  padding: 7px 10px 7px 40px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background 100ms ease;
}

.preview-user-text {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
}

.preview-user:hover {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.preview-assistant {
  position: relative;
  display: block;
  padding: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
}

.preview-assistant-jump {
  position: absolute;
  top: 0;
  left: -29px;
  z-index: 2;
  width: 24px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 26px;
  text-align: center;
  cursor: pointer;
  transition: color 100ms ease, background 100ms ease;
}

.preview-assistant-jump:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.preview-outline {
  display: grid;
  min-width: 0;
  gap: 0;
}

.preview-heading,
.preview-paragraph {
  display: block;
  width: calc(100% + 34px);
  min-height: 26px;
  min-width: 0;
  margin-left: -34px;
  padding: 4px 10px 4px 40px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: inherit;
  line-height: 18px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}

.preview-heading:hover,
.preview-paragraph:hover {
  background: color-mix(in srgb, var(--text) 6%, transparent);
  color: var(--text);
}

.preview-heading[data-level="1"] {
  min-height: 32px;
  padding-top: 7px;
  padding-bottom: 7px;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.preview-heading[data-level="2"] {
  min-height: 28px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-left: 50px;
  color: color-mix(in srgb, var(--text) 88%, var(--text-muted));
  font-size: 12px;
  font-weight: 500;
}

.preview-heading[data-level="3"] {
  padding-left: 60px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.preview-paragraph {
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 400;
}

.preview-assistant:has(.preview-heading[data-level="1"]:first-child) .preview-assistant-jump {
  height: 32px;
  line-height: 32px;
}

.preview-assistant:has(.preview-heading[data-level="2"]:first-child) .preview-assistant-jump {
  height: 28px;
  line-height: 28px;
}
</style>
