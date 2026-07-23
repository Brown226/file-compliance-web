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
