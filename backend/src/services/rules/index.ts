/**
 * 规则引擎模块入口
 * 重新导出所有规则和类型，提供 runAllRules 函数
 */

export { RuleIssue, FileContext, RuleConfig, RunRulesOptions } from './types';

export { checkNaming } from './naming.rule';
export { checkEncodingConsistency, checkUnitConsistency } from './encoding.rule';
export { checkCoverAttributes } from './attribute.rule';
export { checkHeader } from './header.rule';
export { checkPageNumbers } from './page.rule';
export { checkFormatRules, extractCoverArea } from './format.rule';
export { checkCompleteness } from './completeness.rule';
export { checkConsistency } from './consistency.rule';
export { checkLayout } from './layout.rule';
export { checkTypo } from './typo.rule';
export { checkPunctuation } from './punctuation.rule';
export { checkInternalCodes } from './internal-code.rule';
export { checkDwgRules, checkTitleBlock, checkLayerNaming, checkDimensions, checkStandardRefs, checkScale, checkOverlap } from './dwg.rule';
export { checkContractRules } from './contract.rule';

import { RuleIssue, FileContext, RunRulesOptions } from './types';
import { checkNaming } from './naming.rule';
import { checkEncodingConsistency, checkUnitConsistency } from './encoding.rule';
import { checkCoverAttributes } from './attribute.rule';
import { checkHeader } from './header.rule';
import { checkPageNumbers } from './page.rule';
import { checkFormatRules } from './format.rule';
import { checkCompleteness } from './completeness.rule';
import { checkConsistency } from './consistency.rule';
import { checkLayout } from './layout.rule';
import { checkTypo } from './typo.rule';
import { checkPunctuation } from './punctuation.rule';
import { checkInternalCodes } from './internal-code.rule';
import { checkDwgRules } from './dwg.rule';
import { checkContractRules } from './contract.rule';

import prisma from '../../config/db';

// ===== 规则配置缓存 =====
const RULE_CONFIG_CACHE_TTL_MS = 60_000; // 60秒缓存
let ruleConfigCache: Map<string, { enabled: boolean; severity: string; config?: any }> | null = null;
let ruleConfigCacheTimestamp = 0;

// ===== 合同规则阈值缓存（P2-12）：system_configs.contract_rule_thresholds 的运行时缓存 =====
let contractThresholdCache: Record<string, any> | null = null;
let contractThresholdCacheTimestamp = 0;

/** 使规则配置缓存失效（规则配置变更时调用） */
export function invalidateRuleConfigCache(): void {
  ruleConfigCache = null;
  ruleConfigCacheTimestamp = 0;
  contractThresholdCache = null;
  contractThresholdCacheTimestamp = 0;
}

/**
 * 加载合同规则阈值（P2-12：接通 system_configs.contract_rule_thresholds 死配置）
 *
 * 从 system_configs 读取合同阈值覆盖（如 payment_advance_ratio_max），
 * 与规则配置同生命周期（60s 缓存）。读取失败/配置不存在时返回 null，调用方回退
 * contract.rule.ts 的内置 DEFAULT_THRESHOLDS。
 */
export async function loadContractThresholds(): Promise<Record<string, any> | null> {
  const now = Date.now();
  if (contractThresholdCache !== null && (now - contractThresholdCacheTimestamp) < RULE_CONFIG_CACHE_TTL_MS) {
    return contractThresholdCache;
  }
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'contract_rule_thresholds' } });
    const value = row?.value;
    contractThresholdCache = (value && typeof value === 'object' && !Array.isArray(value))
      ? (value as Record<string, any>)
      : null;
  } catch (e) {
    console.warn('[规则引擎] 加载 contract_rule_thresholds 失败，使用内置默认阈值:', e);
    contractThresholdCache = null;
  }
  contractThresholdCacheTimestamp = now;
  return contractThresholdCache;
}

/**
 * 规则前缀 → 规则执行函数 的映射
 * 每个规则前缀对应一个检查函数，函数接受 (ctx, config?) 参数
 */
interface RuleEntry {
  prefix: string;       // 规则前缀，如 'NAME', 'CODE', 'ATTR' 等
  category: string;     // issueType 分类
  fn: (ctx: FileContext, config?: any) => RuleIssue[];
  condition: (ctx: FileContext) => boolean;  // 执行条件
  meta: {               // 前端展示元数据
    label: string;
    description: string;
    group: string;      // 分组名：文件规范 / 内容规范 / 逻辑验证 / 图纸审查(DWG)
    icon: string;       // Element Plus icon name
  };
}

const RULE_REGISTRY: RuleEntry[] = [
  {
    prefix: 'NAME',
    category: 'NAMING',
    fn: checkNaming,
    condition: () => true,
    meta: { label: '命名规范', description: '文件名格式、版本号、特殊字符检查', group: '文件规范', icon: 'FolderOpened' },
  },
  {
    prefix: 'CODE',
    category: 'ENCODING',
    fn: checkEncodingConsistency,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
    meta: { label: '编码规范', description: '编码规则、编号一致性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'UNIT',
    category: 'ENCODING',
    fn: checkUnitConsistency,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
    meta: { label: '单位规范', description: '计量单位使用规范性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'ATTR',
    category: 'ATTRIBUTE',
    fn: checkCoverAttributes,
    condition: (ctx) => ctx.fileType === 'pdf' && !!ctx.extractedText,
    meta: { label: '属性规范', description: '文档属性、元数据完整性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'HEADER',
    category: 'HEADER',
    fn: checkHeader,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 1,
    meta: { label: '页眉规范', description: '页眉内容、格式一致性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'PAGE',
    category: 'PAGE',
    fn: checkPageNumbers,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 1,
    meta: { label: '页码规范', description: '页码连续性、格式正确性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'FORMAT',
    category: 'FORMAT',
    fn: checkFormatRules,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '格式规范', description: '文档排版、字体、段落格式检查', group: '文件规范', icon: 'FolderOpened' },
  },
  {
    prefix: 'COMPL',
    category: 'COMPLETENESS',
    fn: checkCompleteness,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '完整性检查', description: '必填项、关键内容是否缺失检查', group: '逻辑验证', icon: 'List' },
  },
  {
    prefix: 'CONSIST',
    category: 'CONSISTENCY',
    fn: checkConsistency,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '一致性检查', description: '前后参数、数据逻辑一致性检查', group: '逻辑验证', icon: 'List' },
  },
  {
    prefix: 'LAYOUT',
    category: 'LAYOUT',
    fn: checkLayout,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
    meta: { label: '排版布局', description: '布局结构、缩进、对齐方式检查', group: '文件规范', icon: 'FolderOpened' },
  },
  {
    prefix: 'TYPO',
    category: 'TYPO',
    fn: checkTypo,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '术语一致性', description: '专业术语使用是否统一检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'PUNCT',
    category: 'PUNCTUATION',
    fn: checkPunctuation,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '标点规范', description: '中英文标点混用、全半角混用、连续标点、配对缺失', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'INTERNAL_CODE',
    category: 'ENCODING',
    fn: checkInternalCodes,
    condition: (ctx) => !!ctx.extractedText,
    meta: { label: '内部编码校验', description: '正文内工程编码与文件名项目编码一致性检查', group: '内容规范', icon: 'EditPen' },
  },
  {
    prefix: 'DWG_TITLE',
    category: 'DWG',
    fn: checkDwgRules('DWG_TITLE'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg',
    meta: { label: '标题规范', description: '图签、标题栏格式内容检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'DWG_LAYER',
    category: 'DWG',
    fn: checkDwgRules('DWG_LAYER'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!ctx.parseResult?.metadata?.dwg_layers?.length,
    meta: { label: '图层规范', description: '图层命名、颜色、线型规范性检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'DWG_DIM',
    category: 'DWG',
    fn: checkDwgRules('DWG_DIM'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!(ctx.parseResult?.metadata as any)?.layer_stats,
    meta: { label: '标注规范', description: '尺寸标注样式和规范性检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'DWG_STDREF',
    category: 'DWG',
    fn: checkDwgRules('DWG_STDREF'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!ctx.parseResult,
    meta: { label: '标准引用', description: '图纸引用的标准有效性检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'DWG_SCALE',
    category: 'DWG',
    fn: checkDwgRules('DWG_SCALE'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg',
    meta: { label: '比例规范', description: '图幅比例设置正确性检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'DWG_OVERLAP',
    category: 'DWG',
    fn: checkDwgRules('DWG_OVERLAP'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!(ctx.parseResult?.metadata as any)?.layer_stats,
    meta: { label: '重叠检查', description: '图元重叠、干涉问题检查', group: '图纸审查 (DWG)', icon: 'DataAnalysis' },
  },
  {
    prefix: 'CONTRACT',
    category: 'VIOLATION',
    fn: checkContractRules,
    condition: (ctx) => ctx.reviewMode === 'CONTRACT_REVIEW' && !!ctx.extractedText,
    meta: { label: '合同规则', description: '核电工程合同阈值与必需条款检查', group: '逻辑验证', icon: 'List' },
  },
];

/**
 * 从 ruleCode 匹配注册表前缀（最长前缀优先）
 *
 * 修复 P1-8：旧实现 `ruleCode.replace(/_\d+$/, '')` 会把
 * CONTRACT_PAYMENT_001 提取成 CONTRACT_PAYMENT，而注册表前缀是 CONTRACT，
 * 导致 DB 配置永远查不到（子前缀断链）。这里按注册表前缀做最长匹配：
 * - CONTRACT_PAYMENT_001 → CONTRACT
 * - NAME_001 → NAME
 * - DWG_TITLE_001 → DWG_TITLE
 */
function matchRulePrefix(ruleCode: string): string {
  // 按前缀长度降序，保证最长匹配优先（DWG_TITLE 先于 DWG 等）
  const sortedPrefixes = [...RULE_REGISTRY].map((r) => r.prefix).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (ruleCode === prefix || ruleCode.startsWith(`${prefix}_`)) {
      return prefix;
    }
  }
  // 兜底：去掉尾部序号（如 NAME_001 → NAME）
  return ruleCode.replace(/_\d+$/, '');
}

/**
 * 从数据库加载规则配置（带缓存，60秒TTL）
 *
 * 返回结构（修复 P1-8 粒度问题）：
 * - 每个 DB 配置按「完整 ruleCode」作为 key 保存（保留 issue 级粒度，如 NAME_001 / CONTRACT_PAYMENT_001）
 * - 同时按「注册表前缀」聚合一份（用于规则级 enabled 快速判断，如 NAME / CONTRACT）
 * 两个 key 都指向同一个配置对象。
 */
export async function loadRuleConfigsFromDB(): Promise<Map<string, { enabled: boolean; severity: string; config?: any }>> {
  const now = Date.now();
  if (ruleConfigCache && (now - ruleConfigCacheTimestamp) < RULE_CONFIG_CACHE_TTL_MS) {
    return ruleConfigCache;
  }

  const configMap = new Map<string, { enabled: boolean; severity: string; config?: any }>();

  try {
    const rules = await prisma.reviewRule.findMany();

    // 第一遍：先按完整 ruleCode 保存（粒度不丢）
    for (const rule of rules) {
      configMap.set(rule.ruleCode, {
        enabled: rule.enabled,
        severity: rule.severity || 'warning',
        config: rule.config as any || undefined,
      });
    }

    // 第二遍：按注册表前缀聚合（用于规则级 enabled 判断）
    // 同前缀多条规则：任一禁用则整体禁用；severity 取最严重
    for (const rule of rules) {
      const prefix = matchRulePrefix(rule.ruleCode);
      const existing = configMap.get(prefix);

      if (existing) {
        // 前缀聚合：只更新 enabled（任一禁用则禁用），不覆盖 severity/config（粒度已由完整 ruleCode 保留）
        if (!rule.enabled) existing.enabled = false;
      } else {
        configMap.set(prefix, {
          enabled: rule.enabled,
          severity: rule.severity || 'warning',
          config: rule.config as any || undefined,
        });
      }
    }

    ruleConfigCache = configMap;
    ruleConfigCacheTimestamp = now;
  } catch (e) {
    console.warn('[规则引擎] 加载数据库规则配置失败，使用默认值:', e);
  }

  return configMap;
}

/**
 * 对规则的 issue 应用配置覆盖（severity）
 *
 * 匹配优先级（修复 P1-8 粒度问题）：
 * 1. 完整 ruleCode（如 CONTRACT_PAYMENT_001 → 精确覆盖该条 issue）
 * 2. 注册表前缀（如 CONTRACT → 覆盖该前缀下所有 issue）
 */
function applyConfigOverrides(issues: RuleIssue[], rulePrefix: string, options?: RunRulesOptions): RuleIssue[] {
  return issues.map(issue => {
    if (options?.severityMap) {
      // 先精确 ruleCode，再前缀兜底
      const overrideSeverity = options.severityMap.get(issue.ruleCode) || options.severityMap.get(rulePrefix);
      if (overrideSeverity && ['error', 'warning', 'info'].includes(overrideSeverity)) {
        return { ...issue, severity: overrideSeverity as RuleIssue['severity'] };
      }
    }
    return issue;
  });
}

/**
 * 合并 DB 配置的 severityMap 与调用方 options.severityMap
 * （修复 P1-8：旧实现 dbConfigMap 存在时直接丢弃 options.severityMap）
 */
function mergeSeverityMaps(
  dbConfigMap: Map<string, { enabled: boolean; severity: string; config?: any }> | undefined,
  options?: RunRulesOptions,
): Map<string, string> | undefined {
  const merged = new Map<string, string>();
  if (dbConfigMap) {
    for (const [key, cfg] of dbConfigMap) {
      if (cfg.severity) merged.set(key, cfg.severity);
    }
  }
  if (options?.severityMap) {
    for (const [key, severity] of options.severityMap) {
      merged.set(key, severity); // options 优先覆盖 DB
    }
  }
  return merged.size > 0 ? merged : undefined;
}

/**
 * 跨规则去重（P2-9）：同一缺陷被两条规则同时命中时，只保留一条。
 *
 * 映射表语义：key 为"被丢弃方"的 ruleCode，dropWhenSameText 为"保留方"的 ruleCode 列表。
 * 仅当被丢弃方与任一保留方命中的 originalText 完全相同时才去重（位置代理 = 原文）。
 * 例如：同一半角逗号夹中文字符，FORMAT_006（半角/全角标点混用，info）与
 * PUNCT_001（中英文标点混用，warning）同时命中 → 保留 PUNCT_001，丢弃 FORMAT_006。
 */
const CROSS_RULE_DEDUP_MAP: Record<string, { dropWhenSameText: string[] }> = {
  'FORMAT_006': { dropWhenSameText: ['PUNCT_001'] },
};

/**
 * 对聚合后的规则输出做跨规则去重（纯函数，便于单测）。
 * 被丢弃方命中与任一保留方相同的 originalText 时丢弃；否则原样保留。
 */
export function dedupeCrossRuleIssues(issues: RuleIssue[]): RuleIssue[] {
  // 收集"保留方"命中过的原文集合
  const keeperTexts = new Set<string>();
  for (const issue of issues) {
    const cfg = CROSS_RULE_DEDUP_MAP[issue.ruleCode];
    if (cfg) continue; // 被丢弃方本身不算保留方
    if (!issue.originalText) continue;
    for (const c of Object.values(CROSS_RULE_DEDUP_MAP)) {
      if (c.dropWhenSameText.includes(issue.ruleCode)) keeperTexts.add(issue.originalText);
    }
  }
  if (keeperTexts.size === 0) return issues;

  return issues.filter((issue) => {
    const cfg = CROSS_RULE_DEDUP_MAP[issue.ruleCode];
    if (!cfg || !issue.originalText) return true;
    return !keeperTexts.has(issue.originalText);
  });
}

/**
 * 执行所有规则检查（异步版本，从数据库读取规则配置）
 *
 * @param ctx 文件上下文
 * @param options 可选的规则配置覆盖（不传则从数据库读取）
 */
export async function runAllRules(ctx: FileContext, options?: RunRulesOptions): Promise<RuleIssue[]> {
  const issues: RuleIssue[] = [];

  // 始终从数据库加载规则配置（用于检查 enabled 状态和 severity）
  let dbConfigMap: Map<string, { enabled: boolean; severity: string; config?: any }> | undefined;
  try {
    dbConfigMap = await loadRuleConfigsFromDB();
  } catch (e) {
    console.warn('[规则引擎] 加载数据库规则配置失败:', e);
  }

  for (const rule of RULE_REGISTRY) {
    // 检查规则执行条件
    if (!rule.condition(ctx)) continue;

    // 检查数据库中规则是否已禁用
    if (dbConfigMap) {
      const ruleConfig = dbConfigMap.get(rule.prefix);
      if (ruleConfig && !ruleConfig.enabled) {
        continue;
      }
    }

    // 检查前缀过滤（流水线级别限定）
    if (options?.enabledRulePrefixes) {
      if (!options.enabledRulePrefixes.has(rule.prefix)) continue;
    }

    // 获取规则配置参数（优先调用方显式 configMap，其次 DB 前缀聚合配置）
    let config = options?.configMap?.get(rule.prefix) || dbConfigMap?.get(rule.prefix)?.config;

    // P2-12: CONTRACT 规则并入 system_configs.contract_rule_thresholds（DB 阈值优先于内置 DEFAULT_THRESHOLDS）
    if (rule.prefix === 'CONTRACT') {
      const contractThresholds = await loadContractThresholds();
      if (contractThresholds) {
        config = { ...(config || {}), ...contractThresholds };
      }
    }

    try {
      const ruleIssues = rule.fn(ctx, config);
      // 应用 severity 覆盖：合并 DB 配置与调用方 options（修复 P1-8：不再丢弃 options.severityMap）
      const mergedSeverityMap = mergeSeverityMaps(dbConfigMap, options);
      const overridden = applyConfigOverrides(ruleIssues, rule.prefix, mergedSeverityMap ? { severityMap: mergedSeverityMap } : options);
      issues.push(...overridden);
    } catch (e) {
      console.error(`[规则引擎] 规则 ${rule.prefix} 执行出错:`, e);
    }
  }

  // P2-9: 跨规则去重（FORMAT_006 vs PUNCT_001 同原文双报 → 保留 severity 更高者）
  return dedupeCrossRuleIssues(issues);
}

export interface RuleMetaItem {
  prefix: string;
  label: string;
  description: string;
  group: string;
  icon: string;
  category: string;  // issueType 分类（NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/COMPLETENESS/CONSISTENCY/LAYOUT/TYPO/PUNCTUATION/DWG/VIOLATION）
}

export interface RuleGroupMeta {
  title: string;
  icon: string;
  items: RuleMetaItem[];
}

export function getRuleRegistryMetadata(): { groups: RuleGroupMeta[]; total: number; allPrefixes: string[] } {
  const groupMap = new Map<string, { icon: string; items: RuleMetaItem[] }>();
  for (const rule of RULE_REGISTRY) {
    const g = rule.meta.group;
    if (!groupMap.has(g)) {
      groupMap.set(g, { icon: rule.meta.icon, items: [] });
    }
    groupMap.get(g)!.items.push({
      prefix: rule.prefix,
      label: rule.meta.label,
      description: rule.meta.description,
      group: g,
      icon: rule.meta.icon,
      category: rule.category,
    });
  }
  const groups: RuleGroupMeta[] = Array.from(groupMap.entries()).map(([title, val]) => ({
    title,
    icon: val.icon,
    items: val.items,
  }));
  return {
    groups,
    total: RULE_REGISTRY.length,
    allPrefixes: RULE_REGISTRY.map(r => r.prefix),
  };
}

/**
 * 同步版本 — 仅用于不需要数据库配置的场景（如单元测试）
 * 不读取数据库，执行所有已注册的规则
 */
export function runAllRulesSync(ctx: FileContext): RuleIssue[] {
  const issues: RuleIssue[] = [];

  for (const rule of RULE_REGISTRY) {
    if (!rule.condition(ctx)) continue;
    try {
      issues.push(...rule.fn(ctx));
    } catch (e) {
      console.error(`[规则引擎] 规则 ${rule.prefix} 执行出错:`, e);
    }
  }

  return issues;
}
