<template>
  <div class="side-panel">
    <el-tabs v-model="activeTab" class="panel-tabs">
      <el-tab-pane label="执行追踪" name="traces">
        <div class="tab-body">
          <div v-if="!currentSessionId" class="empty-state">
            <el-icon :size="28" color="#c0c4cc"><InfoFilled /></el-icon>
            <p>选择会话后查看执行追踪</p>
          </div>
          <div v-else-if="tracesLoading" class="loading-state">
            <el-icon class="is-loading" :size="20"><Loading /></el-icon>
            <span>加载追踪…</span>
          </div>
          <div v-else-if="traces.length === 0" class="empty-state">
            <el-icon :size="28" color="#c0c4cc"><Clock /></el-icon>
            <p>暂无工具调用记录</p>
            <p class="empty-sub">开始审查后这里将展示 Agent 的每一步决策</p>
          </div>
          <div v-else class="trace-list">
            <div
              v-for="trace in traces"
              :key="trace.id"
              class="trace-item"
              :class="`status-${trace.status}`"
            >
              <div class="trace-top">
                <div class="trace-left">
                  <span class="trace-tool">{{ toolNameMap[trace.toolName] || trace.toolName }}</span>
                  <el-tag size="small" :type="traceStatusType(trace.status)" effect="light">
                    {{ traceStatusLabel(trace.status) }}
                  </el-tag>
                </div>
                <span v-if="trace.durationMs" class="trace-duration">
                  {{ trace.durationMs < 1000 ? `${trace.durationMs}ms` : `${(trace.durationMs / 1000).toFixed(1)}s` }}
                </span>
              </div>
              <div class="trace-step">
                <span>Step {{ trace.stepIndex }}</span>
                <span class="trace-time">{{ formatTraceTime(trace.createdAt) }}</span>
              </div>
              <div v-if="trace.error" class="trace-error">{{ trace.error }}</div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="记忆" name="memory">
        <div class="tab-body">
          <AgentMemoryPanel />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loading, InfoFilled, Clock } from '@element-plus/icons-vue'
import { listTracesApi, type TraceItem } from '@/api/agent'
import AgentMemoryPanel from './AgentMemoryPanel.vue'

const props = defineProps<{
  currentSessionId?: string | null
}>()

const activeTab = ref<'traces' | 'memory'>('traces')
const traces = ref<TraceItem[]>([])
const tracesLoading = ref(false)

const toolNameMap: Record<string, string> = {
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

function traceStatusType(s: string): 'success' | 'warning' | 'danger' {
  if (s === 'failed') return 'danger'
  if (s === 'skipped') return 'warning'
  return 'success'
}

function traceStatusLabel(s: string): string {
  if (s === 'success') return '成功'
  if (s === 'failed') return '失败'
  if (s === 'skipped') return '跳过'
  return s
}

function formatTraceTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadTraces(sessionId: string) {
  tracesLoading.value = true
  try {
    const res = await listTracesApi(sessionId)
    traces.value = res.data
  } catch (e: any) {
    console.error('[AgentSidePanel] 加载 trace 失败:', e)
    traces.value = []
  } finally {
    tracesLoading.value = false
  }
}

watch(
  () => props.currentSessionId,
  (newId) => {
    if (newId) loadTraces(newId)
    else traces.value = []
  },
  { immediate: true },
)
</script>

<style scoped>
.side-panel {
  height: 100%;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
}

.panel-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 16px;
  background: transparent;
}

.panel-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #eeeef2;
}

.panel-tabs :deep(.el-tabs__item) {
  font-size: 13px;
  color: #8c8c9e;
  padding: 0 16px;
  height: 40px;
  line-height: 40px;
}

.panel-tabs :deep(.el-tabs__item.is-active) {
  color: #4f6ef7;
  font-weight: 500;
}

.panel-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
}

.panel-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.tab-body {
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: #a0a0b0;
  gap: 8px;
  font-size: 13px;
}

.empty-sub {
  font-size: 11px;
  color: #c0c0d0;
  max-width: 200px;
  text-align: center;
  line-height: 1.4;
}

.trace-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-item {
  padding: 10px 12px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #eeeef2;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.trace-item:hover {
  border-color: #dddde8;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.trace-item.status-failed {
  border-color: #fecaca;
  background: #fefafafa;
}

.trace-item.status-failed:hover {
  border-color: #fca5a5;
}

.trace-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.trace-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.trace-tool {
  font-size: 12.5px;
  font-weight: 500;
  color: #1a1a2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trace-duration {
  font-size: 11px;
  color: #8c8c9e;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.trace-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #b0b0c0;
}

.trace-time {
  color: #ccc;
}

.trace-error {
  margin-top: 5px;
  padding: 6px 8px;
  background: #fef2f2;
  border-radius: 4px;
  font-size: 11px;
  color: #b91c1c;
  font-family: 'Menlo', 'Consolas', monospace;
  word-break: break-all;
  line-height: 1.3;
}
</style>
