<template>
  <Teleport to="body">
    <div v-if="visible" class="notification-center" @click.self="close">
      <div class="notification-panel">
        <div class="panel-header">
          <h3>通知中心</h3>
          <div class="header-actions">
            <el-button size="small" link type="primary" @click="markAllRead">全部已读</el-button>
            <el-button size="small" text @click="close"><el-icon><Close /></el-icon></el-button>
          </div>
        </div>

        <el-tabs v-model="activeTab">
          <el-tab-pane :label="`全部 (${total})`" name="all" />
          <el-tab-pane :label="`未读 (${unreadCount})`" name="unread" />
        </el-tabs>

        <div class="notification-list">
          <div v-if="filteredNotifications.length === 0" class="empty-state">
            <el-icon :size="48" color="#d1d5db"><Bell /></el-icon>
            <p>暂无通知</p>
          </div>

          <div
            v-for="item in filteredNotifications"
            :key="item.id"
            class="notification-item"
            :class="{ unread: !item.read }"
            @click="handleRead(item)"
          >
            <div class="item-dot" v-if="!item.read"></div>
            <div class="item-icon" :style="{ background: typeColor(item.type) }">
              <el-icon :size="16"><component :is="typeIcon(item.type)" /></el-icon>
            </div>
            <div class="item-body">
              <div class="item-title">{{ item.title }}</div>
              <div class="item-desc">{{ item.description }}</div>
              <div class="item-time">{{ formatTimeAgo(item.createdAt) }}</div>
            </div>
            <el-button size="small" link type="danger" @click.stop="deleteNotification(item.id)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bell, Close, Delete, Check, Warning, InfoFilled, ChatDotRound } from '@element-plus/icons-vue'

interface NotificationItem {
  id: string
  type: 'task' | 'warning' | 'info' | 'message'
  title: string
  description: string
  read: boolean
  createdAt: Date
}

const visible = ref(false)
const activeTab = ref('all')

const notifications = ref<NotificationItem[]>([
  {
    id: '1', type: 'task', title: '审查任务完成',
    description: '任务「2024年度报告审查」已完成，发现 3 个问题',
    read: false, createdAt: new Date(Date.now() - 300000),
  },
  {
    id: '2', type: 'warning', title: 'LLM 接口响应慢',
    description: 'OpenAI API 平均响应时间超过 10s，请检查配置',
    read: false, createdAt: new Date(Date.now() - 1800000),
  },
  {
    id: '3', type: 'info', title: '标准库更新',
    description: '新增 5 条企业标准规范，请及时查看',
    read: true, createdAt: new Date(Date.now() - 3600000),
  },
  {
    id: '4', type: 'message', title: '审批请求',
    description: '用户张三请求修改审查规则「标点符号检查」',
    read: false, createdAt: new Date(Date.now() - 7200000),
  },
])

const total = computed(() => notifications.value.length)
const unreadCount = computed(() => notifications.value.filter(n => !n.read).length)

const filteredNotifications = computed(() => {
  if (activeTab.value === 'unread') {
    return notifications.value.filter(n => !n.read)
  }
  return notifications.value
})

function open() { visible.value = true }
function close() { visible.value = false }
function toggle() { visible.value = !visible.value }

function handleRead(item: NotificationItem) {
  item.read = true
}

function markAllRead() {
  notifications.value.forEach(n => n.read = true)
}

function deleteNotification(id: string) {
  notifications.value = notifications.value.filter(n => n.id !== id)
}

function formatTimeAgo(date: Date) {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const typeColor = (type: string) => {
  const map: Record<string, string> = {
    task: '#409eff', warning: '#e6a23c', info: '#909399', message: '#67c23a',
  }
  return map[type] || '#909399'
}

const typeIcon = (type: string) => {
  const map: Record<string, any> = {
    task: Check, warning: Warning, info: InfoFilled, message: ChatDotRound,
  }
  return map[type] || InfoFilled
}

defineExpose({ open, close, toggle, unreadCount })
</script>

<style scoped>
.notification-center {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: flex-end;
  padding: 60px 24px 24px;
}

.notification-panel {
  width: 400px;
  max-height: calc(100vh - 108px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px 8px;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.notification-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  padding: 12px 20px;
  gap: 12px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
}

.notification-item:hover {
  background: #f9fafb;
}

.notification-item.unread {
  background: #f0f7ff;
}

.item-dot {
  position: absolute;
  left: 8px;
  top: 18px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #409eff;
}

.item-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.item-body {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #111827;
  margin-bottom: 4px;
}

.item-desc {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-time {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
}

.empty-state {
  padding: 40px 16px;
  text-align: center;
  color: #9ca3af;
}

.empty-state p {
  margin-top: 12px;
  font-size: 14px;
}
</style>
