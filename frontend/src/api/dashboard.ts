import request from '@/utils/request'
import type { DashboardStats, DashboardTrend } from '@/types/models'

// ==================== 系统健康检查 ====================

export interface ServiceHealth {
  status: string
  error?: string
}

export interface SystemHealthResult {
  status: 'healthy' | 'partial'
  services: Record<string, ServiceHealth>
}

// 综合健康检查（后端实时探测各依赖服务真实状态）
// 注意：该接口返回 { status, services } 原始格式（非 {code,data} 包装）
export function getSystemHealthApi() {
  return request.get<SystemHealthResult>('/all')
}

// ==================== 仪表盘 ====================

// 获取看板统计数据（支持角色区分：role=user时获取个人统计）
export function getDashboardStatsApi(params?: { role?: string; userId?: string }) {
  return request.get<DashboardStats>('/dashboard/stats', { params })
}

// 获取趋势数据
export function getDashboardTrendApi(days?: number) {
  return request.get<DashboardTrend[]>('/dashboard/trend', {
    params: { days: days || 30 }
  })
}

// ==================== OPT-015: 审查质量指标 ====================

export interface ReviewPrecision {
  /** P1-4: 无反馈时为 null（避免"100% 精确率"假象） */
  precision: number | null
  totalIssues: number
  usefulCount: number
  falsePositiveCount: number
  missedCount: number
  feedbackRate: number
}

export interface ReviewTrendPoint {
  date: string
  precision: number | null
  totalIssues: number
  feedbackCount: number
}

export interface TopFalsePositiveRule {
  issueType: string
  /** P1-4: 按 (issueType, ruleCode) 分组 */
  ruleCode: string | null
  /** P1-4: 聚合 sum(count)，标记 N 次计 N */
  count: number
}

export interface ReviewMetricsResult {
  precision: ReviewPrecision
  trend: ReviewTrendPoint[]
  topFalsePositiveRules: TopFalsePositiveRule[]
}

export type FeedbackType = 'useful' | 'false_positive' | 'missed'

// 获取审查质量指标（precision/recall 趋势 + Top 误报规则）
export function getReviewMetricsApi(params?: {
  startDate?: string
  endDate?: string
  granularity?: 'daily' | 'weekly'
  days?: number
}) {
  return request.get<ReviewMetricsResult>('/dashboard/review-metrics', { params })
}

// 提交单条审查结果反馈（useful/false_positive/missed）
export function submitReviewFeedbackApi(
  taskId: string,
  detailId: string,
  data: { feedbackType: FeedbackType; fileId?: string }
) {
  return request.post(`/dashboard/tasks/${taskId}/details/${detailId}/feedback`, data)
}
