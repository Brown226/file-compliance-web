/**
 * search_rule_library 工具 — 查询条文库（RuleLibrary + RuleLibraryItem）
 *
 * 复用 RuleLibraryService.list({ selectableOnly: true })，
 * 返回 PUBLISHED 状态的规则库及其可执行 items。
 *
 * 工作方式：
 * - 不传 libraryId：列出所有 PUBLISHED 规则库的可执行 items（合并）
 * - 传 libraryId：只查指定规则库的 items
 * - keyword：在 ruleName / description / clauseText 中模糊匹配
 * - category：按 category 字段精确过滤（如 NAMING / ENCODING / ATTRIBUTE / HEADER / PAGE / SCAN / TEMPLATE）
 *
 * 返回结构：
 * - results: [{ id, libraryId, libraryName, ruleCode, ruleName, category, description, severity, checkMethod, checkPrompt, auditDimension, mandatory }]
 * - total: 结果数
 * - searchedLibraries: 实际查询的规则库 [{ id, name }]
 *
 * 典型用途：
 * - LLM 在审查前先查规则库，了解当前文件类型应遵循哪些规则
 * - 调 apply_rule 工具时先查询可用规则的 ruleCode 列表
 * - 获取规则的 checkPrompt 作为 LLM 审查的 prompt 补充
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { RuleLibraryService } from '../../../llm/rule-library.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 规则项结果 */
interface RuleLibrarySearchItem {
  id: string;
  libraryId: string;
  libraryName: string;
  ruleCode: string | null;
  ruleName: string | null;
  category: string | null;
  description: string | null;
  severity: string | null;
  checkMethod: string | null;
  checkPrompt: string | null;
  auditDimension: string | null;
  mandatory: string | null;
  enabled: boolean;
}

/** 检索结果 */
interface SearchRuleLibraryResult {
  results: RuleLibrarySearchItem[];
  total: number;
  searchedLibraries: Array<{ id: string; name: string }>;
}

/**
 * 判断规则项是否匹配关键词
 */
function matchKeyword(item: any, keyword: string): boolean {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  const fields = [
    item?.ruleCode,
    item?.ruleName,
    item?.description,
    item?.clauseText,
    item?.checkMethod,
    item?.category,
  ].filter(Boolean).map(s => String(s).toLowerCase());
  return fields.some(f => f.includes(kw));
}

/**
 * 创建 search_rule_library 工具
 */
export function createSearchRuleLibraryTool(_context: ToolContext) {
  return tool({
    description: '查询已发布（PUBLISHED）的条文库。返回可执行规则项列表，支持按关键词和类别过滤。规则项含 ruleCode/ruleName/category/description/severity/checkMethod/checkPrompt/auditDimension 等字段，可作为审查依据或调 apply_rule 时的规则清单。',
    inputSchema: z.object({
      libraryId: z.string().optional().describe('指定规则库 ID（不传时查所有 PUBLISHED 规则库的可执行 items）'),
      keyword: z.string().optional().describe('关键词（在 ruleName/description/clauseText/checkMethod/category 中模糊匹配）'),
      category: z.string().optional().describe('规则类别（精确匹配，如 NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/SCAN/TEMPLATE）'),
      topNumber: z.number().int().min(1).max(50).optional().default(20).describe('返回的最大结果数（默认 20）'),
    }),
    execute: async ({ libraryId, keyword, category, topNumber }): Promise<SearchRuleLibraryResult> => {
      // 1. 获取规则库列表
      let libraries: any[];
      if (libraryId) {
        // 查指定规则库
        const lib = await RuleLibraryService.getById(libraryId);
        libraries = lib ? [lib] : [];
      } else {
        // 查所有 PUBLISHED 规则库
        libraries = await RuleLibraryService.list({ selectableOnly: true });
      }

      if (libraries.length === 0) {
        return { results: [], total: 0, searchedLibraries: [] };
      }

      const searchedLibraries = libraries.map(lib => ({
        id: lib.id,
        name: lib.name,
      }));

      // 2. 收集所有可执行 + enabled 的 items
      const allItems: RuleLibrarySearchItem[] = [];
      for (const lib of libraries) {
        const items = lib.items || [];
        for (const item of items) {
          // 只返回可执行 + enabled 的
          if (!RuleLibraryService.isExecutableItem(item)) continue;
          if (item.enabled === false) continue;

          // category 过滤
          if (category && item.category !== category) continue;

          // keyword 过滤
          if (!matchKeyword(item, keyword || '')) continue;

          allItems.push({
            id: item.id,
            libraryId: lib.id,
            libraryName: lib.name,
            ruleCode: item.ruleCode || null,
            ruleName: item.ruleName || null,
            category: item.category || null,
            description: item.description || null,
            severity: item.severity || null,
            checkMethod: item.checkMethod || null,
            checkPrompt: item.checkPrompt || null,
            auditDimension: item.auditDimension || null,
            mandatory: item.mandatory || null,
            enabled: item.enabled !== false,
          });
        }
      }

      // 3. 限制返回数量
      const trimmed = allItems.slice(0, topNumber);

      // P2：日志收敛——只在汇总处打一条，且不打印完整用户查询词（keyword/category 属用户检索内容，避免进服务器日志）
      console.log(`[Agent:search_rule_library] 命中 ${allItems.length} 条，返回 ${trimmed.length} 条（library=${libraryId || 'all'}）`);

      return {
        results: trimmed,
        total: trimmed.length,
        searchedLibraries,
      };
    },
  });
}
