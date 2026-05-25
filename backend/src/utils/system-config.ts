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

export function invalidateConfigCache(): void {
  cachedBasicSettings = null;
  cacheTs = 0;
}
