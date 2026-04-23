/**
 * 审查模式能力配置管理
 *
 * 从 systemConfig 表读取/写入 pipeline_mode_capabilities 配置
 * standardRef 统一使用 boolean：前端开关 true/false，后端存储 'on'/'off'
 */
import prisma from '../../config/db';
import { ReviewModeType } from './types';
import { MODE_CAPABILITIES } from './mode-config';

const CONFIG_KEY = 'pipeline_mode_capabilities';

// 后端标准引用格式: 'on' | 'off'
type StandardRefValue = 'on' | 'off';

export interface ModeConfigOverride {
  enabled?: boolean;
  rules?: boolean;
  standardRef?: StandardRefValue;
  ai?: boolean;
  aiStrategy?: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
  crossFile?: boolean;
}

export interface ModeCapabilitiesConfig {
  [mode: string]: ModeConfigOverride;
}

/** 加载模式配置（合并默认配置，standardRef 转换为 boolean 供前端使用） */
export async function getModeCapabilitiesConfig(): Promise<Record<ReviewModeType, {
  enabled: boolean;
  rules: boolean;
  standardRef: boolean;  // true='on', false='off'
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
      standardRef: cap.standardRef === 'on',
      ai: cap.ai,
      aiStrategy: cap.aiStrategy,
      crossFile: cap.crossFile,
    };
  }

  // 从数据库读取覆盖配置
  try {
    const record = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (record?.value && typeof record.value === 'object') {
      const overrides = record.value as ModeCapabilitiesConfig;
      for (const [mode, override] of Object.entries(overrides)) {
        if (result[mode] && override) {
          if (override.standardRef !== undefined) {
            result[mode].standardRef = override.standardRef === 'on';
          }
          if (override.enabled !== undefined) result[mode].enabled = override.enabled;
          if (override.rules !== undefined) result[mode].rules = override.rules;
          if (override.ai !== undefined) result[mode].ai = override.ai;
          if (override.aiStrategy !== undefined) result[mode].aiStrategy = override.aiStrategy;
          if (override.crossFile !== undefined) result[mode].crossFile = override.crossFile;
        }
      }
    }
  } catch (e) {
    console.error('[ModeConfig] 加载配置失败，使用默认配置', e);
  }

  return result as Record<ReviewModeType, any>;
}

/** 保存模式配置（standardRef boolean 转换为 'on'/'off'） */
export async function saveModeCapabilitiesConfig(config: Record<string, any>): Promise<void> {
  // 转换 standardRef: boolean → 'on'/'off'
  const toSave: ModeCapabilitiesConfig = {};
  for (const [mode, cfg] of Object.entries(config)) {
    const c = cfg as any;
    toSave[mode] = {
      enabled: c.enabled,
      rules: c.rules,
      standardRef: c.standardRef === true ? 'on' : 'off',
      ai: c.ai,
      aiStrategy: c.aiStrategy,
      crossFile: c.crossFile,
    };
  }

  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: toSave },
    create: { key: CONFIG_KEY, value: toSave },
  });
}
