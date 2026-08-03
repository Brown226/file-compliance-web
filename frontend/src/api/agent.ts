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
  createdAt: string
  updatedAt: string
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

/** 删除会话 */
export function deleteSessionApi(sessionId: string) {
  return request.delete<{ success: boolean; message: string }>(`/agent/sessions/${sessionId}`)
}

// ===== Trace 可观测性（Task 13）=====

export interface TraceItem {
  id: string
  sessionId: string
  stepIndex: number
  toolName: string
  input: any
  output: any
  durationMs: number | null
  status: string
  traceId: string | null
  error: string | null
  createdAt: string
}

export interface TraceWithLlmCallLog extends TraceItem {
  llmCallLog?: {
    id: number
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    latencyMs: number
    status: string
  } | null
}

/** 查询会话 trace 列表 */
export function listTracesApi(sessionId: string) {
  return request.get<TraceItem[]>(`/agent/traces/${sessionId}`)
}

/** 查询单条 trace + LlmCallLog */
export function getTraceApi(traceId: string) {
  return request.get<TraceWithLlmCallLog>(`/agent/traces/trace/${traceId}`)
}

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
