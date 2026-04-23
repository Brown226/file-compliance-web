import request from '@/utils/request'
import type { AuditLog } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 审计日志 ====================

// 获取审计日志
export function getAuditLogsApi(params?: {
  page?: number
  limit?: number
  action?: string
  resource?: string
}) {
  return request.get<PaginatedResponse<AuditLog>>('/audit-logs', { params })
}

// 导出审计日志 CSV
export function exportAuditLogsApi(params?: {
  action?: string
  startDate?: string
  endDate?: string
}) {
  return request.get('/audit-logs/export', {
    params,
    responseType: 'blob',
  })
}
