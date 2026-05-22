import request from '@/utils/request'

export interface LangChainSearchResult {
  id: string
  title: string | null
  clauseId: string | null
  content: string
  score: number
  rerankScore?: number
  chunkIndex: number
  isTable: boolean
  metadata: any
  source?: string
}

export interface LangChainHitTestResult {
  originalQuery: string
  multiQueryVariants?: string[]
  hydeAnswer?: string
  results: LangChainSearchResult[]
  stats: {
    totalCandidates: number
    afterRerank: number
    searchTimeMs: number
    multiQueryTimeMs?: number
    hydeTimeMs?: number
  }
}

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

export const langchainSearchApi = (data: {
  query: string
  categoryId?: string
  sourceTypes?: string[]
  limit?: number
  enableMultiQuery?: boolean
  enableHyDE?: boolean
  minSimilarity?: number
}) => request.post<LangChainSearchResult[]>('/langchain/search', data)

export const langchainHitTestApi = (data: {
  query: string
  categoryId?: string
  sourceTypes?: string[]
  topNumber?: number
  enableMultiQuery?: boolean
  enableHyDE?: boolean
}) => request.post<LangChainHitTestResult>('/langchain/hit-test', data)

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
