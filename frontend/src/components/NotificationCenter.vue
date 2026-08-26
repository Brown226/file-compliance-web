<template>
  <Teleport to="body">
    <Transition name="nc-fade">
      <div v-if="visible" class="notification-center" @click.self="close">
        <Transition name="nc-slide" appear>
          <div class="notification-panel" v-show="visible">
            <div class="panel-header">
              <h3>通知中心</h3>
              <div class="header-actions">
                <el-button size="small" link type="primary" @click="handleMarkAllRead">全部已读</el-button>
                <el-button size="small" text @click="close"><el-icon><Close /></el-icon></el-button>
              </div>
            </div>

            <el-tabs v-model="activeTab" @tab-click="handleTabClick" class="nc-tabs">
              <el-tab-pane :label="`通知 (${unreadCount})`" name="notifications" />
              <el-tab-pane :label="`公告 (${announcementUnread})`" name="announcements" />
            </el-tabs>

            <!-- 通知列表 Tab -->
            <div v-if="activeTab === 'notifications'" class="notification-list" ref="notifListRef">
              <TransitionGroup name="nc-list" tag="div">
                <div
                  v-for="item in filteredNotifications"
                  :key="item.id"
                  class="notification-item"
                  :class="{ unread: !item.read, 'has-action': !!item.action }"
                  @click="handleItemClick(item)"
                >
                  <div class="item-indicator" :class="{ pulse: !item.read }">
                    <span v-if="!item.read" class="indicator-dot"></span>
                    <div class="item-icon" :style="{ background: typeConfig(item.type).color }">
                      <el-icon :size="14"><component :is="typeConfig(item.type).icon" /></el-icon>
                    </div>
                  </div>
                  <div class="item-body">
                    <div class="item-title-row">
                      <span class="item-title">{{ item.title }}</span>
                      <el-tag v-if="item.tag" size="small" :type="tagType(item.tag)" effect="plain" round>{{ item.tag }}</el-tag>
                    </div>
                    <p class="item-desc">{{ item.description }}</p>
                    <div class="item-meta">
                      <span class="item-time">{{ formatTimeAgo(item.createdAt) }}</span>
                      <span v-if="item.action" class="item-action-hint">{{ actionLabel(item.action) }} →</span>
                    </div>
                  </div>
                  <el-button
                    class="item-delete-btn"
                    size="small"
                    link
                    type="danger"
                    @click.stop="deleteNotification(item.id)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
              </TransitionGroup>

              <div v-if="filteredNotifications.length === 0" class="empty-state">
                <div class="empty-illustration">
                  <el-icon :size="40" color="var(--color-gray-300)"><Bell /></el-icon>
                </div>
                <p class="empty-text">暂无通知</p>
                <p class="empty-subtext">新通知将在此处显示</p>
              </div>
            </div>

            <!-- 系统公告 Tab -->
            <div v-else class="announcement-list">
              <div v-if="announcementLoading" class="loading-state">
                <el-icon :size="28" class="is-loading" color="var(--color-primary-500)"><Loading /></el-icon>
                <p>加载中...</p>
              </div>

              <div v-else-if="announcementHistory.length === 0" class="empty-state">
                <div class="empty-illustration">
                  <el-icon :size="40" color="var(--color-gray-300)"><Document /></el-icon>
                </div>
                <p class="empty-text">暂无公告</p>
                <p class="empty-subtext">系统公告将在此处展示</p>
              </div>

              <TransitionGroup v-else name="nc-list" tag="div">
                <div
                  v-for="item in announcementHistory"
                  :key="item.id"
                  class="announcement-item"
                  :class="{ unread: !item.isRead }"
                  @click="showAnnouncementDetail(item)"
                >
                  <div class="item-indicator">
                    <span v-if="!item.isRead" class="indicator-dot urgent-dot"></span>
                    <div class="item-icon" :style="{ background: urgencyColor(item.urgency) }">
                      <el-icon :size="14"><component :is="urgencyIcon(item.urgency)" /></el-icon>
                    </div>
                  </div>
                  <div class="item-body">
                    <div class="item-header">
                      <el-tag :type="urgencyTagType(item.urgency)" effect="light" size="small" round>
                        {{ urgencyLabel(item.urgency) }}
                      </el-tag>
                      <span class="item-time">{{ formatTimeAgoStr(item.publishAt) }}</span>
                    </div>
                    <p class="item-title">{{ item.title }}</p>
                    <p class="item-desc">{{ truncateContent(item.content) }}</p>
                  </div>
                  <el-button
                    v-if="!item.isRead"
                    size="small"
                    link
                    type="primary"
                    class="item-read-btn"
                    @click.stop="markAnnouncementRead(item.id)"
                  >
                    标记已读
                  </el-button>
                </div>
              </TransitionGroup>

              <div v-if="announcementTotal > announcementLimit" class="pagination-wrap">
                <el-pagination
                  small
                  :current-page="announcementPage"
                  :page-size="announcementLimit"
                  :total="announcementTotal"
                  layout="prev, pager, next"
                  @current-change="handlePageChange"
                />
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- 通知详情对话框 -->
  <el-dialog
    v-model="notifDetailVisible"
    :title="currentNotifItem?.title || '通知详情'"
    width="480px"
    destroy-on-close
    class="notif-detail-dialog"
  >
    <template #header>
      <div class="detail-header">
        <el-tag v-if="currentNotifItem" :type="tagType(currentNotifItem.tag || '')" effect="light" size="small">
          {{ currentNotifItem?.tag || '通知' }}
        </el-tag>
        <span class="detail-time">{{ currentNotifItem ? formatTimeAgo(currentNotifItem.createdAt) : '' }}</span>
      </div>
    </template>

    <div class="notif-detail-content" v-if="currentNotifItem">
      <p class="detail-desc">{{ currentNotifItem.description }}</p>
      <div v-if="currentNotifItem.content" class="detail-extra">
        <h4>详情</h4>
        <p>{{ currentNotifItem.content }}</p>
      </div>
    </div>

    <template #footer>
      <el-button @click="notifDetailVisible = false">关闭</el-button>
      <el-button
        v-if="currentNotifItem && currentNotifItem.action"
        type="primary"
        @click="handleAction(currentNotifItem)"
      >
        {{ actionLabel(currentNotifItem.action!) }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 公告详情对话框 -->
  <el-dialog
    v-model="detailVisible"
    :title="detailItem?.title || '公告详情'"
    width="700px"
    destroy-on-close
    class="announce-detail-dialog"
  >
    <template #header>
      <div class="detail-header">
        <el-tag v-if="detailItem" :type="urgencyTagType(detailItem.urgency)" effect="light" size="small">
          {{ urgencyLabel(detailItem.urgency) }}
        </el-tag>
        <span class="detail-time">{{ formatTimeAgoStr(detailItem?.publishAt) }}</span>
      </div>
    </template>

    <div class="markdown-body announce-content" v-if="detailItem" v-html="renderedContent(detailItem.content)"></div>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button v-if="detailItem && !detailItem.isRead" type="primary" @click="handleDetailConfirm">
        我已阅读
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Bell, Close, Delete, Check, Warning, InfoFilled,
  ChatDotRound, Loading, Document, Tickets, Setting,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { SystemAnnouncement } from '@/types/models'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  getAnnouncementHistoryApi,
  markAnnouncementReadApi,
  markAllAnnouncementsReadApi,
} from '@/api/announcement'

const router = useRouter()
const { renderMarkdown } = useMarkdown()

export interface NotificationItem {
  id: string
  type: 'task' | 'warning' | 'info' | 'message' | 'system' | 'success'
  title: string
  description: string
  content?: string
  read: boolean
  createdAt: Date | string
  tag?: string
  action?: 'view_task' | 'view_settings' | 'view_standards' | 'navigate' | null
  actionPayload?: Record<string, any>
  avatar?: string
  persistent?: boolean
}

const visible = ref(false)
const activeTab = ref('notifications')

// 模块级状态（全局共享）
const notifications = ref<NotificationItem[]>([])
const notifListRef = ref<HTMLElement | null>(null)

const unreadCount = computed(() => notifications.value.filter(n => !n.read).length)

const filteredNotifications = computed(() => {
  return notifications.value.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime()
    const bTime = new Date(b.createdAt).getTime()
    if (a.read !== b.read) return a.read ? 1 : -1
    return bTime - aTime
  })
})

// 公告列表状态
const announcementHistory = ref<SystemAnnouncement[]>([])
const announcementLoading = ref(false)
const announcementPage = ref(1)
const announcementLimit = ref(10)
const announcementTotal = ref(0)
const announcementUnread = computed(() =>
  announcementHistory.value.filter(a => !a.isRead).length
)

// 详情对话框 - 通知
const notifDetailVisible = ref(false)
const currentNotifItem = ref<NotificationItem | null>(null)

// 详情对话框 - 公告
const detailVisible = ref(false)
const detailItem = ref<SystemAnnouncement | null>(null)

// 自动刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null

function open() {
  visible.value = true
  loadNotifications()
  if (activeTab.value === 'announcements') {
    loadAnnouncements()
  }
  startAutoRefresh()
}

function close() {
  visible.value = false
  stopAutoRefresh()
}

function toggle() { visible.value ? close() : open() }

async function loadNotifications() {
  try {
    // TODO: 替换为实际 API 调用
    // const res = await getNotificationsApi()
    // notifications.value = res.data

    notifications.value = [
      {
        id: '1', type: 'task', title: '审查任务完成',
        description: '任务「2024年度报告审查」已完成，发现 3 个问题需要处理',
        read: false, createdAt: new Date(Date.now() - 300000),
        tag: '任务', action: 'view_task', actionPayload: { taskId: 'task_001' },
      },
      {
        id: '2', type: 'warning', title: 'LLM 接口响应慢',
        description: 'OpenAI API 平均响应时间超过 10s，可能影响审查效率',
        content: '建议检查网络连接或切换到备用模型配置',
        read: false, createdAt: new Date(Date.now() - 1800000),
        tag: '警告', action: 'view_settings', actionPayload: { section: 'ai-engine' },
      },
      {
        id: '3', type: 'success', title: '标准库更新',
        description: '新增 5 条企业标准规范，已自动同步到知识库',
        read: true, createdAt: new Date(Date.now() - 3600000),
        tag: '更新', action: 'view_standards',
      },
      {
        id: '4', type: 'info', title: '系统维护通知',
        description: '系统将于今晚 22:00-06:00 进行例行维护升级',
        read: false, createdAt: new Date(Date.now() - 7200000),
        tag: '系统', persistent: true,
      },
      {
        id: '5', type: 'message', title: '协作邀请',
        description: '张三 邀请您加入「Q2合规检查」项目组',
        read: false, createdAt: new Date(Date.now() - 86400000),
        tag: '消息',
      },
    ]
  } catch (error) {
    console.error('加载通知失败:', error)
  }
}

function handleItemClick(item: NotificationItem) {
  markAsRead(item)

  if (item.action) {
    handleAction(item)
  } else if (item.content || item.description.length > 60) {
    showNotificationDetail(item)
  }
}

function handleAction(item: NotificationItem) {
  switch (item.action) {
    case 'view_task':
      if (item.actionPayload?.taskId) {
        router.push(`/review/${item.actionPayload.taskId}`)
        close()
      }
      break
    case 'view_settings':
      router.push('/admin/ai-engine')
      close()
      break
    case 'view_standards':
      router.push('/admin/standards')
      close()
      break
    case 'navigate':
      if (item.actionPayload?.path) {
        router.push(item.actionPayload.path)
        close()
      }
      break
    default:
      showNotificationDetail(item)
  }
}

function showNotificationDetail(item: NotificationItem) {
  currentNotifItem.value = item
  notifDetailVisible.value = true
}

function markAsRead(item: NotificationItem) {
  const target = notifications.value.find(n => n.id === item.id)
  if (target) {
    target.read = true
  }
}

function handleRead(item: NotificationItem) {
  markAsRead(item)
}

function handleMarkAllRead() {
  if (activeTab.value === 'notifications') {
    const unreadCountBefore = unreadCount.value
    notifications.value.forEach(n => n.read = true)
    ElMessage.success(`已将 ${unreadCountBefore} 条通知标记为已读`)
  } else {
    const ids = announcementHistory.value.filter(a => !a.isRead).map(a => a.id)
    if (ids.length > 0) {
      markAllAnnouncementsReadApi({ announcementIds: ids }).then(() => {
        announcementHistory.value.forEach(a => a.isRead = true)
        ElMessage.success(`已将 ${ids.length} 条公告标记为已读`)
      }).catch(() => {
        ElMessage.error('操作失败')
      })
    }
  }
}

function deleteNotification(id: string) {
  const idx = notifications.value.findIndex(n => n.id === id)
  if (idx !== -1) {
    const item = notifications.value[idx]
    if (!item.persistent) {
      notifications.value.splice(idx, 1)
      ElMessage.success('已删除')
    } else {
      ElMessage.warning('该通知为系统重要通知，无法删除')
    }
  }
}

function formatTimeAgo(date: Date | string): string {
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return d.toLocaleDateString('zh-CN')
}

function formatTimeAgoStr(dateStr: string | null): string {
  if (!dateStr) return '刚刚'
  return formatTimeAgo(dateStr)
}

// JS 运行时色值：CSS 中无法用 var()，此处硬编码为 design tokens（variables.css）的等价实际值
// #3A6EA5=--color-primary-500  #F59E0B=--color-warning  #9CA3AF=--color-gray-400
// #10B981=--color-success  #EF4444=--color-danger
const typeConfig = (type: string) => {
  const map: Record<string, { color: string; icon: any }> = {
    task: { color: '#3A6EA5', icon: Tickets },
    warning: { color: '#F59E0B', icon: Warning },
    info: { color: '#9CA3AF', icon: InfoFilled },
    message: { color: '#10B981', icon: ChatDotRound },
    system: { color: '#EF4444', icon: Setting },
    success: { color: '#10B981', icon: Check },
  }
  return map[type] || { color: '#9CA3AF', icon: InfoFilled }
}

const typeColor = (type: string) => typeConfig(type).color
const typeIcon = (type: string) => typeConfig(type).icon

function tagType(tag: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const map: Record<string, '' | 'success' | 'warning' | 'danger' | 'info'> = {
    '任务': '', '警告': 'warning', '更新': 'success', '系统': 'danger', '消息': 'info',
  }
  return map[tag] || 'info'
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    view_task: '查看任务', view_settings: '前往设置',
    view_standards: '查看标准', navigate: '查看详情',
  }
  return map[action] || '查看详情'
}

// ===== 系统公告相关方法 =====

async function loadAnnouncements() {
  announcementLoading.value = true
  try {
    const res = await getAnnouncementHistoryApi({
      page: announcementPage.value,
      limit: announcementLimit.value,
    })
    announcementHistory.value = res.data.items || []
    announcementTotal.value = res.data.total || 0
  } catch (error) {
    console.error('加载公告历史失败:', error)
    ElMessage.error('加载公告失败')
  } finally {
    announcementLoading.value = false
  }
}

function handleTabClick(tab: any) {
  if (tab.props.name === 'announcements') {
    loadAnnouncements()
  }
}

function handlePageChange(page: number) {
  announcementPage.value = page
  loadAnnouncements()
}

function showAnnouncementDetail(item: SystemAnnouncement) {
  detailItem.value = item
  detailVisible.value = true
}

async function handleDetailConfirm() {
  if (detailItem.value) {
    await markAnnouncementReadApi(detailItem.value.id)
    detailItem.value.isRead = true
    const idx = announcementHistory.value.findIndex(a => a.id === detailItem.value!.id)
    if (idx !== -1) {
      announcementHistory.value[idx].isRead = true
    }
    ElMessage.success('已标记为已读')
  }
  detailVisible.value = false
}

async function markAnnouncementRead(id: string) {
  try {
    await markAnnouncementReadApi(id)
    const item = announcementHistory.value.find(a => a.id === id)
    if (item) {
      item.isRead = true
    }
    ElMessage.success('已标记为已读')
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

function urgencyColor(urgency: string): string {
  // JS 运行时色值：等价于令牌 --color-danger / --color-warning / --color-primary-500
  switch (urgency) {
    case 'URGENT': return '#EF4444'
    case 'IMPORTANT': return '#F59E0B'
    default: return '#3A6EA5'
  }
}

function urgencyIcon(urgency: string) {
  switch (urgency) {
    case 'URGENT': return Warning
    case 'IMPORTANT': return Warning
    default: return Document
  }
}

function urgencyTagType(urgency: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (urgency) {
    case 'URGENT': return 'danger'
    case 'IMPORTANT': return 'warning'
    default: return 'info'
  }
}

function urgencyLabel(urgency: string): string {
  switch (urgency) {
    case 'URGENT': return '紧急'
    case 'IMPORTANT': return '重要'
    default: return '普通'
  }
}

function truncateContent(content: string): string {
  if (!content) return ''
  const plainText = content.replace(/[#*`\[\]()]/g, '').trim()
  return plainText.length > 80 ? plainText.substring(0, 80) + '...' : plainText
}

function renderedContent(content: string): string {
  return renderMarkdown(content)
}

// 自动刷新（每 60 秒）
function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(() => {
    if (visible.value) {
      loadNotifications()
    }
  }, 60000)
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

onUnmounted(() => {
  stopAutoRefresh()
})

defineExpose({
  open,
  close,
  toggle,
  notificationUnreadCount: unreadCount,
  announcementUnread,
  loadNotifications,
})
</script>

<style scoped>
.notification-center {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
  padding: 56px 16px 16px;
}

.notification-panel {
  width: 420px;
  max-height: calc(100vh - 72px);
  background: var(--bg-surface);
  border-radius: 16px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.15),
    0 0 1px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--color-gray-100);
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
  letter-spacing: -0.01em;
}

.header-actions {
  display: flex;
  gap: 2px;
  align-items: center;
}

.nc-tabs {
  padding: 0 16px;
}

.nc-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.nc-tabs :deep(.el-tabs__item) {
  font-size: 13px;
  font-weight: 500;
}

.notification-list,
.announcement-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--corp-border-light) transparent;
}

.notification-list::-webkit-scrollbar,
.announcement-list::-webkit-scrollbar {
  width: 5px;
}

.notification-list::-webkit-scrollbar-thumb,
.announcement-list::-webkit-scrollbar-thumb {
  background: var(--corp-border-light);
  border-radius: 3px;
}

/* 通知项 */
.notification-item,
.announcement-item {
  display: flex;
  align-items: flex-start;
  padding: 14px 18px;
  gap: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
  border-left: 3px solid transparent;
}

.notification-item:hover,
.announcement-item:hover {
  background: var(--bg-surface-hover);
  border-left-color: var(--corp-border);
}

.notification-item.unread,
.announcement-item.unread {
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--bg-surface) 100%);
  border-left-color: var(--color-primary-500);
}

.notification-item.unread:hover,
.announcement-item.unread:hover {
  background: linear-gradient(135deg, var(--color-primary-100) 0%, var(--bg-surface) 100%);
}

.item-indicator {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.indicator-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary-500);
  box-shadow: 0 0 0 2px var(--bg-surface);
  z-index: 1;
}

.indicator-dot.pulse {
  animation: nc-pulse 2s ease-in-out infinite;
}

.indicator-dot.urgent-dot {
  background: var(--color-danger);
}

@keyframes nc-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

.item-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.item-body {
  flex: 1;
  min-width: 0;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.item-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--corp-text-primary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-desc {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--color-gray-500);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.item-time {
  font-size: 11.5px;
  color: var(--color-gray-400);
  white-space: nowrap;
}

.item-action-hint {
  font-size: 11.5px;
  color: var(--color-primary-500);
  font-weight: 500;
  white-space: nowrap;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.item-delete-btn,
.item-read-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.notification-item:hover .item-delete-btn,
.announcement-item:hover .item-read-btn {
  opacity: 1;
}

/* 空状态 */
.empty-state {
  padding: 48px 20px;
  text-align: center;
}

.empty-illustration {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--bg-surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-gray-500);
}

.empty-subtext {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-gray-400);
}

.loading-state {
  padding: 48px 20px;
  text-align: center;
  color: var(--color-gray-400);
}

.loading-state p {
  margin-top: 12px;
  font-size: 13px;
}

.pagination-wrap {
  padding: 12px 18px;
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--color-gray-100);
}

/* 详情对话框 */
.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-time {
  font-size: 12px;
  color: var(--color-gray-400);
}

.notif-detail-content .detail-desc {
  font-size: 14px;
  color: var(--color-gray-700);
  line-height: 1.65;
  margin: 0 0 16px;
}

.detail-extra h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-gray-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-extra p {
  margin: 0;
  font-size: 14px;
  color: var(--color-gray-600);
  line-height: 1.6;
  background: var(--bg-surface-hover);
  padding: 12px 16px;
  border-radius: 8px;
}

.announce-content {
  max-height: 50vh;
  overflow-y: auto;
}

/* Markdown 渲染样式 */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 18px;
  margin-bottom: 10px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.markdown-body :deep(p) {
  margin-bottom: 12px;
  line-height: 1.7;
  color: var(--color-gray-700);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 22px;
  margin-bottom: 14px;
}

.markdown-body :deep(li) {
  margin-bottom: 4px;
  line-height: 1.6;
}

.markdown-body :deep(blockquote) {
  margin: 14px 0;
  padding: 10px 18px;
  border-left: 4px solid var(--color-primary-500);
  background: var(--bg-body);
  border-radius: 0 8px 8px 0;
  color: var(--color-gray-600);
}

.markdown-body :deep(code) {
  background: var(--color-gray-100);
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.88em;
  font-family: 'SF Mono', Consolas, monospace;
}

.markdown-body :deep(pre) {
  background: var(--color-gray-800);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  color: var(--color-gray-200);
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

/* 动画 */
.nc-fade-enter-active,
.nc-fade-leave-active {
  transition: opacity 0.2s ease;
}
.nc-fade-enter-from,
.nc-fade-leave-to {
  opacity: 0;
}

.nc-slide-enter-active {
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.nc-slide-leave-active {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.nc-slide-enter-from {
  transform: translateX(100%);
}
.nc-slide-leave-to {
  transform: translateX(100%);
}

.nc-list-enter-active {
  transition: all 0.25s ease-out;
}
.nc-list-leave-active {
  transition: all 0.2s ease-in;
}
.nc-list-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.nc-list-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
.nc-list-move {
  transition: transform 0.25s ease;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .notification-center {
    padding: 0;
    align-items: flex-end;
  }

  .notification-panel {
    width: 100%;
    max-height: 75vh;
    border-radius: 20px 20px 0 0;
  }

  .panel-header {
    padding: 16px 18px 10px;
  }

  .notification-item,
  .announcement-item {
    padding: 12px 16px;
    gap: 10px;
  }

  .item-icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }

  .item-title {
    font-size: 13px;
  }

  .item-desc {
    font-size: 12px;
    -webkit-line-clamp: 1;
  }

  .item-delete-btn,
  .item-read-btn {
    opacity: 1;
  }

  .empty-state {
    padding: 32px 16px;
  }
}

@media (max-width: 400px) {
  .notification-panel {
    max-height: 80vh;
  }

  .item-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .item-action-hint {
    display: none;
  }
}

/* 深色模式支持（预留） */
@media (prefers-color-scheme: dark) {
  /* 可后续扩展深色模式 */
}
</style>