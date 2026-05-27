<template>
  <div class="feedback-detail-container" v-loading="loading">
    <template v-if="feedback">
      <el-card shadow="never" class="detail-card">
        <template #header>
          <div class="card-header">
            <div class="header-left">
              <el-button link @click="$router.back()">
                <el-icon><ArrowLeft /></el-icon>
                返回
              </el-button>
              <h3>{{ feedback.title }}</h3>
            </div>
            <div class="header-right">
              <el-tag :type="getStatusTagType(feedback.status)" size="large">
                {{ getStatusLabel(feedback.status) }}
              </el-tag>
              <el-tag :type="getCategoryTagType(feedback.category)" size="large" style="margin-left: 8px;">
                {{ getCategoryLabel(feedback.category) }}
              </el-tag>
              <el-button v-if="isAdmin" type="primary" size="large" @click="handleUpdateStatus" style="margin-left: 16px;">
                更新状态
              </el-button>
            </div>
          </div>
        </template>

        <el-descriptions :column="2" border class="feedback-meta">
          <el-descriptions-item label="提交人">
            {{ feedback.user?.name || feedback.user?.username || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ formatDate(feedback.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="处理人" v-if="feedback.resolvedBy">
            {{ feedback.resolvedBy.name || feedback.resolvedBy.username }}
          </el-descriptions-item>
          <el-descriptions-item label="处理时间" v-if="feedback.resolvedAt">
            {{ formatDate(feedback.resolvedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <!-- 反馈内容 -->
        <div class="content-section">
          <h4>反馈内容</h4>
          <div class="content-text">{{ feedback.content }}</div>
        </div>

        <!-- 附件列表 -->
        <div class="attachments-section" v-if="feedback.attachmentPaths && feedback.attachmentPaths.length > 0">
          <h4>附件 ({{ feedback.attachmentPaths.length }})</h4>
          <div class="attachment-list">
            <el-card
              v-for="attachment in feedback.attachmentPaths"
              :key="attachment.id"
              shadow="hover"
              class="attachment-item"
            >
              <div class="attachment-info">
                <el-icon class="attachment-icon"><Document /></el-icon>
                <div class="attachment-text">
                  <div class="attachment-name">{{ attachment.fileName }}</div>
                  <div class="attachment-size">{{ formatFileSize(attachment.fileSize) }}</div>
                </div>
              </div>
              <el-button
                type="primary"
                link
                @click="downloadAttachment(attachment.id)"
              >
                下载
              </el-button>
            </el-card>
          </div>
        </div>

        <!-- 处理备注 -->
        <div class="remark-section" v-if="feedback.remark">
          <h4>处理备注</h4>
          <el-alert
            :title="feedback.remark"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
      </el-card>
    </template>

    <el-empty v-else-if="!loading" description="反馈不存在或已被删除" />

    <!-- 状态更新对话框 -->
    <el-dialog
      v-model="statusDialogVisible"
      title="更新反馈状态"
      width="500px"
    >
      <el-form :model="statusForm" label-width="100px">
        <el-form-item label="当前状态">
          <el-tag :type="getStatusTagType(statusForm.status)">
            {{ getStatusLabel(statusForm.status) }}
          </el-tag>
        </el-form-item>
        <el-form-item label="新状态" required>
          <el-select v-model="statusForm.status" placeholder="请选择新状态" style="width: 100%">
            <el-option label="待处理" value="PENDING" />
            <el-option label="处理中" value="IN_PROGRESS" />
            <el-option label="已解决" value="RESOLVED" />
            <el-option label="已关闭" value="CLOSED" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理备注">
          <el-input
            v-model="statusForm.remark"
            type="textarea"
            :rows="4"
            placeholder="可选：添加处理备注信息"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitStatusUpdate" :loading="statusUpdating">
          确认更新
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Document } from '@element-plus/icons-vue'
import { getFeedbackDetailApi, downloadAttachmentApi, updateFeedbackStatusApi } from '@/api/feedback'
import { useUserStore } from '@/stores/user'
import type { Feedback, FeedbackStatus, FeedbackCategory } from '@/types/models'

const route = useRoute()
const userStore = useUserStore()
const isAdmin = userStore.isAdmin()
const loading = ref(false)
const feedback = ref<Feedback | null>(null)

// 状态更新对话框
const statusDialogVisible = ref(false)
const statusUpdating = ref(false)
const statusForm = ref({
  id: '',
  status: '' as FeedbackStatus,
  remark: '',
})

// 加载反馈详情
const loadFeedbackDetail = async () => {
  const id = route.params.id as string
  if (!id) return

  loading.value = true
  try {
    const res = await getFeedbackDetailApi(id)
    feedback.value = res.data
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '加载反馈详情失败')
  } finally {
    loading.value = false
  }
}

// 更新状态
const handleUpdateStatus = () => {
  if (!feedback.value) return
  statusForm.value = {
    id: feedback.value.id,
    status: feedback.value.status,
    remark: feedback.value.remark || '',
  }
  statusDialogVisible.value = true
}

// 提交状态更新
const submitStatusUpdate = async () => {
  if (!statusForm.value.id || !statusForm.value.status) {
    ElMessage.warning('请选择处理状态')
    return
  }

  statusUpdating.value = true
  try {
    await updateFeedbackStatusApi(statusForm.value.id, {
      status: statusForm.value.status,
      remark: statusForm.value.remark,
    })
    ElMessage.success('状态更新成功')
    statusDialogVisible.value = false
    loadFeedbackDetail()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '更新失败')
  } finally {
    statusUpdating.value = false
  }
}

// 下载附件
const downloadAttachment = async (fileId: string) => {
  try {
    const res = await downloadAttachmentApi(fileId)
    // 创建下载链接
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    
    // 从响应头获取文件名
    const contentDisposition = res.headers['content-disposition']
    let fileName = 'attachment'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match && match[1]) {
        fileName = decodeURIComponent(match[1].replace(/['"]/g, ''))
      }
    }
    
    link.setAttribute('download', fileName)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('下载成功')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '下载失败')
  }
}

// 格式化日期
const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

// 获取状态标签类型
const getStatusTagType = (status: FeedbackStatus) => {
  const map: Record<FeedbackStatus, any> = {
    PENDING: 'warning',
    IN_PROGRESS: '',
    RESOLVED: 'success',
    CLOSED: 'info',
  }
  return map[status] || 'info'
}

// 获取状态标签
const getStatusLabel = (status: FeedbackStatus) => {
  const map: Record<FeedbackStatus, string> = {
    PENDING: '待处理',
    IN_PROGRESS: '处理中',
    RESOLVED: '已解决',
    CLOSED: '已关闭',
  }
  return map[status] || status
}

// 获取类别标签类型
const getCategoryTagType = (category: FeedbackCategory) => {
  const map: Record<FeedbackCategory, any> = {
    BUG_REPORT: 'danger',
    SUGGESTION: 'success',
    FEATURE_REQUEST: 'warning',
    OTHER: 'info',
  }
  return map[category] || 'info'
}

// 获取类别标签
const getCategoryLabel = (category: FeedbackCategory) => {
  const map: Record<FeedbackCategory, string> = {
    BUG_REPORT: 'Bug报告',
    SUGGESTION: '建议',
    FEATURE_REQUEST: '功能请求',
    OTHER: '其他',
  }
  return map[category] || category
}

onMounted(() => {
  loadFeedbackDetail()
})
</script>

<style scoped>
.feedback-detail-container {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
}

.detail-card {
  border-radius: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.feedback-meta {
  margin-top: 16px;
}

.content-section,
.attachments-section,
.remark-section {
  margin-top: 24px;
}

.content-section h4,
.attachments-section h4,
.remark-section h4 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.content-text {
  padding: 16px;
  background: #f5f7fa;
  border-radius: 4px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.attachment-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.attachment-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.attachment-icon {
  font-size: 24px;
  color: #409eff;
}

.attachment-name {
  font-weight: 500;
  color: #303133;
}

.attachment-size {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
