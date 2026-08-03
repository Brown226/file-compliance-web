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
        <el-icon :size="13" class="chip-icon" :class="{ 'is-loading': isRunning }">
          <component :is="statusIcon" />
        </el-icon>
        <span class="tool-name">{{ toolName }}</span>
        <span v-if="durationText" class="tool-duration">{{ durationText }}</span>
        <template v-if="resultCount !== null">
          <span class="tool-sep">·</span>
          <span class="tool-count">{{ resultCount }}</span>
        </template>
        <el-icon :size="12" class="expand-arrow" :class="{ rotated: isExpanded }">
          <ArrowDown />
        </el-icon>
      </div>
    </el-tag>

    <transition name="expand">
      <div v-if="isExpanded" class="chip-body">
        <div v-if="hasInput" class="section">
          <div class="section-title">入参</div>
          <pre class="section-content">{{ formattedInput }}</pre>
        </div>
        <div v-if="hasOutput" class="section">
          <div class="section-title">出参</div>
          <pre class="section-content">{{ formattedOutput }}</pre>
        </div>
        <div v-if="errorText" class="section section-error">
          <div class="section-title">错误</div>
          <pre class="section-content">{{ errorText }}</pre>
        </div>
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
import { ArrowDown, Loading, Check, Close, Clock } from '@element-plus/icons-vue'

interface ToolCallPart {
  type: string
  toolCallId?: string
  toolName?: string
  input?: any
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  output?: any
  errorText?: string
}

const props = defineProps<{ part: ToolCallPart }>()
const isExpanded = ref(false)
function toggleExpand() { isExpanded.value = !isExpanded.value }

const TOOL_NAME_MAP: Record<string, string> = {
  upload_file: '上传文件', extract_text: '提取文本', chunk_document: '分块',
  read_file: '读取文件', list_uploads: '列出文件', delete_file: '删除文件',
  write_report: '生成报告', download_report: '下载报告',
  list_available_rules: '列出规则', apply_rule: '执行规则',
  llm_review_chunk: 'LLM 审查', llm_cross_check: '交叉核验',
  summarize_issues: '汇总', format_issues: '格式化',
  search_knowledge: '知识检索', search_rule_library: '规则检索', search_standard_checkpoints: '审点检索',
  create_pipeline_task: '委托任务', get_task_status: '查状态', get_task_results: '取结果',
  recall_memory: '召回记忆', save_memory: '保存记忆', extract_user_preferences: '提取偏好',
}

function getTagType(name: string): 'primary' | 'warning' | 'success' | 'danger' | 'info' {
  if (name === 'extract_text' || name === 'read_file') return 'primary'
  if (name === 'llm_review_chunk') return 'warning'
  if (name.startsWith('search_') || name === 'recall_memory') return 'success'
  if (name.startsWith('write_') || name.startsWith('delete_')) return 'danger'
  return 'info'
}

const tagType = computed(() => getTagType(props.part.toolName || ''))
const toolName = computed(() => TOOL_NAME_MAP[props.part.toolName || ''] || props.part.toolName || '未知')

type ToolStatus = 'running' | 'success' | 'error'
const status = computed<ToolStatus>(() => {
  if (props.part.state === 'output-error') return 'error'
  if (props.part.state === 'output-available') return 'success'
  return 'running'
})
const isRunning = computed(() => status.value === 'running')
const statusIcon = computed(() => status.value === 'running' ? Loading : status.value === 'error' ? Close : Check)

const hasInput = computed(() => props.part.input !== undefined && props.part.input !== null && Object.keys(props.part.input || {}).length > 0)
const hasOutput = computed(() => props.part.output !== undefined && props.part.output !== null)
const formattedInput = computed(() => formatJson(props.part.input))
const formattedOutput = computed(() => formatJson(props.part.output))
const errorText = computed(() => props.part.errorText || '')

function formatJson(v: any): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

const durationText = computed(() => {
  if (isRunning.value) return ''
  const ms = props.part.output?.durationMs
  return typeof ms === 'number' && ms > 0 ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : ''
})

const resultCount = computed<number | null>(() => {
  if (!hasOutput.value) return null
  const out = props.part.output
  if (out == null) return null
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
  max-width: 100%;
}

.chip-tag {
  cursor: pointer !important;
  user-select: none;
  white-space: nowrap;
  border-radius: 6px !important;
  padding: 2px 8px !important;
}

.chip-header {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}

.tool-sep {
  font-size: 10px;
  opacity: 0.3;
}

.tool-count {
  font-size: 11px;
  opacity: 0.65;
  font-weight: 500;
}

.expand-arrow {
  font-size: 11px;
  transition: transform 0.2s ease;
}
.expand-arrow.rotated { transform: rotate(180deg); }

.chip-body {
  border: 1px solid #e8eaf0;
  border-top: none;
  border-radius: 0 0 8px 8px;
  padding: 10px 12px;
  background: #fff;
  max-height: 300px;
  overflow-y: auto;
  box-shadow: 0 2px 6px rgba(0,0,0,0.04);
}

.section { margin-bottom: 10px; }
.section:last-child { margin-bottom: 0; }

.section-title {
  font-size: 11px;
  color: #8c8c9e;
  margin-bottom: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-content {
  margin: 0;
  padding: 8px 10px;
  background: #f8f9fc;
  border-radius: 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  color: #2a2a3e;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
  line-height: 1.4;
}

.section-error .section-content {
  background: #fef2f2;
  color: #b91c1c;
}

.section-running {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 12px;
}

.expand-enter-active, .expand-leave-active {
  transition: all 0.2s ease;
  max-height: 300px;
}
.expand-enter-from, .expand-leave-to {
  opacity: 0;
  max-height: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
