/**
 * Agent API 封装
 *
 * Task 14/17/18：会话历史 + 记忆管理相关端点
 */
import request from '@/utils/request'

// ===== 会话历史（Task 14）=====

export interface SessionListItem {
  id: string
  title: string | null
  taskId: string | null
  messageCount: number
  lastMessagePreview: string | null
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionDetail {
  id: string
  title: string | null
  taskId: string | null
  userId: string
  /** 会话选用的模型（<providerId>::<modelName>，null = 系统默认） */
  modelKey: string | null
  /** 工具预设：none / default / full */
  toolPreset: string
  /** 推理强度：low / medium / high（模型不支持时忽略） */
  thinkingLevel: string | null
  createdAt: string
  updatedAt: string
}

/** 会话设置（模型 / 工具预设 / 推理强度），null 表示重置为默认 */
export interface SessionSettings {
  modelKey?: string | null
  toolPreset?: string
  thinkingLevel?: string | null
}

export interface MessageItem {
  id: string
  sessionId: string
  role: string
  content: string
  status: string
  sources: any
  debug: any
  createdAt: string
  updatedAt: string
}

/** 列出用户会话 */
export function listSessionsApi(limit = 50) {
  return request.get<SessionListItem[]>('/agent/sessions', { params: { limit } })
}

/** 查询会话详情 */
export function getSessionApi(sessionId: string) {
  return request.get<SessionDetail>(`/agent/sessions/${sessionId}`)
}

/** 查询会话消息列表 */
export function listMessagesApi(sessionId: string) {
  return request.get<MessageItem[]>(`/agent/sessions/${sessionId}/messages`)
}

/** 重命名会话 */
export function renameSessionApi(sessionId: string, title: string) {
  return request.patch<SessionDetail>(`/agent/sessions/${sessionId}`, { title })
}

/** 更新会话设置（模型/工具预设/推理强度，per-session 持久化） */
export function updateSessionSettingsApi(sessionId: string, settings: SessionSettings) {
  return request.patch<SessionDetail>(`/agent/sessions/${sessionId}`, { settings })
}

// ===== 模型与 Provider（2026-08-03 新增：多 provider 模型路由）=====

export interface AgentModelOption {
  key: string | null  // <providerId>::<modelName>，null = 系统默认
  label: string
}

export interface AgentModelsResponse {
  defaultKey: string | null
  models: AgentModelOption[]
}

/** 可用模型列表（含系统默认） */
export function listAgentModelsApi() {
  return request.get<AgentModelsResponse>('/agent/models')
}

// ===== LLM 供应商配置（ModelsConfig 弹窗数据源，2026-08-04 新增）=====

export interface AgentProviderCapabilities {
  inputModalities?: string[]
  reasoning?: boolean
  [k: string]: any
}

export interface AgentProviderProfile {
  id: string
  name: string
  provider?: string
  apiBase?: string
  apiKey?: string
  model?: string
  isActive?: boolean
  isEnabled?: boolean
  timeout?: number
  usage?: string
  capabilities?: AgentProviderCapabilities
}

export interface AgentProviderTestResult {
  ok: boolean
  contextWindow?: number
  maxOutput?: number
  reasoning?: boolean
  message?: string
}

/** 读取 LLM 供应商配置（llm_profiles 数组） */
export function listAgentProvidersApi() {
  return request.get<AgentProviderProfile[]>('/agent/providers')
}

/** 保存 LLM 供应商配置（全量覆盖 llm_profiles） */
export function saveAgentProvidersApi(profiles: AgentProviderProfile[]) {
  return request.put<AgentProviderProfile[]>('/agent/providers', { profiles })
}

/** 模型连通性测试 */
export function testAgentModelApi(data: { apiBase: string; apiKey: string; model: string }) {
  return request.post<AgentProviderTestResult>('/agent/models/test', data)
}

/** 从 Provider 的 /models 接口批量拉取模型列表（参考项目 pi 的 discover 能力） */
export interface DiscoveredAgentModel {
  id: string
  name?: string
  /** 上游 /models 返回的能力信息（有则自动回填） */
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  inputModalities?: string[]
}

export function discoverAgentModelsApi(data: {
  providerName: string
  provider: { baseUrl?: string; api?: string; apiKey?: string }
}) {
  return request.post<{ models: DiscoveredAgentModel[]; endpoint: string }>('/agent/providers/discover', data)
}

/** 本地模型目录填充（替代参考项目 models.dev，用本地预置能力库） */
export interface AgentCatalogRecommendation {
  name?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
}

export function agentCatalogApi(data: { model: string }) {
  return request.post<{ matched: boolean; recommendation: AgentCatalogRecommendation | null }>(
    '/agent/providers/catalog',
    data,
  )
}

/** 手动压缩会话上下文（早期消息 → LLM 摘要） */
export function compactSessionApi(sessionId: string) {
  return request.post<{ truncatedMessages: number; estimatedTokens: number; hasSummary: boolean }>(
    `/agent/sessions/${sessionId}/compact`,
  )
}

/** 删除会话 */
export function deleteSessionApi(sessionId: string) {
  return request.delete<{ success: boolean; message: string }>(`/agent/sessions/${sessionId}`)
}

// ===== 上传文件内容读取（右栏文件查看器数据源，2026-08-04 新增）=====

export type AgentFileReadKind = 'text' | 'image' | 'pdf' | 'binary'

export interface AgentFileReadResult {
  filePath: string
  fileName: string
  ext: string
  size: number
  kind: AgentFileReadKind
  content?: string    // kind=text 时返回
  base64?: string     // kind=image/pdf 时返回
  mime: string
}

/**
 * 读取当前用户上传的临时文件内容（右栏查看器预览用）。
 * 仅允许读取当前用户 agent_temp 目录下的文件，跨目录/不存在会返回 403/404。
 */
export function readAgentFileApi(filePath: string) {
  return request.get<AgentFileReadResult>('/agent/files/read', {
    params: { filePath },
  })
}

// 注：Trace 可观测性 API 已随 AgentTrace 链路移除（2026-08-03），
// 工具执行过程由 QAMessage 承载，token 统计见 getSessionStatsApi

// ===== 记忆管理（Task 18）=====

export interface MemoryItem {
  id: string
  userId: string
  type: string  // preference / routine / feedback
  key: string
  value: string
  confidence: number
  source: string | null
  scope: string  // global / project / session
  createdAt: string
  updatedAt: string
}

/** 列出用户记忆（支持 type/scope 过滤） */
export function listMemoriesApi(params?: { type?: string; scope?: string }) {
  return request.get<MemoryItem[]>('/agent/memory', { params })
}

/** 更新记忆（value 和/或 confidence，value 变化时自动重新生成 embedding） */
export function updateMemoryApi(memoryId: string, data: { value?: string; confidence?: number }) {
  return request.put<{ success: boolean; message: string }>(`/agent/memory/${memoryId}`, data)
}

/** 删除记忆 */
export function deleteMemoryApi(memoryId: string) {
  return request.delete<{ success: boolean; message: string }>(`/agent/memory/${memoryId}`)
}

// ===== 会话统计 + 自动命名 =====

export interface SessionStats {
  sessionId: string
  sessionName: string | null
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  contextUsage: {
    percent: number | null
    contextWindow: number
    tokens: number | null
  }
}

/** 查询会话 token 用量统计 */
export function getSessionStatsApi(sessionId: string) {
  return request.get<SessionStats>(`/agent/sessions/${sessionId}/stats`)
}

/** 自动生成会话标题 */
export function autoNameSessionApi(sessionId: string) {
  return request.post<{ title: string }>(`/agent/sessions/${sessionId}/auto-name`)
}

// ===== Skills 管理（2026-08-03 新增：场景化能力 = SKILL.md）=====

export interface AgentSkill {
  name: string
  description: string
  disabled: boolean
  fileName: string
  content: string
  updatedAt: string
}

/** 列出全部 skills（含禁用） */
export function listSkillsApi() {
  return request.get<AgentSkill[]>('/agent/skills')
}

/** 读取单个 skill */
export function getSkillApi(name: string) {
  return request.get<AgentSkill>(`/agent/skills/${name}`)
}

/** 新建 skill */
export function createSkillApi(data: { name: string; description: string; content: string }) {
  return request.post<AgentSkill>('/agent/skills', data)
}

/** 更新 skill（description/content 至少一个） */
export function updateSkillApi(name: string, data: { description?: string; content?: string }) {
  return request.put<AgentSkill>(`/agent/skills/${name}`, data)
}

/** 启用/禁用 skill */
export function setSkillEnabledApi(name: string, enabled: boolean) {
  return request.patch<AgentSkill>(`/agent/skills/${name}`, { enabled })
}

/** 删除 skill */
export function deleteSkillApi(name: string) {
  return request.delete(`/agent/skills/${name}`)
}

// ===== Worktree 管理（2026-08-03 新增：Agent 多任务规划工作区）=====

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
}

/** 列出全部 worktree */
export function listWorktreesApi() {
  return request.get<WorktreeInfo[]>('/agent/worktrees')
}

/** 新建 worktree（新分支） */
export function createWorktreeApi(branch: string) {
  return request.post<WorktreeInfo>('/agent/worktrees', { branch })
}

/** 删除 worktree（仅非主工作区） */
export function deleteWorktreeApi(path: string) {
  return request.delete(`/agent/worktrees?path=${encodeURIComponent(path)}`)
}
