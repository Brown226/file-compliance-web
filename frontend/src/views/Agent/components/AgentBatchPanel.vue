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
          当前会话还没有文件。请先在对话区上传文档（也可粘贴图片/拖拽），再回到这里勾选。
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
        <p class="batch-files-hint dim-text">仅列当前会话上传过的文件；其他会话的文件需先在本会话使用或重新上传。</p>
      </div>

      <!-- 子任务选择 -->
      <div class="batch-section">
        <div class="batch-label">执行子任务（可多选）</div>
        <p class="batch-tasks-hint dim-text">适合粗筛一批文件：勾选「提取文本 + AI 审查 + 生成摘要」，一次拿到每个文件的文本、问题清单与要点；完整精细审查（规则库/标准条文回填）请直接在对话中让 Agent 处理。</p>
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

      <!-- 历史任务（P1：关窗/刷新后恢复进度查询） -->
      <div class="batch-history">
        <div class="batch-label">
          历史任务
          <button class="batch-history-refresh" @click="loadHistory">刷新</button>
        </div>
        <div v-if="historyJobs.length === 0" class="batch-empty dim-text">暂无历史批量任务</div>
        <div v-else class="batch-history-list">
          <button
            v-for="j in historyJobs"
            :key="j.id"
            class="batch-history-item"
            :class="{ active: currentJob?.id === j.id }"
            @click="resumeJob(j)"
          >
            <span class="batch-status" :class="'s-' + j.status.toLowerCase()">{{ statusLabel(j.status) }}</span>
            <span v-if="isFreshCompleted(j)" class="batch-new-badge">新</span>
            <span class="batch-history-id">{{ j.id.slice(0, 8) }}</span>
            <span class="batch-history-progress">{{ j.progress }}%</span>
            <span class="batch-history-meta">{{ fmtTime(j.createdAt) }} · {{ j.fileCount }} 文件</span>
          </button>
        </div>
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
          <button v-if="currentJob.result.results?.length" class="batch-copy-btn" @click="copyResult">复制结果</button>
        </div>
        <div v-if="currentJob.error" class="batch-error">{{ currentJob.error }}</div>
        <div v-if="currentJob.result?.results?.length" class="batch-results-list">
          <div v-for="(r, i) in currentJob.result.results" :key="i" class="batch-result-row">
            <div class="batch-result-item">
              <span class="batch-result-name">{{ r.fileName || r.filePath }}</span>
              <span class="batch-result-ok" :class="r.ok ? 'ok' : 'fail'">{{ r.ok ? '✓' : '✗' }}</span>
              <span v-if="!r.ok" class="batch-result-error">{{ r.error }}</span>
              <span v-else class="batch-result-meta">{{ resultMeta(r) }}</span>
              <!-- P1 修复1：AI 审查结果可见——展开查看每个文件的具体问题 -->
              <button
                v-if="r.review?.issues?.length"
                class="batch-expand-btn"
                :class="{ expanded: expandedRows.has(i) }"
                @click="toggleExpand(i)"
              >
                {{ expandedRows.has(i) ? '收起问题' : `查看问题 (${r.review.issues.length})` }}
              </button>
            </div>
            <div v-if="r.review?.issues?.length && expandedRows.has(i)" class="batch-issues">
              <div v-for="(iss, ii) in r.review.issues" :key="ii" class="batch-issue">
                <span class="batch-issue-sev" :class="'sev-' + (iss.severity || 'info')">{{ iss.severity || 'info' }}</span>
                <span class="batch-issue-type">{{ iss.issueType || 'VIOLATION' }}</span>
                <span class="batch-issue-desc">{{ iss.description }}</span>
              </div>
            </div>
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
  listBatchApi,
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

const historyJobs = ref<BatchJobRecord[]>([])

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
      // 轮询失败停止轮询但保留已展示数据(历史列表可恢复)——原实现置 null 清空结果
      stopPoll()
      ElMessage.error(`批量任务查询失败：${(e as Error)?.message || '网络错误'}（可点「历史任务」重新查询）`)
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

// ===== P1：历史任务可恢复 =====
async function loadHistory() {
  try {
    const res = await listBatchApi(1, 10)
    const data = (res?.data as any) ?? res
    historyJobs.value = Array.isArray(data) ? data : (data?.records ?? [])
  } catch (e) {
    // 历史加载失败不阻断面板（静默 + 控制台）
    console.warn('[AgentBatch] 加载历史任务失败:', (e as Error)?.message)
  }
}

/** 点击历史任务:恢复查看结果;未完成任务继续轮询 */
function resumeJob(j: BatchJobRecord) {
  currentJob.value = j
  if (['PENDING', 'PROCESSING'].includes(j.status)) startPoll(j.id)
  else stopPoll()
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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

// ===== P1 修复1：AI 审查问题明细展开 =====
const expandedRows = ref<Set<number>>(new Set())
function toggleExpand(i: number) {
  const s = new Set(expandedRows.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  expandedRows.value = s
}

// ===== P1 修复2：复制批次结果 =====
async function copyResult() {
  if (!currentJob.value?.result) return
  try {
    const rows = (currentJob.value.result.results || []).map((r: any) => ({
      file: r.fileName || r.filePath,
      ok: r.ok,
      error: r.error ?? undefined,
      extract: r.extract ? { textLength: r.extract.textLength, pages: r.extract.pages } : undefined,
      chunk: r.chunk ? { count: r.chunk.count } : undefined,
      summarize: r.summarize ? { summary: r.summarize.summary, keyPoints: r.summarize.keyPoints } : undefined,
      review: r.review ? { issueCount: r.review.issueCount, issues: r.review.issues } : undefined,
      knowledge: r.knowledge ? { keywords: r.knowledge.snippets } : undefined,
    }))
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
    ElMessage.success('已复制批次结果（JSON）')
  } catch {
    ElMessage.error('复制失败（剪贴板不可用），请手动选择')
  }
}

// ===== P1 修复5：近期完成的批次标「新」 =====
const FRESH_COMPLETED_WINDOW_MS = 5 * 60 * 1000
function isFreshCompleted(j: BatchJobRecord): boolean {
  if (j.status !== 'COMPLETED') return false
  const t = new Date(j.updatedAt).getTime()
  return !Number.isNaN(t) && Date.now() - t < FRESH_COMPLETED_WINDOW_MS
}

// 打开时:清空选择项,但保留 currentJob(进行中任务恢复轮询)并加载历史列表
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      selected.value = new Set()
      selectedTasks.value = new Set()
      // P1:原实现 currentJob.value = null 导致关窗再开进度永久丢失;
      // 现在若任务还在进行中,打开面板即恢复轮询
      if (currentJob.value && ['PENDING', 'PROCESSING'].includes(currentJob.value.status)) {
        startPoll(currentJob.value.id)
      }
      loadHistory()
    } else {
      stopPoll()
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
.batch-files-hint, .batch-tasks-hint { margin: 0; font-size: 12px; }
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
.batch-result-row { display: flex; flex-direction: column; gap: 4px; }
.batch-copy-btn {
  margin-left: 10px; font-size: 12px; padding: 1px 10px;
  border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px;
  background: none; cursor: pointer; color: var(--text-muted, var(--corp-text-secondary));
}
.batch-copy-btn:hover { border-color: var(--color-action); color: var(--color-action); }
.batch-expand-btn {
  flex-shrink: 0; font-size: 12px; padding: 1px 8px;
  border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px;
  background: none; cursor: pointer; color: var(--color-action);
}
.batch-expand-btn:hover, .batch-expand-btn.expanded { border-color: var(--color-action); background: color-mix(in srgb, var(--color-action) 8%, transparent); }
.batch-issues {
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px 8px; background: var(--bg-subtle, var(--color-gray-50));
  border-radius: 4px; max-height: 180px; overflow: auto;
}
.batch-issue { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }
.batch-issue-sev { flex-shrink: 0; font-size: 11px; padding: 0 6px; border-radius: 3px; }
.batch-issue-sev.sev-error { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger-600); }
.batch-issue-sev.sev-warning { background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning-600); }
.batch-issue-sev.sev-info { background: color-mix(in srgb, var(--corp-text-secondary) 13%, transparent); color: var(--color-gray-600); }
.batch-issue-type { flex-shrink: 0; color: var(--text-dim, var(--corp-text-tertiary)); font-family: var(--font-mono, monospace); }
.batch-issue-desc { flex: 1; min-width: 0; }
.batch-new-badge {
  flex-shrink: 0; font-size: 10px; color: var(--color-danger-600);
  border: 1px solid var(--color-danger); border-radius: 3px; padding: 0 4px;
}
.batch-history { border-top: 1px solid var(--border, var(--corp-border-light)); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.batch-history-refresh { font-size: 12px; padding: 0 8px; border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px; background: none; cursor: pointer; margin-left: 8px; }
.batch-history-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow: auto; }
.batch-history-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 5px 10px; border: 1px solid var(--border, var(--corp-border-light)); border-radius: 4px;
  background: none; font-size: 12px; cursor: pointer; text-align: left;
}
.batch-history-item:hover { background: var(--bg-hover, var(--corp-bg-surface-hover)); }
.batch-history-item.active { border-color: var(--accent, var(--color-action)); }
.batch-history-id { font-family: var(--font-mono, monospace); color: var(--text-dim, var(--corp-text-tertiary)); }
.batch-history-progress { color: var(--text-muted, var(--corp-text-secondary)); }
.batch-history-meta { margin-left: auto; color: var(--text-dim, var(--corp-text-tertiary)); }
</style>
