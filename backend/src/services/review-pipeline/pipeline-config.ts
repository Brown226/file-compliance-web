/**
 * 流水线配置工具函数
 *
 * 从 BasePipeline 提取而来，提供流水线运行时配置的读取和判断逻辑。
 */

import { PipelineContext, PipelineReviewConfig, ReviewModeType } from './types';
/**
 * 获取有效的审查配置（带默认值回退）
 */
export function getEffectiveConfig(ctx: PipelineContext): PipelineReviewConfig {
  const cfg = ctx.pipelineConfig;
  if (!cfg) {
    return {
      aiEngine: 'auto',
      chunkSize: 4000,
      llmMaxTokens: 4096,
      llmTimeout: 180,
      ocrTimeout: 60,
      maxConcurrentReviews: 5,
      logLevel: 'info',
      contextWindow: 131072, // 默认 128K 上下文（字符数，约 32K tokens）
    };
  }
  return {
    aiEngine: cfg.aiEngine || 'auto',
    chunkSize: cfg.chunkSize || 4000,
    llmMaxTokens: cfg.llmMaxTokens || 4096,
    llmTimeout: cfg.llmTimeout || 180,
    ocrTimeout: cfg.ocrTimeout || 60,
    maxConcurrentReviews: cfg.maxConcurrentReviews || 3,
    logLevel: cfg.logLevel || 'info',
    contextWindow: cfg.contextWindow || 131072,
  };
}

/**
 * 检查某阶段是否应该运行
 * @param ctx Pipeline 上下文
 * @param defaultEnabled 默认启用状态
 * @param stageName 阶段名称：'rules' | 'ai' | 'stdRef'
 */
export function shouldRunStage(
  ctx: PipelineContext,
  defaultEnabled: boolean,
  _stageName: 'rules' | 'ai' | 'stdRef',
): boolean {
  if (ctx.executionOverrides?.stages && _stageName in ctx.executionOverrides.stages) {
    return ctx.executionOverrides.stages[_stageName] !== false;
  }
  return defaultEnabled;
}


