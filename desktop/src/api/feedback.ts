import request from '@/utils/request'
import type { Feedback } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 反馈建议 ====================

// 提交反馈（支持文件上传）
export function createFeedbackApi(formData: FormData) {
  return request.post<Feedback>('/feedback', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 获取我的反馈列表
export function getMyFeedbacksApi(params?: {
  page?: number
  limit?: number
}) {
  return request.get<PaginatedResponse<Feedback>>('/feedback/my', { params })
}

// 获取反馈详情
export function getFeedbackDetailApi(id: string) {
  return request.get<Feedback>(`/feedback/${id}`)
}

// 下载附件
export function downloadAttachmentApi(fileId: string) {
  return request.get(`/feedback/download/${fileId}`, {
    responseType: 'blob',
  })
}

// ===== 管理员接口 =====

// 获取所有反馈列表
export function getAllFeedbacksApi(params?: {
  page?: number
  limit?: number
  status?: string
  category?: string
  userId?: string
  startDate?: string
  endDate?: string
  keyword?: string
}) {
  return request.get<PaginatedResponse<Feedback>>('/feedback/admin/list', { params })
}

// 更新反馈状态
export function updateFeedbackStatusApi(id: string, data: {
  status: string
  remark?: string
}) {
  return request.put<Feedback>(`/feedback/${id}/status`, data)
}

// 删除反馈
export function deleteFeedbackApi(id: string) {
  return request.delete<{ message: string }>(`/feedback/${id}`)
}

// 批量更新状态
export function batchUpdateFeedbackStatusApi(data: {
  ids: string[]
  status: string
  remark?: string
}) {
  return request.put<{ count: number }>('/feedback/admin/batch-status', data)
}

// 批量删除
export function batchDeleteFeedbackApi(data: { ids: string[] }) {
  return request.delete<{ count: number }>('/feedback/admin/batch', { data })
}

// 获取反馈统计信息
export function getFeedbackStatsApi() {
  return request.get<{
    statusStats: Record<string, number>
    categoryStats: Record<string, number>
    trend: Array<{ date: string; count: number }>
  }>('/feedback/admin/stats')
}
