import prisma from '../config/db';

let cachedBasicSettings: Record<string, any> | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

async function getBasicSettings(): Promise<Record<string, any>> {
  const now = Date.now();
  if (cachedBasicSettings && (now - cacheTs) < CACHE_TTL_MS) {
    return cachedBasicSettings;
  }
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'basic_settings' } });
    cachedBasicSettings = (cfg?.value && typeof cfg.value === 'object') ? (cfg.value as Record<string, any>) : {};
  } catch {
    cachedBasicSettings = {};
  }
  cacheTs = now;
  return cachedBasicSettings;
}

export async function getMaxUploadSizeMB(): Promise<number> {
  const s = await getBasicSettings();
  const v = s.maxUploadSizeMB;
  return (typeof v === 'number' && v > 0) ? v : 100;
}

/** Bull 队列并发数：同时从队列取出处理的审查任务数 */
export async function getQueueConcurrency(): Promise<number> {
  const s = await getBasicSettings();
  const v = s.queueConcurrency;
  return (typeof v === 'number' && v > 0 && v <= 20) ? v : 3;
}

/** 每用户文件并发数：单用户同时进入 AI 审查阶段的文件数 */
export async function getMaxConcurrentReviews(): Promise<number> {
  const s = await getBasicSettings();
  const v = s.maxConcurrentReviews;
  return (typeof v === 'number' && v > 0 && v <= 10) ? v : 3;
}

/** LLM 分片并发数：单文件内同时调用 LLM API 的 chunk 数 */
export async function getChunkConcurrency(): Promise<number> {
  const s = await getBasicSettings();
  const v = s.chunkConcurrency;
  return (typeof v === 'number' && v > 0 && v <= 5) ? v : 2;
}

/** LLM 限流 QPS：每秒允许的 LLM API 调用数（按 model 分桶），0 表示不限流 */
export async function getLlmRateLimit(): Promise<number> {
  const s = await getBasicSettings();
  const v = s.llmRateLimit;
  return (typeof v === 'number' && v >= 0) ? v : 20;
}

export function invalidateConfigCache(): void {
  cachedBasicSettings = null;
  cacheTs = 0;
}
