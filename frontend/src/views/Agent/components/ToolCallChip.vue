<template>
  <div class="tool-call-block" :data-status="status" :class="{ expanded: isExpanded }">
    <!-- 折叠头：toolName(等宽/状态色) + 预览文本 + duration + chevron（对齐参考 ToolCallBlock） -->
    <button class="tool-call-header" :title="isExpanded ? '收起详情' : '展开详情'" @click="toggleExpand">
      <span class="tool-name">{{ toolName }}</span>
      <span class="tool-preview">{{ toolPreview }}</span>
      <span v-if="durationText" class="tool-duration">{{ durationText }}</span>
      <svg class="expand-arrow" :class="{ rotated: isExpanded }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="2 3.5 5 6.5 8 3.5" />
      </svg>
    </button>

    <!-- 展开体：输入参数 pre（bg-subtle + borderTop）+ 配对 result 一体显示（对齐参考 PairedResult） -->
    <transition name="expand">
      <div v-if="isExpanded" class="tool-call-body">
        <pre v-if="hasInput" class="input-pre">{{ formattedInput }}</pre>
        <!-- compare_documents 专用 diff 视图（P0-①）：结构化变更块 + 统计 + 摘要 -->
        <DiffResultView v-if="isDiffResult" :result="resultObj" />
        <!-- extract_tables 专用表格视图（P1-③）：结构化表格列表 -->
        <TableView v-else-if="isTableResult" :result="resultObj" />
        <!-- compare_knowledge 专用对比视图（P2-⑩）：主题级一致性表格 -->
        <CompareResultView v-else-if="isCompareResult" :result="resultObj" />
        <div v-else-if="resultText !== null" class="paired-result" :class="{ 'is-error': isError, 'is-empty': resultIsEmpty }">
          <pre>{{ resultIsEmpty ? '(no output)' : resultText }}</pre>
        </div>
        <div v-if="errorText && !isError" class="error-pre">{{ errorText }}</div>
        <div v-if="isRunning" class="running-hint">
          <span class="spinner" /> 执行中…
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import DiffResultView from './DiffResultView.vue'
import TableView from './TableView.vue'
import CompareResultView from './CompareResultView.vue'

interface ToolCallPart {
  type: string
  toolCallId?: string
  toolName?: string
  input?: any
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string
  output?: any
  errorText?: string
}

const props = defineProps<{ part: ToolCallPart }>()
const isExpanded = ref(false)
function toggleExpand() { isExpanded.value = !isExpanded.value }

const TOOL_NAME_MAP: Record<string, string> = {
  upload_file: '上传文件', extract_text: '提取文本', chunk_document: '分块',
  read_file: '读取文件', list_uploads: '列出文件', delete_file: '删除文件',
  write_report: '生成报告', download_report: '下载报告', compare_documents: '文档对比', extract_tables: '表格提取',
  compare_knowledge: '文档比对问答',
  list_available_rules: '列出规则', apply_rule: '执行规则',
  llm_review_chunk: 'LLM 审查', llm_cross_check: '交叉核验',
  summarize_issues: '汇总', format_issues: '格式化',
  search_knowledge: '知识检索', search_rule_library: '规则检索', search_standard_checkpoints: '审点检索',
  create_pipeline_task: '委托任务', get_task_status: '查状态', get_task_results: '取结果',
  recall_memory: '召回记忆', save_memory: '保存记忆', extract_user_preferences: '提取偏好',
}

// 静态 tool part 没有独立 toolName 字段，工具名嵌在 type（如 'tool-search_knowledge'）；
// dynamic-tool part 才有独立 toolName 字段。两者都要兼容。
const rawToolName = computed(() => {
  if (props.part.toolName) return props.part.toolName
  const t = props.part.type || ''
  if (t.startsWith('tool-')) return t.slice(5)
  return ''
})
const toolName = computed(() => TOOL_NAME_MAP[rawToolName.value] || rawToolName.value || '未知')

type ToolStatus = 'running' | 'success' | 'error'
const status = computed<ToolStatus>(() => {
  if (props.part.state === 'output-error') return 'error'
  if (props.part.state === 'output-available') return 'success'
  return 'running'
})
const isRunning = computed(() => status.value === 'running')
const isError = computed(() => status.value === 'error')

const hasInput = computed(() => props.part.input !== undefined && props.part.input !== null && Object.keys(props.part.input || {}).length > 0)
const formattedInput = computed(() => formatJson(props.part.input))

// 结果文本（对齐参考 PairedResult：从 toolResult 提取 text，空则 italic no output）
const resultText = computed<string | null>(() => {
  const out = props.part.output
  if (out === undefined || out === null) return null
  if (typeof out === 'string') return out
  if (typeof out === 'object') {
    const keys = Object.keys(out)
    if (keys.length === 0) return ''
    if ('total' in out && 'issues' in out) return `共 ${(out as any).total} 条结果`
    if (Array.isArray(out.issues)) return `共 ${out.issues.length} 条问题`
    if (Array.isArray(out.memories)) return `共 ${out.memories.length} 条记忆`
    if (Array.isArray(out.rules)) return `共 ${out.rules.length} 条规则`
    if (Array.isArray(out.items)) return `共 ${out.items.length} 条`
    try { return JSON.stringify(out, null, 2) } catch { return '' }
  }
  return String(out)
})
const resultIsEmpty = computed(() => resultText.value !== null && (resultText.value.trim() === '' || resultText.value.trim() === '(no output)'))
const errorText = computed(() => props.part.errorText || '')

// compare_documents 专用：识别结构化 diff 结果（含 changes/stats 的对象）
const resultObj = computed<any>(() => {
  const out = props.part.output
  return out && typeof out === 'object' ? out : null
})
const isDiffResult = computed(() => {
  if (rawToolName.value !== 'compare_documents') return false
  const out = resultObj.value
  return !!out && (Array.isArray(out.changes) || typeof out.stats === 'object' || typeof out.totalChanges === 'number')
})

// extract_tables 专用：识别表格提取结果（含 tables 数组）
const isTableResult = computed(() => {
  if (rawToolName.value !== 'extract_tables') return false
  const out = resultObj.value
  return !!out && Array.isArray(out.tables)
})

// compare_knowledge 专用：识别多文档对比结果（含 items 数组）
const isCompareResult = computed(() => {
  if (rawToolName.value !== 'compare_knowledge') return false
  const out = resultObj.value
  return !!out && (Array.isArray(out.items) || typeof out.conclusion === 'string')
})

// 预览文本（对齐参考 getToolPreview：取 input 常见字段）
const toolPreview = computed(() => {
  const input = props.part.input
  if (!input || typeof input !== 'object') return ''
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  if ('command' in input) return String((input as any).command).slice(0, 120)
  if ('path' in input) return String((input as any).path).slice(0, 120)
  if ('file_path' in input) return String((input as any).file_path).slice(0, 120)
  if ('pattern' in input) return String((input as any).pattern).slice(0, 120)
  if ('query' in input) return String((input as any).query).slice(0, 120)
  const first = input[keys[0]]
  return String(first).slice(0, 120)
})

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
</script>

<style scoped>
/* 对齐参考项目 ToolCallBlock：整体圆角块 + 状态色边框 */
.tool-call-block {
  display: block;
  max-width: 100%;
  border-radius: 7px;
  overflow: hidden;
  font-size: 12px;
  border: 1px solid rgba(34, 197, 94, 0.22);
  background: rgba(34, 197, 94, 0.03);
}
.tool-call-block[data-status='running'] {
  border-color: rgba(34, 197, 94, 0.22);
  background: rgba(34, 197, 94, 0.03);
}
.tool-call-block[data-status='error'] {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.05);
}

/* 折叠头（对齐参考：flex gap 7 padding 6px 10px，无背景） */
.tool-call-header {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.tool-call-header:hover { color: var(--text); }

/* toolName：等宽字体 + 状态色（成功绿/错误红） */
.tool-name {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 11px;
  color: var(--color-success-600);
  flex-shrink: 0;
  white-space: nowrap;
}
.tool-call-block[data-status='error'] .tool-name { color: var(--color-danger); }

/* 预览文本（对齐参考：等宽 11px text-dim ellipsis 占满剩余） */
.tool-preview {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.tool-duration {
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.expand-arrow {
  flex-shrink: 0;
  color: var(--text-dim);
  transition: transform 0.15s;
}
.expand-arrow.rotated { transform: rotate(180deg); }

/* 展开体 */
.tool-call-body {
  background: var(--bg-subtle);
}
.input-pre {
  margin: 0;
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 300px;
  background: var(--bg-subtle);
  border-top: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
  white-space: pre-wrap;
  word-break: break-all;
}
.tool-call-block[data-status='error'] .input-pre {
  border-top-color: color-mix(in srgb, var(--color-danger) 25%, transparent);
}

/* 配对 result（对齐参考 PairedResult：淡绿底 + pre + 空态 italic） */
.paired-result {
  border-top: 1px solid color-mix(in srgb, var(--color-success) 15%, transparent);
  background: var(--bg-subtle);
}
.paired-result.is-error {
  border-top-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
  background: color-mix(in srgb, var(--color-danger) 4%, transparent);
}
.paired-result pre {
  margin: 0;
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 400px;
  background: var(--bg);
  white-space: pre-wrap;
  word-break: break-all;
}
.paired-result.is-empty pre {
  color: var(--text-dim);
  font-style: italic;
  opacity: 0.6;
}
.paired-result.is-error pre {
  color: var(--color-danger);
}

.error-pre {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
  color: var(--color-danger);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: color-mix(in srgb, var(--color-danger) 4%, transparent);
}

.running-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
}
.spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

.expand-enter-active, .expand-leave-active {
  transition: opacity 0.15s;
}
.expand-enter-from, .expand-leave-to {
  opacity: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
