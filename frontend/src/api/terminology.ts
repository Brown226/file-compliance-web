import request from '@/utils/request'
import type { PaginatedResponse } from '@/types/api'

// ==================== 专业术语白名单 ====================

/** 术语条目 */
export interface TerminologyEntry {
  id: string
  term: string
  category: string
  aliases: string[]
  isBuiltin: boolean
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}

/** 分类统计 */
export interface TerminologyCategory {
  category: string
  count: number
}

/** 获取术语分类列表 */
export function getTerminologyCategoriesApi() {
  return request.get<TerminologyCategory[]>('/terminology/categories')
}

/** 查询术语列表 */
export function getTerminologyListApi(params?: {
  q?: string
  category?: string
  page?: number
  pageSize?: number
}) {
  return request.get<PaginatedResponse<TerminologyEntry>>('/terminology', { params })
}

/** 新增术语 */
export function createTerminologyApi(data: {
  term: string
  category: string
  aliases?: string[]
}) {
  return request.post<TerminologyEntry>('/terminology', data)
}

/** 更新术语 */
export function updateTerminologyApi(id: string, data: {
  term?: string
  category?: string
  aliases?: string[]
}) {
  return request.put<TerminologyEntry>(`/terminology/${id}`, data)
}

/** 删除术语 */
export function deleteTerminologyApi(id: string) {
  return request.delete<{ message: string }>(`/terminology/${id}`)
}

/** 批量新增术语 */
export function batchCreateTerminologyApi(items: Array<{
  term: string
  category: string
  aliases?: string[]
}>) {
  return request.post<{ count: number; items: TerminologyEntry[] }>('/terminology/batch', { items })
}
