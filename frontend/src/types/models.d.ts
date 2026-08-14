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
  mustChangePassword?: boolean
  phone?: string
  departmentId?: string
  departmentName?: string
}

/** 任务状态 */
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

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
  reviewSpecificationId?: string | null
  reviewPlan?: ReviewPlan | null
  reviewSpecification?: { id: string; name: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' } | null
  /** P0-4: 本次审查降级原因汇总（RAG 零命中/不可用等），"没审到"可追溯 */
  degradedReason?: string | null
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
  /** 标准引用自检报告（仅 SELF_CHECK 模式） */
  selfCheckReport?: {
    totalChecked: number
    matchedCount: number
    errorCount: number
    items: SelfCheckReportItem[]
    standardLibraryInfo: { name: string; total: number }
  }
  _count?: {
    taskDetails: number
  }
}

/** 标准引用自检结果条目 */
export interface SelfCheckReportItem {
  docStandardNo: string
  docStandardName: string
  fullMatch: string
  sourceFile: string
  startChar: number
  endChar: number
  lineNumber: number
  contextText: string
  errorTypes: string[]
  matchResult: {
    matched: boolean
    matchLevel: number
    libraryStandardNo?: string
    libraryStandardName?: string
    libraryStandardStatus?: string
    similarity?: number
  }
  noDiff?: { originalRanges: Array<{ start: number; length: number }>; correctRanges: Array<{ start: number; length: number }> } | null
  nameDiff?: { originalRanges: Array<{ start: number; length: number }>; correctRanges: Array<{ start: number; length: number }> } | null
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
  /** OPT-011: 封面结构化信息（PDF 图片封面页 OCR 提取） */
  coverInfo?: CoverInfo | null
}

/** OPT-011: 封面结构化信息 */
export interface CoverInfo {
  /** 文档编号: NPC-QA-001, HAF-601 */
  doc_no: string
  /** 文档标题（最长的中文行） */
  title: string
  /** 版本号: V1.0 / 第3版 / Rev.A */
  revision: string
  /** 比例: 1:100 */
  scale: string
  /** 审批信息: { 设计: '张三', 校核: '李四', ... } */
  approval: Record<string, string>
  /** OCR 原始前 20 行（调试用） */
  raw_lines?: string[]
}

/** 任务详情/问题 */
export interface TaskDetail {
  id: string
  issueType: IssueCategory
  ruleCode?: string
  severity: IssueSeverity
  reviewSource?: 'RULE_ENGINE' | 'RULE_LIBRARY' | 'STANDARD_REF' | 'AI'
  ruleLibraryItemId?: string | null
  originalText: string
  suggestedText: string
  description: string
  /** 通俗语言解释 */
  plainLanguage?: string | null
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
  locateMeta?: LocateMeta | null
  confidence?: ReviewConfidence | null
  confidenceSource?: string | null
  /** 判标置信度（智能判标层）：HIGH / MEDIUM / LOW；LOW 标记待人工复核 */
  judgeConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  /** 判标理由 */
  judgeReason?: string | null
  /** DWG 解析元数据 */
  dwgMetadata?: DwgMetadata
  /** 标记建议是否已采纳 */
  adopted?: boolean
}

/** 文本位置信息 */
export interface TextPosition {
  chunkIndex: number   // 所在分片索引
  charOffset: number  // 在分片内的字符偏移量
  totalChunks: number // 总分片数
}

/** Diff 高亮范围 */
export interface LocateMeta {
  version: 2
  mode: 'text' | 'dwg'
  confidence: 'exact' | 'trimmed' | 'normalized' | 'fallback'
  absolute?: { start: number; end: number }
  quote?: { text: string; normalizedText?: string }
  context?: { prefix: string; suffix: string }
  chunk?: { index: number; start: number; end: number; total: number }
  hint?: { fileId?: string; pageHint?: number; lineHint?: number; cadHandleId?: string }
}

export type ReviewObjective = 'COMPLIANCE' | 'COMPARE' | 'PROOFREAD' | 'STRUCTURED'
export type ReviewEvidenceSource = 'STANDARD' | 'RULE_LIBRARY' | 'REFERENCE'
export type ReviewExecutionProfile = 'AI_ONLY' | 'RULE_ONLY'

export interface ReviewPlan {
  objective: ReviewObjective
  evidence: {
    sources: ReviewEvidenceSource[]
    maxkbKnowledgeIds?: string[]
    ruleLibraryId?: string | null
    refFileGroupId?: string | null
    enabledPrefixes?: string[]
  }
  enhancements: {
    intraFileConsistency: boolean
    crossFileConsistency: boolean
  }
  execution: {
    profile: ReviewExecutionProfile
  }
  templateId?: string
}

export type ReviewConfidence = 'RULE_EXACT' | 'STD_MATCH' | 'AI_INFERRED' | 'NO_RESULT'

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
  version: string
  /** 标准全文内容（可以是长篇文本），列表接口不返回此字段 */
  content?: string | null
  category?: string
  enabled?: boolean
  createdAt: string
  updatedAt: string
  /** Normative 标准编号 */
  standardNo?: string | null
  /** Normative 标准名称 */
  standardName?: string | null
  /** Normative 标识符 (如 GB/T) */
  standardIdent?: string | null
  /** Normative 状态 */
  standardStatus?: 'CURRENT' | 'UPCOMING' | 'ABOLISHED'
  /** 发布日期 */
  publishDate?: string | null
  /** 实施日期 */
  implementDate?: string | null
  /** 废止日期 */
  abolishDate?: string | null
  /** 启用状态 */
  isActive?: boolean
  /** 所属文件夹 */
  folderId?: string | null
  /** MaxKB 文档 ID */
  maxkbDocId?: string | null
  /** 来源 */
  source?: string | null
  /** 关联任务数 */
  _count?: {
    tasks: number
  }
  /** 文件夹 */
  folder?: {
    id: string
    name: string
  } | null
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

/** MaxKB 集成状态 */
export interface MaxKBStatus {
  maxkbReachable: boolean
  initialized: boolean
  knowledgeCount: number
  documentCount: number
  applicationCount: number
  lastSyncTime?: string
}

/** MaxKB 命中测试结果 */
export interface MaxKBHitTestResult {
  results: Array<{
    content: string
    documentName: string
    similarity: number
    comprehensiveScore: number
  }>
  query: string
  topNumber: number
}

/** MaxKB 知识库项 */
export interface KnowledgeBaseItem {
  id: string
  name: string
  description?: string
  documentCount: number
  type?: string
}

/** MaxKB 知识库树节点 */
export interface KnowledgeTreeNode {
  id: string
  name: string
  type: 'folder' | 'knowledge'
  documentCount?: number
  children?: KnowledgeTreeNode[]
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
  /** 扩展字段：用户视图 */
  myTasks?: { by_status?: Record<string, number>; total?: number }
  pendingIssues?: any[]
  avgProcessingTimeMs?: number
  complianceRate?: number
  /** 扩展字段：领导视图 */
  taskStats?: Record<string, number>
  issues?: { by_severity?: Record<string, number> }
  issueStats?: Record<string, number>
  frequentTypos?: any[]
  topViolations?: any[]
  departmentStats?: any[]
  averageProcessingTimeMs?: number
  bySeverity?: Record<string, number>
  unhandledHigh?: any[]
  comparedToLastPeriod?: { tasksDelta?: number; complianceDelta?: number; avgTimeDelta?: number }
  overview?: {
    departmentCount: number
    userCount: number
    standardCount: number
    ruleCount: number
    feedbackCount: number
    announcementCount: number
    knowledgeDocCount: number
    auditLogCount: number
    ruleLibraryCount: number
  }
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
  /** registry.ts 中当前最新默认值（后端实时注入） */
  registryDefault: string
  /** 用户是否在前端手动修改过此提示词 */
  isModified: boolean
  createdAt: string
  updatedAt: string
}

/** 提示词模块 */
export interface PromptModule {
  key: string
  name: string
  label: string
  count: number
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

// ===== 反馈建议相关类型 =====

/** 反馈状态 */
export type FeedbackStatus = 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

/** 反馈类别 */
export type FeedbackCategory = 'BUG_REPORT' | 'SUGGESTION' | 'FEATURE_REQUEST' | 'OTHER'

/** 反馈附件 */
export interface FeedbackAttachment {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  fileType: string
}

/** 反馈 */
export interface Feedback {
  id: string
  title: string
  content: string
  category: FeedbackCategory
  status: FeedbackStatus
  userId: string
  user?: {
    id: string
    username: string
    name: string
    role: UserRole
  }
  attachmentPaths?: FeedbackAttachment[] | null
  createdAt: string
  updatedAt: string
  resolvedAt?: string | null
  resolverId?: string | null
  resolvedBy?: {
    id: string
    username: string
    name: string
  } | null
  remark?: string | null
}

// ===== 系统公告相关类型 =====

/** 公告紧急程度 */
export type AnnouncementUrgency = 'NORMAL' | 'IMPORTANT' | 'URGENT'

/** 公告状态 */
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'

/** 系统公告 */
export interface SystemAnnouncement {
  id: string
  title: string
  content: string
  urgency: AnnouncementUrgency
  status: AnnouncementStatus
  publishAt: string | null
  withdrawnAt: string | null
  createdBy: string
  creator?: {
    id: string
    username: string
    name: string
  }
  isRead?: boolean
  isConfirmed?: boolean
  createdAt: string
  updatedAt: string
}

/** 用户公告阅读记录 */
export interface UserAnnouncementRead {
  id: string
  userId: string
  announcementId: string
  announcement?: SystemAnnouncement
  readAt: string
  confirmed: boolean
}

/** DEC 审点（StandardCheckpoint） */
export interface StandardCheckpoint {
  id: string
  standardId: string
  clauseHash?: string | null
  clauseCode?: string | null
  clauseText: string
  mandatory: 'mandatory' | 'guidance'
  auditDimension: 'compliance' | 'fact' | 'text'
  checkPrompt?: string | null
  source: 'clause_split' | 'manual'
  createdAt: string
  updatedAt: string
}

/** 审点统计 */
export interface CheckpointStats {
  total: number
  mandatory: number
  guidance: number
  compliance: number
  fact: number
  text: number
}

