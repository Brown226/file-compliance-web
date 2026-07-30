import request from '@/utils/request'

// ==================== 类型定义 ====================

// Task 22: CoT 推理过程（annotations + compliance 的 issue 可选字段）
export interface ReasoningMixin {
  reasoning?: string
}

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

export interface AnnotationIssue extends ReasoningMixin {
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

export interface ComplianceIssue extends ReasoningMixin {
  note: string
  violation: string
  suggestion: string
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
  /** Task 21: SoM 区域标号（1=标题栏/2=图例表/3=标注/4=设计说明/5=图框/6=主体图形） */
  markId?: number
  /** Task 28: 规范条文编号（如 "GB 50016-2014 第 5.5.3 条"） */
  clauseRef?: string
  /** Task 28: 规范条文原文（前端点击弹窗展示） */
  clauseText?: string
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

// Task 17: 专业审查结果
export type DwgProfession = 'building' | 'structural' | 'plumbing' | 'hvac' | 'electrical' | 'process' | 'nuclear'

export interface ProfessionIssue extends ReasoningMixin {
  item: string
  location: string
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
}

export interface ProfessionCheckResult {
  profession: DwgProfession
  issues: ProfessionIssue[]
  summary: string
}

// Task 18: 图框规范检查结果
export interface FrameCheckIssue extends ReasoningMixin {
  item: string
  location: string
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
}

export interface FrameCheckResult {
  frameSize: string
  frameWidth: number
  frameHeight: number
  hasTitleBlock: boolean
  hasBindingMargin: boolean
  issues: FrameCheckIssue[]
  summary: string
}

export interface VisionAnalyzeResult {
  titleBlock?: TitleBlockResult | null
  symbols?: SymbolListResult | null
  annotations?: AnnotationCheckResult | null
  compliance?: ComplianceResult | null
  /** Task 17: 专业审查结果 */
  profession?: ProfessionCheckResult | null
  /** Task 18: 图框规范检查结果 */
  frameCheck?: FrameCheckResult | null
  duration_ms: number
  errors: string[]
  modelInfo?: { model: string; modelType: string }
  ruleIssues?: RuleIssue[]
  /** Task 34: 跨维度关联校验结果（标题栏 ↔ 合规审查 ↔ 标注完整性 交叉一致性） */
  crossDimensionIssues?: RuleIssue[]
  /** Task 24: OCR + VLM 交叉验证结果 */
  ocrVerification?: OcrVerificationResult
  /** Task 20: DWG 元数据双校验结果 */
  dwgMetadataVerification?: DwgMetadataVerification
  /** Task 29: 本次分析的 jobKey（traceId），用于查询推理回放日志 */
  traceId?: string
}

/**
 * Task 24: OCR + VLM 交叉验证结果
 */
export interface OcrVerificationResult {
  /** OCR 提取的整图文本（截断至 5000 字符） */
  ocrText: string
  /** OCR 引擎名称 */
  ocrEngine?: string
  /** OCR 文本字符数（原始，未截断） */
  ocrCharCount: number
  /** 不一致的字段列表 */
  mismatches: string[]
  /** 是否需要人工复核（关键字段 drawingNo/title 不一致时为 true） */
  needsReview: boolean
  /** OCR 调用状态 */
  status: 'success' | 'unavailable' | 'failed'
  /** 失败原因 */
  reason?: string
}

// ==================== Task 20: DWG 元数据双校验 ====================

/**
 * Task 20: 前端 WASM 解析出的 DWG 元数据（传给后端做交叉验证）
 */
export interface DwgMetadata {
  layers?: string[]
  textEntities?: Array<{ text: string; layer: string }>
  dimensions?: Array<{ text: string; layer: string }>
  standardRefs?: Array<{ standardNo: string; standardName: string; fullMatch: string }>
  metadata?: {
    layerCount: number
    textCount: number
    dimensionCount: number
    entityCount: number
    converted: boolean
    version?: string
  }
}

/**
 * Task 20: DWG 元数据双校验结果
 */
export interface DwgMetadataVerification {
  wasLayerCount: number
  wasTextCount: number
  wasDimensionCount: number
  wasStandardRefs: string[]
  mismatches: string[]
  needsReview: boolean
  status: 'success' | 'unavailable' | 'failed'
  reason?: string
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
 * Task 17: profession 用于 profession 维度的专业分流审查
 *   - profession: 专业类型（可选，仅在 analyses 包含 'profession' 时生效）
 *   - 可选值: building/structural/plumbing/hvac/electrical/process/nuclear
 */
export function analyzeDwgVision(data: {
  imageBase64: string
  fileName: string
  analyses: string[]
  refText?: string
  kbId?: string
  query?: string
  profession?: DwgProfession
  /** Task 20: 前端 WASM 解析的 DWG 元数据（可选，传给后端做交叉验证） */
  dwgMetadata?: DwgMetadata
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

// ==================== Task 29: 推理回放（LLM 调用日志）====================

/**
 * Task 29: 图纸视觉分析的 LLM 调用日志（推理回放用）
 * 字段与后端 LlmCallLog 表对齐（已序列化 BigInt id 为 string）
 */
export interface VisionLlmCallLog {
  id: string
  mode: string | null
  model: string
  provider: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  status: 'success' | 'failed' | 'cache'
  errorMsg: string | null
  promptFull: string | null
  completionFull: string | null
  ragChunks: any
  createdAt: string
}

/**
 * Task 29: 按 traceId（jobKey）查询图纸视觉分析的 LLM 调用日志
 * 用于推理回放抽屉展示该次分析各维度的 prompt/response/tokens/latency
 */
export function getVisionLlmLogs(traceId: string) {
  return request.get<any, { code: number; data: VisionLlmCallLog[] }>(
    `/dwg/vision-llm-logs/${traceId}`
  )
}
