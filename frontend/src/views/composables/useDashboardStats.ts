/**
 * Dashboard 统计数据相关逻辑
 * 从 Dashboard.vue 提取
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { getDashboardStatsApi, getDashboardTrendApi, getTasksApi } from '@/api/dashboard'
import { toggleFalsePositiveApi } from '@/api/task'
import { getMyFeedbacksApi } from '@/api/feedback'

export interface DashboardStats {
  taskStats: { PENDING: number; PROCESSING: number; COMPLETED: number; FAILED: number; TOTAL: number }
  issueStats: { TYPO: number; VIOLATION: number; TOTAL: number }
  frequentTypos: any[]
  topViolations: any[]
  departmentStats: any[]
  averageProcessingTimeMs: number
  complianceRate: number
  bySeverity: { error: number; warning: number; info: number }
  unhandledHigh: any[]
  comparedToLastPeriod: { tasksDelta: number; complianceDelta: number; avgTimeDelta: number }
  pendingIssues: any[]
  trendData: any
}

export function useDashboardStats() {
  const router = useRouter()
  const userStore = useUserStore()

  const canSwitchView = computed(() => userStore.isAdminOrManager())
  const isAdminByRole = computed(() => userStore.isAdminOrManager())

  // ===== 视图模式 =====
  const storedView = typeof localStorage !== 'undefined' ? localStorage.getItem('dashboard-view') : null
  const viewMode = ref<'admin' | 'user'>(storedView === 'user' ? 'user' : (isAdminByRole.value ? 'admin' : 'user'))

  const toggleView = () => {
    viewMode.value = viewMode.value === 'admin' ? 'user' : 'admin'
    localStorage.setItem('dashboard-view', viewMode.value)
    fetchStats()
  }

  // ===== 时间范围 =====
  const timeRange = ref(30)
  const handleTimeRangeChange = (days: number) => { timeRange.value = days; fetchStats() }

  // ===== 刷新 =====
  const refreshing = ref(false)
  const handleRefresh = async () => { refreshing.value = true; await fetchStats(); refreshing.value = false }

  // ===== 数据 =====
  const stats = ref<DashboardStats>({
    taskStats: { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, TOTAL: 0 },
    issueStats: { TYPO: 0, VIOLATION: 0, TOTAL: 0 },
    frequentTypos: [], topViolations: [], departmentStats: [],
    averageProcessingTimeMs: 0, complianceRate: 0,
    bySeverity: { error: 0, warning: 0, info: 0 },
    unhandledHigh: [], comparedToLastPeriod: { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
    pendingIssues: [], trendData: {},
  })

  const departmentStats = ref<any[]>([])
  const recentTasks = ref<any[]>([])
  const pendingIssues = ref<any[]>([])

  // ===== 日期 =====
  const now = ref(new Date())
  const currentDate = computed(() => {
    const d = now.value
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${weekdays[d.getDay()]}`
  })

  // ===== 反馈统计 =====
  const feedbackLoading = ref(false)
  const feedbackStats = ref<Record<string, number>>({})

  const feedbackStatsList = computed(() => [
    { status: 'PENDING', label: '待处理', count: feedbackStats.value.PENDING || 0, color: '#e6a23c' },
    { status: 'IN_PROGRESS', label: '处理中', count: feedbackStats.value.IN_PROGRESS || 0, color: '#409eff' },
    { status: 'RESOLVED', label: '已解决', count: feedbackStats.value.RESOLVED || 0, color: '#67c23a' },
    { status: 'CLOSED', label: '已关闭', count: feedbackStats.value.CLOSED || 0, color: '#909399' },
  ])

  const loadFeedbackStats = async () => {
    if (viewMode.value !== 'user') return
    feedbackLoading.value = true
    try {
      const res = await getMyFeedbacksApi({ page: 1, limit: 100 })
      const feedbacks = res.data.items || res.data.data || []
      const st: Record<string, number> = { PENDING: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 }
      feedbacks.forEach((fb: any) => { if (st[fb.status] !== undefined) st[fb.status]++ })
      feedbackStats.value = st
    } catch (error: any) { console.error('加载反馈统计失败:', error) }
    finally { feedbackLoading.value = false }
  }

  const filterByStatus = (status: string) => { router.push({ path: '/feedback', query: { status } }) }

  // ===== 辅助函数 =====
  const formatAvgTime = (ms: number) => {
    if (!ms) return '0s'
    const sec = ms / 1000
    if (sec >= 60) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
    return `${sec.toFixed(1)}s`
  }

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = { PENDING: '排队中', PROCESSING: '审查中', COMPLETED: '已完成', FAILED: '失败' }
    return map[status] || status
  }

  const getStatusTagType = (status: string): 'warning' | 'info' | 'success' | 'danger' | 'primary' => {
    const map: Record<string, any> = { PENDING: 'info', PROCESSING: 'primary', COMPLETED: 'success', FAILED: 'danger' }
    return map[status] || 'info'
  }

  const getSeverityLevel = (severity: string) => {
    const map: Record<string, string> = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' }
    return map[severity] || 'low'
  }

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    return `${Math.floor(hours / 24)}天前`
  }

  const deptColors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
  const getDeptColor = (dept: any) => {
    const name = dept?.deptName || ''
    let hash = 0
    for (let i = 0; i < name.length; i++) { hash = (hash << 5) - hash + name.charCodeAt(i); hash |= 0 }
    return deptColors[Math.abs(hash) % deptColors.length]
  }

  const isDeptRowHighlight = (dept: any) => {
    const highTime = dept.avgTimeMs && dept.avgTimeMs > 300000
    const lowCompliance = dept.complianceRate && dept.complianceRate < 80
    return highTime || lowCompliance
  }

  // ===== KPI 数据 =====
  const adminKpiList = computed(() => [
    { label: '审查总量', value: stats.value.taskStats.TOTAL || 0, unit: '', theme: 'primary' as const, trend: stats.value.comparedToLastPeriod?.tasksDelta || 0, trendUnit: '%' },
    { label: '整体合规率', value: stats.value.complianceRate || 0, unit: '%', theme: 'success' as const, trend: stats.value.comparedToLastPeriod?.complianceDelta || 0, trendUnit: '%' },
    { label: '严重问题', value: stats.value.bySeverity?.error || 0, unit: '', theme: 'danger' as const, trend: 0, trendUnit: '项' },
    { label: '平均耗时', value: formatAvgTime(stats.value.averageProcessingTimeMs), unit: '', theme: 'success' as const, trend: stats.value.comparedToLastPeriod?.avgTimeDelta || 0, trendUnit: '%' },
    { label: '积压任务', value: stats.value.taskStats.PENDING || 0, unit: '', theme: 'warning' as const, trend: 0, trendUnit: '项' },
  ])

  const userKpiList = computed(() => [
    { label: '我的任务', value: stats.value.taskStats.TOTAL || 0, unit: '', theme: 'primary' as const, trend: undefined, trendUnit: '' },
    { label: '合规率', value: stats.value.complianceRate || 0, unit: '%', theme: 'success' as const, trend: undefined, trendUnit: '%' },
    { label: '待处理问题', value: pendingIssues.value.length || stats.value.issueStats.VIOLATION || 0, unit: '', theme: 'warning' as const, trend: undefined, trendUnit: '项' },
    { label: '平均耗时', value: formatAvgTime(stats.value.averageProcessingTimeMs), unit: '', theme: 'success' as const, trend: undefined, trendUnit: '%' },
  ])

  const currentKpiList = computed(() => viewMode.value === 'admin' ? adminKpiList.value : userKpiList.value)

  // ===== 问题操作 =====
  const handleConfirmIssue = (issue: any) => {
    ElMessage.success('已确认该问题')
    pendingIssues.value = pendingIssues.value.filter(i => i.id !== issue.id)
  }

  const handleFalsePositive = async (issue: any) => {
    try {
      if (issue.id) {
        await toggleFalsePositiveApi(issue.id, { isFalsePositive: true, reason: '用户标记为误报' })
        ElMessage.success('已标记为误报')
      } else { ElMessage.info('已记录误报反馈') }
      pendingIssues.value = pendingIssues.value.filter(i => i.id !== issue.id)
    } catch (e) { ElMessage.error('标记误报失败') }
  }

  const handleFeedback = () => { router.push('/feedback/submit') }

  // ===== 数据获取 =====
  const fetchStats = async (renderCharts?: () => void) => {
    try {
      const statsParams: any = {}
      if (viewMode.value === 'user') {
        statsParams.role = 'user'
        statsParams.userId = userStore.userInfo?.id
      }

      const [statsRes, trendRes] = await Promise.all([
        getDashboardStatsApi(statsParams),
        getDashboardTrendApi(timeRange.value),
      ])
      const data = statsRes.data

      if (viewMode.value === 'user' && data.myTasks) {
        const byStatus = data.myTasks.by_status || {}
        stats.value = {
          taskStats: { PENDING: byStatus.PENDING || 0, PROCESSING: byStatus.PROCESSING || 0, COMPLETED: byStatus.COMPLETED || 0, FAILED: byStatus.FAILED || 0, TOTAL: data.myTasks.total || 0 },
          issueStats: { TYPO: 0, VIOLATION: data.pendingIssues?.length || 0, TOTAL: data.pendingIssues?.length || 0 },
          frequentTypos: [], topViolations: [], departmentStats: [],
          averageProcessingTimeMs: data.avgProcessingTimeMs || 0, complianceRate: data.complianceRate || 0,
          bySeverity: { error: 0, warning: 0, info: 0 }, unhandledHigh: [],
          comparedToLastPeriod: { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
          pendingIssues: data.pendingIssues || [], trendData: trendRes.data || {},
        }
        pendingIssues.value = data.pendingIssues || []
      } else {
        const byStatus = data.taskStats || {}
        const bySeverity = data.issues?.by_severity || {}
        stats.value = {
          taskStats: { PENDING: byStatus.PENDING || 0, PROCESSING: byStatus.PROCESSING || 0, COMPLETED: byStatus.COMPLETED || 0, FAILED: byStatus.FAILED || 0, TOTAL: byStatus.TOTAL || 0 },
          issueStats: { TYPO: data.issueStats?.TYPO || 0, VIOLATION: data.issueStats?.VIOLATION || 0, TOTAL: data.issueStats?.TOTAL || 0 },
          frequentTypos: data.frequentTypos || [], topViolations: data.topViolations || [],
          departmentStats: data.departmentStats || [], averageProcessingTimeMs: data.averageProcessingTimeMs || 0,
          complianceRate: data.complianceRate || 0, bySeverity, unhandledHigh: data.unhandledHigh || [],
          comparedToLastPeriod: data.comparedToLastPeriod || { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
          pendingIssues: [], trendData: trendRes.data || {},
        }
        departmentStats.value = data.departmentStats || []
      }

      renderCharts?.()
    } catch (e) { /* 错误已在拦截器中处理 */ }
  }

  const fetchRecentTasks = async () => {
    try {
      const params: any = { page: 1, limit: 5 }
      if (viewMode.value === 'user') params.userId = userStore.userInfo?.id
      const res = await getTasksApi(params)
      const items = res.data?.items || []
      recentTasks.value = items.map((t: any) => ({
        id: t.id, title: t.title, status: t.status, timeAgo: timeAgo(t.createdAt), issueCount: t._count?.taskDetails || 0,
      }))
    } catch (e) { recentTasks.value = [] }
  }

  return {
    userStore, canSwitchView, isAdminByRole, viewMode, toggleView,
    timeRange, handleTimeRangeChange, refreshing, handleRefresh,
    stats, departmentStats, recentTasks, pendingIssues, currentDate, now,
    feedbackLoading, feedbackStats, feedbackStatsList, loadFeedbackStats, filterByStatus,
    formatAvgTime, getStatusLabel, getStatusTagType, getSeverityLevel, timeAgo,
    deptColors, getDeptColor, isDeptRowHighlight,
    adminKpiList, userKpiList, currentKpiList,
    handleConfirmIssue, handleFalsePositive, handleFeedback,
    fetchStats, fetchRecentTasks,
  }
}
