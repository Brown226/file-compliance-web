/**
 * 平台运营看板扩展 API
 * 对应后端 /api/dashboard 下的 4 个新接口
 */
import request from '@/utils/request'

// ==================== 在线用户 ====================

export interface OnlineUser {
  id: string
  name: string
  username: string
  role: string
  departmentName: string | null
  lastLoginAt: string | null
}

export interface OnlineUsersResult {
  onlineCount: number
  todayLoginCount: number
  users: OnlineUser[]
}

export function getOnlineUsersApi() {
  return request.get<OnlineUsersResult>('/dashboard/online-users')
}

// ==================== 活跃度趋势 ====================

export interface ActivityMetrics {
  dau: number
  wau: number
  avgDau: number
  totalTasks: number
  avgTasksPerUser: number
}

export interface ActivityTrendPoint {
  date: string
  activeUsers: number
  taskCount: number
}

export interface ActivityResult {
  days: number
  metrics: ActivityMetrics
  trend: ActivityTrendPoint[]
}

export function getActivityApi(days: number = 30) {
  return request.get<ActivityResult>('/dashboard/activity', { params: { days } })
}

// ==================== LLM Token 用量 ====================

export interface LlmUsageSummary {
  totalCalls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  avgLatencyMs: number
  successRate: number
}

export interface LlmUsageByDay {
  date: string
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface LlmUsageByModel {
  model: string
  calls: number
  totalTokens: number
  avgLatencyMs: number
}

export interface LlmUsageResult {
  days: number
  summary: LlmUsageSummary
  byDay: LlmUsageByDay[]
  byModel: LlmUsageByModel[]
}

export function getLlmUsageApi(days: number = 30) {
  return request.get<LlmUsageResult>('/dashboard/llm-usage', { params: { days } })
}

// ==================== 部门使用度 ====================

export interface DepartmentStat {
  id: string
  name: string
  userCount: number
  taskCount: number
  completedCount: number
  complianceRate: number
  tokenUsage: number
  lastActiveAt: string | null
}

export interface DepartmentStatsResult {
  departments: DepartmentStat[]
  totalDepartments: number
}

export function getDepartmentStatsApi() {
  return request.get<DepartmentStatsResult>('/dashboard/department-stats')
}
