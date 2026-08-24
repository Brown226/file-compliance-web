<template>
  <div class="feedback-management">
    <div class="page-intro">
      <h3>反馈管理</h3>
      <p>查看用户提交的 Bug 报告、建议和功能请求，跟踪处理进度并批量更新状态。</p>
    </div>

    <!-- 统计卡片 -->
    <section class="stats-bar">
      <div v-for="stat in statsCards" :key="stat.key" class="stat-item">
        <div class="stat-value">{{ stat.count }}</div>
        <div class="stat-label">{{ stat.label }}</div>
      </div>
    </section>

    <!-- 筛选工具栏 -->
    <section class="filter-card">
      <div class="filter-form">
        <el-select v-model="statusFilter" placeholder="处理状态" clearable @change="handleFilterChange">
          <el-option label="全部状态" value="" />
          <el-option label="待处理" value="PENDING" />
          <el-option label="处理中" value="IN_PROGRESS" />
          <el-option label="已解决" value="RESOLVED" />
          <el-option label="已关闭" value="CLOSED" />
        </el-select>

        <el-select v-model="categoryFilter" placeholder="反馈类别" clearable @change="handleFilterChange">
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
          @change="handleFilterChange"
        />

        <el-input
          v-model="keywordFilter"
          placeholder="搜索标题或内容..."
          prefix-icon="Search"
          clearable
          @input="debounceSearch"
        />
      </div>

      <div class="filter-actions">
        <el-button @click="loadFeedbacks">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>

        <el-dropdown @command="handleBatchStatusChange" :disabled="selectedIds.length === 0">
          <el-button :disabled="selectedIds.length === 0">
            <el-icon><Edit /></el-icon>
            更新状态
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

        <el-button :disabled="selectedIds.length === 0" @click="handleBatchDelete">
          <el-icon><Delete /></el-icon>
          批量删除
        </el-button>
      </div>
    </section>

    <!-- 反馈列表 -->
    <section class="table-card">
      <div class="table-summary">
        <span class="summary-label">共</span>
        <span class="summary-value">{{ total }}</span>
        <span class="summary-label">条反馈</span>
        <span v-if="selectedIds.length > 0" class="summary-selected">· 已选 {{ selectedIds.length }} 条</span>
      </div>
      <el-table :data="feedbacks" v-loading="loading" stripe class="feedback-table" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="55" />

        <el-table-column prop="title" label="标题" min-width="240">
          <template #default="{ row }">
            <div class="title-cell">
              <span class="title-text">{{ row.title }}</span>
              <span class="category-badge" :class="row.category">{{ getCategoryLabel(row.category) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="user" label="提交人" width="110">
          <template #default="{ row }">
            <span class="user-name">{{ row.user?.name || row.user?.username || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="status-badge" :class="row.status">{{ getStatusLabel(row.status) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">
            <span class="time-cell">{{ formatDate(row.createdAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="处理时间" width="160">
          <template #default="{ row }">
            <span v-if="row.resolvedAt" class="time-cell">{{ formatDate(row.resolvedAt) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link @click="viewDetail(row.id)">查看</el-button>
            <el-button link @click="handleUpdateStatus(row)">更新状态</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
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
    </section>

    <!-- 更新状态对话框 -->
    <el-dialog v-model="statusDialogVisible" title="更新处理状态" width="520px">
      <el-form :model="statusForm" label-width="90px">
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
        <el-button type="primary" @click="submitStatusUpdate" :loading="statusUpdating">确定</el-button>
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

const statusFilter = ref('')
const categoryFilter = ref('')
const dateRange = ref<string[]>([])
const keywordFilter = ref('')
let searchTimer: any = null

const selectedIds = ref<string[]>([])

const statsCards = computed(() => [
  { key: 'total', label: '总反馈', count: total.value },
  { key: 'pending', label: '待处理', count: feedbackStats.value.PENDING || 0 },
  { key: 'in_progress', label: '处理中', count: feedbackStats.value.IN_PROGRESS || 0 },
  { key: 'resolved', label: '已解决', count: feedbackStats.value.RESOLVED || 0 },
])

const feedbackStats = ref<Record<string, number>>({})

const statusDialogVisible = ref(false)
const statusUpdating = ref(false)
const statusForm = ref({
  id: '',
  status: '' as FeedbackStatus | '',
  remark: '',
})

const debounceSearch = () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadFeedbacks()
  }, 500)
}

const handleFilterChange = () => {
  currentPage.value = 1
  loadFeedbacks()
}

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

const loadStats = async () => {
  try {
    const res = await getFeedbackStatsApi()
    feedbackStats.value = res.data.statusStats || {}
  } catch (error: any) {
    console.error('加载统计信息失败:', error)
  }
}

const handleSelectionChange = (selection: Feedback[]) => {
  selectedIds.value = selection.map(item => item.id)
}

const viewDetail = (id: string) => {
  router.push(`/feedback/${id}`)
}

const handleUpdateStatus = (row: Feedback) => {
  statusForm.value = {
    id: row.id,
    status: row.status,
    remark: row.remark || '',
  }
  statusDialogVisible.value = true
}

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

const getStatusLabel = (status: FeedbackStatus) => {
  const map: Record<FeedbackStatus, string> = {
    PENDING: '待处理',
    IN_PROGRESS: '处理中',
    RESOLVED: '已解决',
    CLOSED: '已关闭',
  }
  return map[status] || status
}

const getCategoryLabel = (category: FeedbackCategory) => {
  const map: Record<FeedbackCategory, string> = {
    BUG_REPORT: 'Bug报告',
    SUGGESTION: '建议',
    FEATURE_REQUEST: '功能请求',
    OTHER: '其他',
  }
  return map[category] || category
}

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
  padding: 20px 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-intro {
  padding: 4px 0 4px 12px;
  border-left: 4px solid transparent;
  border-image: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600)) 1;
  border-radius: 2px;
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}

/* 统计条 */
.stats-bar {
  display: flex;
  gap: 0;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 12px;
  border-right: 1px solid var(--corp-border-light);
}

.stat-item:last-child {
  border-right: none;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
}

/* 过滤卡片 */
.filter-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-form :deep(.el-input),
.filter-form :deep(.el-select),
.filter-form :deep(.el-date-editor) {
  width: 180px;
}

.filter-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

/* 表格卡片 */
.table-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.table-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--bg-surface-hover);
}

.summary-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.summary-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.summary-selected {
  font-size: 12px;
  color: var(--color-primary-600);
  margin-left: 4px;
}

.feedback-table {
  /* 表头底色交由全局 element-overrides 统一（透明底 + 次级色） */
}

.title-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--corp-text-primary);
}

.category-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.category-badge.BUG_REPORT {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
  border-color: var(--color-danger-bg);
}

.category-badge.SUGGESTION {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-bg);
}

.category-badge.FEATURE_REQUEST {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-bg);
}

.category-badge.OTHER {
  background: var(--bg-surface-active);
  color: var(--corp-text-secondary);
  border-color: var(--corp-border-light);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.status-badge.PENDING {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-bg);
}

.status-badge.IN_PROGRESS {
  background: var(--color-primary-50);
  color: var(--color-primary-600);
  border-color: var(--color-primary-200);
}

.status-badge.RESOLVED {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-bg);
}

.status-badge.CLOSED {
  background: var(--bg-surface-active);
  color: var(--corp-text-secondary);
  border-color: var(--corp-border-light);
}

.user-name {
  font-weight: 500;
  color: var(--corp-text-primary);
}

.time-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  color: var(--color-gray-600);
}

.text-muted {
  color: var(--color-gray-400);
}

/* 分页 */
.pagination-container {
  padding: 12px 20px;
  border-top: 1px solid var(--corp-border-light);
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 960px) {
  .filter-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .filter-actions {
    margin-left: 0;
    width: 100%;
  }

  .stats-bar {
    flex-wrap: wrap;
  }

  .stat-item {
    flex: 1 1 50%;
    border-right: none;
    border-bottom: 1px solid var(--corp-border-light);
  }
}
</style>
