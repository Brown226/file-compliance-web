/**
 * search_standard_checkpoints 工具 — 查询审点库（V3.2 合并后：rule_library_items）
 *
 * V3.2 条文库合并后，审点统一落在 rule_library_items（语义规则库条目），
 * 标准 → 审点库 的关联在 rule_libraries.standardId。
 * 本工具复用 CheckpointService（内部已转查新表），对外行为不变：
 * 不传 standardId 列出现行标准（仅列已关联审点库且有审点的标准），传 standardId 查该标准下审点。
 *
 * 工作方式（两种模式）：
 * 1. 不传 standardId（列出标准模式）：
 *    - 返回所有「已关联审点库且库内有审点」的现行（standardStatus=CURRENT）标准列表
 *    - LLM 拿到标准列表后，再调本工具传 standardId 查询具体审点
 * 2. 传 standardId（查审点模式）：
 *    - 返回该标准下所有审点（经 rule_libraries.standardId → rule_library_items）
 *    - 支持 keyword（在 clauseCode/clauseText/checkPrompt 中模糊匹配）
 *    - 支持 auditDimension 过滤（compliance / fact / text）
 *    - 支持 mandatory 过滤（mandatory / guidance）
 *
 * 返回结构：
 * - 列出标准模式：{ mode: 'list_standards', standards: [{ id, title, standardNo, standardName, standardStatus }], total }
 * - 查审点模式：{ mode: 'list_checkpoints', checkpoints: [{ id, libraryId, standardId, clauseCode, clauseText, checkPrompt, auditDimension, mandatory, source }], total, standardTitle }
 *
 * 典型用途：
 * - LLM 审查时先列出标准，选择相关标准后查审点
 * - 用审点的 checkPrompt 作为 LLM 审查的 prompt 补充
 * - 用审点的 clauseText 作为审查依据
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import prisma from '../../../../config/db';
import { CheckpointService } from '../../../standard/checkpoint/checkpoint.service';
import { StandardService } from '../../../standard/standard.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 标准信息（列出标准模式） */
interface StandardInfo {
  id: string;
  title: string;
  standardNo: string | null;
  standardName: string | null;
  standardStatus: string;
}

/** 审点信息（查审点模式） */
interface CheckpointInfo {
  id: string;
  libraryId: string | null;
  standardId: string | null;
  clauseCode: string | null;
  clauseText: string;
  checkPrompt: string | null;
  auditDimension: string;
  mandatory: string;
  source: string;
}

/** 标准列表结果 */
interface ListStandardsResult {
  mode: 'list_standards';
  standards: StandardInfo[];
  total: number;
}

/** 审点列表结果 */
interface ListCheckpointsResult {
  mode: 'list_checkpoints';
  checkpoints: CheckpointInfo[];
  total: number;
  standardTitle: string;
}

type SearchStandardCheckpointsResult = ListStandardsResult | ListCheckpointsResult;

/**
 * 判断审点是否匹配关键词
 */
function matchCheckpointKeyword(checkpoint: any, keyword: string): boolean {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  const fields = [
    checkpoint?.clauseCode,
    checkpoint?.clauseText,
    checkpoint?.checkPrompt,
  ].filter(Boolean).map(s => String(s).toLowerCase());
  return fields.some(f => f.includes(kw));
}

/**
 * 创建 search_standard_checkpoints 工具
 */
export function createSearchStandardCheckpointsTool(_context: ToolContext) {
  return tool({
    description: '查询审点库（V3.2 合并后统一存于 rule_library_items）。不传 standardId 时返回已关联审点库的现行标准列表（用于让 LLM 选择相关标准），传 standardId 时返回该标准下的审点列表。审点含 clauseCode/clauseText/checkPrompt/auditDimension/mandatory，可作为审查依据或 prompt 补充。',
    inputSchema: z.object({
      standardId: z.string().optional().describe('标准 ID（不传时返回已关联审点库的现行标准列表供选择）'),
      keyword: z.string().optional().describe('关键词（在 clauseCode/clauseText/checkPrompt 中模糊匹配，仅查审点模式生效）'),
      auditDimension: z.enum(['compliance', 'fact', 'text']).optional().describe('审查维度过滤（compliance 合规性 / fact 事实性 / text 文本性）'),
      mandatory: z.enum(['mandatory', 'guidance']).optional().describe('强制性过滤（mandatory 强制 / guidance 推荐）'),
      topNumber: z.number().int().min(1).max(100).optional().default(50).describe('返回的最大审点数（默认 50，仅查审点模式生效）'),
    }),
    execute: async ({ standardId, keyword, auditDimension, mandatory, topNumber }): Promise<SearchStandardCheckpointsResult> => {
      // 模式 1：列出标准（V3.2：仅列已关联审点库且有审点的标准）
      if (!standardId) {
        const libs: any[] = await prisma.ruleLibrary.findMany({
          where: { standardId: { not: null } },
          select: { standardId: true },
        });
        const stdIds = [...new Set(libs.map((l) => l.standardId))];

        let standards: any[] = [];
        if (stdIds.length > 0) {
          const { standards: list } = await StandardService.getStandards({
            standardStatus: 'CURRENT',
            take: 100, // 最多列 100 个
          });
          // 过滤出与审点库关联的（getStandards 分页后按 id 匹配）
          const idSet = new Set(stdIds);
          standards = list.filter((s: any) => idSet.has(s.id));
        }

        const standardInfos: StandardInfo[] = standards.map((s: any) => ({
          id: s.id,
          title: s.title,
          standardNo: s.standardNo || null,
          standardName: s.standardName || null,
          standardStatus: s.standardStatus,
        }));

        console.log(`[Agent:search_standard_checkpoints] 列出已关联审点库的现行标准: ${standardInfos.length} 个`);

        return {
          mode: 'list_standards',
          standards: standardInfos,
          total: standardInfos.length,
        };
      }

      // 模式 2：查审点
      // 先拿标准标题
      const standard = await StandardService.getStandardById(standardId);
      const standardTitle = standard?.title || '未知标准';

      // 查所有审点（CheckpointService 内部已转查 rule_library_items）
      const allCheckpoints = await CheckpointService.listByStandard(standardId);

      console.log(`[Agent:search_standard_checkpoints] 查标准 ${standardId} (${standardTitle}): 原始 ${allCheckpoints.length} 个审点`);

      // 过滤
      const filtered = allCheckpoints.filter((cp: any) => {
        if (auditDimension && cp.auditDimension !== auditDimension) return false;
        if (mandatory && cp.mandatory !== mandatory) return false;
        if (!matchCheckpointKeyword(cp, keyword || '')) return false;
        return true;
      });

      // 限制数量
      const trimmed = filtered.slice(0, topNumber);

      console.log(`[Agent:search_standard_checkpoints] 过滤后 ${filtered.length} 个，返回 ${trimmed.length} 个 (keyword=${keyword || '-'}, dim=${auditDimension || '-'}, mandatory=${mandatory || '-'})`);

      const checkpoints: CheckpointInfo[] = trimmed.map((cp: any) => ({
        id: cp.id,
        libraryId: cp.libraryId || null,
        standardId: cp.standardId || standardId,
        clauseCode: cp.clauseCode || null,
        clauseText: cp.clauseText,
        checkPrompt: cp.checkPrompt || null,
        auditDimension: cp.auditDimension || 'compliance',
        mandatory: cp.mandatory || 'mandatory',
        source: cp.source || 'rule_library',
      }));

      return {
        mode: 'list_checkpoints',
        checkpoints,
        total: checkpoints.length,
        standardTitle,
      };
    },
  });
}
