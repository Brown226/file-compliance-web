/**
 * OPT-015: 审查质量指标服务
 *
 * 基于 ReviewFeedback 表和 TaskDetail 表计算 precision 指标与误报统计，
 * 为审查质量看板提供数据支撑。
 *
 * P1-4 修复（2026-08-14，整改报告 P1-4）：
 * 1. totalIssues 覆盖全部审查引擎产出（此前仅 reviewSource='AI'，
 *    DEC 的 COMPLETENESS/COMPLIANCE/RULE_FALLBACK、语义聚合 AI_REVIEW、
 *    规则库 RULE_LIBRARY 全被排除在分母外，看板分母系统性偏小）；
 * 2. 无反馈时 precision 返回 null（此前假报 1 = "100% 精确率"假象），前端显示"—"；
 * 3. 趋势：按日补零（无审查/无反馈的日期也输出），totalIssues 为当日真实问题数
 *    （此前与 feedbackCount 同名不同义）、precision 无反馈为 null；
 * 4. getTopFalsePositiveRules 按 (issueType, ruleCode) 分组并聚合 sum(count)
 *    （此前按行数 _count.id，标记 5 次只算 1 次）；
 * 5. 头注释不再声称 recall（无 ground truth 无法计算，missedCount 仅表示用户标记漏报数）。
 */

import prisma from '../../config/db';

export interface MetricsResult {
  precision: number | null;   // 精确率 = useful / (useful + false_positive)；无反馈时 null（避免假 100%）
  totalIssues: number;        // 全部审查引擎产出的问题数（排除 NO_RESULT 占位与 REVIEW_SUMMARY 统计条目）
  usefulCount: number;        // 用户标记"有用"数
  falsePositiveCount: number; // 用户标记"误报"数
  missedCount: number;        // 用户标记"漏报"数
  feedbackRate: number;       // 反馈率 = feedback / totalIssues
}

export interface TrendPoint {
  date: string;
  precision: number | null;   // 当日无反馈 → null
  totalIssues: number;        // 当日全部引擎问题数
  feedbackCount: number;
}

/** 全部审查引擎产出的 taskDetail 过滤条件（排除占位/统计条目） */
function issueWhere(extra: any = {}): any {
  return {
    issueType: { not: 'REVIEW_SUMMARY' },
    ruleCode: { not: 'NO_RESULT' },
    ...extra,
  };
}

export class ReviewMetricsService {

  /**
   * 计算总体精确率
   * precision = useful / (useful + false_positive)；无反馈返回 null
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

    // 当 reviewMode 存在时，查出该模式下所有 Task 的 id，用于过滤 feedback 和 taskDetail
    let taskIds: string[] | undefined;
    if (options?.reviewMode) {
      const tasks = await prisma.task.findMany({
        where: { reviewMode: options.reviewMode as any },
        select: { id: true },
      });
      taskIds = tasks.map(t => t.id);
    }

    const feedbackWhere = taskIds ? { ...where, taskId: { in: taskIds } } : where;

    const [usefulCount, falsePositiveCount, missedCount, totalIssues] = await Promise.all([
      prisma.reviewFeedback.count({ where: { ...feedbackWhere, feedbackType: 'useful' } }),
      prisma.reviewFeedback.count({ where: { ...feedbackWhere, feedbackType: 'false_positive' } }),
      prisma.reviewFeedback.count({ where: { ...feedbackWhere, feedbackType: 'missed' } }),
      prisma.taskDetail.count({
        where: {
          ...(taskIds ? { taskId: { in: taskIds } } : {}),
          ...issueWhere(options?.startDate || options?.endDate ? {
            createdAt: {
              ...(options?.startDate ? { gte: options.startDate } : {}),
              ...(options?.endDate ? { lte: options.endDate } : {}),
            }
          } : {}),
        },
      }),
    ]);

    const totalFeedback = usefulCount + falsePositiveCount;
    // P1-4: 无反馈时返回 null（此前返回 1，看板呈现"100% 精确率"假象）
    const precision = totalFeedback > 0 ? usefulCount / totalFeedback : null;
    const feedbackRate = totalIssues > 0 ? (usefulCount + falsePositiveCount + missedCount) / totalIssues : 0;

    return {
      precision: precision === null ? null : Math.round(precision * 1000) / 1000,
      totalIssues,
      usefulCount,
      falsePositiveCount,
      missedCount,
      feedbackRate: Math.round(feedbackRate * 1000) / 1000,
    };
  }

  /**
   * 按天/周聚合精确率趋势
   * P1-4: 每日补零（30 天窗口内无数据的日期也输出），totalIssues 为当日真实问题数
   */
  static async getTrend(granularity: 'daily' | 'weekly' = 'daily', days: number = 30): Promise<TrendPoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [feedbacks, issueRows] = await Promise.all([
      prisma.reviewFeedback.findMany({
        where: { createdAt: { gte: startDate } },
        select: { feedbackType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // P1-4: 全部引擎的问题数按日统计（此前趋势 totalIssues 实为反馈数）
      prisma.taskDetail.findMany({
        where: issueWhere({ createdAt: { gte: startDate } }),
        select: { createdAt: true },
      }),
    ]);

    const grouped = new Map<string, { useful: number; falsePositive: number; issueCount: number }>();
    const keyOf = (d: Date) => granularity === 'daily'
      ? d.toISOString().slice(0, 10)
      : this.getWeekKey(d);

    for (const fb of feedbacks) {
      const dateKey = keyOf(fb.createdAt);
      if (!grouped.has(dateKey)) grouped.set(dateKey, { useful: 0, falsePositive: 0, issueCount: 0 });
      const g = grouped.get(dateKey)!;
      if (fb.feedbackType === 'useful') g.useful++;
      if (fb.feedbackType === 'false_positive') g.falsePositive++;
    }
    for (const row of issueRows) {
      const dateKey = keyOf(row.createdAt);
      if (!grouped.has(dateKey)) grouped.set(dateKey, { useful: 0, falsePositive: 0, issueCount: 0 });
      grouped.get(dateKey)!.issueCount++;
    }

    // P1-4: 按日补零——30 天窗口内每天都输出（周粒度不补零，保持实际数据）
    if (granularity === 'daily') {
      const out: TrendPoint[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const g = grouped.get(key) || { useful: 0, falsePositive: 0, issueCount: 0 };
        out.push({
          date: key,
          precision: (g.useful + g.falsePositive) > 0
            ? Math.round(g.useful / (g.useful + g.falsePositive) * 1000) / 1000
            : null,
          totalIssues: g.issueCount,
          feedbackCount: g.useful + g.falsePositive,
        });
      }
      return out;
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, g]) => ({
        date,
        precision: (g.useful + g.falsePositive) > 0
          ? Math.round(g.useful / (g.useful + g.falsePositive) * 1000) / 1000
          : null,
        totalIssues: g.issueCount,
        feedbackCount: g.useful + g.falsePositive,
      }));
  }

  /**
   * Top N 高误报规则/类型
   * P1-4: 按 (issueType, ruleCode) 分组并聚合 sum(count)（此前按行数，标记 5 次只算 1）
   */
  static async getTopFalsePositiveRules(limit: number = 10): Promise<Array<{
    issueType: string;
    ruleCode: string | null;
    count: number;
  }>> {
    const results = await prisma.falsePositiveLibrary.groupBy({
      by: ['issueType', 'ruleCode'],
      _sum: { count: true },
      orderBy: { _sum: { count: 'desc' } },
      take: limit,
    });

    return results.map(r => ({
      issueType: r.issueType || 'UNKNOWN',
      ruleCode: r.ruleCode,
      count: r._sum.count || 0,
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
