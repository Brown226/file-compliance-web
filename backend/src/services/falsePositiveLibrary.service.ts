import prisma from '../config/db'

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
    // 检查是否已存在相同原文的记录
    const existing = await prisma.falsePositiveLibrary.findFirst({
      where: { originalText: detail.originalText },
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
    const existing = await prisma.falsePositiveLibrary.findFirst({
      where: { originalText },
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
      where: { originalText: text },
    })
    return count > 0
  }
}

export default FalsePositiveLibraryService
