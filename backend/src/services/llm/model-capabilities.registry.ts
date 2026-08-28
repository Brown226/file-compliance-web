/**
 * 预置模型能力库
 *
 * 覆盖主流 LLM/Embedding/Vision 模型的能力描述，用于：
 * 1. Provider 配置时自动填充能力字段
 * 2. fetch-models 接口返回时附带能力
 * 3. 前端 UI 按能力硬过滤（视觉模型 Tab 只列支持 image 的 Provider）
 *
 * 匹配规则：模型名小写去特殊字符后包含 registry key（子串匹配）
 * 例如 "Qwen/Qwen2.5-72B-Instruct" 匹配 "qwen2.5-72b-instruct"
 *
 * 设计参考：Kun-0.2.30 的 ModelCapabilityMetadata（capabilities.ts:47-70）
 */

export type InputModality = 'text' | 'image'

export interface ModelCapabilities {
  /** 输入模态：文本/图片 */
  inputModalities: InputModality[]
  /** 是否支持 function calling / tool use */
  supportsToolCalling: boolean
  /** 上下文窗口（tokens），0 表示未知 */
  contextWindowTokens: number
  /** 最大输出 tokens，0 表示未知 */
  maxOutputTokens: number
}

/** 默认能力（未匹配到预置库时） */
export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  inputModalities: ['text'],
  supportsToolCalling: false,
  contextWindowTokens: 0,
  maxOutputTokens: 0,
}

const REGISTRY: Record<string, ModelCapabilities> = {
  // ===== DeepSeek =====
  'deepseek-chat': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 64000,
    maxOutputTokens: 8192,
  },
  'deepseek-reasoner': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 64000,
    maxOutputTokens: 8192,
  },
  'deepseek-v3': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 64000,
    maxOutputTokens: 8192,
  },
  // 2026-08-28 修复：服务器部署后模型配置界面「最大输出 0 / 不支持工具」——
  // deepseek-v4 系列未收录，lookupCapabilities 落到 DEFAULT_CAPABILITIES（全 0 + toolCalling=false）。
  // 按实际网关返回（context_length=262144）与 DeepSeek 系列惯例补录；探测/用户配置仍可覆盖。
  'deepseek-v4-flash': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 262144,
    maxOutputTokens: 8192,
  },
  'deepseek-v4': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 262144,
    maxOutputTokens: 8192,
  },

  // ===== Qwen 通义千问 =====
  'qwen2.5-72b-instruct': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 8192,
  },
  'qwen2.5-7b-instruct': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 8192,
  },
  'qwen2.5-32b-instruct': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 8192,
  },
  'qwen-vl-max': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 32000,
    maxOutputTokens: 8192,
  },
  'qwen-vl-plus': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 32000,
    maxOutputTokens: 8192,
  },
  'qwen2-vl-72b-instruct': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 32768,
    maxOutputTokens: 8192,
  },
  'qwen2.5-vl-72b-instruct': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 8192,
  },
  'qwen3-embedding-8b': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 8192,
    maxOutputTokens: 0,
  },

  // ===== GLM 智谱 =====
  'glm-4': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 4096,
  },
  'glm-4v': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 4096,
  },
  'glm-4-flash': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 4096,
  },
  'glm-4-air': {
    inputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 4096,
  },

  // ===== BAAI 中文 Embedding =====
  'bge-m3': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 8192,
    maxOutputTokens: 0,
  },
  'bge-large-zh-v1.5': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 512,
    maxOutputTokens: 0,
  },

  // ===== OpenAI =====
  'gpt-4o': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
  },
  'gpt-4o-mini': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
  },
  'gpt-4-turbo': {
    inputModalities: ['text', 'image'],
    supportsToolCalling: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
  },
  'text-embedding-3-small': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 8191,
    maxOutputTokens: 0,
  },
  'text-embedding-3-large': {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 8191,
    maxOutputTokens: 0,
  },
}

/**
 * 按模型名查找预置能力
 * 匹配规则：模型名和 registry key 都做小写+去特殊字符处理，然后子串匹配
 * @returns 匹配则返回能力对象，未匹配返回 null
 */
export function lookupCapabilities(modelName: string): ModelCapabilities | null {
  if (!modelName || typeof modelName !== 'string') return null
  const normalized = modelName.toLowerCase().replace(/[^a-z0-9]/g, '')

  // 优先精确匹配
  for (const [key, caps] of Object.entries(REGISTRY)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalized === normalizedKey) return { ...caps }
  }

  // 退化子串匹配（长 key 优先，避免短 key 误命中）
  const sortedKeys = Object.keys(REGISTRY).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalized.includes(normalizedKey)) return { ...REGISTRY[key] }
  }

  return null
}

/** 判断模型是否支持图片输入 */
export function supportsVision(modelName: string): boolean {
  const caps = lookupCapabilities(modelName)
  return caps?.inputModalities.includes('image') ?? false
}

/** 判断模型是否支持 function calling */
export function supportsToolCalling(modelName: string): boolean {
  const caps = lookupCapabilities(modelName)
  return caps?.supportsToolCalling ?? false
}
