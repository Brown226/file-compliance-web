import prisma from '../../config/db';

/**
 * 功能开关服务
 * 控制前端功能入口的可见性，支持内测后再开放给用户
 * 带内存缓存，避免每次请求查 DB
 */

// 默认开关值：key → { label, enabled, description, category }
const DEFAULT_FLAGS: Array<{
  key: string;
  label: string;
  enabled: boolean;
  description: string;
  category: string;
}> = [
  // 审查入口卡片
  { key: 'entry.PROOFREAD', label: '文字校对', enabled: true, description: '错别字、语句通顺、标点检查', category: 'entry' },
  { key: 'entry.LIBRARY', label: '以库审文', enabled: true, description: '结合知识库或语义规则库进行合规审查', category: 'entry' },
  { key: 'entry.DOC_REVIEW', label: '以文审文', enabled: true, description: '待审文档与参照文档逐项比对', category: 'entry' },
  { key: 'entry.CONSISTENCY', label: '上下文一致性', enabled: true, description: '检查文件内部及多文件间的术语、数值、指标自洽', category: 'entry' },
  { key: 'entry.CONTRACT', label: '合同风险审查', enabled: true, description: '立场驱动识别不利条款、缺失保护条款', category: 'entry' },
  { key: 'entry.SELF_CHECK', label: '标准引用自检', enabled: true, description: '引用与标准库逐条比对校验', category: 'entry' },
  { key: 'entry.DWG_VISION', label: '图纸视觉分析', enabled: true, description: '视觉大模型识别标题栏、符号、标注、合规性', category: 'entry' },
  // 隐藏的入口（体系保留，前端不展示）
  { key: 'entry.RULE_ONLY', label: '仅规则审查', enabled: false, description: '纯规则执行，不调 AI，秒级初筛', category: 'entry' },
];

// 内存缓存：key → enabled
let cache: Map<string, boolean> | null = null;
let cacheLoading: Promise<void> | null = null;

/**
 * 加载所有开关到内存缓存
 * 首次调用会查 DB，后续从缓存读
 */
async function loadCache(): Promise<void> {
  if (cache) return;
  if (cacheLoading) {
    await cacheLoading;
    return;
  }
  cacheLoading = (async () => {
    const flags = await prisma.featureFlag.findMany();
    const map = new Map<string, boolean>();
    for (const f of flags) {
      map.set(f.key, f.enabled);
    }
    cache = map;
  })();
  await cacheLoading;
  cacheLoading = null;
}

/**
 * 初始化默认开关值（幂等 upsert）
 * 在后端启动时调用，不会覆盖用户已修改的值
 */
export async function seedFeatureFlags(): Promise<void> {
  for (const def of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: def.key },
      update: {},  // 不覆盖已存在的值
      create: {
        key: def.key,
        label: def.label,
        enabled: def.enabled,
        description: def.description,
        category: def.category,
      },
    });
  }
  // 加载到缓存
  cache = null;
  await loadCache();
}

/**
 * 获取所有功能开关（管理页用）
 */
export async function listFeatureFlags() {
  await loadCache();
  const flags = await prisma.featureFlag.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
  return flags;
}

/**
 * 更新开关（管理页用）
 * 更新后同步刷新缓存
 */
export async function updateFeatureFlag(
  key: string,
  enabled: boolean,
  updatedBy?: string
): Promise<void> {
  await prisma.featureFlag.update({
    where: { key },
    data: { enabled, updatedBy },
  });
  // 刷新缓存
  if (cache) {
    cache.set(key, enabled);
  }
}

/**
 * 检查开关是否启用（前端入口过滤用）
 * 从缓存读，不查 DB
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  await loadCache();
  // 未知 key 默认启用（避免新功能因未 seed 而被隐藏）
  return cache?.get(key) ?? true;
}

/**
 * 批量检查开关启用状态
 */
export async function getEnabledFeatureKeys(): Promise<Set<string>> {
  await loadCache();
  const enabled = new Set<string>();
  if (cache) {
    for (const [key, flag] of cache.entries()) {
      if (flag) enabled.add(key);
    }
  }
  return enabled;
}
