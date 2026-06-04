import type { EntryModule, ReviewObjective, ReviewEvidenceSource } from '../types/smart-review'

export const ENTRY_MODULE_LABEL: Record<EntryModule, string> = {
  LIBRARY: '以库审文',
  CONSISTENCY: '一致性审查',
  PROOFREAD: '基础校对',
  RULE_ONLY: '规则库审查',
  MULTIMODAL: '结构化审查',
  DOC_REVIEW: '以文审文',
}

export const OBJECTIVE_OPTIONS: Array<{ value: ReviewObjective; label: string; desc: string }> = [
  { value: 'COMPLIANCE', label: '合规审查', desc: '对照知识库或规则库检查文件是否合规。' },
  { value: 'COMPARE', label: '参照比对', desc: '与参考文件逐项比对，识别差异和不一致。' },
  { value: 'PROOFREAD', label: '基础校对', desc: '检查错别字、语病、术语一致性等文字问题。' },
  { value: 'STRUCTURED', label: '结构化审查', desc: '检查图纸、表格、公式和结构化内容。' },
]

export const OBJECTIVE_ICON_MAP: Record<string, string> = {
  COMPLIANCE: 'MagicStick',
  COMPARE: 'Document',
  PROOFREAD: 'EditPen',
  STRUCTURED: 'DataAnalysis',
}

export const EVIDENCE_ICON_MAP: Record<string, string> = {
  STANDARD: 'FolderOpened',
  RULE_LIBRARY: 'Files',
  REFERENCE: 'Link',
}

export const EVIDENCE_SOURCE_OPTIONS: Record<ReviewObjective, Array<{ value: ReviewEvidenceSource; label: string }>> = {
  COMPLIANCE: [
    { value: 'STANDARD', label: '知识库' },
    { value: 'RULE_LIBRARY', label: '语义规则库' },
  ],
  COMPARE: [
    { value: 'REFERENCE', label: '参考文件' },
  ],
  PROOFREAD: [],
  STRUCTURED: [
    { value: 'STANDARD', label: '知识库' },
    { value: 'RULE_LIBRARY', label: '语义规则库' },
  ],
}

export const DEFAULT_RULE_PREFIXES = [
  'NAME', 'FORMAT', 'LAYOUT', 'HEADER', 'PAGE', 'CODE', 'UNIT', 'ATTR', 'TYPO',
  'CONSIST', 'COMPL',
  'DWG_TITLE', 'DWG_LAYER', 'DWG_DIM', 'DWG_STDREF', 'DWG_SCALE', 'DWG_OVERLAP',
]

export const PROGRESS_STEP_LABELS: Record<string, string> = {
  pre_analysis: '文档预分析',
  extract_text: '提取文件正文',
  knowledge_search: '检索知识与标准',
  llm_review: 'AI 深度审查',
  finalize: '保存审查结果',
}

export const PROGRESS_STATUS_LABELS: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
}
