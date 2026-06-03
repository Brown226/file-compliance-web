<template>
  <div class="feedback-management">
    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="6" v-for="stat in statsCards" :key="stat.key">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-value" :style="{ color: stat.color }">{{ stat.count }}</div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 筛选工具栏 -->
    <div class="filter-toolbar">
      <div class="filter-left">
        <el-select v-model="statusFilter" placeholder="处理状态" clearable style="width: 150px" @change="handleFilterChange">
          <el-option label="全部状态" value="" />
          <el-option label="待处理" value="PENDING" />
          <el-option label="处理中" value="IN_PROGRESS" />
          <el-option label="已解决" value="RESOLVED" />
          <el-option label="已关闭" value="CLOSED" />
        </el-select>

        <el-select v-model="categoryFilter" placeholder="反馈类别" clearable style="width: 150px" @change="handleFilterChange">
          <el-option label="全部类别" value="" />
          <el-option label="Bug报告" value="BUG_REPORT" />
          <el-option label="建议" value="SUGGESTION" />
          <el-option label="功能请求" value="FEATURE_REQUEST" />
          <el-option label="其他" value="OTHER" />
        </el-select>

        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 240px"
          @change="handleFilterChange"
        />
      </div>

      <div class="filter-right">
        <el-input
          v-model="keywordFilter"
          placeholder="搜索标题或内容..."
          prefix-icon="Search"
          clearable
          style="width: 240px"
          @input="debounceSearch"
        />

        <el-button @click="loadFeedbacks">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>

        <el-button
          type="danger"
          :disabled="selectedIds.length === 0"
          @click="handleBatchDelete"
        >
          <el-icon><Delete /></el-icon>
          批量删除
        </el-button>

        <el-dropdown @command="handleBatchStatusChange" :disabled="selectedIds.length === 0">
          <el-button type="warning" :disabled="selectedIds.length === 0">
            <el-icon><Edit /></el-icon>
            批量更新状态
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="PENDING">标记为待处理</el-dropdown-item>
              <el-dropdown-item command="IN_PROGRESS">标记为处理中</el-dropdown-item>
              <el-dropdown-item command="RESOLVED">标记为已解决</el-dropdown-item>
              <el-dropdown-item command="CLOSED">标记为已关闭</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 反馈列表 -->
    <el-table
      :data="feedbacks"
      v-loading="loading"
      stripe
      style="width: 100%"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="55" />

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

      <el-table-column prop="user" label="提交人" width="120">
        <template #default="{ row }">
          {{ row.user?.name || row.user?.username || '-' }}
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

      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="viewDetail(row.id)">
            查看
          </el-button>
          <el-button link type="success" @click="handleUpdateStatus(row)">
            更新状态
          </el-button>
          <el-button link type="danger" @click="handleDelete(row)">
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
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="loadFeedbacks"
        @current-change="loadFeedbacks"
      />
    </div>

    <!-- 更新状态对话框 -->
    <el-dialog
      v-model="statusDialogVisible"
      title="更新处理状态"
      width="500px"
    >
      <el-form :model="statusForm" label-width="100px">
        <el-form-item label="处理状态">
          <el-select v-model="statusForm.status" placeholder="请选择状态" style="width: 100%">
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
            placeholder="请输入处理备注（可选）"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitStatusUpdate" :loading="statusUpdating">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Edit, ArrowDown } from '@element-plus/icons-vue'
import {
  getAllFeedbacksApi,
  updateFeedbackStatusApi,
  deleteFeedbackApi,
  batchUpdateFeedbackStatusApi,
  batchDeleteFeedbackApi,
  getFeedbackStatsApi,
} from '@/api/feedback'
import type { Feedback, FeedbackStatus, FeedbackCategory } from '@/types/models'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const feedbacks = ref<Feedback[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

// 筛选条件
const statusFilter = ref('')
const categoryFilter = ref('')
const dateRange = ref<string[]>([])
const keywordFilter = ref('')
let searchTimer: any = null

// 批量操作
const selectedIds = ref<string[]>([])

// 统计卡片
const statsCards = computed(() => [
  { key: 'total', label: '总反馈', count: total.value, color: '#409eff' },
  { key: 'pending', label: '待处理', count: feedbackStats.value.PENDING || 0, color: '#e6a23c' },
  { key: 'in_progress', label: '处理中', count: feedbackStats.value.IN_PROGRESS || 0, color: '#409eff' },
  { key: 'resolved', label: '已解决', count: feedbackStats.value.RESOLVED || 0, color: '#67c23a' },
])

const feedbackStats = ref<Record<string, number>>({})

// 状态更新对话框
const statusDialogVisible = ref(false)
const statusUpdating = ref(false)
const statusForm = ref({
  id: '',
  status: '' as FeedbackStatus | '',
  remark: '',
})

// 防抖搜索
const debounceSearch = () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadFeedbacks()
  }, 500)
}

// 筛选变化
const handleFilterChange = () => {
  currentPage.value = 1
  loadFeedbacks()
}

// 加载反馈列表
const loadFeedbacks = async () => {
  loading.value = true
  try {
    const params: any = {
      page: currentPage.value,
      limit: pageSize.value,
    }

    if (statusFilter.value) params.status = statusFilter.value
    if (categoryFilter.value) params.category = categoryFilter.value
    if (keywordFilter.value) params.keyword = keywordFilter.value
    if (dateRange.value && dateRange.value.length === 2) {
      params.startDate = dateRange.value[0]
      params.endDate = dateRange.value[1]
    }

    const res = await getAllFeedbacksApi(params)
    feedbacks.value = res.data.items || res.data.data || []
    total.value = res.data.total || 0
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '加载反馈列表失败')
  } finally {
    loading.value = false
  }
}

// 加载统计数据
const loadStats = async () => {
  try {
    const res = await getFeedbackStatsApi()
    feedbackStats.value = res.data.statusStats || {}
  } catch (error: any) {
    console.error('加载统计信息失败:', error)
  }
}

// 选择变化
const handleSelectionChange = (selection: Feedback[]) => {
  selectedIds.value = selection.map(item => item.id)
}

// 查看详情
const viewDetail = (id: string) => {
  router.push(`/feedback/${id}`)
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
    loadStats()
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
    loadStats()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败')
    }
  }
}

// 批量更新状态
const handleBatchStatusChange = async (status: string) => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请选择要操作的反馈')
    return
  }

  try {
    await batchUpdateFeedbackStatusApi({
      ids: selectedIds.value,
      status: status as FeedbackStatus,
    })
    ElMessage.success(`成功更新 ${selectedIds.value.length} 条反馈`)
    selectedIds.value = []
    loadFeedbacks()
    loadStats()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '批量更新失败')
  }
}

// 批量删除
const handleBatchDelete = async () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请选择要删除的反馈')
    return
  }

  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedIds.value.length} 条反馈吗？此操作不可恢复。`, '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await batchDeleteFeedbackApi({ ids: selectedIds.value })
    ElMessage.success(`成功删除 ${selectedIds.value.length} 条反馈`)
    selectedIds.value = []
    loadFeedbacks()
    loadStats()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '批量删除失败')
    }
  }
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

// 格式化日期
const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

onMounted(() => {
  loadFeedbacks()
  loadStats()
})
</script>

<style scoped>
.feedback-management {
  padding: 20px;
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
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}

.filter-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.filter-left,
.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
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
</style>
