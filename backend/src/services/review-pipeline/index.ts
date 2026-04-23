/**
 * 审查流水线模块入口（重构后）
 *
 * 重构说明（2026-04-19）：
 * - 新增 mode-config.ts：数据驱动的模式能力配置
 * - 新增 standard.pipeline.ts：替代 4 个重复 Pipeline
 * - 删除 library-review.pipeline.ts, consistency.pipeline.ts,
 *   full-review.pipeline.ts, custom-rule.pipeline.ts
 * - 保留 doc-review.pipeline.ts, typo-grammar.pipeline.ts, multimodal.pipeline.ts
 *   （它们有独特的 AI 策略，需覆盖钩子方法）
 */

export type { ReviewPipeline, PipelineContext, PipelineResult, ReviewModeType, PipelineReviewConfig, PipelineModeConfig, PipelineStageConfig } from './types';
export { BasePipeline } from './base-pipeline';
export { ModeCapabilities, getModeCapabilities, MODE_CAPABILITIES } from './mode-config';
export { StandardPipeline } from './standard.pipeline';
export { DocReviewPipeline } from './doc-review.pipeline';
export { TypoGrammarPipeline } from './typo-grammar.pipeline';
export { MultimodalPipeline } from './multimodal.pipeline';
export { createPipeline, createPipelineAsync, getAvailableModes, clearCapabilitiesCache } from './factory';
