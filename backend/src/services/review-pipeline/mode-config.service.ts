/**
 * 审查模式配置管理
 *
 * 从 systemConfig 表读取/写入模式配置（启用/禁用、AI 策略等）
 * 不再依赖 MODE_CAPABILITIES 静态配置表，配置完全自包含。
 */
import prisma from '../../config/db';
import { ReviewModeType } from './types';

const CONFIG_KEY = 'pipeline_mode_capabilities';

export interface ParamToleranceConfig {
  /** 默认数值容差（相对差异阈值），未配置 byUnit 时使用 */
  default: number;
  /** 按参数单位差异化容差，key 为单位（如 'MPa'、'℃'），value 为相对差异阈值 */
  byUnit?: Record<string, number>;
}

export interface ModeConfigOverride {
  enabled?: boolean;
  rules?: boolean;
  standardRef?: boolean;
  ai?: boolean;
  aiStrategy?: 'standard' | 'llmOnly' | 'refCompare' | 'contractReview' | 'decReview';
  crossFile?: boolean;
  paramTolerance?: ParamToleranceConfig;
}

export interface ModeCapabilitiesConfig {
  [mode: string]: ModeConfigOverride;
}

/**
 * 各模式的默认配置（自包含，不依赖外部模块）
 *
 * ⚠️ 优先级：DB 表 `system_configs.pipeline_mode_capabilities` 中的显式记录
 * **优先于**本默认值（见 getModeCapabilitiesConfig 的覆盖逻辑）。
 * 若线上库已有历史记录（如 LIBRARY_REVIEW.standardRef=false），默认值不会生效——
 * 如需强制启用默认行为，需清除该配置记录（或改 DB 对应字段），代码层不做自动清库。
 */
const DEFAULT_MODE_CONFIGS: Record<ReviewModeType, {
  enabled: boolean;
  rules: boolean;
  standardRef: boolean;
  ai: boolean;
  aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'contractReview' | 'decReview';
  crossFile: boolean;
  paramTolerance?: ParamToleranceConfig;
}> = {
  LIBRARY_REVIEW: { enabled: true, rules: false, standardRef: true, ai: true, aiStrategy: 'standard', crossFile: false },
  DOC_REVIEW:     { enabled: true, rules: false, standardRef: false, ai: true, aiStrategy: 'refCompare', crossFile: false },
  CONTRACT_REVIEW: { enabled: true, rules: false, standardRef: false, ai: true, aiStrategy: 'contractReview', crossFile: false },
  CONSISTENCY:    { enabled: true, rules: true,  standardRef: false, ai: true, aiStrategy: 'standard', crossFile: true, paramTolerance: { default: 0.01, byUnit: { 'MPa': 0.005, '℃': 0.02 } } },
  TYPO_GRAMMAR:   { enabled: true, rules: false, standardRef: false, ai: true, aiStrategy: 'llmOnly', crossFile: false },
  RULE_ONLY:    { enabled: true, rules: true,  standardRef: false, ai: false, aiStrategy: 'standard', crossFile: false },
  SELF_CHECK:     { enabled: true, rules: false, standardRef: true, ai: false, aiStrategy: 'standard', crossFile: false },
  DEC_REVIEW:     { enabled: true, rules: false, standardRef: false, ai: true, aiStrategy: 'decReview', crossFile: false },
};

/** 加载模式配置（合并默认配置 + DB 覆盖） */
export async function getModeCapabilitiesConfig(): Promise<Record<ReviewModeType, {
  enabled: boolean;
  rules: boolean;
  standardRef: boolean;
  ai: boolean;
  aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'contractReview' | 'decReview';
  crossFile: boolean;
  paramTolerance?: ParamToleranceConfig;
}>> {
  // 以默认配置为基底
  const result: Record<string, any> = {};
  for (const [mode, cfg] of Object.entries(DEFAULT_MODE_CONFIGS)) {
    result[mode] = { ...cfg };
  }

  // 从数据库读取覆盖配置
  try {
    const record = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (record?.value) {
      const overrides = typeof record.value === 'string'
        ? JSON.parse(record.value)
        : record.value as ModeCapabilitiesConfig;

      for (const [mode, override] of Object.entries(overrides)) {
        const cfg = override as ModeConfigOverride | undefined;
        if (result[mode] && cfg) {
          if (cfg.enabled !== undefined) result[mode].enabled = cfg.enabled;
          if (cfg.rules !== undefined) result[mode].rules = cfg.rules;
          if (cfg.standardRef !== undefined) result[mode].standardRef = cfg.standardRef;
          if (cfg.ai !== undefined) result[mode].ai = cfg.ai;
          if (cfg.aiStrategy !== undefined) result[mode].aiStrategy = cfg.aiStrategy;
          if (cfg.crossFile !== undefined) result[mode].crossFile = cfg.crossFile;
          if (cfg.paramTolerance !== undefined) result[mode].paramTolerance = cfg.paramTolerance;
        }
      }
    }
  } catch (e) {
    console.error('[ModeConfig] 加载配置失败，使用默认配置', e);
  }

  return result as Record<ReviewModeType, any>;
}

/** 清除缓存（兼容性保留，新架构无缓存） */
export function clearCapabilitiesCache(): void {
  // 新架构中无缓存需要清除，保留空实现供调用方兼容
}

/** 保存模式配置 */
export async function saveModeCapabilitiesConfig(config: Record<string, any>): Promise<void> {
  const toSave: ModeCapabilitiesConfig = {};
  for (const [mode, cfg] of Object.entries(config)) {
    const c = cfg as any;
    toSave[mode] = {
      enabled: c.enabled,
      rules: c.rules,
      standardRef: !!c.standardRef,
      ai: c.ai,
      aiStrategy: c.aiStrategy,
      crossFile: c.crossFile,
      paramTolerance: c.paramTolerance,
    };
  }

  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: JSON.stringify(toSave) },
    create: { key: CONFIG_KEY, value: JSON.stringify(toSave) },
  });
}
