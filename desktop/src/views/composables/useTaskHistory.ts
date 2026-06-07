import { ref, reactive, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
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

// ── Label maps ──────────────────────────────────────────────────────────────

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

// ── Composable ──────────────────────────────────────────────────────────────

export function useTaskHistory() {
  const router = useRouter()
  const { formatTime } = useFormatTime()
  const { getTaskStatusLabel } = useStatusHelpers()

  // ── State ───────────────────────────────────────────────────────────────

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

  // ── Computed ────────────────────────────────────────────────────────────

  const hasActiveFilters = computed(() => {
    return !!(filters.search || filters.status || filters.reviewMode || filters.creator || (filters.dateRange && filters.dateRange.length > 0))
  })

  const getStatusLabel = getTaskStatusLabel

  // ── Time formatting ─────────────────────────────────────────────────────

  const formatTimeRelative = (timeStr: string) => {
    if (!timeStr) return '-'

    const now = new Date()
    const time = new Date(timeStr)
    const diff = now.getTime() - time.getTime()

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`

    const month = String(time.getMonth() + 1).padStart(2, '0')
    const day = String(time.getDate()).padStart(2, '0')
    return `${month}/${day}`
  }

  // ── Review plan summary ─────────────────────────────────────────────────

  const getReviewPlanSummary = (row: any): string => {
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
      if (row?.reviewMode && reviewModeLabelMap[row.reviewMode]) {
        return reviewModeLabelMap[row.reviewMode]
      }
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

  // ── Polling ─────────────────────────────────────────────────────────────

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

  // ── Data fetching ───────────────────────────────────────────────────────

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

  // ── Filter / pagination ─────────────────────────────────────────────────

  const resetFilter = () => {
    filters.search = ''
    filters.status = ''
    filters.reviewMode = ''
    filters.creator = ''
    filters.dateRange = []
    currentPage.value = 1
    fetchTasks()
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

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleViewResult = (row: any) => {
    router.push(`/tasks/${row.id}`)
  }

  // ── Action handlers ─────────────────────────────────────────────────────

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

  const handleExportCommand = (command: string) => {
    switch (command) {
      case 'all':
        handleExportAll()
        break
      case 'selected':
        ElMessage.info(`导出 ${selectedRows.value.length} 条选中记录（功能开发中）`)
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

  const handleBatchExport = () => {
    if (selectedRows.value.length === 0) {
      ElMessage.warning('请先选择要导出的任务')
      return
    }
    ElMessage.success(`正在准备导出 ${selectedRows.value.length} 条记录...`)
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

  // ── Lifecycle ───────────────────────────────────────────────────────────

  onUnmounted(() => { stopPolling() })

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    // state
    loading,
    currentPage,
    pageSize,
    total,
    tableData,
    selectedRows,
    reviewingMap,
    filters,
    showAdvancedFilter,
    // computed
    hasActiveFilters,
    // label helpers
    getStatusLabel,
    formatTime,
    formatTimeRelative,
    getReviewPlanSummary,
    reviewModeLabelMap,
    // data
    fetchTasks,
    resetFilter,
    handleSizeChange,
    handleCurrentChange,
    handleSelectionChange,
    // navigation
    handleViewResult,
    // actions
    handleActionCommand,
    handleExportCommand,
    handleExportTask,
    handleExportAll,
    handleDelete,
    handleBatchExport,
    handleBatchDelete,
    handleReReview,
  }
}
