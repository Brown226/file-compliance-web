import type { IssueType, Severity } from '../types/issue'

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  VIOLATION: '合规违规',
  CONSISTENCY: '一致性',
  COMPLETENESS: '完整性',
  TYPO: '文本错误',
  NAMING: '命名',
}

export const ISSUE_TYPE_TAG_TYPES: Record<IssueType, any> = {
  VIOLATION: 'danger',
  CONSISTENCY: 'info',
  COMPLETENESS: 'warning',
  TYPO: 'warning',
  NAMING: 'warning',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
}

export const SEVERITY_TYPES: Record<Severity, any> = {
  error: 'danger',
  warning: 'warning',
  info: 'info',
}

export const ALL_CATEGORIES = [
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'COMPLETENESS', label: '完整性' },
  { value: 'TYPO', label: '文本错误' },
  { value: 'NAMING', label: '命名' },
]

export const DWG_RULE_TYPE_OPTIONS = [
  { value: 'TITLE', label: '标题栏' },
  { value: 'LAYER', label: '图层' },
  { value: 'DIMENSION', label: '标注' },
  { value: 'STD_REF', label: '标准引用' },
  { value: 'SCALE', label: '比例' },
  { value: 'OVERLAP', label: '重叠' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'FORMAT', label: '格式规范' },
]

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  LINE: '直线',
  ARC: '圆弧',
  CIRCLE: '圆',
  TEXT: '单行文字',
  MTEXT: '多行文字',
  DIMENSION: '标注',
  INSERT: '块引用',
  POLYLINE: '多段线',
  LWPOLYLINE: '轻量多段线',
  HATCH: '填充',
  BLOCK: '块定义',
  ATTDEF: '属性定义',
  ATTRIBUTE: '属性',
  SPLINE: '样条曲线',
  ELLIPSE: '椭圆',
  OTHER: '其他',
}
