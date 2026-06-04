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
    <div class="filter-bar-enhanced">
      <!-- 左侧：主要筛选项 -->
      <div class="filter-left">
        <div class="search-box">
          <el-input
            v-model="filters.search"
            placeholder="搜索任务名称..."
            clearable
            prefix-icon="Search"
            @clear="() => fetchTasks()"
            @keyup.enter="() => fetchTasks()"
            class="search-input"
          />
        </div>

        <el-select
          v-model="filters.status"
          placeholder="全部状态"
          clearable
          @change="fetchTasks"
          class="filter-select"
        >
          <el-option label="排队中" value="PENDING" />
          <el-option label="审查中" value="PROCESSING" />
          <el-option label="已完成" value="COMPLETED" />
          <el-option label="失败" value="FAILED" />
        </el-select>

        <el-select
          v-model="filters.reviewMode"
          placeholder="审查模式"
          clearable
          @change="fetchTasks"
          class="filter-select"
        >
          <el-option label="以库审文" value="LIBRARY_REVIEW" />
          <el-option label="以文审文" value="DOC_REVIEW" />
          <el-option label="一致性审查" value="CONSISTENCY" />
          <el-option label="错别字/语法" value="TYPO_GRAMMAR" />
          <el-option label="结构化审查" value="MULTIMODAL" />
          <el-option label="仅规则审查" value="RULE_ONLY" />
          <el-option label="标准引用自检" value="SELF_CHECK" />
        </el-select>

        <!-- 创建人快速搜索（管理员可见：输入姓名或账号模糊搜索） -->
        <el-input
          v-if="userStore.isAdmin()"
          v-model="filters.creator"
          placeholder="搜索创建人..."
          clearable
          prefix-icon="Search"
          @clear="fetchTasks"
          @keyup.enter="fetchTasks"
          class="filter-input"
          style="width: 150px"
        />
      </div>

      <!-- 右侧：操作按钮组 -->
      <div class="filter-right">
        <el-button-group>
          <el-button type="primary" @click="() => fetchTasks()">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetFilter">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-button-group>

        <el-divider direction="vertical" />

        <el-dropdown @command="handleExportCommand" trigger="click">
          <el-button>
            <el-icon><Download /></el-icon>
            导出
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="all">导出全部数据</el-dropdown-item>
              <el-dropdown-item command="selected" :disabled="selectedRows.length === 0">
                导出选中项 ({{ selectedRows.length }})
              </el-dropdown-item>
              <el-dropdown-item divided command="template">
                下载导出模板
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button
          link
          type="primary"
          @click="showAdvancedFilter = !showAdvancedFilter"
          class="advanced-toggle"
        >
          {{ showAdvancedFilter ? '收起' : '高级' }}
          <el-icon :size="12">
            <component :is="showAdvancedFilter ? 'ArrowUp' : 'ArrowDown'" />
          </el-icon>
        </el-button>
      </div>

      <!-- 高级筛选区（可折叠） -->
      <transition name="slide-down">
        <div v-if="showAdvancedFilter" class="advanced-filter-enhanced">
          <div class="filter-row">
            <el-form-item label="创建时间">
              <el-date-picker
                v-model="filters.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                @change="fetchTasks"
                style="width: 280px"
              />
            </el-form-item>
          </div>
        </div>
      </transition>
    </div>

    <!-- 批量操作栏（增强版） -->
    <transition name="slide-fade">
      <div class="batch-actions-enhanced" v-if="selectedRows.length > 0">
        <div class="batch-left">
          <el-icon :size="18" color="#409EFF"><Select /></el-icon>
          <span class="batch-text">
            已选择 <strong>{{ selectedRows.length }}</strong> 项
          </span>
        </div>

        <div class="batch-right">
          <!-- 批量导出 -->
          <el-button-group>
            <el-button
              type="success"
              size="small"
              @click="handleBatchExport"
            >
              <el-icon><Download /></el-icon>
              批量导出
            </el-button>
          </el-button-group>

          <!-- 批量删除 -->
          <el-button
            type="danger"
            size="small"
            @click="handleBatchDelete"
            plain
          >
            <el-icon><Delete /></el-icon>
            批量删除
          </el-button>

          <!-- 取消选择 -->
          <el-button
            link
            type="info"
            size="small"
            @click="selectedRows = []"
            class="cancel-select"
          >
            取消选择
          </el-button>
        </div>
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
        <el-table-column label="审查模式" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="plan-summary-cell">{{ getReviewPlanSummary(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="140" align="center">
          <template #default="{ row }">
            <!-- 审查中：显示进度条 -->
            <template v-if="row.status === 'PROCESSING'">
              <div class="status-progress">
                <el-progress
                  :percentage="row.progress || 0"
                  :stroke-width="16"
                  :text-inside="true"
                  :format="(p: number) => `${p}%`"
                  status=""
                  color="#409EFF"
                />
                <span class="progress-label">审查中</span>
              </div>
            </template>

            <!-- 其他状态：使用增强标签 -->
            <template v-else>
              <div :class="['status-enhanced', `status-${(row.status || '').toLowerCase()}`]">
                <span class="status-icon" v-if="row.status === 'COMPLETED'">✓</span>
                <span class="status-icon" v-else-if="row.status === 'FAILED'">✗</span>
                <span class="status-icon" v-else-if="row.status === 'PENDING'">⏳</span>
                <span class="status-text">{{ getStatusLabel(row.status) }}</span>
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="file_count" label="文件" width="60" align="center">
          <template #default="{ row }">
            <span class="count-num">{{ row.file_count || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="issue_count" label="问题" width="70" align="center">
          <template #default="{ row }">
            <div
              :class="['issue-count-enhanced', { 'has-issues': (row.issue_count || 0) > 0 }]"
            >
              <span class="issue-number">{{ row.issue_count || 0 }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="user" label="创建人" width="100">
          <template #default="{ row }">
            <span>{{ row.user?.nick_name || row.user?.username || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="create_time" label="创建时间" width="150" align="center">
          <template #default="{ row }">
            <div class="time-enhanced" :title="formatTime(row.create_time)">
              <el-icon><Clock /></el-icon>
              <span>{{ formatTimeRelative(row.create_time) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template #default="{ row }">
            <div class="action-btns">
              <!-- 主要操作：查看详情 -->
              <el-button
                type="primary"
                size="small"
                @click="handleViewResult(row)"
                class="primary-action"
              >
                <el-icon><View /></el-icon>
                详情
              </el-button>

              <!-- 次要操作：下拉菜单 -->
              <el-dropdown
                trigger="click"
                @command="(cmd: string) => handleActionCommand(cmd, row)"
              >
                <el-button size="small" class="more-action">
                  更多
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      command="export"
                      :disabled="row.status !== 'COMPLETED'"
                    >
                      <el-icon><Download /></el-icon>
                      导出报告
                    </el-dropdown-item>
                    <el-dropdown-item
                      command="review"
                      :disabled="row.status === 'PROCESSING' || !row.file_count"
                      :divided="true"
                    >
                      <el-icon><Refresh /></el-icon>
                      重新审查
                    </el-dropdown-item>
                    <el-dropdown-item
                      command="delete"
                      divided
                      style="color: #F56C6C"
                    >
                      <el-icon><Delete /></el-icon>
                      删除任务
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>

        <!-- 空状态 -->
        <template #empty>
          <div class="empty-state">
            <template v-if="hasActiveFilters">
              <svg viewBox="0 0 120 100" fill="none" class="empty-svg">
                <rect x="20" y="15" width="80" height="70" rx="6" stroke="var(--color-gray-200)" stroke-width="2" fill="var(--color-gray-50)"/>
                <path d="M35 38H85M35 50H75M35 62H60" stroke="var(--color-gray-300)" stroke-width="2" stroke-linecap="round"/>
                <circle cx="78" cy="68" r="14" fill="var(--color-warning-50)" stroke="var(--color-warning-500)" stroke-width="1.5"/>
                <path d="M78 63V70M78 73V74" stroke="var(--color-warning-700)" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <p>未找到匹配的审查任务</p>
              <p class="empty-hint">尝试调整筛选条件或重置过滤器</p>
              <el-button type="primary" size="large" @click="resetFilter">
                重置筛选条件
              </el-button>
            </template>
            <template v-else>
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
            </template>
          </div>
        </template>
      </el-table>
    </div>

    <!-- 分页（增强版） -->
    <div class="pagination-enhanced">
      <!-- 左侧：统计信息 -->
      <div class="pagination-left">
        <el-text type="info" size="default">
          共 <strong class="total-count">{{ total }}</strong> 条记录
        </el-text>
        <el-tag
          v-if="selectedRows.length > 0"
          size="small"
          type="info"
          effect="plain"
          round
          class="selected-tag"
        >
          已选 {{ selectedRows.length }} 项
        </el-tag>
      </div>

      <!-- 右侧：分页器 -->
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="sizes, prev, pager, next, jumper"
        :total="total"
        background
        small
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
        class="pagination-component"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Download,
  Search,
  Plus,
  Select,
  Delete,
  Clock,            // 🕐 时间列图标
  View,             // 👁️ 详情按钮图标
  ArrowDown,        // 🔽 下拉箭头
  Refresh,          // 🔄 重置按钮图标
} from '@element-plus/icons-vue'
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
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const { formatTime } = useFormatTime()
const { getTaskStatusLabel } = useStatusHelpers()



// 相对时间格式化（如：5分钟前、2小时前、昨天）
const formatTimeRelative = (timeStr: string) => {
  if (!timeStr) return '-'

  const now = new Date()
  const time = new Date(timeStr)
  const diff = now.getTime() - time.getTime()

  // 计算时间差
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`

  // 超过7天显示具体日期
  const month = String(time.getMonth() + 1).padStart(2, '0')
  const day = String(time.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

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
  reviewMode: '',
  creator: '',
  dateRange: [] as string[],
})

const showAdvancedFilter = ref(false)

// 是否有激活的过滤器
const hasActiveFilters = computed(() => {
  return !!(filters.search || filters.status || filters.reviewMode || filters.creator || (filters.dateRange && filters.dateRange.length > 0))
})

const getStatusLabel = getTaskStatusLabel

const objectiveLabelMap: Record<string, string> = {
  COMPLIANCE: '合规审查',
  COMPARE: '参照比对',
  PROOFREAD: '基础校对',
  STRUCTURED: '结构化审查',
}

const evidenceLabelMap: Record<string, string> = {
  STANDARD: '知识库',
  RULE_LIBRARY: '语义规则库',
  REFERENCE: '参考文件',
}

const reviewModeLabelMap: Record<string, string> = {
  LIBRARY_REVIEW: '以库审文',
  DOC_REVIEW: '以文审文',
  TYPO_GRAMMAR: '基础校对',
  MULTIMODAL: '结构化审查',
  SELF_CHECK: '标准引用自检',
  CONSISTENCY: '一致性审查',
  RULE_ONLY: '仅规则审查',
}

const getReviewPlanSummary = (row: any): string => {
  // 自检任务特殊处理：显示检查统计
  if (row?.reviewMode === 'SELF_CHECK' && row?.selfCheckReport) {
    const sc = row.selfCheckReport as any
    return `标准引用自检 — ${sc.totalChecked ?? '?'} 条引用，${sc.errorCount ?? '?'} 条错误`
  }
  const plan = row?.reviewPlan
  if (!plan || typeof plan !== 'object') {
    return row?.reviewMode ? (reviewModeLabelMap[row.reviewMode] || row.reviewMode) : '—'
  }

  const objective = objectiveLabelMap[plan.objective] || plan.objective || '—'
  const sources = Array.isArray(plan.evidence?.sources) ? plan.evidence.sources : []
  const evidence = sources.length > 0
    ? sources.map((s: string) => evidenceLabelMap[s] || s).join('+')
    : '无外部依据'
  const profile = plan.execution?.profile === 'RULE_ONLY' ? '仅规则' : '混合执行'

  const moduleLabel = (() => {
    // 优先使用数据库存储的 mode（准确反映创建时的选择）
    if (row?.reviewMode && reviewModeLabelMap[row.reviewMode]) {
      return reviewModeLabelMap[row.reviewMode]
    }
    // 兜底：从 plan 推导
    if (plan.objective === 'COMPARE') return '一致性审查（对照）'
    if (plan.objective === 'PROOFREAD') return '基础校对'
    if (plan.objective === 'STRUCTURED') return '结构化审查'
    if (plan.execution?.profile === 'RULE_ONLY' && sources.includes('RULE_LIBRARY')) return '语义规则库审查'
    if (sources.includes('RULE_LIBRARY') && sources.includes('STANDARD')) return '以库审文'
    if (sources.includes('RULE_LIBRARY')) return '语义规则库审查'
    return '以库审文'
  })()

  const proofreadingEnhancement = plan.execution?.profile === 'RULE_ONLY'
    ? '基础校对增强：关闭'
    : `基础校对增强：${plan.enhancements?.intraFileConsistency ? '开启' : '关闭'}`

  return `${moduleLabel}｜${objective}｜${evidence}｜${profile}｜${proofreadingEnhancement}`
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
      reviewMode: filters.reviewMode || undefined,
      search: filters.search || undefined,
      creator: filters.creator || undefined,
      startDate: filters.dateRange?.[0] || undefined,
      endDate: filters.dateRange?.[1] || undefined,
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
  filters.reviewMode = ''
  filters.creator = ''
  filters.dateRange = []
  currentPage.value = 1
  fetchTasks()
}

const handleViewResult = (row: any) => {
  router.push(`/tasks/${row.id}`)
}

// 统一操作命令处理
const handleActionCommand = (command: string, row: any) => {
  switch (command) {
    case 'export':
      handleExportTask(row)
      break
    case 'review':
      handleReReview(row)
      break
    case 'delete':
      handleDelete(row)
      break
    default:
      console.warn('未知操作命令:', command)
  }
}

// 导出命令处理（筛选栏）
const handleExportCommand = (command: string) => {
  switch (command) {
    case 'all':
      handleExportAll()
      break
    case 'selected':
      ElMessage.info(`导出 ${selectedRows.length} 条选中记录（功能开发中）`)
      break
    case 'template':
      ElMessage.success('正在下载导出模板...')
      break
    default:
      console.warn('未知导出命令:', command)
  }
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

// 批量导出
const handleBatchExport = () => {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先选择要导出的任务')
    return
  }

  ElMessage.success(`正在准备导出 ${selectedRows.value.length} 条记录...`)

  // TODO: 调用批量导出API
  setTimeout(() => {
    ElMessage.info('批量导出功能开发中，敬请期待')
  }, 1000)
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

onMounted(() => {
  fetchTasks()
})
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
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--corp-text-primary);
}

/* ===== 过滤栏 ===== */
.filter-bar {
  margin-bottom: 22px;
  padding: 18px 22px;
  border-radius: var(--corp-radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  box-shadow: var(--corp-shadow-sm);
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px 10px;
}

::deep(.filter-form .el-form-item) {
  margin-bottom: 4px;
  margin-right: 14px;
}

::deep(.filter-form .el-form-item__label) {
  font-size: 15px;
  line-height: 36px;
}

::deep(.filter-form .el-input__wrapper),
::deep(.filter-form .el-select__wrapper) {
  min-height: 38px;
}

::deep(.filter-form .el-input__inner),
::deep(.filter-form .el-select__selected-item) {
  font-size: 15px;
  line-height: 1.6;
}

::deep(.filter-form .el-button) {
  font-size: 14px;
  min-height: 36px;
  padding: 0 14px;
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
  font-size: 15px;
  color: var(--corp-primary);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.selected-info strong {
  font-size: 17px;
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

:deep(.table-wrapper .el-table) {
  font-size: 14px;
}

:deep(.table-wrapper .el-table th.el-table__cell) {
  height: 48px;
  padding: 10px 0;
}

:deep(.table-wrapper .el-table td.el-table__cell) {
  height: 48px;
  padding: 10px 0;
}

:deep(.table-wrapper .el-table .cell) {
  line-height: 1.55;
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
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.mode-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--color-primary-700);
  background: var(--color-primary-50);
  border: 1px solid var(--color-primary-200);
}

.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  border: 1px solid transparent;
}

.table-wrapper .status-tag.status-completed {
  color: #166534 !important;
  background-color: #dcfce7 !important;
  border-color: #86efac !important;
}

.table-wrapper .status-tag.status-processing {
  color: #1d4ed8 !important;
  background-color: #dbeafe !important;
  border-color: #93c5fd !important;
}

.table-wrapper .status-tag.status-pending {
  color: #9a3412 !important;
  background-color: #ffedd5 !important;
  border-color: #fdba74 !important;
}

.table-wrapper .status-tag.status-failed {
  color: #b91c1c !important;
  background-color: #fee2e2 !important;
  border-color: #fca5a5 !important;
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
  font-size: 15px;
  font-weight: 650;
  color: var(--corp-text-regular);
  font-family: 'SF Mono', monospace;
  font-variant-numeric: tabular-nums;
}

.issue-count {
  font-size: 15px;
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
  font-size: 14px;
  color: var(--corp-text-secondary);
  font-variant-numeric: tabular-nums;
}

.action-btns {
  display: flex;
  gap: 4px;
}

.action-btns .el-button.el-button {
  font-size: 14px;
  padding: 0 6px;
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

.empty-hint {
  font-size: 13px !important;
  color: var(--corp-text-secondary) !important;
  margin: -12px 0 16px !important;
  font-weight: 400 !important;
  opacity: 0.7;
}

/* ===== 分页 ===== */
.pagination-container {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

:deep(.pagination-container .el-pagination) {
  font-size: 14px;
}

:deep(.pagination-container .el-pager li),
:deep(.pagination-container .btn-prev),
:deep(.pagination-container .btn-next),
:deep(.pagination-container .el-input__inner) {
  min-width: 34px;
  height: 34px;
  line-height: 34px;
  font-size: 14px;
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

/* ===== 增强筛选栏样式 ===== */
.filter-bar-enhanced {
  margin-bottom: 20px;
  padding: 18px 22px;
  border-radius: var(--corp-radius-md);
  background: linear-gradient(135deg, #FAFCFF 0%, #FFFFFF 100%);
  border: 1px solid #E4E7ED;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  /* 关键：使用Flexbox实现水平对齐 */
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.filter-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  flex: 1; /* 占据剩余空间 */
  min-width: 0; /* 防止溢出 */
}

.filter-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0; /* 不压缩按钮组 */
  white-space: nowrap; /* 防止换行 */
}

.search-box {
  min-width: 260px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 20px;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.08);
}

.filter-select {
  width: 150px !important;
}

.advanced-toggle {
  font-weight: 500;
  letter-spacing: 0.5px;
}

.advanced-filter-enhanced {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #EBEEF5;
}

.filter-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

/* ===== 增强批量操作栏样式 ===== */
.batch-actions-enhanced {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  margin-bottom: 16px;
  background: linear-gradient(90deg, #ECF5FF 0%, #F0F9FF 50%, #ECF5FF 100%);
  border: 2px solid #409EFF;
  border-radius: 10px;
  animation: slideDown 0.3s ease;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.15);
}

.batch-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-text {
  font-size: 14px;
  color: #303133;
}

.batch-text strong {
  color: #409EFF;
  font-size: 18px;
  font-weight: 700;
  margin: 0 3px;
}

.batch-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cancel-select {
  font-weight: 500;
}

/* ===== 增强分页组件样式 ===== */
.pagination-enhanced {
  margin-top: 24px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #FAFCFF;
  border-radius: 8px;
  border: 1px solid #E4E7ED;
}

.pagination-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.total-count {
  color: #409EFF;
  font-size: 18px;
  font-weight: 700;
  margin: 0 3px;
}

.selected-tag {
  font-weight: 600;
}

.pagination-component :deep(.el-pagination) {
  font-size: 13px;
  justify-content: flex-end;
}

/* ===== 操作按钮增强样式 ===== */
.action-btns {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.primary-action {
  font-weight: 500;
  border-radius: 6px;
  padding: 6px 14px;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.2);
}

.more-action {
  font-weight: 500;
  border-radius: 6px;
  padding: 6px 10px;
  background-color: #F5F7FA;
  border-color: #DCDFE6;
  color: #606266;
}

.more-action:hover {
  background-color: #ECF5FF;
  border-color: #C6E2FF;
  color: #409EFF;
}

/* ===== 状态标签增强样式 ===== */
.status-enhanced {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.25s ease;
}

.status-icon {
  font-size: 14px;
  font-weight: 700;
}

.status-text {
  letter-spacing: 0.5px;
}

/* 已完成 - 绿色 */
.status-completed {
  background: linear-gradient(135deg, #F0F9EB 0%, #E1F3D8 100%);
  color: #67C23A;
  border: 1px solid #B3E19D;
}

.status-completed .status-icon {
  color: #67C23A;
}

/* 失败 - 红色 */
.status-failed {
  background: linear-gradient(135deg, #FEF0F0 0%, #FDE2E2 100%);
  color: #F56C6C;
  border: 1px solid #FBC4C4;
}

.status-failed .status-icon {
  color: #F56C6C;
}

/* 排队中 - 灰色 */
.status-pending {
  background: linear-gradient(135deg, #F4F4F5 0%, #E9E9EB 100%);
  color: #909399;
  border: 1px solid #DCDFE6;
}

.status-pending .status-icon {
  color: #909399;
}

/* 进度条状态 */
.status-progress {
  text-align: center;
}

.progress-label {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #409EFF;
  font-weight: 600;
}

/* ===== 问题数增强样式 ===== */
.issue-count-enhanced {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.issue-number {
  color: #606266;
}

.issue-count-enhanced.has-issues .issue-number {
  color: #F56C6C;
}

/* ===== 时间列增强样式 ===== */
.time-enhanced {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: #909399;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.time-enhanced:hover {
  background: #F5F7FA;
  color: #409EFF;
}

.time-enhanced .el-icon {
  font-size: 14px;
}

/* ===== 表格行悬停效果 ===== */
.task-history :deep(.el-table__body tr:hover > td) {
  background-color: #F5F9FF !important;
  cursor: pointer;
}

.task-history :deep(.el-table__body tr) {
  transition: all 0.2s ease;
}

/* ===== 响应式布局优化 ===== */

/* 中等屏幕 (≤1200px) */
@media (max-width: 1200px) {
  .filter-bar-enhanced {
    gap: 16px;
    padding: 16px 18px;
  }

  .search-box {
    min-width: 220px;
  }

  .filter-select {
    width: 140px !important;
  }
}

/* 小屏幕 (≤992px) */
@media (max-width: 992px) {
  .filter-bar-enhanced {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }

  .filter-left {
    justify-content: stretch;
  }

  .filter-right {
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px dashed #E4E7ED;
  }

  .search-box {
    min-width: auto;
    flex: 1;
  }

  .filter-select {
    flex: 1 !important;
    width: auto !important;
    min-width: 120px;
  }
}

/* 移动端 (≤768px) */
@media (max-width: 768px) {
  .filter-bar-enhanced {
    padding: 14px 16px;
    gap: 12px;
  }

  .filter-left {
    flex-direction: column;
    gap: 10px;
  }

  .search-input :deep(.el-input__wrapper) {
    border-radius: 8px; /* 移动端使用较小圆角 */
  }

  .filter-right {
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-right .el-button-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* 隐藏分隔线，节省空间 */
  .filter-right .el-divider--vertical {
    display: none;
  }

  /* 高级按钮文字简化 */
  .advanced-toggle span:not(.el-icon) {
    display: none; /* 只显示图标 */
  }
}

/* 超小屏幕 (≤480px) */
@media (max-width: 480px) {
  .filter-bar-enhanced {
    padding: 12px;
  }

  .filter-right .el-button {
    font-size: 13px;
    padding: 7px 12px;
  }

  .filter-select :deep(.el-select__placeholder) {
    font-size: 13px;
  }
}
</style>
