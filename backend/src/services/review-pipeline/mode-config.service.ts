/**
 * 审查模式能力配置管理
 *
 * 从 systemConfig 表读取/写入 pipeline_mode_capabilities 配置
 * standardRef 已简化为 boolean
 */
import prisma from '../../config/db';
import { ReviewModeType } from './types';
import { MODE_CAPABILITIES } from './mode-config';

const CONFIG_KEY = 'pipeline_mode_capabilities';

export interface ModeConfigOverride {
  enabled?: boolean;
  rules?: boolean;
  standardRef?: boolean;
  ai?: boolean;
  aiStrategy?: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
  crossFile?: boolean;
}

export interface ModeCapabilitiesConfig {
  [mode: string]: ModeConfigOverride;
}

/** 加载模式配置（合并默认配置） */
export async function getModeCapabilitiesConfig(): Promise<Record<ReviewModeType, {
  enabled: boolean;
  rules: boolean;
  standardRef: boolean;
  ai: boolean;
  aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
  crossFile: boolean;
}>> {
  // 默认配置
  const result: Record<string, any> = {};
  for (const [mode, cap] of Object.entries(MODE_CAPABILITIES)) {
    result[mode] = {
      enabled: true,
      rules: cap.rules,
      standardRef: cap.standardRef,
      ai: cap.ai,
      aiStrategy: cap.aiStrategy,
      crossFile: cap.crossFile,
    };
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
          if (cfg.standardRef !== undefined) result[mode].standardRef = cfg.standardRef;
          if (cfg.enabled !== undefined) result[mode].enabled = cfg.enabled;
          if (cfg.rules !== undefined) result[mode].rules = cfg.rules;
          if (cfg.ai !== undefined) result[mode].ai = cfg.ai;
          if (cfg.aiStrategy !== undefined) result[mode].aiStrategy = cfg.aiStrategy;
          if (cfg.crossFile !== undefined) result[mode].crossFile = cfg.crossFile;
        }
      }
    }
  } catch (e) {
    console.error('[ModeConfig] 加载配置失败，使用默认配置', e);
  }

  return result as Record<ReviewModeType, any>;
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
    };
  }

  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: JSON.stringify(toSave) },
    create: { key: CONFIG_KEY, value: JSON.stringify(toSave) },
  });
}
