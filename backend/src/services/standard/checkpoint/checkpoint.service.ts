// backend/src/services/standard/checkpoint/checkpoint.service.ts
/**
 * 审点 CRUD 服务
 */

import prisma from '../../../config/db';

export class CheckpointService {
  static async listByStandard(standardId: string) {
    return prisma.standardCheckpoint.findMany({
      where: { standardId },
      orderBy: { clauseCode: 'asc' },
    });
  }

  static async getById(id: string) {
    return prisma.standardCheckpoint.findUnique({ where: { id } });
  }

  static async update(id: string, data: {
    clauseCode?: string;
    mandatory?: string;
    auditDimension?: string;
    checkPrompt?: string;
  }) {
    return prisma.standardCheckpoint.update({ where: { id }, data });
  }

  static async delete(id: string) {
    return prisma.standardCheckpoint.delete({ where: { id } });
  }

  static async getStats(standardId: string) {
    const checkpoints = await prisma.standardCheckpoint.findMany({
      where: { standardId },
      select: { mandatory: true, auditDimension: true },
    });
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
