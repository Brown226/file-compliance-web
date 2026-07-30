<template>
  <div class="side-panel">
    <el-tabs v-model="activeTab" class="panel-tabs">
      <el-tab-pane label="执行追踪" name="traces">
        <div class="tab-body">
          <div v-if="!currentSessionId" class="empty-state">
            <el-icon :size="32" color="#9ca3af"><InfoFilled /></el-icon>
            <p>选择会话后查看执行追踪</p>
          </div>
          <div v-else-if="tracesLoading" class="loading-state">
            <el-icon class="is-loading" :size="24"><Loading /></el-icon>
            <span>加载追踪…</span>
          </div>
          <div v-else-if="traces.length === 0" class="empty-state">
            <el-icon :size="32" color="#9ca3af"><Clock /></el-icon>
            <p>暂无工具调用记录</p>
          </div>
          <div v-else class="trace-list">
            <div
              v-for="(trace, idx) in traces"
              :key="trace.id"
              class="trace-item"
              :class="`status-${trace.status}`"
            >
              <div class="trace-header">
                <span class="trace-step">#{{ trace.stepIndex }}</span>
                <span class="trace-tool">{{ toolNameMap[trace.toolName] || trace.toolName }}</span>
                <span v-if="trace.durationMs" class="trace-duration">
                  {{ trace.durationMs < 1000 ? `${trace.durationMs}ms` : `${(trace.durationMs / 1000).toFixed(1)}s` }}
                </span>
                <el-tag size="small" :type="traceStatusType(trace.status)" effect="plain">
                  {{ traceStatusLabel(trace.status) }}
                </el-tag>
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

/**
 * 右侧面板（Task 17.2）
 *
 * Tab 1：执行追踪（调 /api/agent/traces/:sessionId，展示工具调用序列）
 * Tab 2：文件（占位，Task 18 补充）
 *
 * 当 currentSessionId 变化时自动刷新追踪列表
 */

const props = defineProps<{
  currentSessionId?: string
}>()

const activeTab = ref<'traces' | 'memory'>('traces')
const traces = ref<TraceItem[]>([])
const tracesLoading = ref(false)

// 工具名中文映射（与 ToolCallChip 保持一致）
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

async function loadTraces(sessionId: string) {
  if (!sessionId) {
    traces.value = []
    return
  }
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
  background: #ffffff;
  border-left: 1px solid #e5e7eb;
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
  padding: 0 12px;
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
  padding: 8px 12px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: #9ca3af;
  gap: 8px;
  font-size: 12px;
}

.trace-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-item {
  padding: 6px 8px;
  background: #f9fafb;
  border-radius: 4px;
  border-left: 3px solid #10b981;
  font-size: 12px;
}

.trace-item.status-failed {
  border-left-color: #ef4444;
  background: #fef2f2;
}

.trace-item.status-skipped {
  border-left-color: #f59e0b;
}

.trace-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.trace-step {
  font-size: 10px;
  color: #9ca3af;
  font-family: monospace;
}

.trace-tool {
  font-weight: 500;
  color: #1f2937;
}

.trace-duration {
  font-size: 11px;
  color: #6b7280;
}

.trace-error {
  margin-top: 4px;
  font-size: 11px;
  color: #b91c1c;
  word-break: break-all;
}
</style>
