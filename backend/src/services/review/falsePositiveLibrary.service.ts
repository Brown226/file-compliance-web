import prisma from '../../config/db'

/**
 * 文本归一化：去除空白符和标点，NFKC 标准化，转小写
 * 用于误报库匹配时消除格式差异
 */
export function normalizeText(text: string): string {
  return text.replace(/[\s\u3000\t\r\n]+/g, '')
    .replace(/[，。！？、；：""''（）【】《》\-\–\—\.\,\!\?\;\:\'\"\(\)\[\]\{\}]/g, '')
    .normalize('NFKC')
    .toLowerCase();
}

export interface FpLibraryQuery {
  issueType?: string
  ruleCode?: string
  keyword?: string
  page?: number
  pageSize?: number
}

class FalsePositiveLibraryService {
  /**
   * 获取误报标记库列表
   */
  static async list(query: FpLibraryQuery) {
    const { issueType, ruleCode, keyword, page = 1, pageSize = 20 } = query
    
    const where: any = {}
    if (issueType) where.issueType = issueType
    if (ruleCode) where.ruleCode = ruleCode
    if (keyword) {
      where.OR = [
        { originalText: { contains: keyword, mode: 'insensitive' } },
        { fpReason: { contains: keyword, mode: 'insensitive' } },
      ]
    }

    const [records, total] = await Promise.all([
      prisma.falsePositiveLibrary.findMany({
        where,
        orderBy: { lastMarkedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.falsePositiveLibrary.count({ where }),
    ])

    return { records, total, page, pageSize }
  }

  /**
   * 同步误报记录到标记库（当用户标记误报时调用）
   */
  static async syncFromTaskDetail(detail: {
    originalText: string
    fpReason?: string
    issueType?: string
    ruleCode?: string
    severity?: string
    markedById?: string
    markedByName?: string
    taskId?: string
    taskTitle?: string
  }) {
    // P1-2：写读口径统一——按归一化文本匹配（此前写入侧精确匹配、消费侧归一化匹配，
    // 同一文本因标点/全半角差异在库中分裂多条、count 计数错位）
    const normalized = normalizeText(detail.originalText);
    const existing = await prisma.falsePositiveLibrary.findFirst({
      where: { normalizedText: normalized },
    })

    if (existing) {
      // 更新次数和时间
      return prisma.falsePositiveLibrary.update({
        where: { id: existing.id },
        data: {
          count: existing.count + 1,
          lastMarkedAt: new Date(),
          fpReason: detail.fpReason || existing.fpReason,
        },
      })
    } else {
      // 新增记录
      return prisma.falsePositiveLibrary.create({
        data: {
          originalText: detail.originalText,
          normalizedText: normalized,
          fpReason: detail.fpReason,
          issueType: detail.issueType,
          ruleCode: detail.ruleCode,
          severity: detail.severity,
          markedById: detail.markedById,
          markedByName: detail.markedByName,
          taskId: detail.taskId,
          taskTitle: detail.taskTitle,
        },
      })
    }
  }

  /**
   * 删除误报记录（取消标记时调用）
   */
  static async remove(originalText: string) {
    // P1-2：与写入侧同口径（归一化匹配）
    const existing = await prisma.falsePositiveLibrary.findFirst({
      where: { normalizedText: normalizeText(originalText) },
    })

    if (!existing) return null

    if (existing.count <= 1) {
      // 次数为1，直接删除
      return prisma.falsePositiveLibrary.delete({
        where: { id: existing.id },
      })
    } else {
      // 次数大于1，减少计数
      return prisma.falsePositiveLibrary.update({
        where: { id: existing.id },
        data: {
          count: existing.count - 1,
          lastMarkedAt: new Date(),
        },
      })
    }
  }

  /**
   * 获取导出数据
   */
  static async getExportData(query: FpLibraryQuery) {
    const { issueType, ruleCode, keyword } = query
    
    const where: any = {}
    if (issueType) where.issueType = issueType
    if (ruleCode) where.ruleCode = ruleCode
    if (keyword) {
      where.OR = [
        { originalText: { contains: keyword, mode: 'insensitive' } },
        { fpReason: { contains: keyword, mode: 'insensitive' } },
      ]
    }

    return prisma.falsePositiveLibrary.findMany({
      where,
      orderBy: { lastMarkedAt: 'desc' },
    })
  }

  /**
   * 检查文本是否在误报库中
   */
  static async isInLibrary(text: string): Promise<boolean> {
    const count = await prisma.falsePositiveLibrary.count({
      where: { normalizedText: normalizeText(text) },
    })
    return count > 0
  }

  /**
   * 批量检查多个文本是否在误报库中
   * 一次加载全量误报库到内存，归一化匹配（P1-2：按 (归一化文本, ruleCode) 二元组，
   * 同一文本不同规则上下文不再互相误伤）
   * @returns Map<归一化文本, Set<ruleCode|null>>（null 表示任意规则上下文均命中）
   */
  static async batchCheck(texts: string[]): Promise<Map<string, boolean>> {
    const allFps = await prisma.falsePositiveLibrary.findMany({
      select: { originalText: true, ruleCode: true, normalizedText: true },
    });
    const fpMap = new Map<string, Set<string | null>>();
    for (const fp of allFps) {
      const key = fp.normalizedText || normalizeText(fp.originalText);
      if (!fpMap.has(key)) fpMap.set(key, new Set());
      fpMap.get(key)!.add(fp.ruleCode || null);
    }
    const result = new Map<string, boolean>();
    for (const text of texts) {
      result.set(text, fpMap.has(normalizeText(text)));
    }
    return result;
  }

  /**
   * P1-2：加载误报库为 (归一化文本 → ruleCode 集合) 映射，供审查主流程过滤使用
   * 与 batchCheck 同口径；ruleCode 集合含 null 表示该文本任意规则上下文均命中
   */
  static async loadFpRuleMap(): Promise<Map<string, Set<string | null>>> {
    const allFps = await prisma.falsePositiveLibrary.findMany({
      select: { originalText: true, ruleCode: true, normalizedText: true },
    });
    const fpMap = new Map<string, Set<string | null>>();
    for (const fp of allFps) {
      const key = fp.normalizedText || normalizeText(fp.originalText);
      if (!fpMap.has(key)) fpMap.set(key, new Set());
      fpMap.get(key)!.add(fp.ruleCode || null);
    }
    return fpMap;
  }
}

export default FalsePositiveLibraryService
