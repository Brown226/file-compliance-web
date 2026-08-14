/**
 * 流水线配置工具函数
 *
 * 从 BasePipeline 提取而来，提供流水线运行时配置的读取和判断逻辑。
 */

import { PipelineContext, PipelineReviewConfig } from './types';
import { getMaxConcurrentReviews } from '../../utils/system-config';
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
      maxConcurrentReviews: 3, // 默认值，实际运行时从 DB 读取
      logLevel: 'info',
      contextWindow: 131072, // 默认 128K 上下文（字符数，约 32K tokens）
      chunkOverlap: 300,
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
    chunkOverlap: cfg.chunkOverlap ?? 300,
  };
}

/**
 * 获取每用户文件并发数（从 basic_settings 读取，带回退默认值）
 * 供 review.service.ts 在运行时调用
 */
export { getMaxConcurrentReviews };


