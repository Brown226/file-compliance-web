import type { EntryModule, ReviewObjective, ReviewEvidenceSource } from '../types/smart-review'

export const ENTRY_MODULE_LABEL: Record<EntryModule, string> = {
  LIBRARY: '标准合规审查',
  CONSISTENCY: '一致性审查',
  PROOFREAD: '基础校对',
  RULE_ONLY: '规则库审查',
  DOC_REVIEW: '文件比对审查',
  CONTRACT: '合同风险审查',
}

export const OBJECTIVE_OPTIONS: Array<{ value: ReviewObjective; label: string; desc: string }> = [
  { value: 'COMPLIANCE', label: '合规审查', desc: '对照知识库或规则库检查文件是否合规。' },
  { value: 'COMPARE', label: '参照比对', desc: '与参考文件逐项比对，识别差异和不一致。' },
  { value: 'PROOFREAD', label: '基础校对', desc: '检查错别字、语病、术语一致性等文字问题。' },
]

export const OBJECTIVE_ICON_MAP: Record<string, string> = {
  COMPLIANCE: 'MagicStick',
  COMPARE: 'Document',
  PROOFREAD: 'EditPen',
}

export const EVIDENCE_ICON_MAP: Record<string, string> = {
  STANDARD: 'FolderOpened',
  RULE_LIBRARY: 'Files',
  REFERENCE: 'Link',
}

export const EVIDENCE_SOURCE_OPTIONS: Record<ReviewObjective, Array<{ value: ReviewEvidenceSource; label: string }>> = {
  COMPLIANCE: [
    { value: 'STANDARD', label: '知识库' },
    { value: 'RULE_LIBRARY', label: '条文库' },
  ],
  COMPARE: [
    { value: 'REFERENCE', label: '参考文件' },
    { value: 'STANDARD', label: '知识库（可选增强）' },
  ],
  PROOFREAD: [],
}

/**
 * RULE_ONLY 默认勾选的规则前缀（高价值集）
 *
 * 收敛依据（2026-08-26 误报治理）：NAME/FORMAT/LAYOUT/HEADER/PAGE/ATTR 属
 * 「文件规范/排版格式」类，对工程合规审查价值低且高频触发（如中英文混排空格、
 * 缩进对齐、页眉页码），是用户反馈"价值不高"问题的主力。内容/逻辑/图纸类保留默认。
 * 用户仍可在「规则范围」面板手动勾选被移出默认的格式类前缀；全部取消勾选时
 * 后端执行全部内置规则（review.service.ts 空前缀语义，行为保持不变）。
 */
export const DEFAULT_RULE_PREFIXES = [
  'CODE', 'UNIT', 'TYPO', 'PUNCT', 'INTERNAL_CODE', 'COMPL', 'CONSIST',
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

// ==================== 合同审查专用常量 ====================

export const CONTRACT_RISK_LEVELS = [
  { value: 'HIGH', label: '高风险', color: '#f56c6c' },
  { value: 'MEDIUM', label: '中风险', color: '#e6a23c' },
  { value: 'LOW', label: '低风险', color: '#409eff' },
] as const

export const CONTRACT_CLAUSE_TYPES = [
  { value: 'payment', label: '付款条款' },
  { value: 'penalty', label: '违约条款' },
  { value: 'warranty', label: '质保条款' },
  { value: 'ip', label: '知识产权' },
  { value: 'change', label: '变更条款' },
  { value: 'claim', label: '索赔条款' },
  { value: 'insurance', label: '保险条款' },
  { value: 'dispute', label: '争议解决' },
  { value: 'other', label: '其他' },
] as const

export const CONTRACT_STANCES = [
  { value: 'owner', label: '业主/建设方', desc: '重点识别承包商履约风险、付款条件不利、违约责任不对等等问题' },
  { value: 'contractor', label: '承包商', desc: '重点识别付款保障不足、变更索赔受限、工期约束过严等问题' },
] as const
