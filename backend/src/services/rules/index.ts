/**
 * 规则引擎模块入口
 * 重新导出所有规则和类型，提供 runAllRules 函数
 */

export { RuleIssue, FileContext, RuleConfig, RunRulesOptions } from './types';

export { checkNaming } from './naming.rule';
export { checkEncodingConsistency } from './encoding.rule';
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
import { checkEncodingConsistency } from './encoding.rule';
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

/** 使规则配置缓存失效（规则配置变更时调用） */
export function invalidateRuleConfigCache(): void {
  ruleConfigCache = null;
  ruleConfigCacheTimestamp = 0;
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
    fn: checkEncodingConsistency,
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
 * 从数据库加载规则配置（带缓存，60秒TTL）
 * 返回 Map<ruleCode前缀, { enabled, severity, config }>
 */
async function loadRuleConfigsFromDB(): Promise<Map<string, { enabled: boolean; severity: string; config?: any }>> {
  const now = Date.now();
  if (ruleConfigCache && (now - ruleConfigCacheTimestamp) < RULE_CONFIG_CACHE_TTL_MS) {
    return ruleConfigCache;
  }

  const configMap = new Map<string, { enabled: boolean; severity: string; config?: any }>();

  try {
    const rules = await prisma.reviewRule.findMany();

    for (const rule of rules) {
      // 从 ruleCode 提取前缀，如 NAME_001 → NAME, CODE_001 → CODE
      const prefix = rule.ruleCode.replace(/_\d+$/, '');
      const existing = configMap.get(prefix);

      // 如果同前缀已有配置，合并（任一禁用则整体禁用，取最严重的 severity）
      if (existing) {
        if (!rule.enabled) existing.enabled = false;
        // severity 优先级: error > warning > info
        const severityOrder = ['info', 'warning', 'error'];
        if (severityOrder.indexOf(rule.severity) > severityOrder.indexOf(existing.severity)) {
          existing.severity = rule.severity;
        }
        if (rule.config && typeof rule.config === 'object') {
          existing.config = { ...existing.config, ...rule.config };
        }
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
 */
function applyConfigOverrides(issues: RuleIssue[], rulePrefix: string, options?: RunRulesOptions): RuleIssue[] {
  return issues.map(issue => {
    // 优先使用 options 中的 severityMap
    if (options?.severityMap) {
      const overrideSeverity = options.severityMap.get(issue.ruleCode) || options.severityMap.get(rulePrefix);
      if (overrideSeverity && ['error', 'warning', 'info'].includes(overrideSeverity)) {
        return { ...issue, severity: overrideSeverity as RuleIssue['severity'] };
      }
    }
    return issue;
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

    // 获取规则配置参数
    const config = options?.configMap?.get(rule.prefix) || dbConfigMap?.get(rule.prefix)?.config;

    try {
      const ruleIssues = rule.fn(ctx, config);
      // 应用 severity 覆盖
      const overridden = applyConfigOverrides(ruleIssues, rule.prefix, dbConfigMap ? {
        severityMap: new Map([...(dbConfigMap || [])].map(([k, v]) => [k, v.severity])),
      } : options);
      issues.push(...overridden);
    } catch (e) {
      console.error(`[规则引擎] 规则 ${rule.prefix} 执行出错:`, e);
    }
  }

  return issues;
}

export interface RuleMetaItem {
  prefix: string;
  label: string;
  description: string;
  group: string;
  icon: string;
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
