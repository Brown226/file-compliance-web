<template>
  <div class="session-list-panel">
    <div class="panel-header">
      <span class="panel-title">Agent 审查助手</span>
      <div class="header-actions">
        <button class="header-btn primary" title="新建会话" @click="$emit('new-chat')">
          <el-icon :size="12"><Plus /></el-icon>
          <span>新建</span>
        </button>
        <button class="header-btn icon" :title="refreshDone ? '已刷新' : '刷新会话列表'" @click="handleRefresh">
          <el-icon :size="14" v-if="refreshDone"><Check /></el-icon>
          <el-icon :size="14" v-else><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading" :size="18"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <div v-else-if="sessions.length === 0" class="empty-state">
        <!-- 对齐 --corp-text-tertiary -->
        <el-icon :size="26" color="var(--corp-text-tertiary)"><ChatDotRound /></el-icon>
        <p>暂无历史会话</p>
      </div>

      <div v-else class="session-list">
        <!-- 分组渲染：今天 / 最近7天 / 更早 -->
        <div
          v-for="group in groups"
          :key="group.key"
          class="session-group"
        >
          <button
            class="group-header"
            :title="group.collapsed ? '展开' : '收起'"
            @click="toggleGroup(group.key)"
          >
            <span class="group-chevron" :class="{ 'is-collapsed': group.collapsed }">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 4.5 6 8 9.5 4.5" /></svg>
            </span>
            <span class="group-name">{{ group.label }}</span>
            <span class="group-count">{{ group.sessions.length }}</span>
          </button>
          <template v-if="!group.collapsed">
            <div
              v-for="session in group.sessions"
              :key="session.id"
              class="session-item"
              :class="{ active: session.id === currentSessionId }"
              @click="confirmDeleteId === session.id || renamingId === session.id ? null : $emit('select', session.id)"
              @mouseenter="hoveredId = session.id"
              @mouseleave="hoveredId = null"
            >
          <!-- 删除确认（行内，对齐参考） -->
          <template v-if="confirmDeleteId === session.id">
            <span class="delete-hint">{{ (session.title || '未命名会话').slice(0, 18) }}</span>
            <button class="confirm-btn danger" @click.stop="doDelete(session.id)">删除</button>
            <button class="confirm-btn" @click.stop="confirmDeleteId = null">取消</button>
          </template>

          <!-- 重命名输入（行内，对齐参考） -->
          <template v-else-if="renamingId === session.id">
            <input
              ref="renameInputRef"
              v-model="renameValue"
              class="rename-input"
              @keydown.enter="commitRename(session)"
              @keydown.esc="cancelRename"
              @blur="commitRename(session)"
            />
          </template>

          <!-- 正常展示 -->
          <template v-else>
            <div class="item-content">
              <div class="item-title" :title="session.title || '未命名会话'">{{ session.title || '未命名会话' }}</div>
              <div class="item-meta">
                <span>{{ formatTime(session.updatedAt) }}</span>
                <span class="meta-sep">·</span>
                <span>{{ session.messageCount }} 条消息</span>
              </div>
            </div>
            <div v-if="hoveredId === session.id" class="item-actions">
              <button class="action-btn" title="复制会话" @click.stop="doDuplicate(session)">
                <el-icon :size="13"><CopyDocument /></el-icon>
              </button>
              <button class="action-btn" title="重命名" @click.stop="startRename(session)">
                <el-icon :size="13"><EditPen /></el-icon>
              </button>
              <button class="action-btn danger" title="删除" @click.stop="confirmDeleteId = session.id">
                <el-icon :size="13"><Delete /></el-icon>
              </button>
            </div>
          </template>
          </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 底部工具栏（对齐参考项目：等分按钮，置底展示；Plugins 替换为「记忆」） -->
    <div class="panel-footer">
      <!-- 模型配置仅管理员可见（普通用户使用配置好的模型即可） -->
      <button v-if="userStore.isAdmin()" class="footer-btn" title="模型配置" @click="emit('open-config', 'models')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>
        <span>模型</span>
      </button>
      <button class="footer-btn" title="技能配置" @click="emit('open-config', 'skills')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        <span>技能</span>
      </button>
      <button class="footer-btn" title="记忆" @click="emit('open-config', 'memory')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
        <span>记忆</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh, Check, Loading, ChatDotRound, Delete, EditPen, CopyDocument } from '@element-plus/icons-vue'
import { listSessionsApi, deleteSessionApi, renameSessionApi, duplicateSessionApi, type SessionListItem } from '@/api/agent'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const props = defineProps<{
  currentSessionId?: string | null
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  'new-chat': []
  'open-config': [type: 'models' | 'skills' | 'memory']
  /** 当前正在查看的会话被删除（父组件需清理本地状态，防止继续向已删会话发送消息） */
  'deleted-current': []
}>()

const sessions = ref<SessionListItem[]>([])
const loading = ref(false)
const refreshDone = ref(false)
const hoveredId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// ===== 会话历史分组（今天 / 最近7天 / 更早）=====
type GroupKey = 'today' | 'recent7' | 'older'
const GROUP_STORAGE_KEY = 'agent-session-group-collapsed'

function loadCollapsedMap(): Record<GroupKey, boolean> {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY)
    if (raw) return { ...{ today: true, recent7: true, older: false }, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { today: true, recent7: true, older: false }
}
const collapsedMap = ref<Record<GroupKey, boolean>>(loadCollapsedMap())

function toggleGroup(key: GroupKey) {
  collapsedMap.value[key] = !collapsedMap.value[key]
  try {
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(collapsedMap.value))
  } catch { /* ignore */ }
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const groups = computed(() => {
  const todayStart = startOfDay(new Date())
  const today = sessions.value.filter(s => startOfDay(new Date(s.updatedAt)) === todayStart)
  const recent7 = sessions.value.filter(s => {
    const t = startOfDay(new Date(s.updatedAt))
    return t < todayStart && t >= todayStart - 6 * 86400000
  })
  const older = sessions.value.filter(s => startOfDay(new Date(s.updatedAt)) < todayStart - 6 * 86400000)
  return [
    { key: 'today' as GroupKey, label: '今天', sessions: today, collapsed: collapsedMap.value.today },
    { key: 'recent7' as GroupKey, label: '最近 7 天', sessions: recent7, collapsed: collapsedMap.value.recent7 },
    { key: 'older' as GroupKey, label: '更早', sessions: older, collapsed: collapsedMap.value.older },
  ].filter(g => g.sessions.length > 0)
})

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

async function handleRefresh() {
  await loadSessions()
  refreshDone.value = true
  setTimeout(() => { refreshDone.value = false }, 2000)
}

async function doDelete(sessionId: string) {
  try {
    await deleteSessionApi(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    confirmDeleteId.value = null
    // 修复：删除当前查看的会话时通知父组件清理消息/会话状态，
    // 否则 UI 仍显示已删会话，继续发送会重建空会话
    if (props.currentSessionId === sessionId) {
      emit('deleted-current')
    }
    // [无弹窗] 成功提示已移除：ElMessage.success('会话已删除')
  } catch (e: any) {
    ElMessage.error(`删除失败: ${e?.message || e}`)
    confirmDeleteId.value = null
  }
}

async function doDuplicate(session: SessionListItem) {
  try {
    const res = await duplicateSessionApi(session.id)
    // [无弹窗] 成功提示已移除：ElMessage.success(`已复制会话：${res.data?.title || '副本'}`)
    await loadSessions()
    // 复制后自动切换到新会话（多方案并行对比入口）
    emit('select', res.data.id)
  } catch (e: any) {
    ElMessage.error(`复制会话失败: ${e?.message || e}`)
  }
}

function startRename(session: SessionListItem) {
  renamingId.value = session.id
  renameValue.value = session.title || ''
  nextTick(() => {
    renameInputRef.value?.select()
  })
}

async function commitRename(session: SessionListItem) {
  if (renamingId.value !== session.id) return
  const name = renameValue.value.trim()
  renamingId.value = null
  if (!name || name === (session.title || '')) return
  try {
    await renameSessionApi(session.id, name)
    session.title = name
    // [无弹窗] 成功提示已移除：ElMessage.success('已重命名')
  } catch (e: any) {
    ElMessage.error(`重命名失败: ${e?.message || e}`)
  }
}

function cancelRename() {
  renamingId.value = null
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
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
  background: var(--bg-panel);
}

/* 头部：品牌名 + 新建/刷新（对齐参考轻量按钮） */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 10px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.panel-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  height: 32px;
  padding: 0 10px 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.01em;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.header-btn.primary:hover {
  background: var(--bg-selected);
  color: var(--accent);
  border-color: rgba(37, 99, 235, 0.35);
}
.header-btn.icon {
  width: 32px;
  padding: 0;
}
.header-btn.icon:hover {
  background: var(--bg-selected);
  color: var(--accent);
  border-color: rgba(37, 99, 235, 0.35);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  min-height: 80px;
}

/* 底部工具栏（对齐参考：三个等分图标+文字按钮，32px 高） */
.panel-footer {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.footer-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 9px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s;
}
.footer-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-dim);
  gap: 8px;
  font-size: 13px;
}

.session-list {
  display: flex;
  flex-direction: column;
}

/* ===== 会话分组（今天 / 最近7天 / 更早）===== */
.session-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 6px;
}
.session-group:last-child {
  margin-bottom: 0;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: left;
  transition: color 0.12s, background 0.12s;
  flex-shrink: 0;
}
.group-header:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.group-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.group-chevron.is-collapsed {
  transform: rotate(-90deg);
}
.group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  background: var(--bg-hover);
  border-radius: 8px;
  padding: 0 6px;
  line-height: 16px;
  flex-shrink: 0;
}

/* 会话项：54px 高 + 2px accent 竖条（对齐参考） */
.session-item {
  height: 54px;
  display: flex;
  align-items: center;
  padding-left: 14px;
  padding-right: 8px;
  cursor: pointer;
  border-left: 2px solid transparent;
  background: transparent;
  transition: background 0.1s;
  gap: 6px;
  overflow: hidden;
}
.session-item:hover {
  background: var(--bg-hover);
}
.session-item.active {
  background: var(--bg-selected);
  border-left-color: var(--accent);
}

.item-content {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.meta-sep {
  font-size: 12px;
}

.item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.action-btn:hover {
  background: var(--bg-selected);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
.action-btn.danger:hover {
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
}

/* 行内删除确认 */
.delete-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.confirm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.confirm-btn.danger {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--corp-text-inverse);
  font-weight: 600;
}

/* 行内重命名输入 */
.rename-input {
  flex: 1;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  outline: none;
  background: var(--bg);
  color: var(--text);
  height: 30px;
  min-width: 0;
}
</style>
