<template>
  <div class="session-list-panel">
    <div class="panel-header">
      <span class="panel-title">会话历史</span>
      <el-button size="small" type="primary" plain @click="$emit('new-chat')">
        <el-icon><Plus /></el-icon> 新会话
      </el-button>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <div v-else-if="sessions.length === 0" class="empty-state">
        <el-icon :size="32" color="#9ca3af"><ChatDotRound /></el-icon>
        <p>暂无会话</p>
      </div>

      <div v-else class="session-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === currentSessionId }"
          @click="$emit('select', session.id)"
        >
          <div class="session-main">
            <div class="session-title">{{ session.title || '（未命名会话）' }}</div>
            <div class="session-preview">{{ session.lastMessagePreview || '暂无消息' }}</div>
          </div>
          <div class="session-meta">
            <span class="session-time">{{ formatTime(session.updatedAt) }}</span>
            <span class="session-count">{{ session.messageCount }} 条</span>
          </div>
          <el-icon
            class="session-delete"
            @click.stop="handleDelete(session.id)"
          >
            <Delete />
          </el-icon>
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

/**
 * 左侧会话列表面板（Task 17.1）
 *
 * - 启动时调 listSessionsApi 加载会话列表
 * - 点击会话项 → emit('select', sessionId)
 * - 删除按钮 → 确认后调 deleteSessionApi，本地同步移除
 * - 新会话按钮 → emit('new-chat')
 */

const props = defineProps<{
  currentSessionId?: string
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
  // 超过 7 天显示日期
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}/${day}`
}

onMounted(loadSessions)

// 暴露刷新方法供父组件调用
defineExpose({ refresh: loadSessions })
</script>

<style scoped>
.session-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
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

.session-list {
  padding: 4px 0;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.15s;
  position: relative;
}

.session-item:hover {
  background: #f9fafb;
}

.session-item.active {
  background: #eff6ff;
  border-left: 3px solid #3b82f6;
  padding-left: 13px;
}

.session-main {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.session-preview {
  font-size: 11px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 10px;
  color: #9ca3af;
  flex-shrink: 0;
}

.session-delete {
  opacity: 0;
  color: #9ca3af;
  transition: opacity 0.15s, color 0.15s;
  cursor: pointer;
  flex-shrink: 0;
}

.session-item:hover .session-delete {
  opacity: 1;
}

.session-delete:hover {
  color: #ef4444;
}
</style>
