<template>
  <el-dialog
    :model-value="modelValue"
    title="批量文档处理"
    width="680px"
    class="agent-batch-dialog"
    :append-to-body="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="batch-panel">
      <!-- 文件选择 -->
      <div class="batch-section">
        <div class="batch-label">已上传文件（可多选，最多 10 个）</div>
        <div v-if="availableFiles.length === 0" class="batch-empty dim-text">
          当前会话还没有可处理的文件。请先上传文档，或通过文件树选择。
        </div>
        <div v-else class="batch-files">
          <label
            v-for="f in availableFiles"
            :key="f.path"
            class="batch-file-item"
            :class="{ selected: selected.has(f.path) }"
          >
            <input
              type="checkbox"
              class="batch-file-check"
              :checked="selected.has(f.path)"
              @change="toggleFile(f.path)"
            />
            <span class="batch-file-name">{{ f.name }}</span>
          </label>
        </div>
      </div>

      <!-- 子任务选择 -->
      <div class="batch-section">
        <div class="batch-label">执行子任务（可多选）</div>
        <div class="batch-tasks">
          <label v-for="t in taskOptions" :key="t.value" class="batch-task-item">
            <input
              type="checkbox"
              :checked="selectedTasks.has(t.value)"
              @change="toggleTask(t.value)"
            />
            <span class="batch-task-name">{{ t.label }}</span>
            <span class="batch-task-desc">{{ t.desc }}</span>
          </label>
        </div>
      </div>

      <!-- 提交 -->
      <div class="batch-actions">
        <button
          class="batch-submit"
          :disabled="submitting || selected.size === 0 || selectedTasks.size === 0"
          @click="submit"
        >
          {{ submitting ? '提交中…' : '开始批量处理' }}
        </button>
      </div>

      <!-- 进度 / 结果 -->
      <div v-if="currentJob" class="batch-result">
        <div class="batch-result-head">
          <span class="batch-status" :class="'s-' + currentJob.status.toLowerCase()">{{ statusLabel(currentJob.status) }}</span>
          <span class="batch-progress-text">进度 {{ currentJob.progress }}%</span>
          <button v-if="canCancel" class="batch-cancel" @click="cancel">取消</button>
        </div>
        <div class="batch-progress-bar">
          <div class="batch-progress-fill" :style="{ width: currentJob.progress + '%' }" />
        </div>
        <div v-if="currentJob.result" class="batch-summary">
          共 {{ currentJob.result.total }} 个文件，成功 {{ currentJob.result.succeeded }}，失败 {{ currentJob.result.failed }}
        </div>
        <div v-if="currentJob.error" class="batch-error">{{ currentJob.error }}</div>
        <div v-if="currentJob.result?.results?.length" class="batch-results-list">
          <div v-for="(r, i) in currentJob.result.results" :key="i" class="batch-result-item">
            <span class="batch-result-name">{{ r.fileName || r.filePath }}</span>
            <span class="batch-result-ok" :class="r.ok ? 'ok' : 'fail'">{{ r.ok ? '✓' : '✗' }}</span>
            <span v-if="!r.ok" class="batch-result-error">{{ r.error }}</span>
            <span v-else class="batch-result-meta">{{ resultMeta(r) }}</span>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  submitBatchApi,
  getBatchApi,
  cancelBatchApi,
  type BatchFileInput,
  type BatchJobRecord,
  type BatchTaskName,
} from '@/api/agent'

const props = defineProps<{
  modelValue: boolean
  // 当前会话已上传文件（带 path）
  uploadedFiles?: Array<{ name: string; size: number; path?: string }>
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const taskOptions: Array<{ value: BatchTaskName; label: string; desc: string }> = [
  { value: 'extract', label: '提取文本', desc: '解析文档为纯文本' },
  { value: 'chunk', label: '分块', desc: '按章节切分为块' },
  { value: 'summarize', label: '生成摘要', desc: 'LLM 文档摘要 + 要点' },
  { value: 'review', label: 'AI 审查', desc: '合规问题审查' },
  { value: 'knowledge', label: '知识检索', desc: '关键词/要点提取' },
]

const selected = ref<Set<string>>(new Set())
const selectedTasks = ref<Set<BatchTaskName>>(new Set())
const submitting = ref(false)
const currentJob = ref<BatchJobRecord | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

const availableFiles = computed(() =>
  (props.uploadedFiles || []).filter((f) => typeof f.path === 'string' && f.path),
)

function toggleFile(path: string) {
  const s = new Set(selected.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  // 最多 10 个
  if (s.size > 10) {
    ElMessage.warning('最多选择 10 个文件')
    return
  }
  selected.value = s
}
function toggleTask(t: BatchTaskName) {
  const s = new Set(selectedTasks.value)
  if (s.has(t)) s.delete(t)
  else s.add(t)
  selectedTasks.value = s
}

async function submit() {
  const files: BatchFileInput[] = Array.from(selected.value).map((path) => ({
    filePath: path,
    tasks: Array.from(selectedTasks.value),
  }))
  if (files.length === 0 || files[0].tasks.length === 0) return
  submitting.value = true
  try {
    const res = await submitBatchApi(files)
    const id = (res?.data as any)?.id ?? res?.data?.id
    currentJob.value = { id, status: 'PENDING', progress: 0 } as any
    startPoll(id)
  } catch (e: any) {
    ElMessage.error(`提交失败：${e?.message || '未知错误'}`)
  } finally {
    submitting.value = false
  }
}

function startPoll(id: string) {
  stopPoll()
  pollTimer = setInterval(async () => {
    try {
      const res = await getBatchApi(id)
      currentJob.value = (res?.data as any) ?? res
      if (currentJob.value && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(currentJob.value.status)) {
        stopPoll()
        // 仅在失败时提示，成功不弹窗（大王 2026-08-04）
        if (currentJob.value.status === 'FAILED') ElMessage.error('批量任务失败')
      }
    } catch (e) {
      // 修复：轮询异常原实现静默 stopPoll，进度永久卡死无任何提示
      stopPoll()
      currentJob.value = null
      ElMessage.error(`批量任务查询失败：${(e as Error)?.message || '网络错误'}（请到「批量」面板重新查询）`)
    }
  }, 2000)
}
function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function cancel() {
  if (!currentJob.value) return
  try {
    await cancelBatchApi(currentJob.value.id)
    stopPoll()
  } catch (e: any) {
    ElMessage.error(`取消失败：${e?.message || '未知错误'}`)
  }
}

const canCancel = computed(() =>
  currentJob.value && ['PENDING', 'PROCESSING'].includes(currentJob.value.status),
)
function statusLabel(s: string) {
  return ({ PENDING: '等待中', PROCESSING: '处理中', COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消' } as Record<string, string>)[s] || s
}
function resultMeta(r: any): string {
  const parts: string[] = []
  if (r.extract) parts.push(`文本 ${r.extract.textLength} 字符`)
  if (r.chunk) parts.push(`分块 ${r.chunk.count}`)
  if (r.summarize) parts.push(`摘要 ${(r.summarize.keyPoints || []).length} 要点`)
  if (r.review) parts.push(`问题 ${r.review.issueCount}`)
  if (r.knowledge) parts.push(`知识 ${r.knowledge.results} 条`)
  return parts.join(' · ') || '完成'
}

// 打开时清空状态
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      selected.value = new Set()
      selectedTasks.value = new Set()
      currentJob.value = null
    }
  },
)
onUnmounted(stopPoll)
</script>

<style scoped>
.batch-panel { display: flex; flex-direction: column; gap: 14px; }
.batch-section { display: flex; flex-direction: column; gap: 6px; }
.batch-label { font-size: 12px; font-weight: 500; color: var(--text-muted, var(--corp-text-secondary)); }
.batch-empty { font-size: 12px; padding: 8px 0; }
.dim-text { color: var(--text-dim, var(--corp-text-tertiary)); }
.batch-files { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow: auto; }
.batch-file-item {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px;
  font-size: 12px; cursor: pointer;
}
.batch-file-item.selected { border-color: var(--accent, var(--color-action)); background: color-mix(in srgb, var(--accent, var(--color-action)) 8%, transparent); }
.batch-file-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-tasks { display: flex; flex-wrap: wrap; gap: 6px; }
.batch-task-item {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px;
  font-size: 12px; cursor: pointer;
}
.batch-task-desc { color: var(--text-dim, var(--corp-text-tertiary)); font-size: 12px; }
.batch-actions { display: flex; justify-content: flex-end; }
.batch-submit {
  padding: 7px 20px; background: var(--accent, var(--color-action)); color: var(--corp-text-inverse);
  border: none; border-radius: 4px; font-size: 13px; cursor: pointer;
}
.batch-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.batch-result { border-top: 1px solid var(--border, var(--corp-border-light)); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.batch-result-head { display: flex; align-items: center; gap: 10px; }
.batch-status { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 3px; }
.batch-status.s-pending { background: color-mix(in srgb, var(--color-warning) 13%, transparent); color: var(--color-warning-600); }
.batch-status.s-processing { background: color-mix(in srgb, var(--color-action) 13%, transparent); color: var(--color-action-hover); }
.batch-status.s-completed { background: color-mix(in srgb, var(--color-success) 13%, transparent); color: var(--color-success-600); }
.batch-status.s-failed { background: color-mix(in srgb, var(--color-danger) 13%, transparent); color: var(--color-danger-600); }
.batch-status.s-cancelled { background: color-mix(in srgb, var(--corp-text-secondary) 13%, transparent); color: var(--color-gray-600); }
.batch-progress-text { font-size: 12px; color: var(--text-muted, var(--corp-text-secondary)); }
.batch-cancel { font-size: 12px; padding: 2px 10px; border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px; background: none; cursor: pointer; }
.batch-progress-bar { height: 6px; background: var(--border, var(--corp-border-light)); border-radius: 3px; overflow: hidden; }
.batch-progress-fill { height: 100%; background: var(--accent, var(--color-action)); transition: width 0.3s; }
.batch-summary { font-size: 12px; color: var(--text-muted, var(--corp-text-secondary)); }
.batch-error { font-size: 12px; color: var(--color-danger-600); }
.batch-results-list { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow: auto; }
.batch-result-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 8px; background: var(--bg-subtle, var(--color-gray-50)); border-radius: 4px; }
.batch-result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-result-ok.ok { color: var(--color-success-600); }
.batch-result-ok.fail { color: var(--color-danger-600); }
.batch-result-error { color: var(--color-danger-600); font-size: 12px; }
.batch-result-meta { color: var(--text-dim, var(--corp-text-tertiary)); font-size: 12px; }
</style>
