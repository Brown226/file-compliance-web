import request from '@/utils/request'
import type { PromptTemplate, PromptModule } from '@/types/models'

// ==================== 提示词模板管理 ====================

// 获取所有提示词模板
export function getPromptTemplatesApi(params?: { module?: string }) {
  return request.get<PromptTemplate[]>('/prompt-templates', { params })
}

// 获取模块列表
export function getPromptModulesApi() {
  return request.get<PromptModule[]>('/prompt-templates/modules')
}

// 获取单个模板
export function getPromptTemplateApi(key: string) {
  return request.get<PromptTemplate>(`/prompt-templates/${key}`)
}

// 更新模板内容
export function updatePromptTemplateApi(key: string, content: string) {
  return request.put<PromptTemplate>(`/prompt-templates/${key}`, { content })
}

// 重置为默认值
export function resetPromptTemplateApi(key: string) {
  return request.post<PromptTemplate>(`/prompt-templates/${key}/reset`)
}

// 批量重置所有模板
export function resetAllPromptTemplatesApi() {
  return request.post<{ message: string; count: number }>('/prompt-templates/reset-all')
}

// 启用/禁用模板
export function togglePromptTemplateApi(key: string, enabled: boolean) {
  return request.patch<PromptTemplate>(`/prompt-templates/${key}/toggle`, { enabled })
}

// 初始化内置模板
export function seedPromptTemplatesApi() {
  return request.post<{ message: string; count: number }>('/prompt-templates/seed')
}
