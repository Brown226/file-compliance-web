/**
 * 业务模型类型定义
 */

/** 用户角色 */
export type UserRole = 'ADMIN' | 'MANAGER' | 'USER'

/** 用户信息 */
export interface UserInfo {
  id: string
  username: string
  name: string
  role: UserRole | UserRole[]
  nick_name?: string
  email?: string
  phone?: string
  departmentId?: string
  departmentName?: string
}

/** 任务状态 */
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

/** 审查模式 */
export type ReviewMode = 'TEXT' | 'IMAGE' | 'DOCUMENT'

/** 问题分类 */
export type IssueCategory = 'TYPO' | 'VIOLATION'

/** 严重度 */
export type IssueSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

/** 任务信息 */
export interface Task {
  id: string
  title: string
  status: TaskStatus
  reviewMode?: string
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  userId: string
  user?: {
    id: string
    username: string
    name: string
    nick_name?: string
  }
  files?: TaskFile[]
  taskFiles?: TaskFile[]
  _count?: {
    taskDetails: number
  }
}

/** 任务文件 */
export interface TaskFile {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  fileType: string
  errorCount: number
  taskId: string
  /** DWG 文件级元数据 */
  dwgMetadata?: DwgFileMetadata
}

/** 任务详情/问题 */
export interface TaskDetail {
  id: string
  issueType: IssueCategory
  ruleCode?: string
  severity: IssueSeverity
  originalText: string
  suggestedText: string
  description: string
  cadHandleId?: string
  diffRanges?: DiffRange[]
  standardRefId?: string
  standardRef?: string
  sourceReferences?: SourceReference[] | null
  lineNumber?: number
  taskId: string
  taskFileId: string
  fileId?: string
  file?: TaskFile
  isFalsePositive?: boolean
  fpReason?: string | null
  matchLevel?: number
  similarity?: number
  /** 文本位置信息 - 用于前端定位 */
  textPosition?: TextPosition
  /** DWG 解析元数据 */
  dwgMetadata?: DwgMetadata
}

/** 文本位置信息 */
export interface TextPosition {
  chunkIndex: number   // 所在分片索引
  charOffset: number  // 在分片内的字符偏移量
  totalChunks: number // 总分片数
}

/** Diff 高亮范围 */
export interface DiffRange {
  start: number
  length: number
}

/** 来源引用 */
export interface SourceReference {
  standardId?: string
  standardTitle?: string
  chunkContent?: string
  relevanceScore?: number
}

/** 标准/规范 */
export interface Standard {
  id: string
  title: string
  content: string
  category: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 知识库 */
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  type: 'LOCAL' | 'MAXKB'
  maxkbId?: string
  maxkbApplicationId?: string
  documentCount: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 系统配置项 */
export interface SystemConfig {
  id: string
  key: string
  value: string
  description?: string
  updatedAt: string
}

/** 审计日志 */
export interface AuditLog {
  id: string
  userId: string
  user?: UserInfo
  action: string
  resource: string
  details?: string
  ipAddress?: string
  createdAt: string
}

/** 部门 */
export interface Department {
  id: string
  name: string
  parentId?: string | null
  parent?: Department
  children?: Department[]
  createdAt: string
  updatedAt: string
}

/** MaxKB 状态 */
export interface MaxKBStatus {
  initialized: boolean
  maxkbReachable: boolean
  maxkbUrl?: string
  knowledgeId?: string
  knowledgeDocCount?: number
}

/** 审查规则 */
export interface ReviewRule {
  id: string
  ruleCode: string
  name: string
  category: string
  severity: 'error' | 'warning' | 'info'
  description: string
  enabled: boolean
  config?: any
  createdAt: string
  updatedAt: string
}

/** 提示词模板 */
export interface PromptTemplate {
  id: string
  name: string
  description?: string
  content: string
  category?: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

/** 标准文件夹 */
export interface StandardFolder {
  id: string
  name: string
  parentId?: string | null
  description?: string
  children?: StandardFolder[]
  createdAt: string
  updatedAt: string
}

/** 白名单术语 */
export interface Terminology {
  id: string
  term: string
  category?: string
  description?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 仪表盘统计数据 */
export interface DashboardStats {
  totalTasks: number
  completedTasks: number
  processingTasks: number
  failedTasks: number
  totalIssues: number
  highSeverityCount: number
  mediumSeverityCount: number
  lowSeverityCount: number
}

/** 仪表盘趋势数据 */
export interface DashboardTrend {
  date: string
  tasks: number
  issues: number
}

/** 标准比对结果 */
export interface StandardCheckResult {
  standardNo: string
  standardName?: string
  exists: boolean
  standard?: Standard
}

/** 标准引用提取结果 */
export interface StandardRefExtractResult {
  refs: Array<{
    standardNo: string
    standardName?: string
  }>
}

/** 临时标准库条目 */
export interface TempLibraryEntry {
  id: string
  standardNo: string
  standardName: string
  status: string
  createdAt: string
}

/** 知识库命中测试结果 */
export interface MaxKBHitTestResult {
  results: Array<{
    content: string
    score: number
    title?: string
  }>
}

/** 知识库条目 */
export interface KnowledgeBaseItem {
  id: string
  name: string
  documentCount?: number
}

/** 知识库树节点 */
export interface KnowledgeTreeNode {
  id: string
  name: string
  type: 'dataset' | 'document'
  children?: KnowledgeTreeNode[]
  documentCount?: number
}

/** 规则分类 */
export interface RuleCategory {
  code: string
  name: string
  count?: number
}

/** 提示词模板 */
export interface PromptTemplate {
  id: string
  key: string
  module: string
  role: string
  variant: string
  name: string
  description?: string
  content: string
  placeholders?: string
  defaultValue?: string
  isBuiltin: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 提示词模块 */
export interface PromptModule {
  key: string
  name: string
  count?: number
}

/** LLM 测试结果 */
export interface LlmTestResult {
  success: boolean
  message?: string
  response?: string
}

/** 员工信息 */
export interface Employee {
  id: string
  username: string
  name: string
  role: UserRole
  email?: string
  departmentId?: string
  department?: Department
  createdAt: string
  updatedAt: string
}

// ===== DWG 相关类型 =====

/** DWG 图元类型 */
export type DwgEntityType = 'LINE' | 'ARC' | 'CIRCLE' | 'TEXT' | 'MTEXT' | 'DIMENSION' |
  'INSERT' | 'POLYLINE' | 'LWPOLYLINE' | 'HATCH' | 'BLOCK' | 'ATTDEF' | 'ATTRIBUTE' | 'SPLINE' | 'ELLIPSE' | 'OTHER'

/** DWG 问题元数据（存储在 TaskDetail.dwgMetadata 中） */
export interface DwgMetadata {
  /** 图层名称 */
  layer?: string
  /** 图元类型 */
  entityType?: DwgEntityType
  /** 图元坐标 */
  position?: { x: number; y: number; z?: number }
  /** 图元 Handle ID */
  handle?: string
  /** 图元所属块名 */
  blockName?: string
  /** 图元颜色索引 */
  colorIndex?: number
}

/** DWG 文件级元数据（存储在 TaskFile.dwgMetadata 中） */
export interface DwgFileMetadata {
  /** 图层列表及统计 */
  layers?: Array<{
    name: string
    entityCount: number
    colorIndex?: number
    isOff?: boolean
    isFrozen?: boolean
  }>
  /** 图元类型统计 */
  entityStats?: Record<string, number>
  /** 标注数量 */
  dimensionCount?: number
  /** 文字对象数量 */
  textCount?: number
  /** 块引用数量 */
  blockRefCount?: number
  /** 总图元数 */
  totalEntityCount?: number
  /** 图纸尺寸 */
  extents?: {
    minX: number; minY: number
    maxX: number; maxY: number
  }
  /** 标准引用列表 */
  standardRefs?: Array<{
    standardNo: string
    standardName?: string
    exists: boolean
    standardId?: string
  }>
}
