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
 */
export function analyzeDwgVision(data: {
  imageBase64: string
  fileName: string
  analyses: string[]
  refText?: string
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
