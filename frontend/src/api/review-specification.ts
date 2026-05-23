import request from '@/utils/request'

export interface ReviewSpecification {
  id: string
  name: string
  description?: string
  sourceFileName?: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  createdBy: string
  items?: ReviewSpecificationItem[]
  _count?: { items: number }
  executableItemCount?: number
  enabledExecutableItemCount?: number
  pendingStructuredItemCount?: number
  createdAt: string
}

export interface ReviewSpecificationItem {
  id: string
  specificationId: string
  ruleCode?: string
  ruleName?: string
  category?: string
  description?: string
  checkMethod?: string
  severity?: string
  executionType?: 'BUILTIN_PREFIX' | 'REGEX' | 'KEYWORD_REQUIRED' | 'KEYWORD_FORBIDDEN' | 'MANUAL'
  builtinPrefix?: string
  targetScope?: 'FILE_NAME' | 'TEXT' | 'HEADER' | 'TABLE' | 'DWG'
  params?: any
  messageTemplate?: string
  sourceQuote?: string
  sourceLocation?: string
  enabled: boolean
  createdAt: string
  updatedAt?: string
}

export interface SpecificationPreviewItem {
  ruleCode?: string | null
  ruleName: string
  category?: string | null
  description?: string | null
  checkMethod?: string | null
  severity?: string | null
  executionType: 'BUILTIN_PREFIX' | 'REGEX' | 'KEYWORD_REQUIRED' | 'KEYWORD_FORBIDDEN' | 'MANUAL'
  builtinPrefix?: string | null
  targetScope: 'FILE_NAME' | 'TEXT' | 'HEADER' | 'TABLE' | 'DWG'
  params?: any
  messageTemplate?: string | null
  sourceQuote?: string | null
  sourceLocation?: string | null
  executable: boolean
  duplicate: boolean
}

export const getReviewSpecificationsApi = (params?: {
  selectableOnly?: boolean
  folderId?: string
  keyword?: string
  status?: string
}) => request.get<ReviewSpecification[]>('/review-specifications', { params })

export const getReviewSpecificationApi = (id: string) =>
  request.get<ReviewSpecification>(`/review-specifications/${id}`)

export const createReviewSpecificationApi = (data: { name: string; description?: string; folderId?: string | null }) =>
  request.post<ReviewSpecification>('/review-specifications', data)

export const updateReviewSpecificationApi = (id: string, data: {
  name?: string
  description?: string
  folderId?: string | null
  status?: string
}) => request.put<ReviewSpecification>(`/review-specifications/${id}`, data)

export const deleteReviewSpecificationApi = (id: string) =>
  request.delete(`/review-specifications/${id}`)

export const parseRulesFromFileApi = (specificationId: string, formData: FormData) =>
  request.post<{ count: number }>(`/review-specifications/${specificationId}/parse`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const parseRulesPreviewApi = (specificationId: string, formData: FormData) =>
  request.post<{ items: SpecificationPreviewItem[]; sourceFileName?: string }>(`/review-specifications/${specificationId}/parse-preview`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const importPreviewItemsApi = (
  specificationId: string,
  data: { items: SpecificationPreviewItem[]; mode?: 'merge' | 'replace'; sourceFileName?: string },
) => request.post<{ count: number }>(`/review-specifications/${specificationId}/import`, data)

export const addSpecificationItemApi = (specificationId: string, data: {
  ruleCode?: string
  ruleName: string
  category?: string
  description?: string
  checkMethod?: string
  severity?: string
  executionType?: 'BUILTIN_PREFIX' | 'REGEX' | 'KEYWORD_REQUIRED' | 'KEYWORD_FORBIDDEN' | 'MANUAL'
  builtinPrefix?: string
  targetScope?: 'FILE_NAME' | 'TEXT' | 'HEADER' | 'TABLE' | 'DWG'
  params?: any
  messageTemplate?: string
  sourceQuote?: string
  sourceLocation?: string
}) => request.post<ReviewSpecificationItem>(`/review-specifications/${specificationId}/items`, data)

export const updateSpecificationItemApi = (itemId: string, data: {
  ruleCode?: string
  ruleName?: string
  category?: string
  description?: string
  checkMethod?: string
  severity?: string
  enabled?: boolean
  executionType?: 'BUILTIN_PREFIX' | 'REGEX' | 'KEYWORD_REQUIRED' | 'KEYWORD_FORBIDDEN' | 'MANUAL'
  builtinPrefix?: string | null
  targetScope?: 'FILE_NAME' | 'TEXT' | 'HEADER' | 'TABLE' | 'DWG'
  params?: any
  messageTemplate?: string | null
  sourceQuote?: string | null
  sourceLocation?: string | null
}) => request.put<ReviewSpecificationItem>(`/review-specifications/items/${itemId}`, data)

export const deleteSpecificationItemApi = (itemId: string) =>
  request.delete(`/review-specifications/items/${itemId}`)