import request from '@/utils/request'

export interface QASession {
  id: string
  title?: string
  taskId?: string
  _count?: { messages: number }
  createdAt: string
  updatedAt: string
}

export interface QAMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export const getQASessionsApi = () =>
  request.get<QASession[]>('/qa/sessions')

export const createQASessionApi = (data?: { title?: string; taskId?: string }) =>
  request.post<QASession>('/qa/sessions', data ?? {})

export const deleteQASessionApi = (sessionId: string) =>
  request.delete(`/qa/sessions/${sessionId}`)

export const getQAHistoryApi = (sessionId: string) =>
  request.get<QAMessage[]>(`/qa/sessions/${sessionId}/history`)

export const getQAStreamUrl = () => {
  const base = request.defaults?.baseURL || '/api'
  return `${base}/qa/ask-stream`
}
