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
  enabled: boolean
  createdAt: string
}

export const getRuleLibrariesApi = () =>
  request.get<RuleLibrary[]>('/rule-libraries')

export const getRuleLibraryApi = (id: string) =>
  request.get<RuleLibrary>(`/rule-libraries/${id}`)

export const createRuleLibraryApi = (data: { name: string; description?: string }) =>
  request.post<RuleLibrary>('/rule-libraries', data)

export const updateRuleLibraryApi = (id: string, data: {
  name?: string
  description?: string
  status?: string
}) => request.put<RuleLibrary>(`/rule-libraries/${id}`, data)

export const deleteRuleLibraryApi = (id: string) =>
  request.delete(`/rule-libraries/${id}`)

export const parseRulesFromFileApi = (libraryId: string, formData: FormData) =>
  request.post<{ count: number }>(`/rule-libraries/${libraryId}/parse`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const addRuleItemApi = (libraryId: string, data: {
  ruleCode?: string
  ruleName: string
  category?: string
  description?: string
  checkMethod?: string
  severity?: string
}) => request.post<RuleLibraryItem>(`/rule-libraries/${libraryId}/items`, data)

export const updateRuleItemApi = (libraryId: string, itemId: string, data: {
  ruleCode?: string
  ruleName?: string
  category?: string
  description?: string
  checkMethod?: string
  severity?: string
  enabled?: boolean
}) => request.put<RuleLibraryItem>(`/rule-libraries/${libraryId}/items/${itemId}`, data)

export const deleteRuleItemApi = (libraryId: string, itemId: string) =>
  request.delete(`/rule-libraries/${libraryId}/items/${itemId}`)
