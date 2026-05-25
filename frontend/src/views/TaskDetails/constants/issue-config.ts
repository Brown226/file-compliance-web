import type { IssueType, Severity } from '../types/issue'

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  TYPO: '错别字',
  VIOLATION: '合规违规',
  NAMING: '命名规范',
  ENCODING: '编码一致性',
  ATTRIBUTE: '封面属性',
  HEADER: '页眉检查',
  PAGE: '页码检查',
  SCAN: '图纸扫描',
  TEMPLATE: '模板统一',
  FORMAT: '格式规范',
  COMPLETENESS: '数据完整性',
  CONSISTENCY: '一致性',
  LAYOUT: '排版布局',
  STD_REF: '标准引用',
  DWG: 'DWG图纸',
  FLUENCY: '语句通顺性',
}

export const ISSUE_TYPE_TAG_TYPES: Record<IssueType, any> = {
  TYPO: 'warning',
  VIOLATION: 'danger',
  NAMING: 'info',
  ENCODING: 'danger',
  ATTRIBUTE: 'warning',
  HEADER: 'success',
  PAGE: 'info',
  SCAN: 'info',
  TEMPLATE: 'warning',
  FORMAT: 'warning',
  COMPLETENESS: 'danger',
  CONSISTENCY: 'info',
  LAYOUT: 'info',
  STD_REF: 'warning',
  DWG: 'info',
  FLUENCY: 'warning',
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
  { value: 'TYPO', label: '错别字' },
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'ENCODING', label: '编码一致性' },
  { value: 'ATTRIBUTE', label: '封面属性' },
  { value: 'HEADER', label: '页眉检查' },
  { value: 'PAGE', label: '页码检查' },
  { value: 'SCAN', label: '图纸扫描' },
  { value: 'TEMPLATE', label: '模板统一' },
  { value: 'FORMAT', label: '格式规范' },
  { value: 'COMPLETENESS', label: '数据完整性' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'LAYOUT', label: '排版布局' },
  { value: 'STD_REF', label: '标准引用' },
  { value: 'DWG', label: 'DWG图纸' },
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
