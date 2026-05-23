/**
 * 审查模式能力配置（数据驱动）
 *
 * 重构说明（2026-04-19）：
 * 原先 7 个 Pipeline 类中有 3 个（LIBRARY_REVIEW / CONSISTENCY / CUSTOM_RULE）
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
 * 模式关系梳理（简化版）：
 * - LIBRARY_REVIEW（以库审文）= 仅 AI(RAG/LLM)                     → 标准AI模式
 * - DOC_REVIEW   （以文审文）= 仅 AI(参照比对)                      → 有参照时比对，无参照降级标准AI
 * - CONSISTENCY  （一致性）  = 仅 AI + 跨文件                        → 标准AI + 跨文件
 * - TYPO_GRAMMAR （错别字）  = 仅 AI(纯LLM)                        → 纯LLM模式
 * - MULTIMODAL   （多模态）  = 仅 AI(多模态)                        → 多模态LLM模式
 * - CUSTOM_RULE  （自定义）  = 规则引擎 + 标准引用检查               → 仅规则模式（保留原有逻辑）
 *
 * 配置说明：
 * - 除 CUSTOM_RULE 外，其他模式均关闭规则和标准引用检查，只保留 AI 审查
 * - CUSTOM_RULE 保持规则和标准引用检查开启，无 AI 审查
 */
export const MODE_CAPABILITIES: Record<ReviewModeType, ModeCapabilities> = {
  LIBRARY_REVIEW: {
    rules: false,
    standardRef: 'off',
    ai: true,
    aiStrategy: 'standard',
    crossFile: false,
    needsRefFiles: false,
  },
  DOC_REVIEW: {
    rules: false,
    standardRef: 'off',
    ai: true,
    aiStrategy: 'refCompare',
    crossFile: false,
    needsRefFiles: true,
  },
  CONSISTENCY: {
    rules: false,
    standardRef: 'off',
    ai: true,
    aiStrategy: 'standard',
    crossFile: true,
    needsRefFiles: false,
  },
  TYPO_GRAMMAR: {
    rules: false,
    standardRef: 'off',
    ai: true,
    aiStrategy: 'llmOnly',
    crossFile: false,
    needsRefFiles: false,
  },
  MULTIMODAL: {
    rules: false,
    standardRef: 'off',
    ai: true,
    aiStrategy: 'multimodal',
    crossFile: false,
    needsRefFiles: false,
  },
  CUSTOM_RULE: {
    rules: true,
    standardRef: 'on',
    ai: false,
    aiStrategy: 'standard',
    crossFile: false,
    needsRefFiles: false,
  },
};

/** 获取指定模式的能力配置 */
export function getModeCapabilities(mode: ReviewModeType): ModeCapabilities {
  return MODE_CAPABILITIES[mode];
}
