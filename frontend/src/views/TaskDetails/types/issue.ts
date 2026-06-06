export type Severity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'VIOLATION'
  | 'CONSISTENCY'
  | 'COMPLETENESS'
  | 'TYPO'

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
}
