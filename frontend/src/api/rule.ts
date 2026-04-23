import request from '@/utils/request'
import type { ReviewRule } from '@/types/models'

// ==================== 审查规则管理 ====================

// 获取规则列表（后端返回数组，非分页）
export function getRulesApi(params?: {
  category?: string
  enabled?: boolean
}) {
  return request.get<ReviewRule[]>('/rules', { params })
}

// 获取规则详情（按 code）
export function getRuleByCodeApi(code: string) {
  return request.get<ReviewRule>(`/rules/${code}`)
}

// 创建规则
export function createRuleApi(data: {
  ruleCode: string
  name: string
  category: string
  description?: string
  severity?: 'error' | 'warning' | 'info'
  enabled?: boolean
  config?: any
}) {
  return request.post<ReviewRule>('/rules', data)
}

// 更新规则（后端路由: PATCH /rules/:code）
export function updateRuleApi(code: string, data: {
  name?: string
  category?: string
  description?: string
  severity?: string
  config?: any
  enabled?: any  // 支持 boolean 和 'toggle' 字符串
}) {
  return request.patch<ReviewRule>(`/rules/${code}`, data)
}

// 删除规则
export function deleteRuleApi(code: string) {
  return request.delete<{ message: string }>(`/rules/${code}`)
}

// 切换规则启用/禁用（后端路由: POST /rules/:code/toggle）
export function toggleRuleApi(code: string) {
  return request.post<ReviewRule>(`/rules/${code}/toggle`)
}

// 获取规则分类列表
export function getRuleCategoriesApi() {
  return request.get<string[]>('/rules/categories')
}

// 批量启用/禁用（后端路由: POST /rules/batch-toggle）
export function batchToggleRulesApi(ids: string[], enabled: boolean) {
  return request.post<{ message: string; updatedCount: number }>('/rules/batch-toggle', { ids, enabled })
}

// 重置规则为默认配置（后端路由: POST /rules/reset）
export function resetRulesApi() {
  return request.post<{ message: string; resetCount: number }>('/rules/reset')
}

// 测试规则匹配效果
export function testMatchApi(ruleCode: string, testText: string) {
  return request.post<{
    ruleCode: string
    ruleName: string
    matched: boolean
    matchedContent: string
    matchDetails: string
    testTextLength: number
  }>('/rules/test-match', { ruleCode, testText })
}

// 批量导入规则
export function importRulesApi(rules: Array<{
  ruleCode: string
  name: string
  category: string
  description?: string
  severity?: 'error' | 'warning' | 'info'
  enabled?: boolean
  config?: any
}>) {
  return request.post<{
    importedCount: number
    skippedCount: number
    total: number
    errors?: string[]
  }>('/rules/import', { rules })
}

// ==================== 审查模式控制面板 ====================

// 获取控制面板数据（各分类统计 + 启用状态）
export function getRulePanelDataApi() {
  return request.get<{
    categories: Array<{
      prefix: string
      label: string
      description: string
      totalRules: number
      enabledRules: number
      allEnabled: boolean
      allDisabled: boolean
      partiallyEnabled: boolean
      category: string
      ruleCodes: string[]
    }>
    totalRules: number
  }>('/rules/panel-data')
}

// 按前缀批量切换规则启用/禁用
export function toggleRulesByPrefixApi(prefixes: string[], enabled: boolean) {
  return request.post<{ updatedCount: number; prefixes: string[]; enabled: boolean }>('/rules/toggle-by-prefix', {
    prefixes,
    enabled,
  })
}
