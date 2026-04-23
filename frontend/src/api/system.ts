import request from '@/utils/request'
import type { SystemConfig, Department, Employee, LlmTestResult } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 系统配置管理 ====================

// 获取系统配置
export function getSystemConfigApi(key: string) {
  return request.get<SystemConfig>(`/system-config/${key}`)
}

// 保存系统配置
export function saveSystemConfigApi(key: string, value: any) {
  return request.put<SystemConfig>(`/system-config/${key}`, { value })
}

// 测试 LLM 连接
export function testLlmConnectionApi(data: any) {
  return request.post<LlmTestResult>('/system-config/test-llm', data)
}

// 发送 LLM 测试消息
export function sendLlmTestApi(data: any) {
  return request.post<LlmTestResult>('/system-config/test-llm-send', data)
}

// ==================== 部门管理 ====================

export function getDepartmentsTreeApi() {
  return request.get<Department[]>('/departments')
}

export function createDepartmentApi(data: { name: string; parentId?: string }) {
  return request.post<Department>('/departments', data)
}

export function updateDepartmentApi(id: string, data: { name?: string; parentId?: string }) {
  return request.put<Department>(`/departments/${id}`, data)
}

export function deleteDepartmentApi(id: string) {
  return request.delete<{ message: string }>(`/departments/${id}`)
}

// ==================== 员工管理 ====================

export function getEmployeesApi(params?: {
  page?: number
  limit?: number
  departmentId?: string
  role?: string
  search?: string
  includeChildren?: boolean
}) {
  return request.get<PaginatedResponse<Employee>>('/employees', { params })
}

export function getEmployeeByIdApi(id: string) {
  return request.get<Employee>(`/employees/${id}`)
}

export function createEmployeeApi(data: {
  username: string
  password?: string
  name?: string
  role?: string
  email?: string
  departmentId?: string
}) {
  return request.post<Employee>('/employees', data)
}

export function updateEmployeeApi(id: string, data: any) {
  return request.put<Employee>(`/employees/${id}`, data)
}

export function deleteEmployeeApi(id: string) {
  return request.delete<{ message: string }>(`/employees/${id}`)
}

// 批量创建员工
export function batchCreateEmployeesApi(employees: Array<{
  username: string
  password?: string
  name: string
  role?: string
  departmentId?: string
  email?: string
}>) {
  return request.post<{ successCount: number; failCount: number; errors: string[] }>('/employees/batch-create', { employees })
}

// 批量启用/禁用
export function batchUpdateStatusApi(ids: string[], enabled: boolean) {
  return request.post<{ count: number }>('/employees/batch-update-status', { ids, enabled })
}

// 批量删除
export function batchDeleteEmployeesApi(ids: string[]) {
  return request.post<{ count: number }>('/employees/batch-delete', { ids })
}

// 重置密码
export function resetPasswordApi(id: string, password?: string) {
  return request.post<{ message: string }>(`/employees/reset-password/${id}`, { password })
}

// ==================== 存储管理 ====================

export interface StorageStats {
  totalFiles: number
  totalSize: number
  totalSizeMB: string
  referencedFiles: number
  referencedSize: number
  referencedSizeMB: string
  orphanedFiles: number
  orphanedSize: number
  orphanedSizeMB: string
}

export interface CleanupResult {
  deleted: number
  freedSpace: number
  files: string[]
}

// 获取存储统计
export function getStorageStatsApi() {
  return request.get<StorageStats>('/system/storage-stats')
}

// 清理孤立文件
export function cleanupFilesApi(days: number = 7) {
  return request.post<CleanupResult>(`/system/cleanup-files?days=${days}`)
}
