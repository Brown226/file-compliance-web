<template>
  <div class="task-history">
    <!-- 页面标题区 -->
    <div class="page-header">
      <h2 class="page-title">审查任务列表</h2>
      <el-button type="primary" @click="$router.push('/tasks/new')">
        <el-icon><Plus /></el-icon> 新建任务
      </el-button>
    </div>

    <!-- 过滤栏 -->
    <div class="filter-bar">
      <el-form :inline="true" :model="filters" class="filter-form">
        <el-form-item label="任务名称">
          <el-input
            v-model="filters.search"
            placeholder="搜索任务名称"
            clearable
            @clear="() => fetchTasks()"
            @keyup.enter="() => fetchTasks()"
            style="width: 220px"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="filters.status"
            placeholder="全部状态"
            clearable
            @change="fetchTasks"
            style="width: 150px"
          >
            <el-option label="排队中" value="PENDING" />
            <el-option label="审查中" value="PROCESSING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="失败" value="FAILED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="() => fetchTasks()">
            <el-icon><Search /></el-icon> 查询
          </el-button>
          <el-button plain @click="resetFilter">重置</el-button>
          <el-button :icon="Download" plain type="info" @click="handleExportAll">导出</el-button>
          <el-button link type="info" @click="showAdvancedFilter = !showAdvancedFilter">
            {{ showAdvancedFilter ? '收起筛选' : '高级筛选' }}
            <el-icon :size="12"><component :is="showAdvancedFilter ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
          </el-button>
        </el-form-item>
      </el-form>
      <!-- 高级筛选区 -->
      <transition name="slide-down">
        <div v-if="showAdvancedFilter" class="advanced-filter">
          <el-form :inline="true" :model="filters" class="filter-form">
            <el-form-item label="创建人">
              <el-input
                v-model="filters.creator"
                placeholder="搜索创建人"
                clearable
                @clear="() => fetchTasks()"
                @keyup.enter="fetchTasks"
                style="width: 160px"
              />
            </el-form-item>
            <el-form-item label="创建时间">
              <el-date-picker
                v-model="filters.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                @change="fetchTasks"
                style="width: 260px"
              />
            </el-form-item>
          </el-form>
        </div>
      </transition>
    </div>

    <!-- 批量操作栏 -->
    <transition name="slide-fade">
      <div class="batch-actions" v-if="selectedRows.length > 0">
        <span class="selected-info">
          <el-icon><Select /></el-icon>
          已选择 <strong>{{ selectedRows.length }}</strong> 项
        </span>
        <el-button type="danger" size="small" @click="handleBatchDelete">
          <el-icon><Delete /></el-icon> 批量删除
        </el-button>
      </div>
    </transition>

    <!-- 数据表格 -->
    <div class="table-wrapper">
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        @selection-change="handleSelectionChange"
        row-class-name="task-row"
      >
        <el-table-column type="selection" width="48" align="center" />
        <el-table-column prop="title" label="任务名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="task-name-cell">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reviewMode" label="模式" width="110">
          <template #default="{ row }">
            <span :class="['mode-tag', `mode-${(row.reviewMode || '').toLowerCase()}`]">
              {{ getReviewModeLabel(row.reviewMode) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="160">
          <template #default="{ row }">
            <template v-if="row.status === 'PROCESSING'">
              <div class="progress-wrap">
                <el-progress
                  :percentage="row.progress || 0"
                  :stroke-width="14"
                  :text-inside="true"
                  :format="(p: number) => `${p}%`"
                  status=""
                />
              </div>
            </template>
            <template v-else>
              <span :class="['status-tag', `status-${(row.status || '').toLowerCase()}`]">
                {{ getStatusLabel(row.status) }}
              </span>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="file_count" label="文件" width="60" align="center">
          <template #default="{ row }">
            <span class="count-num">{{ row.file_count || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="issue_count" label="问题" width="60" align="center">
          <template #default="{ row }">
            <span
              class="issue-count"
              :class="{ 'has-issue': (row.issue_count || 0) > 0 }"
            >
              {{ row.issue_count || 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="user" label="创建人" width="100">
          <template #default="{ row }">
            <span>{{ row.user?.nick_name || row.user?.username || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="create_time" label="创建时间" width="155">
          <template #default="{ row }">
            <span class="time-cell">{{ formatTime(row.create_time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="action-btns">
              <el-button type="primary" link size="small" @click="handleViewResult(row)">
                详情
              </el-button>
              <el-button
                type="success" link size="small"
                @click="handleExportTask(row)"
                :disabled="row.status !== 'COMPLETED'"
              >
                导出
              </el-button>
              <el-button
                type="warning" link size="small"
                @click="handleReReview(row)"
                :loading="reviewingMap.get(row.id)"
                :disabled="row.status === 'PROCESSING' || !row.file_count"
              >
                重审
              </el-button>
              <el-button type="danger" link size="small" @click="handleDelete(row)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>

        <!-- 空状态 -->
        <template #empty>
          <div class="empty-state">
            <svg viewBox="0 0 120 100" fill="none" class="empty-svg">
              <rect x="20" y="15" width="80" height="70" rx="6" stroke="var(--color-gray-200)" stroke-width="2" fill="var(--color-gray-50)"/>
              <path d="M35 38H85M35 50H75M35 62H60" stroke="var(--color-gray-300)" stroke-width="2" stroke-linecap="round"/>
              <circle cx="78" cy="68" r="14" fill="var(--color-primary-50)" stroke="var(--color-primary-500)" stroke-width="1.5"/>
              <path d="M73 68L77 72L84 64" stroke="var(--color-primary-700)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p>暂无审查任务</p>
            <el-button type="primary" size="large" @click="$router.push('/tasks/new')">
              创建第一个审查任务
            </el-button>
          </div>
        </template>
      </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        :total="total"
        background
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Download, Search, Plus, Select, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getTasksApi,
  exportTaskReportApi,
  deleteTaskApi,
  deleteTasksApi,
  reReviewTaskApi
} from '@/api/task'
import { useFormatTime } from '@/composables/useFormatTime'
import { useStatusHelpers } from '@/composables/useStatusHelpers'

const router = useRouter()
const { formatTime } = useFormatTime()
const { getTaskStatusLabel } = useStatusHelpers()

const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const tableData = ref<any[]>([])
const selectedRows = ref<any[]>([])
const reviewingMap = reactive(new Map<string, boolean>())

const filters = reactive({
  search: '',
  status: '',
  creator: '',
  dateRange: [] as string[],
})

const showAdvancedFilter = ref(false)

const getStatusLabel = getTaskStatusLabel

const getReviewModeLabel = (mode: string) => {
  const map: Record<string, string> = {
    FULL_REVIEW: '全面审查',
    LIBRARY_REVIEW: '标准库审查',
    DOC_REVIEW: '以文审文',
    CONSISTENCY: '一致性检查',
    TYPO_GRAMMAR: '错别字审查',
    MULTIMODAL: '多模态审查',
    CUSTOM_RULE: '自定义规则',
  }
  return map[mode] || mode || '-'
}





let pollTimer: ReturnType<typeof setInterval> | null = null

const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const hasProcessing = tableData.value.some((r: any) => r.status === 'PROCESSING')
    if (hasProcessing) { fetchTasks(true) } else { stopPolling() }
  }, 5000)
}

const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

const fetchTasks = async (silent = false) => {
  if (!silent) loading.value = true
  try {
    const { data } = await getTasksApi({
      page: currentPage.value,
      limit: pageSize.value,
      status: filters.status || undefined,
      title: filters.search || undefined,
    })
    tableData.value = data.items || []
    total.value = data.total || 0
    // 初始化 reviewing 状态映射，确保响应式
    for (const item of tableData.value) {
      if (!reviewingMap.has(item.id)) {
        reviewingMap.set(item.id, false)
      }
    }
    const hasProcessing = tableData.value.some((r: any) => r.status === 'PROCESSING')
    if (hasProcessing) { startPolling() } else { stopPolling() }
  } catch (e) {} finally {
    loading.value = false
  }
}

const resetFilter = () => {
  filters.search = ''
  filters.status = ''
  filters.creator = ''
  filters.dateRange = []
  currentPage.value = 1
  fetchTasks()
}

const handleViewResult = (row: any) => {
  router.push(`/tasks/${row.id}`)
}

const handleExportTask = async (row: any) => {
  try {
    const { data } = await exportTaskReportApi(row.id)
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${row.title}_审查报告.json`
      link.click()
      window.URL.revokeObjectURL(url)
      ElMessage.success('导出成功')
    }
  } catch (e) {
    ElMessage.warning('导出功能暂不可用')
  }
}

const handleExportAll = () => {
  if (tableData.value.length === 0) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const headers = ['任务名称', '状态', '文件数', '问题数', '创建人', '创建时间']
  const rows = tableData.value.map(row => [
    row.title,
    getStatusLabel(row.status),
    String(row.file_count || 0),
    String(row.issue_count || 0),
    row.user?.nick_name || row.user?.username || '-',
    formatTime(row.create_time),
  ])
  const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n')
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '审查任务列表.csv'
  link.click()
  window.URL.revokeObjectURL(url)
  ElMessage.success('导出成功')
}

const handleSizeChange = () => {
  currentPage.value = 1
  fetchTasks()
}

const handleCurrentChange = () => {
  fetchTasks()
}

const handleSelectionChange = (rows: any[]) => {
  selectedRows.value = rows
}

const handleDelete = (row: any) => {
  ElMessageBox.confirm(
    `确定要删除任务「${row.title}」吗？<br><span style="color: var(--color-danger)">此操作不可恢复，关联的文件和审查结果将被永久删除！</span>`,
    '确认删除',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
    }
  ).then(async () => {
    try {
      await deleteTaskApi(row.id)
      ElMessage.success('删除成功')
      fetchTasks()
    } catch (e) {}
  }).catch(() => {})
}

const handleBatchDelete = () => {
  if (selectedRows.value.length === 0) return
  
  ElMessageBox.confirm(
    `确定要删除选中的 ${selectedRows.value.length} 个任务吗？<br><span style="color: var(--color-danger)">此操作不可恢复，关联的文件和审查结果将被永久删除！</span>`,
    '批量删除',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
    }
  ).then(async () => {
    try {
      const ids = selectedRows.value.map((r: any) => r.id)
      await deleteTasksApi(ids)
      ElMessage.success('批量删除成功')
      selectedRows.value = []
      fetchTasks()
    } catch (e) {}
  }).catch(() => {})
}

const handleReReview = async (row: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要重新审核任务「${row.title}」吗？<br>系统将清除旧的审查结果并重新执行审查流程。`,
      '重新审核',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info',
      }
    )
    
    reviewingMap.set(row.id, true)
    
    await reReviewTaskApi(row.id)
    ElMessage.success('已提交重新审核，请稍后刷新查看结果')
    
    fetchTasks()
  } catch (e: any) {
    if (e !== 'cancel') {
      reviewingMap.set(row.id, false)
    }
  }
}

onMounted(() => { fetchTasks() })
onUnmounted(() => { stopPolling() })
</script>

<style scoped>
.task-history {
  padding: 0;
  background-color: transparent;
}

/* ===== 页面标题区 ===== */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--corp-text-primary);
}

/* ===== 过滤栏 ===== */
.filter-bar {
  margin-bottom: 18px;
  padding: 16px 22px;
  border-radius: var(--corp-radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  box-shadow: var(--corp-shadow-sm);
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

::deep(.filter-form .el-form-item) {
  margin-bottom: 0;
  margin-right: 12px;
}

/* ===== 批量操作 ===== */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  margin-bottom: 12px;
  background: linear-gradient(135deg, var(--corp-primary-lighter), var(--color-primary-50));
  border-radius: var(--corp-radius-sm);
  border-left: 3px solid var(--corp-primary);
  animation: fadeInUp 0.3s ease;
}

.selected-info {
  font-size: 13.5px;
  color: var(--corp-primary);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.selected-info strong {
  font-size: 16px;
}

.slide-fade-enter-active { transition: all 0.25s ease; }
.slide-fade-leave-active { transition: all 0.15s ease; }
.slide-fade-enter-from { opacity: 0; transform: translateY(-8px); }
.slide-fade-leave-to { opacity: 0; transform: translateY(-8px); }

/* ===== 表格 ===== */
.table-wrapper {
  background: var(--corp-bg-panel);
  border-radius: var(--corp-radius-md);
  overflow: hidden;
  box-shadow: var(--corp-shadow-sm);
}

.task-row {
  cursor: default;
  transition: all 0.15s ease;
}

:deep(.task-row:hover td:first-child::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--corp-primary), var(--color-primary-400));
  border-radius: 0 2px 2px 0;
}

:deep(.el-table__inner-wrapper::before) {
  display: none;
}

.task-name-cell {
  font-weight: 550;
  color: var(--corp-text-primary);
}

/* 进度条包裹 */
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-wrap :deep(.el-progress) {
  flex: 1;
  max-width: 120px;
}

.progress-wrap :deep(.el-progress-bar__outer.el-progress-bar__outer) {
  border-radius: 8px;
  background-color: var(--color-gray-200);
}

.progress-wrap :deep(.el-progress-bar__inner.el-progress-bar__inner) {
  background: linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600));
  border-radius: 8px;
}

.progress-label {
  font-size: 12px;
  color: var(--corp-primary);
  font-weight: 500;
  white-space: nowrap;
}

.count-num {
  font-weight: 650;
  color: var(--corp-text-regular);
  font-family: 'SF Mono', monospace;
  font-variant-numeric: tabular-nums;
}

.issue-count {
  font-weight: 700;
  color: var(--corp-text-regular);
  font-family: 'SF Mono', monospace;
  font-variant-numeric: tabular-nums;
}

.issue-count.has-issue {
  color: var(--corp-danger);
  animation: pulse 2s infinite;
}

.time-cell {
  font-size: 13px;
  color: var(--corp-text-secondary);
  font-variant-numeric: tabular-nums;
}

.action-btns {
  display: flex;
  gap: 2px;
}

.action-btns .el-button.el-button {
  padding: 0 4px;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 40px 0 32px;
}

.empty-svg {
  width: 120px;
  height: 100px;
  margin-bottom: 16px;
}

.empty-state p {
  color: var(--corp-text-secondary);
  font-size: 15px;
  margin: 0 0 20px;
  font-weight: 500;
}

/* ===== 分页 ===== */
.pagination-container {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

/* ===== 高级筛选 ===== */
.advanced-filter {
  padding-top: 12px;
  border-top: 1px solid var(--color-gray-100);
  margin-top: 8px;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  margin-top: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 80px;
}
</style>
