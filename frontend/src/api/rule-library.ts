import request from '@/utils/request'

export interface RuleLibrary {
  id: string
  name: string
  description?: string
  sourceFileName?: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  createdBy: string
  items?: RuleLibraryItem[]
  _count?: { items: number }
  executableItemCount?: number
  enabledExecutableItemCount?: number
  pendingStructuredItemCount?: number
  createdAt: string
}

export interface RuleLibraryItem {
  id: string
  libraryId: string
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

export interface RuleLibraryPreviewItem {
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

export const getRuleLibrariesApi = (params?: {
  selectableOnly?: boolean
  folderId?: string
  keyword?: string
  status?: string
}) => request.get<RuleLibrary[]>('/rule-libraries', { params })

export const getRuleLibraryApi = (id: string) =>
  request.get<RuleLibrary>(`/rule-libraries/${id}`)

export const createRuleLibraryApi = (data: { name: string; description?: string; folderId?: string | null }) =>
  request.post<RuleLibrary>('/rule-libraries', data)

export const updateRuleLibraryApi = (id: string, data: {
  name?: string
  description?: string
  folderId?: string | null
  status?: string
}) => request.put<RuleLibrary>(`/rule-libraries/${id}`, data)

export const deleteRuleLibraryApi = (id: string) =>
  request.delete(`/rule-libraries/${id}`)

export const parseRulesFromFileApi = (libraryId: string, formData: FormData) =>
  request.post<{ count: number }>(`/rule-libraries/${libraryId}/parse`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const parseRulesPreviewApi = (libraryId: string, formData: FormData) =>
  request.post<{ items: RuleLibraryPreviewItem[]; sourceFileName?: string }>(`/rule-libraries/${libraryId}/parse-preview`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const importRulePreviewItemsApi = (
  libraryId: string,
  data: { items: RuleLibraryPreviewItem[]; mode?: 'merge' | 'replace'; sourceFileName?: string },
) => request.post<{ count: number }>(`/rule-libraries/${libraryId}/import`, data)

export const addRuleItemApi = (libraryId: string, data: {
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
}) => request.post<RuleLibraryItem>(`/rule-libraries/${libraryId}/items`, data)

export const updateRuleItemApi = (libraryId: string, itemId: string, data: {
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
}) => request.put<RuleLibraryItem>(`/rule-libraries/${libraryId}/items/${itemId}`, data)

export const deleteRuleItemApi = (libraryId: string, itemId: string) =>
  request.delete(`/rule-libraries/${libraryId}/items/${itemId}`)
