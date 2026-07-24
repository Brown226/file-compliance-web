/**
 * LLM 配置迁移服务
 *
 * 把旧的"凭证副本"结构迁移为"Provider 引用"结构：
 * - 旧 llm_chat_model: { apiKey, apiBaseUrl, modelName, temperature, ... }
 * - 新 llm_chat_model: { providerId, temperature, ... }
 *
 * 同理处理 embedding_model 和 llm_vision_model
 *
 * 迁移策略（保守匹配）：
 * 1. 在 llm_profiles 里找 apiBase 完全相等的 Provider
 * 2. 找到 → 把旧 apiKey/modelName 更新进该 Provider（以旧配置为准）
 * 3. 找不到 → 新建一个 LlmProfile
 * 4. 给新 Provider 打 migrated=true 标记，查预置库填 capabilities
 * 5. 把原 config 改写为 { providerId, ...业务参数 }
 *
 * 幂等性：检查 providerId 字段存在或 apiKey 字段不存在则跳过
 */

import prisma from '../../config/db'
import { lookupCapabilities, type ModelCapabilities } from './model-capabilities.registry'

const LLm_PROFILE_KEY = 'llm_profiles'

type ProviderUsage = 'chat' | 'embedding' | 'vision' | 'all'

interface LlmProfile {
  id: string
  name: string
  provider: string
  apiBase: string
  apiKey: string
  model: string
  isActive: boolean
  isEnabled: boolean
  timeout: number
  usage?: ProviderUsage
  capabilities?: ModelCapabilities
  migrated?: boolean
}

interface NewModelConfig {
  providerId: string
  [key: string]: any
}

/** 生成简单 ID（不依赖 uuid，避免引入依赖） */
function genId(): string {
  return `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 合并两个 usage，若不同则降级为 all */
function mergeUsage(a?: ProviderUsage, b?: ProviderUsage): ProviderUsage {
  if (!a) return b || 'all'
  if (!b || a === b) return a
  return 'all'
}

/** 根据模型能力推断 usage */
function inferUsageFromCapabilities(profile: LlmProfile): ProviderUsage {
  const caps = profile.capabilities
  const hasImage = caps?.inputModalities?.includes('image') ?? false
  const model = (profile.model || '').toLowerCase()
  const isEmbedding = /embed|bge|m3e|text-embedding|qwen3/.test(model)
  if (isEmbedding) return 'embedding'
  if (hasImage) return 'vision'
  return 'chat'
}

/** 读取 llm_profiles 数组 */
async function readProfiles(): Promise<LlmProfile[]> {
  const config = await prisma.systemConfig.findUnique({ where: { key: LLm_PROFILE_KEY } })
  if (!config?.value) return []
  try {
    const raw = typeof config.value === 'string' ? JSON.parse(config.value) : config.value
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** 写回 llm_profiles 数组 */
async function writeProfiles(profiles: LlmProfile[]): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: LLm_PROFILE_KEY },
    update: { value: JSON.stringify(profiles) },
    create: { key: LLm_PROFILE_KEY, value: JSON.stringify(profiles) },
  })
}

/** 读取任意配置项 */
async function readConfig(key: string): Promise<any> {
  const config = await prisma.systemConfig.findUnique({ where: { key } })
  if (!config?.value) return null
  try {
    return typeof config.value === 'string' ? JSON.parse(config.value) : config.value
  } catch {
    return null
  }
}

/** 写回配置项 */
async function writeConfig(key: string, value: any): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  })
}

/**
 * 迁移单个模型配置项
 * @param configKey system_configs 表的 key（如 'llm_chat_model'）
 * @param defaultProfileName 新建 Provider 时的默认名称（如 '迁移-对话模型'）
 * @param defaultProviderType Provider 类型（如 'openai-compatible'）
 * @returns 迁移日志
 */
async function migrateOne(
  configKey: string,
  defaultProfileName: string,
  defaultProviderType: string,
  usage: ProviderUsage,
): Promise<string> {
  const oldConfig = await readConfig(configKey)
  if (!oldConfig || typeof oldConfig !== 'object') {
    return `[${configKey}] 无配置，跳过`
  }

  // 幂等：已迁移（有 providerId 或无 apiKey）则跳过
  if (oldConfig.providerId) {
    return `[${configKey}] 已迁移，跳过`
  }
  if (!oldConfig.apiKey && !oldConfig.apiBaseUrl && !oldConfig.modelName) {
    return `[${configKey}] 无凭证字段，跳过`
  }

  const profiles = await readProfiles()
  const oldApiBase = (oldConfig.apiBaseUrl || '').trim()
  const oldApiKey = oldConfig.apiKey || ''
  const oldModelName = oldConfig.modelName || ''

  // 保守匹配：apiBase 完全相等
  let targetProfile = profiles.find(
    (p) => (p.apiBase || '').trim() === oldApiBase && oldApiBase !== '',
  )

  if (targetProfile) {
    // 命中已有 Provider：把旧凭证更新进去（以旧配置为准，覆盖 Provider 的同名字段）
    if (oldApiKey) targetProfile.apiKey = oldApiKey
    if (oldModelName) targetProfile.model = oldModelName
    if (!targetProfile.capabilities) {
      targetProfile.capabilities = lookupCapabilities(oldModelName) || undefined
    }
    // 若 usage 冲突（如一个 Provider 既被 chat 又被 embedding 引用），降级为 all
    targetProfile.usage = mergeUsage(targetProfile.usage, usage)
  } else {
    // 找不到：新建一个 Provider
    targetProfile = {
      id: genId(),
      name: defaultProfileName,
      provider: oldConfig.serviceType || defaultProviderType,
      apiBase: oldApiBase,
      apiKey: oldApiKey,
      model: oldModelName,
      isActive: false,
      isEnabled: true,
      timeout: oldConfig.timeout || 60,
      usage,
      capabilities: lookupCapabilities(oldModelName) || undefined,
      migrated: true,
    }
    profiles.push(targetProfile)
  }

  // 构造新配置（保留业务参数，去掉凭证字段）
  const newConfig: NewModelConfig = { providerId: targetProfile.id }
  for (const [k, v] of Object.entries(oldConfig)) {
    if (!['apiKey', 'apiBaseUrl', 'modelName', 'serviceType'].includes(k)) {
      newConfig[k] = v
    }
  }

  await writeProfiles(profiles)
  await writeConfig(configKey, newConfig)

  return `[${configKey}] 迁移成功 → Provider ${targetProfile.id} (${targetProfile.name})`
}

/**
 * 主迁移入口（幂等，可重复调用）
 * 在后端启动时调用
 *
 * 注意：迁移必须顺序执行，不能并发。每个 migrateOne 都会 read-modify-write
 * llm_profiles 数组，并发会导致后写覆盖先写，丢失 Provider。
 */
export async function migrateLlmConfigsToProviderRef(): Promise<void> {
  try {
    const tasks: Array<[string, string, string, ProviderUsage]> = [
      ['llm_chat_model', '迁移-对话模型', 'openai-compatible', 'chat'],
      ['embedding_model', '迁移-Embedding', 'openai-compatible', 'embedding'],
      ['llm_vision_model', '迁移-视觉模型', 'openai-compatible', 'vision'],
    ]

    const logs: string[] = []
    for (const [key, name, provider, usage] of tasks) {
      // 顺序执行，避免 llm_profiles 数组的 read-modify-write 竞态
      logs.push(await migrateOne(key, name, provider, usage))
    }

    // 后置校验：清理 dangling providerId（指向已不存在的 Provider）
    // 场景：历史并发迁移 bug 导致 embedding_model.providerId 指向被覆盖丢失的 profile
    await cleanupDanglingProviderRefs()

    // 给没有 usage 字段的历史 Provider 补 usage
    await ensureUsageField()

    const changed = logs.filter((l) => !l.includes('跳过'))
    if (changed.length > 0) {
      console.log('[LLM Migration] 配置迁移完成:')
      changed.forEach((l) => console.log(`  ${l}`))
    }
  } catch (err: any) {
    console.error('[LLM Migration] 迁移失败（不阻塞启动）:', err.message)
  }
}

/**
 * 清理 dangling providerId 引用
 * 如果 config.providerId 指向的 Provider 在 llm_profiles 中不存在，
 * 删除 providerId 字段（保留业务参数），让用户在新 UI 中重新选择。
 */
async function cleanupDanglingProviderRefs(): Promise<void> {
  const configKeys = ['llm_chat_model', 'embedding_model', 'llm_vision_model']
  const profiles = await readProfiles()
  const profileIds = new Set(profiles.map((p) => p.id))

  for (const key of configKeys) {
    const config = await readConfig(key)
    if (!config || typeof config !== 'object') continue
    if (!config.providerId) continue
    if (profileIds.has(config.providerId)) continue

    // dangling: 删除 providerId，保留其他业务参数
    const { providerId, ...rest } = config
    await writeConfig(key, rest)
    console.log(`[LLM Migration] 清理 dangling providerId: ${key} -> ${providerId} (Provider 不存在，已重置)`)
  }
}

/**
 * 给没有 usage 字段的历史 Provider 补充 usage
 * 幂等：已有 usage 且不为 all 的保持不变；无 usage 的按 capabilities/model 推断
 */
export async function ensureUsageField(): Promise<void> {
  try {
    const profiles = await readProfiles()
    let changed = false

    for (const p of profiles) {
      if (!p.usage) {
        p.usage = inferUsageFromCapabilities(p)
        changed = true
      }
    }

    if (changed) {
      await writeProfiles(profiles)
      console.log('[LLM Migration] 已补充 Provider usage 字段')
    }
  } catch (err: any) {
    console.error('[LLM Migration] 补充 usage 字段失败（不阻塞启动）:', err.message)
  }
}
