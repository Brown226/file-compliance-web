/**
 * list_available_rules 工具 — 列出可用规则
 *
 * 工作方式：
 * 1. 从 RULE_REGISTRY 获取全量规则元数据（getRuleRegistryMetadata）
 * 2. 从 prisma.reviewRule 获取数据库中的启用/参数配置
 * 3. 合并后按 category 筛选返回
 *
 * 参数：
 * - category: 可选，按 issueType 分类筛选
 *   （NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/COMPLETENESS/CONSISTENCY/LAYOUT/TYPO/PUNCTUATION/DWG/VIOLATION）
 *
 * 返回：
 * - rules: 规则列表 [{prefix, label, description, group, category, enabled, severity}]
 * - total: 总数
 * - categories: 可用分类列表（含计数）
 */
import { z } from 'zod';
import prisma from '../../../../config/db';
import { getRuleRegistryMetadata } from '../../../rules';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 规则详情（合并注册表元数据 + 数据库配置） */
interface RuleDetail {
  prefix: string;
  label: string;
  description: string;
  group: string;
  icon: string;
  category: string;
  enabled: boolean;
  severity: string;
}

/** 列表结果 */
interface ListRulesResult {
  rules: RuleDetail[];
  total: number;
  categories: { name: string; count: number }[];
}

/**
 * 规则前缀 → category 映射（与 RULE_REGISTRY 中的 category 字段一致）
 * issueType: NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/COMPLETENESS/CONSISTENCY/LAYOUT/TYPO/PUNCTUATION/DWG/VIOLATION
 */
const PREFIX_CATEGORY_MAP: Record<string, string> = {
  NAME: 'NAMING',
  CODE: 'ENCODING',
  UNIT: 'ENCODING',
  ATTR: 'ATTRIBUTE',
  HEADER: 'HEADER',
  PAGE: 'PAGE',
  FORMAT: 'FORMAT',
  COMPL: 'COMPLETENESS',
  CONSIST: 'CONSISTENCY',
  LAYOUT: 'LAYOUT',
  TYPO: 'TYPO',
  PUNCT: 'PUNCTUATION',
  INTERNAL_CODE: 'ENCODING',
  DWG_TITLE: 'DWG',
  DWG_LAYER: 'DWG',
  DWG_DIM: 'DWG',
  DWG_STDREF: 'DWG',
  DWG_SCALE: 'DWG',
  DWG_OVERLAP: 'DWG',
  CONTRACT: 'VIOLATION',
};

/**
 * 创建 list_available_rules 工具
 */
export function createListAvailableRulesTool(_context: ToolContext) {
  return tool({
    description: '列出所有可用的审查规则及其状态。可按 issueType 分类筛选（如 NAMING/FORMAT/COMPLETENESS/CONSISTENCY/DWG 等）。返回规则列表、总数和分类统计。',
    inputSchema: z.object({
      category: z.string().optional().describe(
        '按 issueType 分类筛选。可选值：NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/COMPLETENESS/CONSISTENCY/LAYOUT/TYPO/PUNCTUATION/DWG/VIOLATION。不传则返回全部。'
      ),
    }),
    execute: async ({ category }): Promise<ListRulesResult> => {
      // 1. 从注册表获取全量元数据
      const metadata = getRuleRegistryMetadata();
      const allItems = metadata.groups.flatMap(g => g.items);

      // 2. 从数据库加载规则配置（读取 enabled/severity）
      let dbConfigMap = new Map<string, { enabled: boolean; severity: string }>();
      try {
        const dbRules = await prisma.reviewRule.findMany({
          select: { ruleCode: true, enabled: true, severity: true },
        });
        for (const r of dbRules) {
          const prefix = r.ruleCode.replace(/_\d+$/, '');
          // 同名规则：任一启用即启用，取最严重 severity
          const existing = dbConfigMap.get(prefix);
          if (existing) {
            if (!r.enabled) existing.enabled = false;
            const sevOrder = ['info', 'warning', 'error'];
            if (sevOrder.indexOf(r.severity) > sevOrder.indexOf(existing.severity)) {
              existing.severity = r.severity;
            }
          } else {
            dbConfigMap.set(prefix, {
              enabled: r.enabled,
              severity: r.severity || 'warning',
            });
          }
        }
      } catch (e) {
        console.warn('[list_available_rules] 加载数据库规则配置失败，使用默认值:', e);
      }

      // 3. 合并元数据 + 数据库配置
      let rules: RuleDetail[] = allItems.map(item => {
        const dbCfg = dbConfigMap.get(item.prefix);
        const category_ = PREFIX_CATEGORY_MAP[item.prefix] || 'UNKNOWN';
        return {
          prefix: item.prefix,
          label: item.label,
          description: item.description,
          group: item.group,
          icon: item.icon,
          category: category_,
          enabled: dbCfg?.enabled ?? true,  // 无 DB 记录时默认启用
          severity: dbCfg?.severity ?? 'warning',
        };
      });

      // 4. 按 category 筛选
      if (category) {
        const cat = category.toUpperCase().replace(/[^A-Z_]/g, '_');
        rules = rules.filter(r => r.category === cat);
      }

      // 5. 构建分类统计
      const catMap = new Map<string, number>();
      for (const r of rules) {
        catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
      }
      const categories = Array.from(catMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        rules,
        total: rules.length,
        categories,
      };
    },
  });
}
