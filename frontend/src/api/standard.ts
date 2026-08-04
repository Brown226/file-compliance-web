import request from '@/utils/request'
import type { Standard, StandardCheckResult, StandardRefExtractResult, TempLibraryEntry, StandardCheckpoint, CheckpointStats } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 标准库清单管理 ====================

// 获取标准列表
export function getStandardsApi(params?: {
  page?: number
  limit?: number
  title?: string
  search?: string
  isActive?: boolean
  standardStatus?: 'CURRENT' | 'UPCOMING' | 'ABOLISHED'
  folderId?: string
  includeSubFolders?: boolean
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}) {
  return request.get<PaginatedResponse<Standard>>('/standards', { params })
}

// 获取标准详情
export function getStandardByIdApi(id: string) {
  return request.get<Standard>(`/standards/${id}`)
}

// 获取标准详细内容
export function getStandardDetailApi(id: string) {
  return request.get<Standard>(`/standards/${id}/detail`)
}

// 创建标准
export function createStandardApi(data: {
  title: string
  content?: string
  version?: string
  isActive?: boolean
  folderId?: string
}) {
  return request.post<Standard>('/standards', data)
}

// 通过文件上传创建标准
export function createStandardFromFileApi(formData: FormData) {
  return request.post<Standard>('/standards/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 更新标准
export function updateStandardApi(id: string, data: {
  title?: string
  content?: string | null
  version?: string
  isActive?: boolean
  folderId?: string | null
  // Normative 特有字段
  standardNo?: string
  standardName?: string
  standardIdent?: string
  standardStatus?: 'CURRENT' | 'UPCOMING' | 'ABOLISHED'
  publishDate?: string | null
  implementDate?: string | null
  abolishDate?: string | null
}) {
  return request.put<Standard>(`/standards/${id}`, data)
}

// 删除标准
export function deleteStandardApi(id: string) {
  return request.delete<{ message: string }>(`/standards/${id}`)
}

// 清空所有标准库数据（仅 ADMIN）
export function clearAllStandardsApi() {
  return request.delete<{ count: number }>('/standards')
}

// 导出标准 Excel
export function exportStandardsExcelApi() {
  return request.get<Blob>('/standards/export/excel', { responseType: 'blob' })
}

// 导入标准 Excel
export function importStandardsExcelApi(formData: FormData) {
  return request.post<{ count: number; standards: Standard[] }>('/standards/import/excel', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 下载导入模板
export function downloadStandardTemplateApi() {
  return request.get<Blob>('/standards/import/template', { responseType: 'blob' })
}

// ==================== 标准比对检查 ====================

// 实时标准比对预览
export function checkStandardApi(data: { standardNo: string; standardName?: string }) {
  return request.post<StandardCheckResult>('/standards/check', data)
}

// 从文本中提取标准引用
export function extractStandardRefsApi(data: { text: string; docType?: string }) {
  return request.post<StandardRefExtractResult>('/standards/extract-refs', data)
}

// 从 Excel 文件中按固定列提取标准引用
export function extractFromExcelColumnApi(file: File, options?: { startRow?: number; column?: number; sheetIndex?: number }) {
  const formData = new FormData()
  formData.append('file', file)
  if (options?.startRow) formData.append('startRow', String(options.startRow))
  if (options?.column) formData.append('column', String(options.column))
  if (options?.sheetIndex) formData.append('sheetIndex', String(options.sheetIndex))
  return request.post<StandardRefExtractResult>('/standards/extract/excel-column', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// ==================== 临时标准库 ====================

// 导入临时标准库（Excel）
export function importTempLibraryApi(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post<{ count: number } & TempLibraryEntry>('/standards/temp-library', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 获取临时标准库
export function getTempLibraryApi() {
  return request.get<TempLibraryEntry[]>('/standards/temp-library')
}

// 清除临时标准库
export function clearTempLibraryApi() {
  return request.delete<{ message: string }>('/standards/temp-library')
}

// 使用临时标准库进行比对
export function checkStandardWithTempApi(data: { standardNo: string; standardName?: string }) {
  return request.post<StandardCheckResult>('/standards/check-temp', data)
}

// 归档临时标准库条目为正式标准
export function archiveTempToStandardApi(entryIds: string[]) {
  return request.post<{ count: number; standards: Standard[] }>('/standards/temp-library/archive', { entryIds })
}

// 归档所有临时标准库条目
export function archiveAllTempToStandardApi() {
  return request.post<{ count: number; standards: Standard[] }>('/standards/temp-library/archive-all')
}

// ==================== Normative 格式 Excel 解析 ====================

/**
 * Normative 格式 Excel 标准库导入结果
 */
export interface NormativeImportResult {
  success: boolean
  total: number
  valid: number
  imported: number
  skipped: number
  message?: string
  errors: Array<{ row: number; message: string; data?: any }>
  preview: NormativePreviewItem[]
}

export interface NormativePreviewItem {
  row: number
  standardNo: string
  standardName: string
  standardIdent: string
  status: string
  publishDate?: string
  implementDate?: string
  repealDate?: string
  isValid: boolean
  error?: string
}

/**
 * 导入 Normative 格式 Excel 标准库
 */
export function importNormativeExcelApi(
  file: File,
  options?: {
    folderId?: string
    skipInvalidRows?: boolean
    overwriteExisting?: boolean
    dryRun?: boolean
  }
) {
  const formData = new FormData()
  formData.append('file', file)
  if (options?.folderId) formData.append('folderId', options.folderId)
  if (options?.skipInvalidRows !== undefined) formData.append('skipInvalidRows', String(options.skipInvalidRows))
  if (options?.overwriteExisting !== undefined) formData.append('overwriteExisting', String(options.overwriteExisting))
  if (options?.dryRun !== undefined) formData.append('dryRun', String(options.dryRun))
  
  return request.post<NormativeImportResult>('/standards/import/normative', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000, // 10分钟超时（大规模标准库导入需要较长时间）
  })
}

/**
 * 预览 Normative 格式 Excel 数据（不写入数据库）
 */
export function previewNormativeExcelApi(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  
  return request.post<{
    total: number
    valid: number
    errors: Array<{ row: number; message: string }>
    preview: NormativePreviewItem[]
  }>('/standards/import/normative-preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 下载 Normative 格式 Excel 导入模板
 */
export function downloadNormativeTemplateApi() {
  return request.get<Blob>('/standards/import/normative-template', { responseType: 'blob' })
}

// ==================== DEC 审点管理 ====================
// 路径前缀：/api/checkpoint
// 查询类所有登录用户可用；写操作（生成/编辑/删除）需 MANAGER 及以上。

/** 获取标准的审点列表 + 统计 */
export function getCheckpointsApi(standardId: string) {
  return request.get<{ checkpoints: StandardCheckpoint[]; stats: CheckpointStats }>(
    `/checkpoint/standards/${standardId}/checkpoints`
  )
}

/** 触发离线加工（切分 + LLM 加工 + 落库，幂等） */
export function generateCheckpointsApi(standardId: string, options?: { concurrency?: number }) {
  return request.post<{ total: number; extracted: number; skipped: number; failed: number }>(
    `/checkpoint/standards/${standardId}/checkpoints/generate`,
    options || {}
  )
}

/** 人工修正审点 */
export function updateCheckpointApi(id: string, data: {
  clauseCode?: string
  mandatory?: 'mandatory' | 'guidance'
  auditDimension?: 'compliance' | 'fact' | 'text'
  checkPrompt?: string
}) {
  return request.patch<StandardCheckpoint>(`/checkpoint/checkpoints/${id}`, data)
}

/** 删除审点 */
export function deleteCheckpointApi(id: string) {
  return request.delete<{ message: string }>(`/checkpoint/checkpoints/${id}`)
}

/** 跨标准检索审点条文（keyword 模糊匹配 clauseCode/clauseText/checkPrompt；传 standardId 时只查该标准） */
export function searchCheckpointsApi(params: { keyword?: string; standardId?: string; topNumber?: number }) {
  return request.get<{ results: CrossStandardCheckpointHit[]; total: number }>('/checkpoint/search', { params })
}

/** 跨标准检索审点命中项 */
export interface CrossStandardCheckpointHit {
  id: string
  standardId: string
  standardNo: string | null
  standardName: string | null
  standardTitle: string | null
  clauseCode: string | null
  clauseText: string | null
  checkPrompt: string | null
  auditDimension: string
  mandatory: string
}
