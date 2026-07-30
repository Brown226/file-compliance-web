<template>
  <div class="tool-call-chip" :class="{ expanded: isExpanded }">
    <el-tag
      :type="tagType"
      :hit="false"
      effect="light"
      class="chip-tag"
      @click="toggleExpand"
    >
      <div class="chip-header">
        <el-icon :size="14" class="chip-icon" :color="iconColor">
          <component :is="statusIcon" />
        </el-icon>
        <span class="tool-name">{{ toolName }}</span>
        <span v-if="durationText" class="tool-duration">{{ durationText }}</span>
        <template v-if="resultCount !== null">
          <span class="tool-result-sep">|</span>
          <span class="tool-result-count">{{ resultCount }} 项</span>
        </template>
        <el-icon :size="12" class="expand-arrow" :class="{ rotated: isExpanded }">
          <ArrowDown />
        </el-icon>
      </div>
    </el-tag>

    <transition name="expand">
      <div v-if="isExpanded" class="chip-body">
        <!-- 入参 -->
        <div v-if="hasInput" class="section">
          <div class="section-title">入参</div>
          <pre class="section-content">{{ formattedInput }}</pre>
        </div>

        <!-- 出参 -->
        <div v-if="hasOutput" class="section">
          <div class="section-title">出参</div>
          <pre class="section-content">{{ formattedOutput }}</pre>
        </div>

        <!-- 错误 -->
        <div v-if="errorText" class="section section-error">
          <div class="section-title">错误</div>
          <pre class="section-content">{{ errorText }}</pre>
        </div>

        <!-- 执行中状态 -->
        <div v-if="isRunning" class="section section-running">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>执行中…</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ArrowDown,
  Loading,
  Check,
  Close,
  Clock,
} from '@element-plus/icons-vue'

/**
 * 工具调用 Chip 组件
 *
 * 显示 Agent 每次工具调用的折叠卡片：
 * - 折叠态：图标 + 工具名 + 耗时 + 结果数 + 展开箭头
 * - 展开态：入参 / 出参 / 错误（JSON 美化）
 *
 * 状态：
 * - running: 执行中（旋转 Loading 图标 + 蓝色）
 * - success: 成功（绿色 Check 图标）
 * - error: 失败（红色 Close 图标）
 */

interface ToolCallPart {
  type: string
  toolCallId?: string
  toolName?: string
  input?: any
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  output?: any
  errorText?: string
}

const props = defineProps<{
  part: ToolCallPart
}>()

const isExpanded = ref(false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// 工具名映射到中文显示（保持简短，便于 chip 展示）
const TOOL_NAME_MAP: Record<string, string> = {
  upload_file: '上传文件',
  extract_text: '提取文本',
  chunk_document: '分块',
  read_file: '读取文件',
  list_uploads: '列出文件',
  delete_file: '删除文件',
  write_report: '生成报告',
  download_report: '下载报告',
  list_available_rules: '列出规则',
  apply_rule: '执行规则',
  llm_review_chunk: 'LLM 审查',
  llm_cross_check: '交叉核验',
  summarize_issues: '问题汇总',
  format_issues: '格式化结果',
  search_maxkb_knowledge: '知识检索',
  search_rule_library: '规则库检索',
  search_standard_checkpoints: '审点检索',
  create_pipeline_task: '委托任务',
  get_task_status: '查任务状态',
  get_task_results: '取任务结果',
  recall_memory: '召回记忆',
  save_memory: '保存记忆',
  extract_user_preferences: '提取偏好',
}

// 工具名到 el-tag type 的映射
function getTagType(toolName: string): 'primary' | 'warning' | 'success' | 'danger' | 'info' {
  if (toolName === 'extract_text') return 'primary'
  if (toolName === 'llm_review_chunk') return 'warning'
  if (toolName.startsWith('search_')) return 'success'
  if (toolName.startsWith('write_')) return 'danger'
  return 'info'
}

const tagType = computed(() => getTagType(props.part.toolName || ''))

const toolName = computed(() => {
  const name = props.part.toolName || '未知工具'
  return TOOL_NAME_MAP[name] || name
})

// 状态推断
type ToolStatus = 'running' | 'success' | 'error'
const status = computed<ToolStatus>(() => {
  const state = props.part.state
  if (state === 'output-error') return 'error'
  if (state === 'output-available') return 'success'
  // input-streaming / input-available 都视为执行中
  return 'running'
})

const isRunning = computed(() => status.value === 'running')

const statusIcon = computed(() => {
  if (status.value === 'running') return Loading
  if (status.value === 'error') return Close
  return Check
})

const iconColor = computed(() => {
  if (status.value === 'running') return '#3B82F6'
  if (status.value === 'error') return '#EF4444'
  return '#10B981'
})

// 入参 / 出参
const hasInput = computed(() => {
  return props.part.input !== undefined && props.part.input !== null
    && Object.keys(props.part.input || {}).length > 0
})

const hasOutput = computed(() => {
  return props.part.output !== undefined && props.part.output !== null
})

const formattedInput = computed(() => {
  return formatJson(props.part.input)
})

const formattedOutput = computed(() => {
  return formatJson(props.part.output)
})

const errorText = computed(() => props.part.errorText || '')

function formatJson(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// 耗时（仅成功/失败时显示，running 时不显示）
const durationText = computed(() => {
  if (isRunning.value) return ''
  // output 中可能含 durationMs（部分工具返回此字段）
  const ms = props.part.output?.durationMs
  if (typeof ms === 'number' && ms > 0) {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }
  return ''
})

// 结果数（从 output.total / output.issues.length / output.memories.length 等推断）
const resultCount = computed<number | null>(() => {
  if (!hasOutput.value) return null
  const out = props.part.output
  if (out == null) return null
  // 常见字段优先级
  if (typeof out.total === 'number') return out.total
  if (Array.isArray(out.issues)) return out.issues.length
  if (Array.isArray(out.memories)) return out.memories.length
  if (Array.isArray(out.rules)) return out.rules.length
  if (Array.isArray(out.items)) return out.items.length
  if (Array.isArray(out.chunks)) return out.chunks.length
  return null
})
</script>

<style scoped>
.tool-call-chip {
  display: inline-flex;
  flex-direction: column;
  margin: 4px 0;
  max-width: 100%;
}

.chip-tag {
  cursor: pointer !important;
  user-select: none;
  white-space: nowrap;
}

.chip-header {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.chip-icon.is-loading {
  animation: spin 1s linear infinite;
}

.tool-name {
  font-weight: 500;
  font-size: 12px;
}

.tool-duration {
  font-size: 11px;
  opacity: 0.75;
}

.tool-result-sep {
  margin: 0 1px;
  opacity: 0.4;
}

.tool-result-count {
  font-size: 11px;
  opacity: 0.75;
}

.expand-arrow {
  margin-left: 2px;
  transition: transform 0.2s;
  font-size: 12px;
}

.expand-arrow.rotated {
  transform: rotate(180deg);
}

.chip-body {
  border: 1px solid #e5e7eb;
  border-top: none;
  border-radius: 0 0 6px 6px;
  padding: 8px;
  background: #ffffff;
  max-height: 320px;
  overflow-y: auto;
}

.section {
  margin-bottom: 8px;
}

.section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 4px;
  font-weight: 600;
}

.section-content {
  margin: 0;
  padding: 6px 8px;
  background: #f9fafb;
  border-radius: 4px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  color: #1f2937;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.section-error .section-content {
  background: #fef2f2;
  color: #b91c1c;
}

.section-running {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #3b82f6;
  font-size: 12px;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  max-height: 320px;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
