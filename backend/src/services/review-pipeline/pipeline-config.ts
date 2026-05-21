/**
 * 流水线配置工具函数
 *
 * 从 BasePipeline 提取而来，提供流水线运行时配置的读取和判断逻辑。
 */

import { PipelineContext, PipelineReviewConfig, ReviewModeType } from './types';
import { ModeCapabilities } from './mode-config';

/**
 * 获取有效的流水线配置（带默认值回退）
 */
export function getEffectiveConfig(ctx: PipelineContext): PipelineReviewConfig {
  const cfg = ctx.pipelineConfig;
  if (!cfg) {
    return {
      modes: {},
      aiEngine: 'auto',
      chunkSize: 4000,
      llmMaxTokens: 4096,
      llmTimeout: 180,
      ocrTimeout: 60,
      maxConcurrentReviews: 3,
      logLevel: 'info',
    };
  }
  return {
    modes: cfg.modes || {},
    aiEngine: cfg.aiEngine || 'auto',
    chunkSize: cfg.chunkSize || 4000,
    llmMaxTokens: cfg.llmMaxTokens || 4096,
    llmTimeout: cfg.llmTimeout || 180,
    ocrTimeout: cfg.ocrTimeout || 60,
    maxConcurrentReviews: cfg.maxConcurrentReviews || 3,
    logLevel: cfg.logLevel || 'info',
  };
}

/**
 * 检查某阶段是否应该运行（优先读取 pipelineConfig，再回退到 capabilities）
 * @param ctx Pipeline 上下文
 * @param capabilities 当前模式的能力组合
 * @param stageName 阶段名称：'rules' | 'ai' | 'stdRef'
 */
export function shouldRunStage(
  ctx: PipelineContext,
  capabilities: ModeCapabilities,
  stageName: 'rules' | 'ai' | 'stdRef',
): boolean {
  if (ctx.executionOverrides?.stages && stageName in ctx.executionOverrides.stages) {
    return ctx.executionOverrides.stages[stageName] !== false;
  }
  const config = getEffectiveConfig(ctx);
  const modeConfig = config.modes?.[ctx.reviewMode as ReviewModeType];
  if (!modeConfig?.stages) {
    // 无运行时配置时，回退到 capabilities 的静态声明
    if (stageName === 'rules') return capabilities.rules;
    if (stageName === 'ai') return capabilities.ai;
    if (stageName === 'stdRef') return capabilities.standardRef !== 'off';
    return true;
  }
  const stages = modeConfig.stages as any;
  if (stageName in stages) {
    return stages[stageName] !== false;
  }
  return true; // 未配置的阶段默认执行
}

/**
 * 获取当前模式的自定义规则前缀（如果配置了），否则返回默认前缀
 */
export function getEffectiveRulePrefixes(
  ctx: PipelineContext,
  capabilities: ModeCapabilities,
  defaultPrefixes: string[],
): string[] {
  const config = getEffectiveConfig(ctx);
  const modeConfig = config.modes?.[ctx.reviewMode as ReviewModeType];
  if (modeConfig?.rulePrefixes && modeConfig.rulePrefixes.length > 0) {
    return modeConfig.rulePrefixes;
  }
  return defaultPrefixes;
}
