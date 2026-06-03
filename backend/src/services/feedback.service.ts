import prisma from '../config/db';
import { Feedback, FeedbackStatus, FeedbackCategory, Prisma } from '@prisma/client';

export interface CreateFeedbackInput {
  title: string;
  content: string;
  category: FeedbackCategory;
  userId: string;
  attachmentPaths?: Array<{
    id: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    fileType: string;
  }>;
}

export interface UpdateFeedbackStatusInput {
  status: FeedbackStatus;
  resolverId: string;
  remark?: string;
}

export interface FeedbackQueryParams {
  page?: number;
  limit?: number;
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  userId?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

export class FeedbackService {
  /**
   * 创建反馈
   */
  static async createFeedback(input: CreateFeedbackInput): Promise<Feedback> {
    return prisma.feedback.create({
      data: {
        title: input.title,
        content: input.content,
        category: input.category,
        userId: input.userId,
        attachmentPaths: input.attachmentPaths ? input.attachmentPaths : Prisma.JsonNullValueInput.JsonNull,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * 获取我的反馈列表（用户视角）
   */
  static async getMyFeedbacks(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      }),
      prisma.feedback.count({ where: { userId } }),
    ]);

    return {
      feedbacks,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 获取反馈详情
   */
  static async getFeedbackById(id: string, userId?: string, userRole?: string): Promise<Feedback | null> {
    const feedback = await prisma.feedback.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    if (!feedback) {
      return null;
    }

    // 权限检查：非管理员只能查看自己的反馈
    if (userRole !== 'ADMIN' && feedback.userId !== userId) {
      throw new Error('无权查看此反馈');
    }

    return feedback;
  }

  /**
   * 获取所有反馈列表（管理员视角）
   */
  static async getAllFeedbacks(params: FeedbackQueryParams) {
    const {
      page = 1,
      limit = 10,
      status,
      category,
      userId,
      startDate,
      endDate,
      keyword,
    } = params;

    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: Prisma.FeedbackWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = category;
    }

    if (userId) {
      where.userId = userId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { content: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              role: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      }),
      prisma.feedback.count({ where }),
    ]);

    return {
      feedbacks,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 更新反馈状态
   */
  static async updateFeedbackStatus(
    id: string,
    input: UpdateFeedbackStatusInput
  ): Promise<Feedback> {
    const feedback = await prisma.feedback.findUnique({
      where: { id },
    });

    if (!feedback) {
      throw new Error('反馈不存在');
    }

    const updateData: any = {
      status: input.status,
      resolverId: input.resolverId,
      resolvedAt: input.status === FeedbackStatus.RESOLVED ? new Date() : (feedback.resolvedAt || undefined),
    };

    if (input.remark !== undefined) {
      updateData.remark = input.remark;
    }

    return prisma.feedback.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * 删除反馈（仅管理员）
   */
  static async deleteFeedback(id: string): Promise<Feedback> {
    const feedback = await prisma.feedback.findUnique({
      where: { id },
    });

    if (!feedback) {
      throw new Error('反馈不存在');
    }

    return prisma.feedback.delete({
      where: { id },
    });
  }

  /**
   * 批量更新反馈状态
   */
  static async batchUpdateStatus(
    ids: string[],
    status: FeedbackStatus,
    resolverId: string,
    remark?: string
  ): Promise<{ count: number }> {
    const result = await prisma.feedback.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        status,
        resolverId,
        resolvedAt: status === FeedbackStatus.RESOLVED ? new Date() : undefined,
        remark,
      },
    });

    return { count: result.count };
  }

  /**
   * 批量删除反馈
   */
  static async batchDelete(ids: string[]): Promise<{ count: number }> {
    const result = await prisma.feedback.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    return { count: result.count };
  }

  /**
   * 获取反馈统计信息
   */
  static async getFeedbackStats() {
    const [totalByStatus, totalByCategory, recentTrend] = await Promise.all([
      // 按状态统计
      prisma.feedback.groupBy({
        by: ['status'],
        _count: true,
      }),
      // 按类别统计
      prisma.feedback.groupBy({
        by: ['category'],
        _count: true,
      }),
      // 近30天趋势
      prisma.feedback.groupBy({
        by: ['createdAt'],
        _count: true,
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
    ]);

    // 处理统计数据
    const statusStats = totalByStatus.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const categoryStats = totalByCategory.reduce((acc, item) => {
      acc[item.category] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // 按日期聚合趋势数据
    const trendMap = new Map<string, number>();
    recentTrend.forEach((item) => {
      const date = item.createdAt.toISOString().split('T')[0];
      trendMap.set(date, (trendMap.get(date) || 0) + item._count);
    });

    const trend = Array.from(trendMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    return {
      statusStats,
      categoryStats,
      trend,
    };
  }
}

export default FeedbackService;
