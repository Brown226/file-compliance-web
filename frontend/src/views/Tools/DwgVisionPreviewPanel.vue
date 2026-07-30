<template>
  <!--
    Task 26 + 27: 通用 SVG 预览组件（dwg-vision 专用）
    - 接受 svgContent 字符串（来自后端的 SVG，不走 WASM 解析）
    - 接受 bboxIssues 数组（0-1000 归一化坐标系），渲染叠框
    - 支持 pan/zoom（Ctrl+滚轮缩放、左键拖拽平移、工具栏按钮）
    - 支持 focusBbox 联动（点击列表项 → 图纸 pan/zoom 到对应区域）
    - 支持双向高亮（activeIssueId 高亮对应 rect；rect 点击 emit 给父组件）
  -->
  <div class="dwg-vision-preview-panel">
    <!-- 工具栏 -->
    <div class="preview-toolbar">
      <div class="toolbar-left">
        <span class="preview-title">图纸预览</span>
        <el-tag v-if="bboxIssues.length" size="small" type="danger" effect="plain">
          {{ bboxIssues.length }} 个标注
        </el-tag>
      </div>
      <div class="toolbar-right">
        <el-tooltip content="放大" placement="bottom">
          <el-button size="small" :icon="ZoomIn" circle @click="zoomIn" />
        </el-tooltip>
        <el-tooltip content="缩小" placement="bottom">
          <el-button size="small" :icon="ZoomOut" circle @click="zoomOut" />
        </el-tooltip>
        <el-tooltip content="重置视图" placement="bottom">
          <el-button size="small" :icon="RefreshRight" circle @click="resetView" />
        </el-tooltip>
      </div>
    </div>

    <!-- SVG 视口（可缩放/平移） -->
    <div
      class="svg-viewport"
      ref="viewportRef"
      @wheel="onWheel"
      @mousedown.prevent="onMouseDown"
    >
      <div class="svg-canvas" ref="canvasRef" :style="canvasTransform">
        <!-- 后端 SVG 内容（v-html 渲染） -->
        <div class="svg-content" v-html="svgContent"></div>
        <!-- 叠框层：0-1000 归一化坐标系，覆盖在 SVG 之上 -->
        <svg
          v-if="bboxIssues.length"
          class="overlay-svg"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
        >
          <rect
            v-for="issue in bboxIssues"
            :key="issue.id"
            :ref="el => setRectRef(el, issue.id)"
            :x="issue.bbox[0]"
            :y="issue.bbox[1]"
            :width="rectWidth(issue.bbox)"
            :height="rectHeight(issue.bbox)"
            :class="['issue-rect', `issue-rect-${issue.severity}`, { 'issue-rect-active': activeIssueId === issue.id }]"
            @click.stop="$emit('rect-click', issue)"
          />
        </svg>
      </div>
    </div>

    <!-- 缩放比例指示 -->
    <div class="zoom-indicator" v-if="svgContent">
      {{ Math.round(scale * 100) }}%
    </div>

    <!-- 空状态 -->
    <div v-if="!svgContent" class="preview-empty">
      <el-icon :size="32" color="#94a3b8"><Picture /></el-icon>
      <p>暂无图纸预览</p>
      <p class="empty-hint">请先上传 DWG 文件</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { ZoomIn, ZoomOut, RefreshRight, Picture } from '@element-plus/icons-vue'
import { useSvgZoomPan, type BboxOverlay } from '@/composables/useSvgZoomPan'

const props = defineProps<{
  /** 后端返回的 SVG 字符串 */
  svgContent: string
  /** 叠框 issue 列表（0-1000 归一化坐标系） */
  bboxIssues: BboxOverlay[]
  /** 当前高亮的 issue id（双向联动用） */
  activeIssueId?: string
  /** Task 27: pan/zoom 目标 bbox（变化时自动定位） */
  focusBbox?: [number, number, number, number] | null
}>()

defineEmits<{
  /** 叠框 rect 点击事件 */
  (e: 'rect-click', issue: BboxOverlay): void
}>()

const viewportRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)

const {
  scale,
  canvasTransform,
  zoomIn,
  zoomOut,
  resetView,
  focusBbox: doFocusBbox,
  onWheel,
  onMouseDown,
} = useSvgZoomPan({ viewportRef, canvasRef })

/** rect 元素 ref 集合，用于 scrollIntoView */
const rectRefs = new Map<string, SVGRectElement>()
function setRectRef(el: any, id: string) {
  if (el) rectRefs.set(id, el as SVGRectElement)
  else rectRefs.delete(id)
}

/** 计算 rect 宽高（bbox 视为 [x1, y1, x2, y2]） */
function rectWidth(bbox: [number, number, number, number]) {
  return Math.max(0, bbox[2] - bbox[0])
}
function rectHeight(bbox: [number, number, number, number]) {
  return Math.max(0, bbox[3] - bbox[1])
}

/** Task 27: 监听 focusBbox 变化，自动 pan/zoom 到目标区域 */
watch(() => props.focusBbox, (bbox) => {
  if (!bbox) return
  nextTick(() => {
    doFocusBbox(bbox)
    // 同时滚动到对应 rect
    if (props.activeIssueId) {
      const rectEl = rectRefs.get(props.activeIssueId)
      rectEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
})

/** Task 27: 监听 activeIssueId 变化，scrollIntoView 到对应 rect */
watch(() => props.activeIssueId, (id) => {
  if (!id) return
  nextTick(() => {
    const rectEl = rectRefs.get(id)
    rectEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
})

defineExpose({ resetView, focusBbox: doFocusBbox })
</script>

<style scoped>
.dwg-vision-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1e293b;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  min-height: 400px;
}

/* ===== 工具栏 ===== */
.preview-toolbar {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  border-bottom: 1px solid #475569;
  background: #334155;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-title {
  font-weight: 600;
  font-size: 13px;
  color: #e2e8f0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-right .el-button {
  border-color: #475569;
  color: #e2e8f0;
}

/* ===== SVG 视口 ===== */
.svg-viewport {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #1e293b;
  cursor: grab;
  min-height: 0;
}

.svg-viewport:active {
  cursor: grabbing;
}

.svg-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.svg-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.svg-content :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
}

/* ===== 叠框层 ===== */
.overlay-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;  /* 默认不拦截事件，让 rect 单独可点击 */
}

.overlay-svg .issue-rect {
  pointer-events: auto;
  cursor: pointer;
  fill-opacity: 0.15;
  stroke-width: 2;
  transition: fill-opacity 0.2s, stroke-width 0.2s;
}

.overlay-svg .issue-rect:hover {
  fill-opacity: 0.3;
  stroke-width: 3;
}

/* severity 着色 */
.overlay-svg .issue-rect-error {
  fill: #ef4444;
  stroke: #ef4444;
}

.overlay-svg .issue-rect-warning {
  fill: #f59e0b;
  stroke: #f59e0b;
}

.overlay-svg .issue-rect-info {
  fill: #3b82f6;
  stroke: #3b82f6;
}

/* Task 28: 闪烁高亮动画 */
.overlay-svg .issue-rect-active {
  stroke-width: 5;
  fill-opacity: 0.4;
  animation: rect-pulse 1s ease-in-out 3;
}

@keyframes rect-pulse {
  0%, 100% { stroke-opacity: 1; fill-opacity: 0.4; }
  50% { stroke-opacity: 0.4; fill-opacity: 0.15; }
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
  z-index: 10;
}

/* ===== 空状态 ===== */
.preview-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 13px;
}

.empty-hint {
  font-size: 12px;
  opacity: 0.7;
}
</style>
