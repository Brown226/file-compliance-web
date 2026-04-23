/**
 * 审查流水线公共类型定义
 */

import { RuleIssue, FileContext } from '../rules/types';
import { ReviewIssue, SourceReference } from '../llm.service';

/** 审查模式（与数据库 ReviewMode 枚举一致） */
export type ReviewModeType =
  | 'LIBRARY_REVIEW'
  | 'DOC_REVIEW'
  | 'CONSISTENCY'
  | 'TYPO_GRAMMAR'
  | 'MULTIMODAL'
  | 'CUSTOM_RULE'
  | 'FULL_REVIEW';

/** Pipeline 阶段开关配置 */
export interface PipelineStageConfig {
  rules: boolean;      // 是否执行规则引擎
  ai: boolean;         // 是否执行 AI 审查
  stdRef?: boolean;    // 是否执行标准引用检查（仅 LIBRARY_REVIEW / FULL_REVIEW）
}

/** Pipeline 模式配置 */
export interface PipelineModeConfig {
  enabled: boolean;           // 该模式是否启用
  stages: PipelineStageConfig; // 阶段开关
  rulePrefixes: string[];     // 启用的规则前缀
}

/** Pipeline 全局配置（存储在 SystemConfig 'pipeline_review_config' 中） */
export interface PipelineReviewConfig {
  modes: Partial<Record<ReviewModeType, PipelineModeConfig>>;
  aiEngine: 'auto' | 'rag' | 'rag_llm' | 'maxkb_only' | 'llm_only' | 'disabled';  // AI 引擎策略
  chunkSize: number;           // 文本分片大小
  llmMaxTokens: number;        // LLM max_tokens
  llmTimeout: number;          // LLM 超时（秒）
  maxkbTimeout: number;        // MaxKB 超时（秒）
  ocrTimeout: number;          // OCR 超时（秒）
  maxConcurrentReviews: number;// 最大并发审查数
  logLevel: 'debug' | 'info' | 'warn' | 'error';  // 日志级别
}

/** Word 文档结构化数据 */
export interface WordStructure {
  headers: Array<{ text: string; type: string }>;
  paragraphs: Array<{ text: string; style: string | null; page: number | null }>;
  tables: Array<{ rows: string[][]; caption: string | null }>;
}

/** DWG 图纸结构化数据 */
export interface DwgStructure {
  /** 图层列表 */
  layers: string[];
  /** 文本实体 */
  textEntities: Array<{
    text: string;
    layer: string;
    entityType: 'TEXT' | 'MTEXT';
    handle: string;
    insert?: [number, number];
  }>;
  /** 尺寸标注 */
  dimensions: Array<{
    text: string;
    layer: string;
    entityType: string;
    handle: string;
    measurement?: string | null;
  }>;
  /** 标准引用 */
  standardRefs: Array<{
    standardNo: string;
    standardName: string;
    standardIdent: string;
    cadHandleId: string;
  }>;
}

/** 单个文件的审查上下文 */
export interface PipelineContext {
  taskId: string;
  fileId: string;
  fileName: string;
  filePath: string;
  fileType: string;
  extractedText: string;
  pdfPages?: string[];
  reviewMode: ReviewModeType;
  standardIds?: string[];           // 关联标准ID
  maxkbKnowledgeId?: string;        // 用户选择的知识库ID（兼容单个）
  maxkbKnowledgeIds?: string[];     // 用户选择的多个知识库ID（树形选择器多选）
  refFileGroup?: {                  // 参照文件组（以文审文模式）
    groupId: string;
    groupName: string;
    refFiles: Array<{
      id: string;
      fileName: string;
      filePath: string;
      fileType: string;
      extractedText?: string;
    }>;
  };
  pipelineConfig?: PipelineReviewConfig;  // 审查流水线配置
  /**
   * 每完成一个 AI 分片审查后回调
   * @param chunkLength 该分片处理的字符数（用于更新 processedLength 进度）
   * @param issues 该分片审查出的问题数组（用于立即入库并推送 WebSocket）
   * @param chunkIndex 当前分片索引
   * @param totalChunks 总分片数
   * @param engine 使用的 AI 引擎名称
   */
  onChunkProgress?: (
    chunkLength: number,
    issues: ReviewIssue[],
    chunkIndex: number,
    totalChunks: number,
    engine: string,
  ) => void;
  /** 阶段1（规则+标准引用）完成后的回调，允许立即返回快速结果 */
  onFastResult?: (fastResult: { ruleIssues: RuleIssue[]; stdRefIssues: ReviewIssue[] }) => void;
  /** Python 解析服务的结构化结果（可能为 null） */
  parseResult?: import('../python-parser.service').ParseResult | null;
  /** Word 文档结构化数据 */
  wordStructure?: WordStructure;
  /** DWG 图纸结构化数据 */
  dwgStructure?: DwgStructure;
}

/** 审查流水线接口 — 策略模式核心 */
export interface ReviewPipeline {
  /** 流水线对应的审查模式 */
  readonly mode: ReviewModeType;

  /** 流水线显示名称 */
  readonly displayName: string;

  /** 流水线描述 */
  readonly description: string;

  /**
   * 该模式需要使用的规则前缀（用于过滤规则引擎）
   * @deprecated 空数组表示全量规则，实际过滤由数据库 review_rules.enabled 控制。
   *   保留此字段仅为向后兼容。
   */
  readonly rulePrefixes: string[];

  /** 是否需要 AI 审查（MaxKB/LLM） */
  readonly needsAI: boolean;

  /** 是否需要参照文件 */
  readonly needsRefFiles: boolean;

  /**
   * 模式能力组合（数据驱动配置）
   * 重构后新增：BasePipeline 统一读取此配置编排阶段1/2流程，
   * 子类不再需要重复编写几乎相同的 execute() 逻辑。
   */
  readonly capabilities: import('./mode-config').ModeCapabilities;

  /**
   * 执行审查流水线
   * @param ctx 文件审查上下文
   * @returns 规则引擎问题 + AI 审查问题
   */
  execute(ctx: PipelineContext): Promise<PipelineResult>;

  /**
   * 阶段1: 规则审查（快速）
   * 用于两阶段并行编排：所有文件分批并发执行阶段1，立即入库推送
   */
  runFastPhase(ctx: PipelineContext): Promise<FastPhaseResult>;

  /**
   * 阶段2: AI 深度审查（耗时）
   * 用于两阶段并行编排：阶段1全部完成后，所有文件分批并发执行阶段2
   */
  runSlowPhase(ctx: PipelineContext): Promise<SlowPhaseResult>;
}

/** 流水线执行结果 */
export interface PipelineResult {
  ruleIssues: RuleIssue[];
  aiIssues: ReviewIssue[];
  /** 标准引用检查问题（独立出来方便前端分类展示） */
  stdRefIssues?: ReviewIssue[];
  sources?: SourceReference[];  // MaxKB RAG 溯源来源汇总（用于统计/展示），每个 issue 的精确映射见 aiIssues[].sourceReferences
  metadata?: {
    usedEngine?: string;       // 'maxkb' | 'llm-direct' | 'none'
    processingTime?: number;   // 处理耗时(ms)
    stdRefCount?: number;      // 提取到的标准引用总数
    stdRefMatched?: number;    // 匹配成功的数量
    [key: string]: any;
  };
}

/** 阶段1（规则审查）结果 — 用于两阶段并行编排 */
export interface FastPhaseResult {
  ruleIssues: RuleIssue[];
  stdRefIssues: ReviewIssue[];
  textLength: number;
}

/** 阶段2（AI审查）结果 — 用于两阶段并行编排 */
export interface SlowPhaseResult {
  aiIssues: ReviewIssue[];
  sources?: SourceReference[];
  usedEngine?: string;
}
