import request from '@/utils/request'

export interface RuleLibrary {
  id: string
  name: string
  description?: string
  sourceFileName?: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  createdBy: string
  /** V3.2 条文库合并：关联的标准 ID（可选，保留标准树组织） */
  standardId?: string | null
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
  // ===== V3.1 审点字段 =====
  clauseText?: string | null
  checkPrompt?: string | null
  auditDimension?: 'compliance' | 'fact' | 'text' | null
  mandatory?: 'mandatory' | 'guidance' | null
  clauseHash?: string | null
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
  // ===== V3.1 审点字段 =====
  clauseText?: string | null
  checkPrompt?: string | null
  auditDimension?: 'compliance' | 'fact' | 'text' | null
  mandatory?: 'mandatory' | 'guidance' | null
  clauseHash?: string | null
  executable: boolean
  duplicate: boolean
}

export const getRuleLibrariesApi = (params?: {
  selectableOnly?: boolean
  keyword?: string
  status?: string
  /** V3.2 条文库合并：按关联标准过滤 */
  standardId?: string
}) => request.get<RuleLibrary[]>('/rule-libraries', { params })

export const getRuleLibraryApi = (id: string) =>
  request.get<RuleLibrary>(`/rule-libraries/${id}`)

export const createRuleLibraryApi = (data: { name: string; description?: string; standardId?: string | null }) =>
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

export const parseRulesPreviewApi = (libraryId: string, formData: FormData) =>
  request.post<{ items: RuleLibraryPreviewItem[]; sourceFileName?: string }>(`/rule-libraries/${libraryId}/parse-preview`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

/**
 * 异步解析规则预览（适合大文件/长文档）
 * 立即返回 jobId，后台异步执行，通过轮询任务状态获取结果
 */
export const parseRulesPreviewAsyncApi = (libraryId: string, formData: FormData) =>
  request.post<{ jobId: string; status: string }>(`/rule-libraries/${libraryId}/parse-preview-async`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 5 * 60 * 1000, // 5 分钟超时（仅针对文件上传阶段，解析在后台执行）
  })

/**
 * V3.1 审点模式异步解析：用 ClauseSplitterService 切分条文 + LLM 加工成 DEC 风格审点
 * 产出 clauseText + checkPrompt + auditDimension + mandatory，可直接驱动 DEC_REVIEW
 */
export const parseCheckpointsPreviewAsyncApi = (libraryId: string, formData: FormData) =>
  request.post<{ jobId: string; status: string }>(`/rule-libraries/${libraryId}/parse-checkpoints-async`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 5 * 60 * 1000,
  })

export interface RuleParseJobResult {
  id: string
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED'
  progress: number
  step: string
  message: string
  items?: RuleLibraryPreviewItem[]
  sourceFileName?: string
}

export const getRuleParseJobApi = (jobId: string) =>
  request.get<RuleParseJobResult>(`/rule-libraries/parse-jobs/${jobId}`)

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
