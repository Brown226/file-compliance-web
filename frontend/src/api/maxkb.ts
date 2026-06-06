import request from '@/utils/request'
import type { MaxKBStatus, MaxKBHitTestResult, KnowledgeBaseItem, KnowledgeTreeNode } from '@/types/models'

// ==================== MaxKB 集成管理 ====================

// 获取 MaxKB 集成状态
export function getMaxKBStatusApi() {
  return request.get<MaxKBStatus>('/maxkb/status')
}

// 一键初始化 MaxKB 集成
export function initializeMaxKBApi() {
  return request.post<MaxKBStatus>('/maxkb/initialize')
}

// 知识库命中测试
export function maxKBHitTestApi(data: { query: string; topNumber?: number }) {
  return request.post<MaxKBHitTestResult>('/maxkb/hit-test', data)
}

// 获取 MaxKB 配置
export function getMaxKBConfigApi() {
  return request.get<Record<string, any>>('/maxkb/config')
}

// 保存 MaxKB 配置
export function saveMaxKBConfigApi(data: {
  baseUrl?: string
  username?: string
  password?: string
}) {
  return request.put<Record<string, any>>('/maxkb/config', data)
}

// 测试 MaxKB 连接
export function testMaxKBConnectionApi(data: {
  baseUrl?: string
  username?: string
  password?: string
}) {
  return request.post<{ reachable: boolean; error?: string }>('/maxkb/test-connection', data)
}

// 获取 MaxKB 知识库管理页面 URL
export function getMaxKBKnowledgeUrlApi() {
  return request.get<{ url: string }>('/maxkb/knowledge-url')
}

// 获取可选的知识库列表
export function getKnowledgeBasesApi() {
  return request.get<KnowledgeBaseItem[]>('/maxkb/knowledge-bases')
}

// 获取知识库树形结构
export function getKnowledgeTreeApi() {
  return request.get<KnowledgeTreeNode[]>('/maxkb/knowledge-tree')
}

// 获取 MaxKB 应用列表
export function getApplicationsApi() {
  return request.get<Array<{
    id: string; name: string; desc: string; is_publish: boolean;
    type: string; chatUrl: string; create_time: string;
  }>>('/maxkb/applications')
}

// ==================== iframe 嵌入 API ====================

/** 获取嵌入 URL（后端按 userId + applicationId 持久化 token） */
export function getEmbedUrlApi(applicationId: string) {
  return request.get<{ embedUrl: string; applicationId: string }>('/maxkb/embed-url', {
    params: { applicationId }
  })
}

/** 清理嵌入会话（下次进入重新签发 token） */
export function clearEmbedSessionApi(applicationId: string) {
  return request.post<any>('/maxkb/embed-session/clear', { applicationId })
}
