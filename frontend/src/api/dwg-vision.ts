import request from '@/utils/request'

// ==================== 类型定义 ====================

export interface TitleBlockResult {
  drawingNo: string
  title: string
  revision: string
  scale: string
  designer: string
  checker: string
  reviewer: string
  approver: string
  date: string
  company: string
  bbox?: [number, number, number, number]
}

export interface SymbolItem {
  type: 'valve' | 'pump' | 'vessel' | 'instrument' | 'tank' | 'heat_exchanger' | 'other'
  tag: string
  description: string
  position: string
  bbox?: [number, number, number, number]
}

export interface SymbolListResult {
  symbols: SymbolItem[]
  totalCount: number
  summary: string
}

export interface AnnotationIssue {
  item: string
  location: string
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
}

export interface AnnotationCheckResult {
  missingItems: AnnotationIssue[]
  completenessScore: number
  summary: string
}

export interface ComplianceIssue {
  note: string
  violation: string
  suggestion: string
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
}

export interface ComplianceResult {
  designNotes: string[]
  issues: ComplianceIssue[]
  summary: string
}

export interface RuleIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface VisionAnalyzeResult {
  titleBlock?: TitleBlockResult | null
  symbols?: SymbolListResult | null
  annotations?: AnnotationCheckResult | null
  compliance?: ComplianceResult | null
  duration_ms: number
  errors: string[]
  modelInfo?: { model: string; modelType: string }
  ruleIssues?: RuleIssue[]
}

export interface VisionStatusResult {
  configured: boolean
  modelName: string
  analyses: string[]
}

// ==================== API 方法 ====================

/**
 * 图纸视觉智能分析
 *
 * Task 15: kbId / query 用于 compliance 维度的 MaxKB RAG 注入
 *   - kbId:  MaxKB 知识库 ID（可选，仅在 analyses 包含 'compliance' 时生效）
 *   - query: RAG 检索查询词（可选，为空时后端使用默认关键词）
 */
export function analyzeDwgVision(data: {
  imageBase64: string
  fileName: string
  analyses: string[]
  refText?: string
  kbId?: string
  query?: string
}) {
  return request.post<any, { code: number; data: VisionAnalyzeResult; message?: string }>(
    '/dwg/vision-analyze',
    data,
    { timeout: 600000 } // 10 分钟超时（Vision 调用较慢）
  )
}

/**
 * 检查视觉模型配置状态
 */
export function getVisionStatus() {
  return request.get<any, { code: number; data: VisionStatusResult }>('/dwg/vision-status')
}

// ==================== 历史记录（Task 25）====================

export interface VisionHistoryItem {
  id: string
  userId: string | null
  fileName: string | null
  imageHash: string | null
  analyses: string[]
  result: VisionAnalyzeResult
  modelInfo: { model: string; modelType: string } | null
  durationMs: number
  errors: string[]
  refText: string | null
  createdAt: string
}

export interface VisionHistoryResult {
  total: number
  items: VisionHistoryItem[]
}

/**
 * 查询图纸视觉分析历史记录
 */
export function getVisionHistory(params?: {
  limit?: number
  offset?: number
  fileName?: string
  imageHash?: string
  userId?: string
}) {
  return request.get<any, { code: number; data: VisionHistoryResult }>(
    '/dwg/vision-history',
    { params }
  )
}

/**
 * 查询单条历史记录详情
 */
export function getVisionHistoryDetail(id: string) {
  return request.get<any, { code: number; data: VisionHistoryItem }>(
    `/dwg/vision-history/${id}`
  )
}
