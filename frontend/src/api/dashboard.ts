import request from '@/utils/request'
import type { DashboardStats, DashboardTrend } from '@/types/models'

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
