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
