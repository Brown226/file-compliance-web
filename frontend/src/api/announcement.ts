import request from '@/utils/request'
import type { SystemAnnouncement } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 系统公告 ====================

// ===== 管理员接口 =====

// 创建公告草稿
export function createAnnouncementApi(data: {
  title: string
  content: string
  urgency: string
}) {
  return request.post<SystemAnnouncement>('/announcements', data)
}

// 更新公告草稿
export function updateAnnouncementApi(id: string, data: {
  title?: string
  content?: string
  urgency?: string
}) {
  return request.put<SystemAnnouncement>(`/announcements/${id}`, data)
}

// 发布公告
export function publishAnnouncementApi(id: string) {
  return request.put<SystemAnnouncement>(`/announcements/${id}/publish`)
}

// 撤回公告
export function withdrawAnnouncementApi(id: string) {
  return request.put<SystemAnnouncement>(`/announcements/${id}/withdraw`)
}

// 删除公告
export function deleteAnnouncementApi(id: string) {
  return request.delete<{ message: string }>(`/announcements/${id}`)
}

// 获取公告列表（管理员）
export function getAnnouncementsApi(params?: {
  page?: number
  limit?: number
  status?: string
  urgency?: string
  keyword?: string
}) {
  return request.get<PaginatedResponse<SystemAnnouncement>>('/announcements/admin/list', { params })
}

// ===== 用户接口 =====

// 获取未读公告
export function getUnreadAnnouncementsApi() {
  return request.get<SystemAnnouncement[]>('/announcements/unread')
}

// 标记公告为已读
export function markAnnouncementReadApi(id: string, data?: {
  confirmed?: boolean
}) {
  return request.post<{ message: string }>(`/announcements/${id}/read`, data || {})
}

// 批量标记公告为已读
export function markAllAnnouncementsReadApi(data: {
  announcementIds: string[]
}) {
  return request.post<{ message: string }>('/announcements/read-all', data)
}

// 获取公告历史
export function getAnnouncementHistoryApi(params?: {
  page?: number
  limit?: number
  urgency?: string
  keyword?: string
}) {
  return request.get<PaginatedResponse<SystemAnnouncement>>('/announcements/history', { params })
}

// 获取公告详情
export function getAnnouncementDetailApi(id: string) {
  return request.get<SystemAnnouncement>(`/announcements/${id}`)
}
