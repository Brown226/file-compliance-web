/**
 * OPT-015: 审查质量指标服务
 *
 * 基于 ReviewFeedback 表和 TaskDetail 表计算 precision/recall 指标，
 * 为审查质量看板提供数据支撑。
 */

import prisma from '../config/db';

export interface MetricsResult {
  precision: number;        // 精确率 = 1 - (false_positive / total_feedback)
  totalIssues: number;      // 总审查问题数
  usefulCount: number;      // 用户标记"有用"数
  falsePositiveCount: number; // 用户标记"误报"数
  missedCount: number;      // 用户标记"漏报"数
  feedbackRate: number;     // 反馈率 = feedback / totalIssues
}

export interface TrendPoint {
  date: string;
  precision: number;
  totalIssues: number;
  feedbackCount: number;
}

export class ReviewMetricsService {

  /**
   * 计算总体精确率
   * precision = useful / (useful + false_positive)
   */
  static async calculatePrecision(options?: {
    reviewMode?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<MetricsResult> {
    const where: any = {};
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }

    const [usefulCount, falsePositiveCount, missedCount, totalIssues] = await Promise.all([
      prisma.reviewFeedback.count({ where: { ...where, feedbackType: 'useful' } }),
      prisma.reviewFeedback.count({ where: { ...where, feedbackType: 'false_positive' } }),
      prisma.reviewFeedback.count({ where: { ...where, feedbackType: 'missed' } }),
      prisma.taskDetail.count({
        where: {
          reviewSource: 'AI',
          ...(options?.startDate || options?.endDate ? {
            createdAt: {
              ...(options?.startDate ? { gte: options.startDate } : {}),
              ...(options?.endDate ? { lte: options.endDate } : {}),
            }
          } : {}),
        }
      }),
    ]);

    const totalFeedback = usefulCount + falsePositiveCount;
    const precision = totalFeedback > 0 ? usefulCount / totalFeedback : 1;
    const feedbackRate = totalIssues > 0 ? (usefulCount + falsePositiveCount + missedCount) / totalIssues : 0;

    return {
      precision: Math.round(precision * 1000) / 1000,
      totalIssues,
      usefulCount,
      falsePositiveCount,
      missedCount,
      feedbackRate: Math.round(feedbackRate * 1000) / 1000,
    };
  }

  /**
   * 按天/周聚合精确率趋势
   */
  static async getTrend(granularity: 'daily' | 'weekly' = 'daily', days: number = 30): Promise<TrendPoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const feedbacks = await prisma.reviewFeedback.findMany({
      where: { createdAt: { gte: startDate } },
      select: { feedbackType: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // 按日期分组
    const grouped = new Map<string, { useful: number; falsePositive: number }>();
    for (const fb of feedbacks) {
      const dateKey = granularity === 'daily'
        ? fb.createdAt.toISOString().slice(0, 10)
        : this.getWeekKey(fb.createdAt);

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, { useful: 0, falsePositive: 0 });
      }
      const g = grouped.get(dateKey)!;
      if (fb.feedbackType === 'useful') g.useful++;
      if (fb.feedbackType === 'false_positive') g.falsePositive++;
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, g]) => ({
        date,
        precision: (g.useful + g.falsePositive) > 0
          ? Math.round(g.useful / (g.useful + g.falsePositive) * 1000) / 1000
          : 1,
        totalIssues: g.useful + g.falsePositive,
        feedbackCount: g.useful + g.falsePositive,
      }));
  }

  /**
   * Top N 高误报规则/类型
   */
  static async getTopFalsePositiveRules(limit: number = 10): Promise<Array<{
    issueType: string;
    count: number;
  }>> {
    // 从 falsePositiveLibrary 表获取误报统计（已有数据）
    const results = await prisma.falsePositiveLibrary.groupBy({
      by: ['issueType'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return results.map(r => ({
      issueType: r.issueType || 'UNKNOWN',
      count: r._count.id,
    }));
  }

  /**
   * 提交反馈
   */
  static async submitFeedback(data: {
    taskId: string;
    fileId?: string;
    detailId?: string;
    feedbackType: 'useful' | 'false_positive' | 'missed';
    userId?: string;
  }): Promise<any> {
    return prisma.reviewFeedback.create({ data });
  }

  private static getWeekKey(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().slice(0, 10);
  }
}
