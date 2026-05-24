import request from '@/utils/request'

export interface LangChainAskResult {
  answer: string
  sources: Array<{
    content: string
    document_name: string
    similarity: number
  }>
  debug: {
    multiQueryVariants?: string[]
    hydeAnswer?: string
    retrievedCount: number
    afterCompressionCount: number
    rerankApplied: boolean
  }
}

export interface Conversation {
  id: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface ConversationDetail extends Conversation {
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    status?: string
    sources?: any
    debug?: any
    createdAt: string
  }>
}

export interface MessageStatus {
  id: string
  content: string
  status: 'processing' | 'completed' | 'failed'
  sources?: any
  debug?: any
  createdAt: string
  updatedAt: string
}

export const langchainAskApi = (data: {
  question: string
  categoryIds: string[]
  history?: Array<{ role: string; content: string }>
  topK?: number
  enableMultiQuery?: boolean
  enableHyDE?: boolean
  enableCompression?: boolean
}) => request.post<LangChainAskResult>('/langchain/ask', data)

export const langchainReviewApi = (data: {
  text: string
  categoryIds: string[]
  chunkSize?: number
  topK?: number
  scene?: string
  enableMultiQuery?: boolean
  enableHyDE?: boolean
  enableCompression?: boolean
}) => request.post('/langchain/review', data)

export const getLangChainStreamUrl = () => {
  const base = request.defaults?.baseURL || '/api'
  return `${base}/langchain/ask-stream`
}

// 后台问答 API
export const langchainAskBackgroundApi = (data: {
  question: string
  categoryIds: string[]
  sessionId?: string
  history?: Array<{ role: string; content: string }>
  topK?: number
  enableMultiQuery?: boolean
  enableHyDE?: boolean
  enableCompression?: boolean
}) => request.post<{
  sessionId: string
  userMessageId: string
  assistantMessageId: string
}>('/langchain/ask-background', data)

// 获取消息状态
export const getMessageStatusApi = (messageId: string) =>
  request.get<MessageStatus>(`/langchain/messages/${messageId}/status`)

// 批量获取消息状态
export const getMessagesStatusApi = (messageIds: string[]) =>
  request.post<MessageStatus[]>('/langchain/messages/status', { messageIds })

// 对话记录管理 API
export const getConversationsApi = () =>
  request.get<Conversation[]>('/langchain/conversations')

export const getConversationApi = (id: string) =>
  request.get<ConversationDetail>(`/langchain/conversations/${id}`)

export const createConversationApi = (title?: string) =>
  request.post<Conversation>('/langchain/conversations', { title })

export const updateConversationApi = (id: string, title: string) =>
  request.put<Conversation>(`/langchain/conversations/${id}`, { title })

export const deleteConversationApi = (id: string) =>
  request.delete(`/langchain/conversations/${id}`)

export const saveMessageApi = (sessionId: string, role: string, content: string) =>
  request.post(`/langchain/conversations/${sessionId}/messages`, { role, content })
