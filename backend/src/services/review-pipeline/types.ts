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
  | 'RULE_ONLY'
  | 'SELF_CHECK'
  | 'CONTRACT_REVIEW'
  | 'STANDARD_CHECK';

/** 审查模式 → prompt 场景名映射（唯一数据源，review-handlers / ai-review 共用） */
export const MODE_SCENE_MAP: Record<ReviewModeType, string> = {
  LIBRARY_REVIEW: 'library_review',
  CONSISTENCY:    'consistency',
  TYPO_GRAMMAR:   'typo_grammar',
  DOC_REVIEW:     'doc_review',
  CONTRACT_REVIEW: 'contract_review',
  MULTIMODAL:     'multimodal',
  RULE_ONLY:      'library_review',
  SELF_CHECK:     'self_check',
  STANDARD_CHECK: 'standard_check',
};

/** 根据审查模式获取 prompt 场景名 */
export function getModeScene(mode: ReviewModeType): string {
  return MODE_SCENE_MAP[mode] || 'library_review';
}

/** 审查全局配置（存储在 SystemConfig 'pipeline_review_config' 中） */
export interface PipelineReviewConfig {
  aiEngine: 'auto' | 'rag' | 'rag_llm' | 'llm_only' | 'disabled';  // AI 引擎策略
  chunkSize: number;           // 文本分片大小
  llmMaxTokens: number;        // LLM max_tokens（输出上限）
  llmTimeout: number;          // LLM 超时（秒）
  ocrTimeout: number;          // OCR 超时（秒）
  maxConcurrentReviews: number;// 最大并发审查数
  logLevel: 'debug' | 'info' | 'warn' | 'error';  // 日志级别
  /** 模型上下文窗口大小（字符数）。用于派生分片大小和摘要容量。
   *  不设置则从 LLM 配置的 maxTokens 自动推导（maxTokens × 4）。 */
  contextWindow?: number;
  /** 分片间 overlap 字符数（默认 300），用于跨分片上下文连贯性 */
  chunkOverlap?: number;
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
  ruleSource?: ('STANDARD' | 'RULE_LIBRARY')[];
  ruleLibraryId?: string;
  rulePlan?: {
    enabledPrefixes: string[];
    itemIds: string[];
  };
  standardIds?: string[];           // 关联标准ID
  maxkbKnowledgeId?: string;        // MaxKB 知识库 ID
  maxkbKnowledgeIds?: string[];     // MaxKB 多个知识库 ID
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
  contractStance?: 'owner' | 'contractor';  // 合同审查立场
  pipelineConfig?: PipelineReviewConfig;  // 审查流水线配置
  executionOverrides?: {
    crossFileConsistency?: boolean;
    stages?: {
      rules?: boolean;
      ai?: boolean;
      stdRef?: boolean;
    };
  };
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
  ) => Promise<void>;
  /** 阶段1（规则+标准引用）完成后的回调，允许立即返回快速结果 */
  onFastResult?: (fastResult: { ruleIssues: RuleIssue[]; stdRefIssues: ReviewIssue[] }) => void;
  /** 是否启用文件内一致性检查 */
  intraFileConsistency?: boolean;
  /** 语义规范库条目（从 ReviewSpecification 加载，用于 AI 语义审查） */
  semanticItems?: Array<{
    ruleCode: string;
    ruleName: string;
    category?: string;
    description?: string;
    severity?: string;
  }>;
  /** 用户选择的审查点（用于指导 AI 审查方向） */
  reviewPoints?: string[];
  /** 用户定义的核心目的（用于指导 AI 审查重点） */
  corePurposes?: string[];
  /** 内部使用的语义规范库提示词上下文（由 AI 服务构建） */
  _semanticPromptContext?: string;
  /** 审查场景名（供 prompt 加载用，从 ReviewMode 映射） */
  scene?: string;
  /** Python 解析服务的结构化结果（可能为 null） */
  parseResult?: import('../python-parser.service').ParseResult | null;
  /** Word 文档结构化数据 */
  wordStructure?: WordStructure;
  /** DWG 图纸结构化数据 */
  dwgStructure?: DwgStructure;
  /** 任务创建者 ID（用于记忆系统注入） */
  userId?: string;
  /** 预加载的归一化误报原文集合（任务级预加载，内存归一化匹配） */
  fpLibrarySet?: Set<string>;
  /** OCR 降级原因（非空表示 OCR 服务不可用或失败，审查应生成告警） */
  ocrDegradedReason?: string;
}

/** 审查处理结果 */
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
