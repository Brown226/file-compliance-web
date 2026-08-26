export type Severity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'VIOLATION'
  | 'CONSISTENCY'
  | 'COMPLETENESS'
  | 'TYPO'
  | 'NAMING'

export interface DiffRange {
  start: number
  end: number
}

export interface DiffRanges {
  original: DiffRange[]
  correct: DiffRange[]
}

export interface DwgMetadata {
  layer?: string
  entityType?: string
  position?: { x: number; y: number; z?: number }
  blockName?: string
}

export interface SourceReference {
  document_name: string
  similarity: number
  content: string
  /** P0-2（OPT-016 接通）：来源未通过真实性校验（检索结果中不存在），前端标"引用存疑" */
  unverified?: boolean
}

export interface IssueDetail {
  id: string
  severity: Severity
  issueType: IssueType
  ruleCode?: string
  description: string
  originalText: string
  suggestedText?: string
  plainLanguage?: string
  diffRanges?: DiffRanges
  matchLevel?: number
  similarity?: number
  dwgMetadata?: DwgMetadata
  cadHandleId?: string
  textPosition?: any
  fileId?: string
  file?: { fileName: string }
  standardRef?: string
  standardRefId?: string
  sourceReferences?: SourceReference[]
  isFalsePositive?: boolean
  fpReason?: string
  /** P2-2: 是否已采纳建议（单条采纳按钮） */
  adopted?: boolean
  // 合同审查专属字段
  riskLevel?: 'HIGH' | 'MEDIUM' | 'LOW'
  clauseType?: string
  recommendation?: string
  // dwg-vision 专属字段（Task 42：复用 IssueCardList 统一展示）
  /** 归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系），用于 SVG 叠框定位联动 */
  bbox?: [number, number, number, number]
  /** Task 21: SoM 区域标号（1=标题栏/2=图例表/3=标注/4=设计说明/5=图框/6=主体图形） */
  markId?: number
  /** Task 28: 规范条文编号（如 "GB 50016-2014 第 5.5.3 条"） */
  clauseRef?: string
  /** Task 28: 规范条文原文（点击"查看条文"弹窗展示） */
  clauseText?: string
  /** Task 22: CoT 推理过程（模型先思考再下结论，前端可折叠展示） */
  reasoning?: string
  /** 置信度 0-1，低于 0.6 将标记待人工复核 */
  confidence?: number
  // ===== 智能判标 / 人工复核状态（P1-6 + 2026-08-26 判标全模式扩展）=====
  /** 落库复核状态：PENDING_REVIEW = 需人工复核（判标 LOW / AI 纯推断 / 合同 HIGH / 引用未定位） */
  reviewStatus?: 'PENDING_REVIEW' | 'CONFIRMED' | null
  /** 判标置信度（SmartJudgeService）：HIGH / MEDIUM / LOW；LOW 由待复核徽标承载 */
  judgeConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  /** 判标理由（LOW 时卡内展示，解释为何判为疑似误报） */
  judgeReason?: string | null
}
