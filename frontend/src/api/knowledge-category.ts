import request from '@/utils/request'

export interface KnowledgeCategory {
  id: string
  name: string
  description?: string
  status: 'ACTIVE' | 'ARCHIVED'
  parentId?: string
  children?: KnowledgeCategory[]
  _count?: { vectorDocuments: number }
  chunkMode?: 'auto' | 'fixed' | 'paragraph'
  maxChars?: number
  overlap?: number
  minSimilarity?: number
  directReturnThreshold?: number
  maxReferenceChars?: number
  enableRerank?: boolean
  embeddingUseDocumentTitle?: boolean
  embeddingUseClauseId?: boolean
  isLeaf?: boolean
  createdAt: string
}

export interface KnowledgeTreeNode {
  id: string
  name: string
  isLeaf: boolean
  type: 'folder' | 'knowledge'
  parentId?: string | null
  documentCount?: number
  children?: KnowledgeTreeNode[]
}

export interface DocumentTagSummary {
  id: string
  key: string
  value: string
  categoryId?: string
  createdAt: string | Date
}

export interface GroupedDocument {
  title: string
  categoryId: string
  paragraph_count: number
  char_length: number
  chunk_range: { min: number; max: number }
  embedded_count: number
  is_fully_embedded: boolean
  vector_status: 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILURE'
  create_time: string
  update_time: string
  tags: DocumentTagSummary[]
}

export interface DocumentParagraph {
  id: string
  clauseId?: string
  content: string
  chunkIndex: number
  sourceType: string
  metadata?: any
  createdAt: string
  updatedAt: string
}

export interface VectorDocument {
  id: string
  sourceType: string
  sourceId?: string
  title?: string
  clauseId?: string
  content: string
  contentHash?: string
  chunkIndex: number
  metadata?: any
  createdAt: string
}

// ===== 知识库树形结构 =====

export const getKnowledgeTreeApi = () =>
  request.get<KnowledgeTreeNode[]>('/knowledge-categories/tree')

// ===== 知识库 CRUD =====

export const getKnowledgeCategoriesApi = () =>
  request.get<KnowledgeCategory[]>('/knowledge-categories')

export const getAllKnowledgeCategoriesApi = () =>
  request.get<KnowledgeCategory[]>('/knowledge-categories/all')

export const createKnowledgeCategoryApi = (data: {
  name: string
  description?: string
  parentId?: string
  isLeaf?: boolean
}) => request.post<KnowledgeCategory>('/knowledge-categories', data)

export const updateKnowledgeCategoryApi = (id: string, data: {
  name?: string
  description?: string
  status?: string
  chunkMode?: string
  maxChars?: number
  overlap?: number
  minSimilarity?: number
  directReturnThreshold?: number
  maxReferenceChars?: number
  enableRerank?: boolean
  embeddingUseDocumentTitle?: boolean
  embeddingUseClauseId?: boolean
  parentId?: string | null
  isLeaf?: boolean
}) => request.put<KnowledgeCategory>(`/knowledge-categories/${id}`, data)

export const deleteKnowledgeCategoryApi = (id: string) =>
  request.delete(`/knowledge-categories/${id}`)

// ===== 文档分组列表 =====

export const getGroupedDocumentsApi = (
  categoryId: string,
  params?: { page?: number; pageSize?: number; query?: string }
) =>
  request.get<{ page: number; pageSize: number; total: number; items: GroupedDocument[] }>(
    `/knowledge-categories/${categoryId}/grouped-documents`,
    { params }
  )

// ===== 单文档操作 =====

export const updateDocumentApi = (
  categoryId: string,
  data: { oldTitle: string; newTitle: string }
) =>
  request.put<{ updatedCount: number }>(`/knowledge-categories/${categoryId}/documents`, data)

export const deleteDocumentApi = (categoryId: string, title: string) =>
  request.delete<{ deletedCount: number }>(`/knowledge-categories/${categoryId}/documents`, {
    data: { title },
  })

// ===== 文档段落 =====

export const getDocumentParagraphsApi = (categoryId: string, title: string) =>
  request.get<{ title: string; paragraphCount: number; totalChars: number; paragraphs: DocumentParagraph[] }>(
    `/knowledge-categories/${categoryId}/document-paragraphs`,
    { params: { title } }
  )

export const updateParagraphApi = (paragraphId: string, data: { content?: string; clauseId?: string }) =>
  request.put<DocumentParagraph>(`/knowledge-categories/paragraphs/${paragraphId}`, data)

export const deleteParagraphApi = (paragraphId: string) =>
  request.delete(`/knowledge-categories/paragraphs/${paragraphId}`)

// ===== 批量向量化 =====

export const batchVectorizeApi = (categoryId: string, titles: string[]) =>
  request.post<{ updatedCount: number }>(`/knowledge-categories/${categoryId}/batch-vectorize`, { titles })

// ===== 向量文档管理 =====

export const uploadKnowledgeDocumentApi = (categoryId: string, formData: FormData) =>
  request.post<{ chunks: number }>(`/knowledge-categories/${categoryId}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const getVectorDocumentsApi = (params: {
  page?: number
  pageSize?: number
  query?: string
  sourceType?: string
  categoryId?: string
}) => request.get<{ items: VectorDocument[]; total: number }>('/knowledge-categories/documents', { params })

export const deleteVectorDocumentsApi = (data: { ids?: string[]; categoryId?: string }) =>
  request.post('/knowledge-categories/documents/delete', data)

export const getVectorStatsApi = () =>
  request.get<{ totalCount: number; byType: Array<{ sourceType: string; _count: { id: number } }> }>('/knowledge-categories/stats')

// ===== 异步上传 =====

export interface UploadTaskStatus {
  id: string
  fileName: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  message: string
  chunks?: number
  error?: string
  createdAt: number
}

export const uploadDocumentAsyncApi = (categoryId: string, formData: FormData) =>
  request.post<{ taskIds: string[] }>(`/knowledge-categories/${categoryId}/upload-async`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const getTaskStatusApi = (taskIds: string[]) =>
  request.get<UploadTaskStatus[]>(`/knowledge-categories/task-status`, { params: { taskIds: taskIds.join(',') } })

export const getActiveTasksApi = () =>
  request.get<UploadTaskStatus[]>('/knowledge-categories/active-tasks')

// ===== 分段预览确认 =====

export interface ParagraphSegment {
  /** 标题（父级标题链） */
  title: string
  /** 段落正文 */
  content: string
}

export interface PreviewResult {
  title: string
  chunks: ParagraphSegment[]
  metadata: Record<string, any>
  parseQuality: {
    passed: boolean
    score: number
    reasons: string[]
    metrics: {
      textLength: number
      visibleCharRatio: number
      duplicateLineRatio: number
      headingDensity: number
      tableSeparatorRatio: number
      mojibakeRatio: number
    }
  }
  canImport: boolean
}

export const previewDocumentApi = (categoryId: string, formData: FormData) =>
  request.post<PreviewResult>(`/knowledge-categories/${categoryId}/preview`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const confirmImportApi = (categoryId: string, data: {
  documents?: Array<{ title: string; chunks: Array<{ title?: string; content: string }> }>
  metadata?: Record<string, any>
}) => request.post<{ imported: number; deduped: number }>(`/knowledge-categories/${categoryId}/confirm-import`, data, {
  timeout: 300000,
})

// ===== 命中测试 =====

export interface HitTestResult {
  originalQuery: string
  rewrittenQuery?: string
  results: Array<{
    id: string
    title: string | null
    clauseId: string | null
    content: string
    vectorScore: number
    keywordScore: number
    rerankScore?: number
    comprehensiveScore: number
    chunkIndex: number
    isTable: boolean
    metadata: any
  }>
  usedConfig: {
    minSimilarity: number
    directReturnThreshold: number
    maxReferenceChars: number
    enableRerank: boolean
  }
  rerankApplied: boolean
  directReturnHit: boolean
  filteredBySimilarity: number
  stats: {
    totalCandidates: number
    afterDedup: number
    afterRerank: number
    searchTimeMs: number
    queryRewriteTimeMs?: number
  }
}

export const hitTestApi = (data: {
  query: string
  categoryId?: string
  sourceTypes?: string[]
  topNumber?: number
  searchMode?: 'vector' | 'keyword' | 'hybrid'
  enableQueryRewrite?: boolean
}) => request.post<HitTestResult>('/knowledge-categories/hit-test', data)

// ===== 标签管理 =====

export interface Tag {
  id: string
  key: string
  value: string
  categoryId?: string
  _count?: { documents: number }
  createdAt: string
}

export const getTagsApi = (params?: { categoryId?: string }) =>
  request.get<Tag[]>('/knowledge-categories/tags', { params })

export const createTagApi = (data: { key: string; value: string; categoryId?: string }) =>
  request.post<Tag>('/knowledge-categories/tags', data)

export const deleteTagApi = (tagId: string) =>
  request.delete(`/knowledge-categories/tags/${tagId}`)

export const getDocumentTagsApi = (categoryId: string, title: string) =>
  request.get<Tag[]>(`/knowledge-categories/${categoryId}/document-tags`, { params: { title } })

export const addDocumentTagApi = (categoryId: string, data: { tagId: string; documentTitle: string }) =>
  request.post(`/knowledge-categories/${categoryId}/document-tags`, {
    ...data,
    categoryId,
  })

export const removeDocumentTagApi = (categoryId: string, data: { tagId: string; documentTitle: string }) =>
  request.delete(`/knowledge-categories/${categoryId}/document-tags`, { data: { ...data, categoryId } })

// ===== 问题自动生成 =====

export const generateQuestionsApi = (categoryId: string, title: string) =>
  request.post<{ totalChunks: number; generatedCount: number }>(
    `/knowledge-categories/${categoryId}/generate-questions`,
    { title }
  )
