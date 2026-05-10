import request from '@/utils/request'

export interface KnowledgeCategory {
  id: string
  name: string
  description?: string
  documentTypes?: string
  status: 'ACTIVE' | 'ARCHIVED'
  parentId?: string
  children?: KnowledgeCategory[]
  _count?: { vectorDocuments: number }
  createdAt: string
}

export interface KnowledgeTreeNode {
  id: string
  name: string
  type: 'folder' | 'knowledge'
  documentCount?: number
  children?: KnowledgeTreeNode[]
}

export interface GroupedDocument {
  title: string
  categoryId: string
  paragraph_count: number
  char_length: number
  chunk_range: { min: number; max: number }
  embedded_count: number
  is_fully_embedded: boolean
  create_time: string
  update_time: string
}

export interface DocumentParagraph {
  id: string
  clauseId?: string
  content: string
  chunkIndex: number
  sourceType: string
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
  documentTypes?: string
  parentId?: string
}) => request.post<KnowledgeCategory>('/knowledge-categories', data)

export const updateKnowledgeCategoryApi = (id: string, data: {
  name?: string
  description?: string
  documentTypes?: string
  status?: string
}) => request.put<KnowledgeCategory>(`/knowledge-categories/${id}`, data)

export const deleteKnowledgeCategoryApi = (id: string) =>
  request.delete(`/knowledge-categories/${id}`)

// ===== 文档分组列表 =====

export const getGroupedDocumentsApi = (
  categoryId: string,
  params?: { page?: number; pageSize?: number; query?: string; status?: string }
) =>
  request.get<{ page: number; pageSize: number; total: number; items: GroupedDocument[] }>(
    `/knowledge-categories/${categoryId}/grouped-documents`,
    { params }
  )

// ===== 单文档操作 =====

export const updateDocumentApi = (
  categoryId: string,
  data: { oldTitle: string; newTitle?: string; isActive?: boolean }
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
