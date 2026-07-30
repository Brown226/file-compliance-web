<template>
  <el-drawer
    v-model="drawerVisible"
    title="LLM 推理回放"
    direction="rtl"
    size="55%"
    :destroy-on-close="true"
  >
    <div v-loading="loading" class="llm-replay">
      <!-- 顶部统计 -->
      <div v-if="logs.length > 0" class="stats-bar">
        <span class="stat-item">调用 {{ logs.length }} 次</span>
        <span class="stat-item">Token {{ totalTokens }}</span>
        <span class="stat-item">失败 {{ failedCount }} 次</span>
        <span class="stat-item">平均 {{ avgLatency }}ms</span>
      </div>

      <!-- 空状态 -->
      <el-empty v-if="!loading && logs.length === 0" description="暂无 LLM 调用记录" />

      <!-- 调用列表 -->
      <el-collapse v-else v-model="activeNames" accordion>
        <el-collapse-item
          v-for="(log, index) in logs"
          :key="log.id"
          :name="String(index)"
        >
          <template #title>
            <div class="log-title">
              <span class="log-index">{{ index + 1 }}</span>
              <el-tag :type="statusTagType(log.status)" size="small" effect="plain">
                {{ statusLabel(log.status) }}
              </el-tag>
              <span class="log-mode">{{ log.mode || '-' }}</span>
              <span class="log-model">{{ log.model }}</span>
              <span class="log-meta">{{ log.totalTokens }} tok / {{ log.latencyMs }}ms</span>
              <span class="log-time">{{ formatTime(log.createdAt) }}</span>
            </div>
          </template>

          <div class="log-detail">
            <!-- 元信息 -->
            <el-descriptions :column="3" border size="small" class="meta-desc">
              <el-descriptions-item label="模型">{{ log.model }}</el-descriptions-item>
              <el-descriptions-item label="供应商">{{ log.provider || '-' }}</el-descriptions-item>
              <el-descriptions-item label="模式">{{ log.mode || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Prompt Tokens">{{ log.promptTokens }}</el-descriptions-item>
              <el-descriptions-item label="Completion Tokens">{{ log.completionTokens }}</el-descriptions-item>
              <el-descriptions-item label="总 Tokens">{{ log.totalTokens }}</el-descriptions-item>
              <el-descriptions-item label="耗时">{{ log.latencyMs }}ms</el-descriptions-item>
              <el-descriptions-item label="状态">{{ statusLabel(log.status) }}</el-descriptions-item>
              <el-descriptions-item label="时间">{{ formatTime(log.createdAt) }}</el-descriptions-item>
            </el-descriptions>

            <!-- 错误信息 -->
            <div v-if="log.errorMsg" class="error-block">
              <div class="block-label">错误信息</div>
              <pre class="block-content error-content">{{ log.errorMsg }}</pre>
            </div>

            <!-- Prompt 全文 -->
            <div v-if="log.promptFull" class="prompt-block">
              <div class="block-header">
                <span class="block-label">Prompt 全文</span>
                <el-button text size="small" @click="copyText(log.promptFull)">复制</el-button>
              </div>
              <pre class="block-content">{{ log.promptFull }}</pre>
            </div>

            <!-- Completion 全文 -->
            <div v-if="log.completionFull" class="completion-block">
              <div class="block-header">
                <span class="block-label">Completion 全文</span>
                <el-button text size="small" @click="copyText(log.completionFull)">复制</el-button>
              </div>
              <pre class="block-content">{{ log.completionFull }}</pre>
            </div>

            <!-- RAG Chunks -->
            <div v-if="log.ragChunks" class="rag-block">
              <div class="block-label">RAG 检索片段</div>
              <pre class="block-content">{{ JSON.stringify(log.ragChunks, null, 2) }}</pre>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getLlmLogsApi, type LlmCallLog } from '@/api/task'
import { getVisionLlmLogs, type VisionLlmCallLog } from '@/api/dwg-vision'

const props = defineProps<{
  modelValue: boolean
  /** 任务 ID 模式：按 taskId 查询任务级 LLM 调用日志（TaskDetails 场景） */
  taskId?: string
  /** Task 29: traceId 模式：按 traceId(jobKey) 查询图纸视觉分析的 LLM 调用日志（DwgVisionAnalysis 场景） */
  traceId?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const drawerVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const loading = ref(false)
// 两种查询模式返回字段一致，统一用 VisionLlmCallLog 类型承载
const logs = ref<(LlmCallLog | VisionLlmCallLog)[]>([])
const activeNames = ref<string>('')

watch(
  () => props.modelValue,
  async (visible) => {
    if (visible && (props.taskId || props.traceId)) {
      await loadLogs()
    }
  },
)

async function loadLogs() {
  loading.value = true
  try {
    // Task 29: traceId 优先（dwg-vision 场景），否则走 taskId（任务审查场景）
    if (props.traceId) {
      const res = await getVisionLlmLogs(props.traceId)
      logs.value = res.data || []
    } else if (props.taskId) {
      const res = await getLlmLogsApi(props.taskId)
      logs.value = res.data || []
    } else {
      logs.value = []
    }
  } catch (e) {
    ElMessage.error('加载 LLM 调用日志失败')
    logs.value = []
  } finally {
    loading.value = false
  }
}

const totalTokens = computed(() =>
  logs.value.reduce((s, l) => s + (l.totalTokens || 0), 0),
)

const failedCount = computed(() =>
  logs.value.filter((l) => l.status === 'failed').length,
)

const avgLatency = computed(() => {
  if (logs.value.length === 0) return 0
  const total = logs.value.reduce((s, l) => s + (l.latencyMs || 0), 0)
  return Math.round(total / logs.value.length)
})

function statusTagType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  return 'info'
}

function statusLabel(status: string) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'cache') return '缓存'
  return status
}

function formatTime(iso: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}
</script>

<style scoped>
.llm-replay {
  padding: 0 4px;
}

.stats-bar {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
}

.stat-item {
  white-space: nowrap;
}

.log-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: 13px;
}

.log-index {
  display: inline-block;
  min-width: 24px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  background: #e4e7ed;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
}

.log-mode {
  color: #303133;
  font-weight: 500;
  min-width: 80px;
}

.log-model {
  color: #909399;
  font-size: 12px;
}

.log-meta {
  color: #909399;
  font-size: 12px;
  margin-left: auto;
}

.log-time {
  color: #c0c4cc;
  font-size: 12px;
  min-width: 70px;
  text-align: right;
}

.log-detail {
  padding: 8px 0;
}

.meta-desc {
  margin-bottom: 16px;
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.block-label {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.prompt-block,
.completion-block,
.rag-block,
.error-block {
  margin-bottom: 16px;
}

.block-content {
  max-height: 360px;
  overflow: auto;
  padding: 10px 12px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Monaco', monospace;
}

.error-content {
  color: #f56c6c;
  background: #fef0f0;
  border-color: #fbc4c4;
}
</style>
