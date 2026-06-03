import request from '@/utils/request'

export interface FpLibraryItem {
  id: string
  originalText: string
  fpReason?: string
  issueType?: string
  ruleCode?: string
  severity?: string
  markedById?: string
  markedByName?: string
  taskId?: string
  taskTitle?: string
  count: number
  lastMarkedAt: string
  createdAt: string
}

export interface FpLibraryQuery {
  issueType?: string
  ruleCode?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface FpLibraryListResponse {
  records: FpLibraryItem[]
  total: number
  page: number
  pageSize: number
}

export interface FpLibraryStats {
  total: number
  recentCount: number
  byType: { type: string; count: number }[]
}

/**
 * 获取误报标记库列表
 */
export function getFpLibraryListApi(params: FpLibraryQuery) {
  return request.get<FpLibraryListResponse>('/false-positive-library', { params })
}

/**
 * 获取误报标记库统计
 */
export function getFpLibraryStatsApi() {
  return request.get<FpLibraryStats>('/false-positive-library/stats')
}

/**
 * 删除误报记录
 */
export function deleteFpLibraryItemApi(id: string) {
  return request.delete(`/false-positive-library/${id}`)
}

/**
 * 导出误报标记库
 */
export function exportFpLibraryApi(params?: FpLibraryQuery) {
  return request.get('/false-positive-library/export', {
    params,
    responseType: 'blob',
  })
}
