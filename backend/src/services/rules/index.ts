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
export { checkInternalCodes } from './internal-code.rule';
export { checkDwgRules, checkTitleBlock, checkLayerNaming, checkDimensions, checkStandardRefs, checkScale, checkOverlap } from './dwg.rule';

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
import { checkInternalCodes } from './internal-code.rule';
import { checkDwgRules } from './dwg.rule';

import prisma from '../../config/db';

/**
 * 规则前缀 → 规则执行函数 的映射
 * 每个规则前缀对应一个检查函数，函数接受 (ctx, config?) 参数
 */
interface RuleEntry {
  prefix: string;       // 规则前缀，如 'NAME', 'CODE', 'ATTR' 等
  category: string;     // issueType 分类
  fn: (ctx: FileContext, config?: any) => RuleIssue[];
  condition: (ctx: FileContext) => boolean;  // 执行条件
}

const RULE_REGISTRY: RuleEntry[] = [
  {
    prefix: 'NAME',
    category: 'NAMING',
    fn: checkNaming,
    condition: () => true, // 所有文件都检查
  },
  {
    prefix: 'CODE',
    category: 'ENCODING',
    fn: checkEncodingConsistency,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
  },
  {
    prefix: 'UNIT',
    category: 'ENCODING',
    fn: checkEncodingConsistency,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
  },
  {
    prefix: 'ATTR',
    category: 'ATTRIBUTE',
    fn: checkCoverAttributes,
    condition: (ctx) => ctx.fileType === 'pdf' && !!ctx.extractedText,
  },
  {
    prefix: 'HEADER',
    category: 'HEADER',
    fn: checkHeader,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 1,
  },
  {
    prefix: 'PAGE',
    category: 'PAGE',
    fn: checkPageNumbers,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 1,
  },
  {
    prefix: 'FORMAT',
    category: 'FORMAT',
    fn: checkFormatRules,
    condition: (ctx) => !!ctx.extractedText,
  },
  {
    prefix: 'COMPL',
    category: 'COMPLETENESS',
    fn: checkCompleteness,
    condition: (ctx) => !!ctx.extractedText,
  },
  {
    prefix: 'CONSIST',
    category: 'CONSISTENCY',
    fn: checkConsistency,
    condition: (ctx) => !!ctx.extractedText,
  },
  {
    prefix: 'LAYOUT',
    category: 'LAYOUT',
    fn: checkLayout,
    condition: (ctx) => !!ctx.pdfPages && ctx.pdfPages.length > 0,
  },
  {
    prefix: 'TYPO',
    category: 'TYPO',
    fn: checkTypo,
    condition: (ctx) => !!ctx.extractedText,
  },
  {
    prefix: 'INTERNAL_CODE',
    category: 'ENCODING',
    fn: checkInternalCodes,
    condition: (ctx) => !!ctx.extractedText,
  },
  {
    prefix: 'DWG_TITLE',
    category: 'DWG',
    fn: checkDwgRules('DWG_TITLE'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg',
  },
  {
    prefix: 'DWG_LAYER',
    category: 'DWG',
    fn: checkDwgRules('DWG_LAYER'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!ctx.parseResult?.metadata?.dwg_layers?.length,
  },
  {
    prefix: 'DWG_DIM',
    category: 'DWG',
    fn: checkDwgRules('DWG_DIM'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!(ctx.parseResult?.metadata as any)?.layer_stats,
  },
  {
    prefix: 'DWG_STDREF',
    category: 'DWG',
    fn: checkDwgRules('DWG_STDREF'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!ctx.parseResult,
  },
  {
    prefix: 'DWG_SCALE',
    category: 'DWG',
    fn: checkDwgRules('DWG_SCALE'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg',
  },
  {
    prefix: 'DWG_OVERLAP',
    category: 'DWG',
    fn: checkDwgRules('DWG_OVERLAP'),
    condition: (ctx) => ctx.fileType.toLowerCase() === 'dwg' && !!(ctx.parseResult?.metadata as any)?.layer_stats,
  },
];

/**
 * 从数据库加载规则配置
 * 返回 Map<ruleCode前缀, { enabled, severity, config }>
 */
async function loadRuleConfigsFromDB(): Promise<Map<string, { enabled: boolean; severity: string; config?: any }>> {
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
