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

// ==================== LLM Profiles 管理 ====================

export type ProviderUsage = 'chat' | 'embedding' | 'vision' | 'rerank' | 'all'

export interface ModelCapabilities {
  inputModalities: ('text' | 'image')[]
  supportsToolCalling: boolean
  contextWindowTokens: number
  maxOutputTokens: number
  reasoning?: boolean
  supportsEmbedding?: boolean
  supportsRerank?: boolean
}

export interface LlmProfile {
  id: string
  name: string
  provider: string
  apiBase: string
  model: string
  apiKey?: string
  isActive: boolean
  isEnabled: boolean
  timeout: number
  maxRetries: number
  usage?: ProviderUsage
  capabilities?: ModelCapabilities
}

// 获取所有 LLM 配置（密钥脱敏）
export function getLlmProfilesApi() {
  return request.get<LlmProfile[]>('/system-config/llm-profiles')
}

// 保存所有 LLM 配置
export function saveLlmProfilesApi(profiles: LlmProfile[]) {
  return request.put<{ message: string }>('/system-config/llm-profiles', { profiles })
}

// 从 Provider API 地址拉取可用模型列表
export function fetchProviderModelsApi(data: { apiBase: string; apiKey?: string }) {
  return request.post<string[]>('/system-config/llm-profiles/fetch-models', data)
}

// ==================== 可观测性 P2：AI 调用看板 ====================

export interface AiCallModelStat {
  model: string
  calls: number
  totalTokens: number
  avgLatency: number
  costEstimate: number
}

export interface AiCallDailyTrend {
  date: string
  tokens: number
}

export interface AiCallStats {
  totalCalls: number
  totalTokens: number
  avgLatency: number
  errorRate: number
  modelStats: AiCallModelStat[]
  dailyTrend: AiCallDailyTrend[]
}

// 获取 AI 调用统计（看板用）
export function getAiCallStatsApi() {
  return request.get<AiCallStats>('/system-config/ai-call-stats')
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

// 查找或创建多级部门路径（批量导入用）
export function findOrCreateDepartmentPathApi(data: { level1?: string; level2?: string; level3?: string }) {
  return request.post<{ departmentId: string | null; created: string[] }>('/departments/resolve-path', data)
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
  return request.post<{ successCount: number; failCount: number; errors: string[] }>('/employees/batch-create', { employees }, { timeout: 120000 })
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

// 批量修正登录账号（按部门+姓名匹配）
export function batchUpdateUsernamesApi(employees: Array<{
  departmentId: string
  name: string
  newUsername: string
}>, dryRun?: boolean) {
  return request.post<{
    successCount: number
    failCount: number
    errors: string[]
    matched?: Array<{
      rowNum: number
      name: string
      oldUsername: string
      newUsername: string
      status: 'matched' | 'skipped' | 'conflict'
    }>
  }>('/employees/batch-update-usernames', { employees, dryRun }, { timeout: 120000 })
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

// ==================== 存储路径配置 ====================

export interface UploadPathConfig {
  effective: string
}

export interface UploadPathChangeResult {
  oldPath: string
  newPath: string
  filesAtOldPath: number
  warning: string
}

export function getUploadPathConfigApi() {
  return request.get<UploadPathConfig>('/system/config-path')
}

export function setUploadPathConfigApi(path: string) {
  return request.put<UploadPathChangeResult>('/system/config-path', { path })
}

// ==================== 规则注册表 ====================

export interface RuleMetaItem {
  prefix: string
  label: string
  description: string
  group: string
  icon: string
}

export interface RuleGroupMeta {
  title: string
  icon: string
  items: RuleMetaItem[]
}

export interface RuleRegistryData {
  groups: RuleGroupMeta[]
  total: number
  allPrefixes: string[]
}

export function getRuleRegistryApi() {
  return request.get<RuleRegistryData>('/system/rule-registry')
}

// ===== 功能开关 =====

export interface FeatureFlag {
  key: string
  label: string
  enabled: boolean
  description: string | null
  category: string
  updatedAt: string
  updatedBy: string | null
}

/** 获取启用的功能 key 集合（已认证用户可读，用于前端入口过滤） */
export function getEnabledFeatureFlagsApi() {
  return request.get<string[]>('/system/feature-flags/enabled')
}

/** 获取所有功能开关（ADMIN only，管理页用） */
export function getFeatureFlagsApi() {
  return request.get<FeatureFlag[]>('/system/feature-flags')
}

/** 更新功能开关（ADMIN only） */
export function updateFeatureFlagApi(key: string, enabled: boolean) {
  return request.put(`/system/feature-flags/${key}`, { enabled })
}

