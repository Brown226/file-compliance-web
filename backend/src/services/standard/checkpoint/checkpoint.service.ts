// backend/src/services/standard/checkpoint/checkpoint.service.ts
/**
 * 审点 CRUD 服务（V3.2 合并：审点统一落在 rule_library_items）
 *
 * 合并后审点载体 = rule_library_items（条文库条目），
 * 标准 → 审点库 的关联在 rule_libraries.standardId。
 * 本服务对上层保持原 API 形状（clauseCode/clauseText/checkPrompt/...），内部转查新表。
 */

import prisma from '../../../config/db';

/** 从 rule_library_item 原始行适配为审点形状（对外保持原审点 API 形状，兼容旧调用方） */
function adaptItem(item: any, standardId: string | null): any {
  return {
    id: item.id,
    libraryId: item.libraryId,
    standardId, // 关联标准的 id（无关联时为 null）
    clauseCode: item.ruleCode || item.ruleName || null,
    clauseText: item.clauseText || item.description || '',
    mandatory: item.mandatory || (item.severity === 'error' ? 'mandatory' : 'guidance'),
    auditDimension: item.auditDimension || 'compliance',
    checkPrompt: item.checkPrompt || '',
    source: 'rule_library',
  };
}

export class CheckpointService {
  /** 标准关联的审点库 id 列表 */
  static async libraryIdsOfStandard(standardId: string): Promise<string[]> {
    const libs = await prisma.ruleLibrary.findMany({
      where: { standardId },
      select: { id: true },
    });
    return libs.map((l) => l.id);
  }

  /** 查某标准下所有审点（V3.2：经 rule_libraries.standardId → rule_library_items） */
  static async listByStandard(standardId: string) {
    const libraryIds = await this.libraryIdsOfStandard(standardId);
    if (libraryIds.length === 0) return [];
    const items = await prisma.ruleLibraryItem.findMany({
      where: { libraryId: { in: libraryIds }, enabled: true, clauseText: { not: null } },
      orderBy: { ruleCode: 'asc' },
    });
    return items.map((it: any) => adaptItem(it, standardId));
  }

  static async getById(id: string) {
    const item = await prisma.ruleLibraryItem.findUnique({ where: { id } });
    if (!item) return null;
    const lib = await prisma.ruleLibrary.findUnique({
      where: { id: item.libraryId },
      select: { standardId: true },
    });
    return adaptItem(item, lib?.standardId ?? null);
  }

  static async update(id: string, data: {
    clauseCode?: string;
    mandatory?: string;
    auditDimension?: string;
    checkPrompt?: string;
  }) {
    const updated = await prisma.ruleLibraryItem.update({
      where: { id },
      data: {
        ...(data.clauseCode !== undefined ? { ruleCode: data.clauseCode } : {}),
        ...(data.mandatory !== undefined ? { mandatory: data.mandatory } : {}),
        ...(data.auditDimension !== undefined ? { auditDimension: data.auditDimension } : {}),
        ...(data.checkPrompt !== undefined ? { checkPrompt: data.checkPrompt } : {}),
      },
    });
    // 保持返回形状与旧 API 一致（审点形状）
    const lib = await prisma.ruleLibrary.findUnique({
      where: { id: updated.libraryId },
      select: { standardId: true },
    });
    return adaptItem(updated, lib?.standardId ?? null);
  }

  static async delete(id: string) {
    return prisma.ruleLibraryItem.delete({ where: { id } });
  }

  static async getStats(standardId: string) {
    const checkpoints = await this.listByStandard(standardId);
    return {
      total: checkpoints.length,
      mandatory: checkpoints.filter(c => c.mandatory === 'mandatory').length,
      guidance: checkpoints.filter(c => c.mandatory === 'guidance').length,
      compliance: checkpoints.filter(c => c.auditDimension === 'compliance').length,
      fact: checkpoints.filter(c => c.auditDimension === 'fact').length,
      text: checkpoints.filter(c => c.auditDimension === 'text').length,
    };
  }
}
