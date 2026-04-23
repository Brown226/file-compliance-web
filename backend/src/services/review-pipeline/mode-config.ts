/**
 * 审查模式能力配置（数据驱动）
 *
 * 重构说明（2026-04-19）：
 * 原先 7 个 Pipeline 类中有 4 个（LIBRARY_REVIEW / CONSISTENCY / FULL_REVIEW / CUSTOM_RULE）
 * 的 execute() / runFastPhase() / runSlowPhase() 逻辑几乎一模一样，
 * 仅在"是否启用 AI / 标准引用 / 跨文件检查"上有差异。
 *
 * 重构思路：将模式的差异化行为抽象为「能力组合」(ModeCapabilities)，
 * 由 BasePipeline 统一编排，子类只需覆盖钩子方法处理独有逻辑。
 * 模式定义从"一个类一种行为"变为"一份配置描述能力组合"。
 */

import { ReviewModeType } from './types';

/** 模式能力组合 — 定义每种审查模式启用的能力 */
export interface ModeCapabilities {
  /** 是否执行规则引擎（阶段1） */
  rules: boolean;
  /** 是否执行标准引用规范性检查（阶段1） */
  standardRef: 'on' | 'off' | 'config';  // on=默认开, off=默认关, config=由 pipelineConfig 控制
  /** 是否执行 AI 深度审查（阶段2） */
  ai: boolean;
  /** AI 引擎策略：standard=走 runAIReview, llmOnly=走 runLLMOnly, refCompare=参照文件比对, multimodal=多模态LLM */
  aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
  /** 是否执行跨文件一致性检查（阶段结束后） */
  crossFile: boolean;
  /** 是否需要参照文件 */
  needsRefFiles: boolean;
}

/**
 * 各审查模式的能力配置
 *
 * 模式关系梳理：
 * - LIBRARY_REVIEW（以库审文）= 规则 + 标准引用 + AI(RAG/LLM)     → 标准模式
 * - DOC_REVIEW   （以文审文）= 规则 + 标准引用 + 参照比对           → 有参照时比对，无参照降级标准AI
 * - CONSISTENCY  （一致性）  = 规则 + 标准引用 + AI + 跨文件         → LIBRARY + 跨文件
 * - TYPO_GRAMMAR （错别字）  = 规则 + AI(纯LLM) + 术语过滤          → 轻量模式
 * - MULTIMODAL   （多模态）  = 规则 + 表格/公式 + 多模态LLM         → 图表专家模式
 * - CUSTOM_RULE  （自定义）  = 仅规则引擎                           → 纯规则模式
 * - FULL_REVIEW  （全量审查）= 规则 + 标准引用 + AI + 跨文件         → 最完整 = CONSISTENCY
 */
export const MODE_CAPABILITIES: Record<ReviewModeType, ModeCapabilities> = {
  LIBRARY_REVIEW: {
    rules: true,
    standardRef: 'on',
    ai: true,
    aiStrategy: 'standard',
    crossFile: false,
    needsRefFiles: false,
  },
  DOC_REVIEW: {
    rules: true,
    standardRef: 'on',
    ai: true,
    aiStrategy: 'refCompare',
    crossFile: false,
    needsRefFiles: true,
  },
  CONSISTENCY: {
    rules: true,
    standardRef: 'on',
    ai: true,
    aiStrategy: 'standard',
    crossFile: true,
    needsRefFiles: false,
  },
  TYPO_GRAMMAR: {
    rules: true,
    standardRef: 'config',
    ai: true,
    aiStrategy: 'llmOnly',
    crossFile: false,
    needsRefFiles: false,
  },
  MULTIMODAL: {
    rules: true,
    standardRef: 'config',
    ai: true,
    aiStrategy: 'multimodal',
    crossFile: false,
    needsRefFiles: false,
  },
  CUSTOM_RULE: {
    rules: true,
    standardRef: 'config',
    ai: false,
    aiStrategy: 'standard',  // ai=false 时此字段无意义，保留占位
    crossFile: false,
    needsRefFiles: false,
  },
  FULL_REVIEW: {
    rules: true,
    standardRef: 'on',
    ai: true,
    aiStrategy: 'standard',
    crossFile: true,
    needsRefFiles: false,
  },
};

/** 获取指定模式的能力配置 */
export function getModeCapabilities(mode: ReviewModeType): ModeCapabilities {
  return MODE_CAPABILITIES[mode];
}
