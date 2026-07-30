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
