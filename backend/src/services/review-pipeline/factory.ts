/**
 * 审查流水线工厂（重构后）
 *
 * 重构说明（2026-04-19）：
 * - LIBRARY_REVIEW / CONSISTENCY / FULL_REVIEW / CUSTOM_RULE 统一使用 StandardPipeline
 * - DocReviewPipeline / TypoGrammarPipeline / MultimodalPipeline 保留为独立子类
 *   （它们有独特的 AI 策略，需覆盖 runAIStrategy 等钩子方法）
 * - 已删除的文件：library-review.pipeline.ts, consistency.pipeline.ts,
 *   full-review.pipeline.ts, custom-rule.pipeline.ts
 */

import { ReviewPipeline, ReviewModeType } from './types';
import { StandardPipeline } from './standard.pipeline';
import { DocReviewPipeline } from './doc-review.pipeline';
import { TypoGrammarPipeline } from './typo-grammar.pipeline';
import { MultimodalPipeline } from './multimodal.pipeline';
import { ModeCapabilities } from './mode-config';
import { getModeCapabilitiesConfig } from './mode-config.service';
import prisma from '../../config/db';

/**
 * 运行时模式能力配置（缓存，避免每次创建都查库）
 * key=审查模式，value=运行时能力配置（合并了 DB 配置与默认值）
 */
let cachedRuntimeCapabilities: Record<ReviewModeType, ModeCapabilities> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5秒缓存

/**
 * 获取运行时能力配置（带缓存）
 * 优先从 DB 的 pipeline_mode_capabilities 读取覆盖配置，回退到 mode-config.ts 默认值
 */
async function getRuntimeCapabilities(): Promise<Record<ReviewModeType, ModeCapabilities>> {
  const now = Date.now();
  if (cachedRuntimeCapabilities && now - cacheTime < CACHE_TTL) {
    return cachedRuntimeCapabilities;
  }

  try {
    // 从 DB 读取运行时配置
    const dbConfig = await getModeCapabilitiesConfig();
    cachedRuntimeCapabilities = dbConfig as Record<ReviewModeType, ModeCapabilities>;
    cacheTime = now;
    return cachedRuntimeCapabilities;
  } catch (e) {
    // DB 不可用时回退到缓存
    if (cachedRuntimeCapabilities) return cachedRuntimeCapabilities;
    throw e;
  }
}

/** 同步获取缓存的运行时能力（无缓存时返回 null） */
function getCachedCapabilities(): Record<ReviewModeType, ModeCapabilities> | null {
  return cachedRuntimeCapabilities;
}

/** 清除运行时能力缓存（配置保存后调用） */
export function clearCapabilitiesCache(): void {
  cachedRuntimeCapabilities = null;
  cacheTime = 0;
}

/**
 * 工厂函数映射
 * - 使用 StandardPipeline 的模式：LIBRARY_REVIEW / CONSISTENCY / FULL_REVIEW / CUSTOM_RULE
 * - 使用独立 Pipeline 的模式：DOC_REVIEW / TYPO_GRAMMAR / MULTIMODAL
 */
const PIPELINE_MAP: Record<ReviewModeType, (runtimeCaps?: ModeCapabilities) => ReviewPipeline> = {
  LIBRARY_REVIEW: (caps) => new StandardPipeline('LIBRARY_REVIEW', caps),
  DOC_REVIEW: (caps) => new DocReviewPipeline(caps),
  CONSISTENCY: (caps) => new StandardPipeline('CONSISTENCY', caps),
  TYPO_GRAMMAR: (caps) => new TypoGrammarPipeline(caps),
  MULTIMODAL: (caps) => new MultimodalPipeline(caps),
  CUSTOM_RULE: (caps) => new StandardPipeline('CUSTOM_RULE', caps),
  FULL_REVIEW: (caps) => new StandardPipeline('FULL_REVIEW', caps),
};

/** 获取所有可用的审查模式信息（根据 DB 配置过滤禁用模式） */
export async function getAvailableModes(): Promise<Array<{
  mode: ReviewModeType;
  displayName: string;
  description: string;
  needsRefFiles: boolean;
  capabilities: ModeCapabilities;
}>> {
  // 预热缓存，确保所有 pipeline 使用一致的运行时配置
  const runtimeCaps = await getRuntimeCapabilities();

  return Object.entries(PIPELINE_MAP)
    .filter(([mode]) => {
      // 过滤被禁用的模式
      const cfg = runtimeCaps[mode as ReviewModeType];
      return !cfg || cfg.enabled !== false;
    })
    .map(([mode, factory]) => {
      const pipeline = factory(runtimeCaps[mode as ReviewModeType]);
      return {
        mode: mode as ReviewModeType,
        displayName: pipeline.displayName,
        description: pipeline.description,
        needsRefFiles: pipeline.needsRefFiles,
        capabilities: pipeline.capabilities,
      };
    });
}

/** 根据审查模式创建对应的流水线（同步版本，使用缓存） */
export function createPipeline(mode: ReviewModeType): ReviewPipeline {
  const factory = PIPELINE_MAP[mode];
  if (!factory) {
    throw new Error(`不支持的审查模式: ${mode}`);
  }
  // 优先使用缓存的运行时配置（缓存不存在时使用默认配置，创建 pipeline）
  const cachedCaps = getCachedCapabilities();
  return factory(cachedCaps?.[mode]);
}

/** 根据审查模式创建对应的流水线（异步版本，确保从 DB 读取最新配置） */
export async function createPipelineAsync(mode: ReviewModeType): Promise<ReviewPipeline> {
  const factory = PIPELINE_MAP[mode];
  if (!factory) {
    throw new Error(`不支持的审查模式: ${mode}`);
  }
  const runtimeCaps = await getRuntimeCapabilities();
  return factory(runtimeCaps[mode]);
}
