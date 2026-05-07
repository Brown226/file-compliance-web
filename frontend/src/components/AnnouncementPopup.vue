<template>
  <Teleport to="body">
    <!-- 紧急公告强制确认弹窗 -->
    <div v-if="showUrgentDialog && currentUrgentIndex < urgentList.length" class="urgent-dialog-overlay" @click.self="preventClose">
      <div class="urgent-dialog">
        <div class="urgent-header">
          <el-icon :size="24" color="#f56c6c"><WarningFilled /></el-icon>
          <h2>紧急通知</h2>
          <el-tag type="danger" effect="dark" size="large">紧急</el-tag>
        </div>

        <div class="urgent-content">
          <h3>{{ currentUrgent?.title }}</h3>
          <div class="markdown-body" v-html="renderedContent(currentUrgent?.content || '')"></div>
        </div>

        <div class="urgent-footer">
          <el-button
            type="danger"
            size="large"
            :loading="confirmLoading"
            @click="handleConfirmUrgent"
          >
            我已阅读并确认
          </el-button>
        </div>

        <div class="urgent-progress">
          <span>{{ currentUrgentIndex + 1 }} / {{ urgentList.length }}</span>
        </div>
      </div>
    </div>

    <!-- 普通/重要公告面板（右下角） -->
    <Transition name="slide-up">
      <div v-if="showNormalPanel && normalList.length > 0" class="announcement-panel">
        <div class="panel-header">
          <h3><el-icon><Bell /></el-icon> 系统公告</h3>
          <div class="header-actions">
            <el-button size="small" link type="primary" @click="handleMarkAllRead">
              全部已读
            </el-button>
            <el-button size="small" text @click="closePanel">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>

        <div class="panel-body">
          <div
            v-for="item in normalList"
            :key="item.id"
            class="announcement-item"
            :class="{ urgent: item.urgency === 'URGENT' }"
          >
            <div class="item-header">
              <el-tag
                :type="urgencyType(item.urgency)"
                effect="light"
                size="small"
              >
                {{ urgencyLabel(item.urgency) }}
              </el-tag>
              <span class="item-time">{{ formatTimeAgo(item.publishAt) }}</span>
            </div>

            <h4 class="item-title">{{ item.title }}</h4>

            <div class="item-preview" v-html="renderedContent(truncateContent(item.content))"></div>

            <div class="item-actions">
              <el-button size="small" link type="primary" @click="showDetail(item)">
                查看详情
              </el-button>
              <el-button size="small" link @click="markItemRead(item.id)">
                关闭
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

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
            :type="urgencyType(detailItem.urgency)"
            effect="light"
            size="small"
          >
            {{ urgencyLabel(detailItem.urgency) }}
          </el-tag>
          <span class="detail-title">{{ detailItem?.title }}</span>
        </div>
      </template>

      <div class="markdown-body" v-if="detailItem" v-html="renderedContent(detailItem.content)"></div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleDetailConfirm">
          我已阅读
        </el-button>
      </template>
    </el-dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Bell, Close, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { SystemAnnouncement } from '@/types/models'
import { useMarkdown } from '@/composables/useMarkdown'
import { useAnnouncements } from '@/composables/useAnnouncements'

const { renderMarkdown } = useMarkdown()
const {
  unreadAnnouncements,
  urgentAnnouncements,
  markRead,
  markAllRead,
  closePopup,
} = useAnnouncements()

// 紧急公告状态
const showUrgentDialog = ref(false)
const currentUrgentIndex = ref(0)
const confirmLoading = ref(false)

// 普通公告面板状态
const showNormalPanel = ref(false)

// 详情对话框状态
const detailVisible = ref(false)
const detailItem = ref<SystemAnnouncement | null>(null)

// 监听紧急公告变化，自动显示弹窗
watch(urgentAnnouncements, (val) => {
  if (val.length > 0) {
    currentUrgentIndex.value = 0
    showUrgentDialog.value = true
    showNormalPanel.value = false
  }
}, { immediate: true })

// 监听普通公告变化，紧急公告处理完后显示面板
watch(unreadAnnouncements, (val) => {
  if (val.length > 0 && urgentAnnouncements.value.length === 0 && !showUrgentDialog.value) {
    showNormalPanel.value = true
  }
}, { immediate: true })

// 组件挂载时检查是否已有数据
onMounted(() => {
  if (urgentAnnouncements.value.length > 0) {
    showUrgentDialog.value = true
  } else if (unreadAnnouncements.value.length > 0) {
    showNormalPanel.value = true
  }
})

// 计算属性
const urgentList = computed(() => urgentAnnouncements.value)
const currentUrgent = computed(() => {
  if (currentUrgentIndex.value < urgentList.value.length) {
    return urgentList.value[currentUrgentIndex.value]
  }
  return null
})

const normalList = computed(() => {
  return unreadAnnouncements.value.filter(a => a.urgency !== 'URGENT')
})

/**
 * 渲染 Markdown 内容
 */
function renderedContent(content: string): string {
  return renderMarkdown(content)
}

/**
 * 截断内容用于预览
 */
function truncateContent(content: string): string {
  if (!content) return ''
  const plainText = content.replace(/[#*`\[\]()]/g, '').trim()
  return plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText
}

/**
 * 紧急程度对应的 UI 类型
 */
function urgencyType(urgency: string): 'info' | 'warning' | 'danger' {
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
 * 格式化时间为相对时间
 */
function formatTimeAgo(dateStr: string | null): string {
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

/**
 * 显示公告详情
 */
function showDetail(item: SystemAnnouncement) {
  detailItem.value = item
  detailVisible.value = true
}

/**
 * 详情对话框确认
 */
async function handleDetailConfirm() {
  if (detailItem.value) {
    await markRead(detailItem.value.id)
  }
  detailVisible.value = false
}

/**
 * 处理紧急公告确认
 */
async function handleConfirmUrgent() {
  if (!currentUrgent.value) return

  confirmLoading.value = true
  try {
    await markRead(currentUrgent.value.id, true)

    // 显示下一条紧急公告
    currentUrgentIndex.value++

    if (currentUrgentIndex.value >= urgentList.value.length) {
      // 所有紧急公告已处理完
      showUrgentDialog.value = false

      // 如果还有普通公告，显示面板
      if (normalList.value.length > 0) {
        showNormalPanel.value = true
      } else {
        closePopup()
      }
    }

    ElMessage.success('已确认')
  } catch (error) {
    ElMessage.error('操作失败，请重试')
  } finally {
    confirmLoading.value = false
  }
}

/**
 * 标记单条公告为已读
 */
async function markItemRead(id: string) {
  await markRead(id)
}

/**
 * 全部标记为已读
 */
async function handleMarkAllRead() {
  const ids = [...urgentList.value, ...normalList.value].map(a => a.id)
  if (ids.length > 0) {
    await markAllRead(ids)
    showNormalPanel.value = false
    showUrgentDialog.value = false
  }
}

/**
 * 关闭面板
 */
function closePanel() {
  showNormalPanel.value = false
}

/**
 * 阻止关闭（用于紧急公告弹窗的遮罩层点击）
 */
function preventClose() {
  // 紧急公告不允许点击遮罩层关闭
}

// 暴露方法供外部调用
defineExpose({
  showUrgentDialog,
  showNormalPanel,
})
</script>

<style scoped>
/* 紧急公告弹窗 */
.urgent-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

.urgent-dialog {
  width: 700px;
  max-height: 80vh;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.urgent-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 32px 16px;
  border-bottom: 1px solid #ebeef5;
}

.urgent-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #f56c6c;
  flex: 1;
}

.urgent-content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
}

.urgent-content h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #303133;
}

.urgent-footer {
  padding: 16px 32px;
  border-top: 1px solid #ebeef5;
  display: flex;
  justify-content: center;
}

.urgent-progress {
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: #909399;
  background: #f5f7fa;
}

/* 普通公告面板 */
.announcement-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  width: 400px;
  max-height: 600px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.announcement-item {
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.2s;
}

.announcement-item:hover {
  background: #f9fafb;
}

.announcement-item.urgent {
  background: #fef2f2;
  border-left: 3px solid #f56c6c;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.item-time {
  font-size: 12px;
  color: #909399;
}

.item-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.item-preview {
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
  margin-bottom: 12px;
  max-height: 60px;
  overflow: hidden;
}

.item-preview :deep(p) {
  margin: 0 0 4px;
}

.item-actions {
  display: flex;
  gap: 8px;
}

/* 详情对话框 */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
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

/* 动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
