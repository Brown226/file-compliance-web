<template>
  <Teleport to="body">
    <div v-if="visible" class="notification-center" @click.self="close">
      <div class="notification-panel">
        <div class="panel-header">
          <h3>通知中心</h3>
          <div class="header-actions">
            <el-button size="small" link type="primary" @click="handleMarkAllRead">全部已读</el-button>
            <el-button size="small" text @click="close"><el-icon><Close /></el-icon></el-button>
          </div>
        </div>

        <el-tabs v-model="activeTab" @tab-click="handleTabClick">
          <el-tab-pane :label="`通知 (${notificationTotal})`" name="notifications" />
          <el-tab-pane :label="`公告 (${announcementUnread})`" name="announcements" />
        </el-tabs>

        <!-- 通知列表 Tab -->
        <div v-if="activeTab === 'notifications'" class="notification-list">
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

        <!-- 系统公告 Tab -->
        <div v-else class="announcement-list">
          <div v-if="announcementLoading" class="loading-state">
            <el-icon :size="32" class="is-loading"><Loading /></el-icon>
            <p>加载中...</p>
          </div>

          <div v-else-if="announcementHistory.length === 0" class="empty-state">
            <el-icon :size="48" color="#d1d5db"><Bell /></el-icon>
            <p>暂无公告</p>
          </div>

          <div
            v-for="item in announcementHistory"
            :key="item.id"
            class="announcement-item"
            :class="{ unread: !item.isRead }"
            @click="showAnnouncementDetail(item)"
          >
            <div class="item-dot" v-if="!item.isRead"></div>
            <div class="item-icon" :style="{ background: urgencyColor(item.urgency) }">
              <el-icon :size="16"><component :is="urgencyIcon(item.urgency)" /></el-icon>
            </div>
            <div class="item-body">
              <div class="item-header">
                <el-tag
                  :type="urgencyTagType(item.urgency)"
                  effect="light"
                  size="small"
                >
                  {{ urgencyLabel(item.urgency) }}
                </el-tag>
                <span class="item-time">{{ formatTimeAgoStr(item.publishAt) }}</span>
              </div>
              <div class="item-title">{{ item.title }}</div>
              <div class="item-desc">{{ truncateContent(item.content) }}</div>
            </div>
            <el-button
              v-if="!item.isRead"
              size="small"
              link
              type="primary"
              @click.stop="markAnnouncementRead(item.id)"
            >
              标记已读
            </el-button>
          </div>

          <!-- 分页 -->
          <div v-if="announcementTotal > announcementLimit" class="pagination-wrap">
            <el-pagination
              size="small"
              :current-page="announcementPage"
              :page-size="announcementLimit"
              :total="announcementTotal"
              layout="prev, pager, next"
              @current-change="handlePageChange"
            />
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 公告详情对话框 -->
  <el-dialog
    v-model="detailVisible"
    :title="detailItem?.title || '公告详情'"
    width="700px"
    destroy-on-close
  >
    <template #header>
      <div class="detail-header">
        <el-tag
          v-if="detailItem"
          :type="urgencyTagType(detailItem.urgency)"
          effect="light"
          size="small"
        >
          {{ urgencyLabel(detailItem.urgency) }}
        </el-tag>
        <span class="detail-time">{{ formatTimeAgoStr(detailItem?.publishAt) }}</span>
      </div>
    </template>

    <div class="markdown-body" v-if="detailItem" v-html="renderedContent(detailItem.content)"></div>

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button v-if="detailItem && !detailItem.isRead" type="primary" @click="handleDetailConfirm">
        我已阅读
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Bell, Close, Delete, Check, Warning, InfoFilled, ChatDotRound, Loading, Document } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { SystemAnnouncement } from '@/types/models'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  getAnnouncementHistoryApi,
  markAnnouncementReadApi,
  markAllAnnouncementsReadApi,
} from '@/api/announcement'

const { renderMarkdown } = useMarkdown()

interface NotificationItem {
  id: string
  type: 'task' | 'warning' | 'info' | 'message'
  title: string
  description: string
  read: boolean
  createdAt: Date
}

const visible = ref(false)
const activeTab = ref('notifications')

// 通知列表（模拟数据，后续可接 API）
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
])

const notificationTotal = computed(() => notifications.value.length)
const notificationUnreadCount = computed(() => notifications.value.filter(n => !n.read).length)

const filteredNotifications = computed(() => {
  return notifications.value
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

// 详情对话框
const detailVisible = ref(false)
const detailItem = ref<SystemAnnouncement | null>(null)

function open() {
  visible.value = true
  if (activeTab.value === 'announcements') {
    loadAnnouncements()
  }
}
function close() { visible.value = false }
function toggle() { visible.value = !visible.value }

function handleRead(item: NotificationItem) {
  item.read = true
}

function handleMarkAllRead() {
  if (activeTab.value === 'notifications') {
    notifications.value.forEach(n => n.read = true)
    ElMessage.success('已全部标记为已读')
  } else {
    // 公告批量标记已读
    const ids = announcementHistory.value.filter(a => !a.isRead).map(a => a.id)
    if (ids.length > 0) {
      markAllAnnouncementsReadApi({ announcementIds: ids }).then(() => {
        announcementHistory.value.forEach(a => a.isRead = true)
        ElMessage.success('已全部标记为已读')
      }).catch(() => {
        ElMessage.error('操作失败')
      })
    }
  }
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

function formatTimeAgoStr(dateStr: string | null): string {
  if (!dateStr) return '刚刚'
  const date = new Date(dateStr)
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

// ===== 系统公告相关方法 =====

/**
 * 加载公告历史
 */
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

/**
 * Tab 切换时加载数据
 */
function handleTabClick(tab: any) {
  if (tab.props.name === 'announcements') {
    loadAnnouncements()
  }
}

/**
 * 分页切换
 */
function handlePageChange(page: number) {
  announcementPage.value = page
  loadAnnouncements()
}

/**
 * 显示公告详情
 */
function showAnnouncementDetail(item: SystemAnnouncement) {
  detailItem.value = item
  detailVisible.value = true
}

/**
 * 详情对话框确认
 */
async function handleDetailConfirm() {
  if (detailItem.value) {
    await markAnnouncementReadApi(detailItem.value.id)
    detailItem.value.isRead = true
    // 同步更新列表
    const idx = announcementHistory.value.findIndex(a => a.id === detailItem.value!.id)
    if (idx !== -1) {
      announcementHistory.value[idx].isRead = true
    }
    ElMessage.success('已标记为已读')
  }
  detailVisible.value = false
}

/**
 * 标记单条公告为已读
 */
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

/**
 * 紧急程度对应的颜色
 */
function urgencyColor(urgency: string): string {
  switch (urgency) {
    case 'URGENT': return '#f56c6c'
    case 'IMPORTANT': return '#e6a23c'
    default: return '#409eff'
  }
}

/**
 * 紧急程度对应的图标
 */
function urgencyIcon(urgency: string) {
  switch (urgency) {
    case 'URGENT': return Warning
    case 'IMPORTANT': return Warning
    default: return Document
  }
}

/**
 * 紧急程度对应的 Tag 类型
 */
function urgencyTagType(urgency: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (urgency) {
    case 'URGENT': return 'danger'
    case 'IMPORTANT': return 'warning'
    default: return 'info'
  }
}

/**
 * 紧急程度对应的中文标签
 */
function urgencyLabel(urgency: string): string {
  switch (urgency) {
    case 'URGENT': return '紧急'
    case 'IMPORTANT': return '重要'
    default: return '普通'
  }
}

/**
 * 截断内容用于预览
 */
function truncateContent(content: string): string {
  if (!content) return ''
  const plainText = content.replace(/[#*`\[\]()]/g, '').trim()
  return plainText.length > 80 ? plainText.substring(0, 80) + '...' : plainText
}

/**
 * 渲染 Markdown 内容
 */
function renderedContent(content: string): string {
  return renderMarkdown(content)
}

defineExpose({ open, close, toggle, notificationUnreadCount, announcementUnread })
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
  width: 420px;
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

.notification-list,
.announcement-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.notification-item,
.announcement-item {
  display: flex;
  align-items: flex-start;
  padding: 12px 20px;
  gap: 12px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
}

.notification-item:hover,
.announcement-item:hover {
  background: #f9fafb;
}

.notification-item.unread,
.announcement-item.unread {
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

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
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
}

.empty-state,
.loading-state {
  padding: 40px 16px;
  text-align: center;
  color: #9ca3af;
}

.empty-state p,
.loading-state p {
  margin-top: 12px;
  font-size: 14px;
}

.pagination-wrap {
  padding: 12px 20px;
  display: flex;
  justify-content: center;
  border-top: 1px solid #f0f0f0;
}

/* 详情对话框 */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-time {
  font-size: 12px;
  color: #909399;
}

/* Markdown 渲染样式 */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
}

.markdown-body :deep(p) {
  margin-bottom: 12px;
  line-height: 1.6;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.markdown-body :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 4px solid #409eff;
  background: #f5f7fa;
  color: #606266;
}

.markdown-body :deep(code) {
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
</style>
