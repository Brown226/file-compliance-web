<template>
  <div class="my-feedbacks-container">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <h3>我的反馈</h3>
          <el-button type="primary" @click="$router.push('/feedback/submit')">
            <el-icon><Plus /></el-icon>
            提交新反馈
          </el-button>
        </div>
      </template>

      <!-- 统计卡片 -->
      <el-row :gutter="16" class="stats-row">
        <el-col :span="6" v-for="stat in feedbackStats" :key="stat.status">
          <el-card shadow="hover" class="stat-card" :class="`stat-${stat.status.toLowerCase()}`">
            <div class="stat-content">
              <div class="stat-value">{{ stat.count }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 筛选 -->
      <div class="filter-section">
        <el-radio-group v-model="statusFilter" @change="loadFeedbacks">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="PENDING">待处理</el-radio-button>
          <el-radio-button value="IN_PROGRESS">处理中</el-radio-button>
          <el-radio-button value="RESOLVED">已解决</el-radio-button>
          <el-radio-button value="CLOSED">已关闭</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 反馈列表 -->
      <el-table
        :data="feedbacks"
        v-loading="loading"
        stripe
        style="width: 100%"
        @row-click="handleRowClick"
      >
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <div class="title-cell">
              <span class="title-text">{{ row.title }}</span>
              <el-tag :type="getCategoryTagType(row.category)" size="small">
                {{ getCategoryLabel(row.category) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="createdAt" label="提交时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column prop="resolvedAt" label="处理时间" width="180">
          <template #default="{ row }">
            <span v-if="row.resolvedAt">{{ formatDate(row.resolvedAt) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="viewDetail(row.id)">
              查看
            </el-button>
            <el-button link type="warning" @click.stop="handleUpdateStatus(row)">
              更新状态
            </el-button>
            <el-button link type="danger" @click.stop="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadFeedbacks"
          @current-change="loadFeedbacks"
        />
      </div>
    </el-card>

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
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getMyFeedbacksApi, deleteFeedbackApi, updateFeedbackStatusApi } from '@/api/feedback'
import type { Feedback, FeedbackStatus, FeedbackCategory } from '@/types/models'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const feedbacks = ref<Feedback[]>([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const statusFilter = ref('')

// 状态更新对话框
const statusDialogVisible = ref(false)
const statusUpdating = ref(false)
const statusForm = ref({
  id: '',
  status: '' as FeedbackStatus,
  remark: '',
})

// 统计数据
const feedbackStats = computed(() => [
  { status: 'PENDING', label: '待处理', count: feedbacks.value.filter(f => f.status === 'PENDING').length },
  { status: 'IN_PROGRESS', label: '处理中', count: feedbacks.value.filter(f => f.status === 'IN_PROGRESS').length },
  { status: 'RESOLVED', label: '已解决', count: feedbacks.value.filter(f => f.status === 'RESOLVED').length },
  { status: 'CLOSED', label: '已关闭', count: feedbacks.value.filter(f => f.status === 'CLOSED').length },
])

// 加载反馈列表
const loadFeedbacks = async () => {
  loading.value = true
  try {
    const params: any = {
      page: currentPage.value,
      limit: pageSize.value,
    }
    if (statusFilter.value) {
      params.status = statusFilter.value
    }

    const res = await getMyFeedbacksApi(params)
    feedbacks.value = res.data.items || res.data.data || []
    total.value = res.data.total || 0
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '加载反馈列表失败')
  } finally {
    loading.value = false
  }
}

// 查看详情
const viewDetail = (id: string) => {
  router.push(`/feedback/${id}`)
}

// 行点击
const handleRowClick = (row: Feedback) => {
  viewDetail(row.id)
}

// 更新状态
const handleUpdateStatus = (row: Feedback) => {
  statusForm.value = {
    id: row.id,
    status: row.status,
    remark: row.remark || '',
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
    loadFeedbacks()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '更新失败')
  } finally {
    statusUpdating.value = false
  }
}

// 删除反馈
const handleDelete = async (row: Feedback) => {
  try {
    await ElMessageBox.confirm('确定要删除这条反馈吗？此操作不可恢复。', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await deleteFeedbackApi(row.id)
    ElMessage.success('删除成功')
    loadFeedbacks()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败')
    }
  }
}

// 格式化日期
const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
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
  loadFeedbacks()
})
</script>

<style scoped>
.my-feedbacks-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  border-radius: 8px;
}

.stat-content {
  text-align: center;
  padding: 10px 0;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}

.stat-pending .stat-value {
  color: #e6a23c;
}

.stat-in-progress .stat-value {
  color: #409eff;
}

.stat-resolved .stat-value {
  color: #67c23a;
}

.stat-closed .stat-value {
  color: #909399;
}

.filter-section {
  margin-bottom: 20px;
}

.title-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-muted {
  color: #c0c4cc;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
