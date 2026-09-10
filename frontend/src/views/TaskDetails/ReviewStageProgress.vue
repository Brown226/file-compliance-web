<!-- 方案A：审查阶段进度条（阶段状态机可视化） -->
<!-- 通用 3 节点（preload/fast/ai）或 DEC 7 节点（completeness/compliance/smart_judge/image_text/text_cross/rule_fallback/merge） -->
<!--
  2026-09-10：正式审查结束后折叠为一行摘要。
  此前该面板只要拿到过阶段数据就常驻，审查完成后仍占据大块纵向空间，
  把下方的结果展示挤下去（用户反馈「应当隐藏，为结果展示让出空间」）。
  现在：审查中 → 展开完整节点；已结束 → 折叠为单行，可点击展开回看（并保留失败提示）。
-->
<template>
  <div v-if="visibleStages.length > 0" class="stage-progress" :class="{ 'is-collapsed': isCollapsed }">
    <div class="stage-progress-header" @click="toggleCollapsed">
      <span class="stage-progress-title">
        审查阶段
        <span v-if="isCollapsed" class="stage-summary">
          · {{ doneCount }}/{{ visibleStages.length }} 完成<template v-if="failedStage">，1 个失败</template>
        </span>
      </span>
      <div class="stage-header-right">
        <span v-if="failedStage" class="stage-failed-tip">
          <el-icon><WarningFilled /></el-icon>
          阶段失败：{{ failedStage.message }}
        </span>
        <!-- 仅在审查已结束时提供折叠开关；审查中保持展开，便于观察进度 -->
        <el-icon v-if="!reviewing" class="stage-toggle-icon" :class="{ 'is-collapsed': isCollapsed }">
          <ArrowDown />
        </el-icon>
      </div>
    </div>
    <div v-show="!isCollapsed" class="stage-nodes">
      <div
        v-for="node in visibleStages"
        :key="node.stageKey"
        class="stage-node"
        :class="[`stage-${node.status.toLowerCase()}`, { 'is-last': node.isLast }]"
      >
        <div class="stage-node-dot">
          <el-icon v-if="node.status === 'RUNNING'" class="is-loading"><Loading /></el-icon>
          <el-icon v-else-if="node.status === 'DONE'"><CircleCheckFilled /></el-icon>
          <el-icon v-else-if="node.status === 'FAILED'"><CircleCloseFilled /></el-icon>
          <el-icon v-else-if="node.status === 'SKIPPED'"><Minus /></el-icon>
        </div>
        <div class="stage-node-body">
          <span class="stage-node-name" :title="node.error || ''">{{ node.label }}</span>
          <span v-if="node.attemptCount > 1" class="stage-node-attempt" title="重试次数">×{{ node.attemptCount }}</span>
        </div>
        <el-tooltip v-if="node.error" :content="node.error" placement="top">
          <el-icon class="stage-node-error"><WarningFilled /></el-icon>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loading, CircleCheckFilled, CircleCloseFilled, WarningFilled, Minus, ArrowDown } from '@element-plus/icons-vue'
import type { ReviewStageItem } from '@/api/task'

const props = defineProps<{
  stages: ReviewStageItem[]
  reviewing: boolean
}>()

/** 阶段显示名映射（DEC 7 节点 + 通用 3 节点） */
const STAGE_LABELS: Record<string, string> = {
  preload: '预加载',
  fast: '快速审查',
  ai: 'AI 审查',
  completeness: '完整性',
  compliance: '合规/事实/文本',
  smart_judge: '智能判标',
  image_text: '图文复核',
  text_cross: '文本交叉',
  rule_fallback: '规则兜底',
  merge: '合并',
}

interface StageNode extends ReviewStageItem {
  label: string
  isLast: boolean
}

const visibleStages = computed<StageNode[]>(() => {
  const list = props.stages.map((s) => ({
    ...s,
    label: STAGE_LABELS[s.stageKey] || s.stageKey,
    isLast: false,
  }))
  if (list.length > 0) list[list.length - 1].isLast = true
  return list
})

const failedStage = computed(() => {
  const f = props.stages.find((s) => s.status === 'FAILED')
  if (!f) return null
  return { message: `${STAGE_LABELS[f.stageKey] || f.stageKey}：${f.error?.split('\n')[0] || '未知错误'}` }
})

/** 已完成节点数（折叠态摘要用） */
const doneCount = computed(() =>
  props.stages.filter((s) => s.status === 'DONE' || s.status === 'SKIPPED').length,
)

/**
 * 折叠状态：
 * - 审查中 → 始终展开（用户要看实时进度）
 * - 审查结束 → 默认折叠，仅留一行摘要，把纵向空间让给结果展示
 * 用户手动展开后不再被自动收起（尊重用户当前操作）。
 */
const userToggled = ref(false)
const userCollapsed = ref(false)
const isCollapsed = computed(() => {
  if (props.reviewing) return false            // 审查中：强制展开
  if (userToggled.value) return userCollapsed.value
  return true                                   // 已结束：默认折叠
})
const toggleCollapsed = () => {
  // 审查中点击无效（保持展开）
  if (props.reviewing) return
  userCollapsed.value = !isCollapsed.value
  userToggled.value = true
}
</script>

<style scoped>
.stage-progress {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 12px;
}

/* 折叠态：收紧内边距，仅留一行摘要，为下方结果展示让出空间 */
.stage-progress.is-collapsed {
  padding: 6px 16px;
  margin-bottom: 8px;
}

.stage-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
/* 折叠态下标题行不再需要下间距 */
.stage-progress.is-collapsed .stage-progress-header {
  margin-bottom: 0;
  cursor: pointer;
}

.stage-summary {
  font-weight: 400;
  color: var(--corp-text-secondary);
}

.stage-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.stage-toggle-icon {
  font-size: 13px;
  color: var(--corp-text-tertiary);
  transition: transform 0.2s;
}
.stage-toggle-icon.is-collapsed { transform: rotate(-90deg); }

.stage-progress-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.stage-failed-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-danger);
}

.stage-nodes {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.stage-node {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--color-gray-100);
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.stage-node-dot {
  display: inline-flex;
  align-items: center;
  color: var(--color-gray-400);
  font-size: 13px;
}

.stage-running {
  background: rgba(59, 130, 246, 0.1);
  color: var(--color-primary, #3b82f6);
}

.stage-running .stage-node-dot {
  color: var(--color-primary, #3b82f6);
}

.stage-done {
  background: rgba(16, 185, 129, 0.08);
  color: var(--color-success);
}

.stage-done .stage-node-dot {
  color: var(--color-success);
}

.stage-failed {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger);
}

.stage-failed .stage-node-dot {
  color: var(--color-danger);
}

.stage-skipped {
  opacity: 0.6;
}

.stage-node-body {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stage-node-attempt {
  font-size: 10px;
  background: var(--color-gray-200);
  border-radius: 6px;
  padding: 0 4px;
}

.stage-node-error {
  color: var(--color-danger);
  font-size: 12px;
  cursor: help;
}
</style>
