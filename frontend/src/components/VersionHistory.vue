<template>
  <div class="version-history">
    <div class="version-header">
      <span class="version-title">版本历史</span>
      <el-button size="small" text @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <div v-if="loading" class="version-loading">
      <el-icon class="loading-spinner"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <div v-else-if="versions.length === 0" class="version-empty">
      <el-icon :size="32" color="var(--corp-text-hint)"><Clock /></el-icon>
      <span>暂无版本记录</span>
    </div>

    <div v-else class="version-list">
      <div
        v-for="v in versions"
        :key="v.id"
        class="version-item"
        :class="{ active: selectedVersion?.id === v.id }"
        @click="selectVersion(v)"
      >
        <div class="version-info">
          <span class="version-no">v{{ v.versionNo }}</span>
          <el-tag size="small" effect="plain" round>{{ getActionLabel(v.sourceAction) }}</el-tag>
        </div>
        <div class="version-meta">
          <span class="version-time">{{ formatTime(v.createdAt) }}</span>
        </div>
      </div>
    </div>

    <!-- Diff 预览 -->
    <div v-if="diffData" class="diff-preview">
      <div class="diff-header">
        <span>与 v{{ selectedVersion?.versionNo }} 的差异</span>
        <el-button size="small" text @click="diffData = null">关闭</el-button>
      </div>
      <div class="diff-content">
        <span
          v-for="(segment, i) in diffData"
          :key="i"
          :class="'diff-' + segment.type"
        >{{ segment.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Close, Loading, Clock } from '@element-plus/icons-vue'
import { getVersionsApi, getVersionDiffApi } from '@/api/onlyoffice'

const props = defineProps<{
  fileId: string
}>()

defineEmits<{
  (e: 'close'): void
}>()

interface Version {
  id: string
  versionNo: number
  sourceAction: string
  createdAt: string
}

const loading = ref(false)
const versions = ref<Version[]>([])
const selectedVersion = ref<Version | null>(null)
const diffData = ref<Array<{ type: 'equal' | 'delete' | 'insert'; text: string }> | null>(null)

const fetchVersions = async () => {
  if (!props.fileId) return
  loading.value = true
  try {
    const res = await getVersionsApi(props.fileId)
    versions.value = res.data || []
  } catch (e) {
    console.error('[VersionHistory] 获取版本历史失败:', e)
  } finally {
    loading.value = false
  }
}

const selectVersion = async (v: Version) => {
  selectedVersion.value = v
  try {
    const res = await getVersionDiffApi(props.fileId, v.versionNo)
    diffData.value = res.data || null
  } catch (e) {
    console.error('[VersionHistory] 获取 diff 失败:', e)
  }
}

const getActionLabel = (action: string): string => {
  const m: Record<string, string> = {
    'replace-text': '文本替换',
    'batch-replace-text': '批量替换',
    'manual-save': '手动保存',
  }
  return m[action] || action
}

const formatTime = (dateStr: string): string => {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

watch(() => props.fileId, fetchVersions, { immediate: true })
</script>

<style scoped>
.version-history {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.version-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}

.version-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.version-loading,
.version-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--corp-text-hint);
  font-size: 13px;
}

.loading-spinner {
  font-size: 24px;
  color: var(--corp-primary);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.version-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.version-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.version-item:hover {
  background: var(--corp-bg-sunken);
}

.version-item.active {
  background: var(--corp-primary-light-9);
  border-left: 2px solid var(--corp-primary);
}

.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-no {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-primary);
}

.version-meta {
  display: flex;
  align-items: center;
}

.version-time {
  font-size: 11px;
  color: var(--corp-text-hint);
}

.diff-preview {
  border-top: 1px solid var(--corp-border-light);
  flex-shrink: 0;
  max-height: 240px;
  display: flex;
  flex-direction: column;
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-secondary);
  background: var(--corp-bg-sunken);
  border-bottom: 1px solid var(--corp-border-light);
}

.diff-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
}

.diff-equal {
  color: var(--corp-text-primary);
}

.diff-delete {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  text-decoration: line-through;
}

.diff-insert {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
</style>
