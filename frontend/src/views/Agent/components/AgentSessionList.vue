<template>
  <div class="session-list-panel">
    <div class="panel-header">
      <span class="panel-title">会话历史</span>
      <el-button size="small" type="primary" @click="$emit('new-chat')">
        <el-icon><Plus /></el-icon>
        <span>新建</span>
      </el-button>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <div v-else-if="sessions.length === 0" class="empty-state">
        <el-icon :size="28" color="#c0c4cc"><ChatDotRound /></el-icon>
        <p>暂无历史会话</p>
      </div>

      <div v-else class="session-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === currentSessionId }"
          @click="$emit('select', session.id)"
        >
          <div class="item-content">
            <div class="item-title">{{ session.title || '未命名会话' }}</div>
            <div class="item-preview">{{ session.lastMessagePreview || '暂无消息' }}</div>
            <div class="item-meta">
              <span>{{ formatTime(session.updatedAt) }}</span>
              <span class="meta-sep">·</span>
              <span>{{ session.messageCount }} 条消息</span>
            </div>
          </div>
          <button class="item-delete" @click.stop="handleDelete(session.id)" title="删除会话">
            <el-icon :size="14"><Delete /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Plus, Loading, ChatDotRound, Delete } from '@element-plus/icons-vue'
import { listSessionsApi, deleteSessionApi, type SessionListItem } from '@/api/agent'

const props = defineProps<{
  currentSessionId?: string | null
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  'new-chat': []
}>()

const sessions = ref<SessionListItem[]>([])
const loading = ref(false)

async function loadSessions() {
  loading.value = true
  try {
    const res = await listSessionsApi(50)
    sessions.value = res.data
  } catch (e: any) {
    ElMessage.error(`加载会话列表失败: ${e?.message || e}`)
  } finally {
    loading.value = false
  }
}

async function handleDelete(sessionId: string) {
  try {
    await ElMessageBox.confirm('确定删除该会话？删除后无法恢复。', '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteSessionApi(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    ElMessage.success('会话已删除')
  } catch (e: any) {
    if (e !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(`删除失败: ${e?.message || e}`)
    }
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}/${day}`
}

onMounted(loadSessions)
defineExpose({ refresh: loadSessions })
</script>

<style scoped>
.session-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fafbfc;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
  letter-spacing: -0.01em;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
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

.session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  position: relative;
}

.session-item:hover {
  background: #f0f2f5;
}

.session-item.active {
  background: #eef2ff;
}

.session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: #4f6ef7;
  border-radius: 0 2px 2px 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1a1a2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 3px;
}

.session-item.active .item-title {
  color: #4f6ef7;
}

.item-preview {
  font-size: 12px;
  color: #8c8c9e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
  line-height: 1.3;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: #b0b0c0;
}

.meta-sep {
  font-size: 10px;
}

.item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #c0c0d0;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  flex-shrink: 0;
  margin-top: -1px;
}

.session-item:hover .item-delete {
  opacity: 1;
}

.item-delete:hover {
  color: #e5484d;
  background: #fff0f0;
}
</style>
