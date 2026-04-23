import prisma from '../config/db';

export class DashboardService {
  async getStats() {
    // 1. Task counts by status
    const tasksCount = await prisma.task.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    });

    const taskStats = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
      TOTAL: 0,
    };

    tasksCount.forEach((item) => {
      taskStats[item.status] = item._count.id;
      taskStats.TOTAL += item._count.id;
    });

    // 2. Issue counts by type
    const issuesCount = await prisma.taskDetail.groupBy({
      by: ['issueType'],
      _count: {
        id: true,
      },
    });

    const issueStats = {
      TYPO: 0,
      VIOLATION: 0,
      TOTAL: 0,
    };

    issuesCount.forEach((item) => {
      if (item.issueType === 'TYPO' || item.issueType === 'VIOLATION') {
        issueStats[item.issueType] = item._count.id;
        issueStats.TOTAL += item._count.id;
      }
    });

    // High frequency typos
    const frequentTyposRaw = await prisma.taskDetail.groupBy({
      by: ['originalText'],
      where: {
        issueType: 'TYPO',
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 10,
    });

    const frequentTypos = frequentTyposRaw.map((item) => ({
      text: item.originalText,
      count: item._count.id,
    }));

    // Top 10 violated standards
    const topViolationsRaw = await prisma.taskDetail.groupBy({
      by: ['description'],
      where: {
        issueType: 'VIOLATION',
        description: { not: null },
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 10,
    });

    const topViolations = topViolationsRaw.map((item) => ({
      standardTitle: item.description || '未知规范',
      count: item._count.id,
    }));

    // Department task stats with compliance rate and avg time
    const departments = await prisma.department.findMany({
      include: {
        users: {
          include: {
            _count: { select: { tasks: true } }
          }
        }
      }
    });

    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const userIds = dept.users.map(u => u.id);
        const deptTasks = await prisma.task.findMany({
          where: { creatorId: { in: userIds } },
          select: { id: true, status: true, createdAt: true, updatedAt: true }
        });
        const taskCount = deptTasks.length;
        if (taskCount === 0) return { deptName: dept.name, taskCount: 0, avgTimeMs: 0, complianceRate: 0 };

        // Compliance rate for this department
        const completedIds = deptTasks.filter(t => t.status === 'COMPLETED').map(t => t.id);
        let complianceRate = 100;
        if (completedIds.length > 0) {
          const violations = await prisma.taskDetail.groupBy({
            by: ['taskId'],
            where: { taskId: { in: completedIds }, issueType: 'VIOLATION' }
          });
          complianceRate = Math.round(((completedIds.length - violations.length) / completedIds.length) * 10000) / 100;
        }

        // Average processing time
        let avgTimeMs = 0;
        if (completedIds.length > 0) {
          try {
            const completedTasks = deptTasks.filter(t => t.status === 'COMPLETED' && t.updatedAt);
            if (completedTasks.length > 0) {
              const totalMs = completedTasks.reduce((sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()), 0);
              avgTimeMs = totalMs / completedTasks.length;
            }
          } catch {}

          return { deptName: dept.name, taskCount, avgTimeMs, complianceRate };
        }

        return { deptName: dept.name, taskCount, avgTimeMs, complianceRate };
      })
    );

    // Average processing time (completed tasks)
    let averageProcessingTimeMs = 0;
    try {
      const result: any = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_time
        FROM "tasks"
        WHERE status = 'COMPLETED'
      `;
      if (result && result[0] && result[0].avg_time) {
        averageProcessingTimeMs = parseFloat(result[0].avg_time) * 1000;
      }
    } catch (e) {
      console.error('Error calculating avg time', e);
    }

    // === Enhanced data ===

    // Compliance rate: (COMPLETED tasks without VIOLATION) / COMPLETED tasks * 100
    let complianceRate = 0;
    try {
      const completedTaskIds = await prisma.task.findMany({
        where: { status: 'COMPLETED' },
        select: { id: true },
      });
      const completedTotal = completedTaskIds.length;
      if (completedTotal > 0) {
        const tasksWithViolation = await prisma.taskDetail.groupBy({
          by: ['taskId'],
          where: {
            taskId: { in: completedTaskIds.map(t => t.id) },
            issueType: 'VIOLATION',
          },
        });
        const violationTaskCount = tasksWithViolation.length;
        complianceRate = Math.round(((completedTotal - violationTaskCount) / completedTotal) * 10000) / 100;
      }
    } catch (e) {
      console.error('Error calculating compliance rate', e);
    }

    // Issues by severity
    let issuesBySeverity: { error: number; warning: number; info: number } = { error: 0, warning: 0, info: 0 };
    try {
      const severityCount = await prisma.taskDetail.groupBy({
        by: ['severity'],
        _count: { id: true },
      });
      severityCount.forEach((item) => {
        if (item.severity === 'error' || item.severity === 'warning' || item.severity === 'info') {
          issuesBySeverity[item.severity] = item._count.id;
        }
      });
    } catch (e) {
      console.error('Error calculating issues by severity', e);
    }

    // Unhandled high-severity issues aggregated by department
    let unhandledHigh: { deptName: string; count: number; taskIds: string[] }[] = [];
    try {
      const highIssues = await prisma.taskDetail.findMany({
        where: {
          severity: 'error',
          isFalsePositive: false,
        },
        include: {
          task: {
            include: {
              creator: {
                include: {
                  department: true,
                },
              },
            },
          },
        },
      });
      const deptMap = new Map<string, { deptName: string; count: number; taskIds: Set<string> }>();
      highIssues.forEach((issue) => {
        const deptName = issue.task.creator?.department?.name || '未分配部门';
        if (!deptMap.has(deptName)) {
          deptMap.set(deptName, { deptName, count: 0, taskIds: new Set<string>() });
        }
        const entry = deptMap.get(deptName)!;
        entry.count += 1;
        entry.taskIds.add(issue.taskId);
      });
      unhandledHigh = Array.from(deptMap.values()).map((entry) => ({
        deptName: entry.deptName,
        count: entry.count,
        taskIds: Array.from(entry.taskIds),
      }));
    } catch (e) {
      console.error('Error calculating unhandled high issues', e);
    }

    // Compared to last period (current month vs previous month)
    let comparedToLastPeriod = { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 };
    try {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = thisMonthStart;

      // This month task count
      const thisMonthTasks = await prisma.task.count({
        where: { createdAt: { gte: thisMonthStart } },
      });
      // Last month task count
      const lastMonthTasks = await prisma.task.count({
        where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
      });
      comparedToLastPeriod.tasksDelta = lastMonthTasks > 0
        ? Math.round(((thisMonthTasks - lastMonthTasks) / lastMonthTasks) * 10000) / 100
        : thisMonthTasks > 0 ? 100 : 0;

      // This month compliance rate
      const thisMonthCompleted = await prisma.task.findMany({
        where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } },
        select: { id: true },
      });
      const lastMonthCompleted = await prisma.task.findMany({
        where: { status: 'COMPLETED', createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
        select: { id: true },
      });

      let thisCompliance = 0;
      if (thisMonthCompleted.length > 0) {
        const thisViolations = await prisma.taskDetail.groupBy({
          by: ['taskId'],
          where: { taskId: { in: thisMonthCompleted.map(t => t.id) }, issueType: 'VIOLATION' },
        });
        thisCompliance = Math.round(((thisMonthCompleted.length - thisViolations.length) / thisMonthCompleted.length) * 10000) / 100;
      }

      let lastCompliance = 0;
      if (lastMonthCompleted.length > 0) {
        const lastViolations = await prisma.taskDetail.groupBy({
          by: ['taskId'],
          where: { taskId: { in: lastMonthCompleted.map(t => t.id) }, issueType: 'VIOLATION' },
        });
        lastCompliance = Math.round(((lastMonthCompleted.length - lastViolations.length) / lastMonthCompleted.length) * 10000) / 100;
      }
      comparedToLastPeriod.complianceDelta = Math.round((thisCompliance - lastCompliance) * 100) / 100;

      // Avg time comparison
      const thisAvgResult: any = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_time
        FROM "tasks"
        WHERE status = 'COMPLETED' AND "createdAt" >= ${thisMonthStart}
      `;
      const lastAvgResult: any = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_time
        FROM "tasks"
        WHERE status = 'COMPLETED' AND "createdAt" >= ${lastMonthStart} AND "createdAt" < ${lastMonthEnd}
      `;
      const thisAvg = (thisAvgResult?.[0]?.avg_time ? parseFloat(thisAvgResult[0].avg_time) : 0) * 1000;
      const lastAvg = (lastAvgResult?.[0]?.avg_time ? parseFloat(lastAvgResult[0].avg_time) : 0) * 1000;
      comparedToLastPeriod.avgTimeDelta = lastAvg > 0
        ? Math.round(((thisAvg - lastAvg) / lastAvg) * 10000) / 100
        : 0;
    } catch (e) {
      console.error('Error calculating compared to last period', e);
    }

    return {
      taskStats,
      issueStats,
      frequentTypos,
      topViolations,
      departmentStats,
      averageProcessingTimeMs,
      complianceRate,
      issues: {
        by_severity: issuesBySeverity,
      },
      unhandledHigh,
      comparedToLastPeriod,
    };
  }

  /**
   * 获取当前用户的个人统计
   */
  async getPersonalStats(userId: string) {
    // 1. My tasks by status
    const myTasksCount = await prisma.task.groupBy({
      by: ['status'],
      where: { creatorId: userId },
      _count: { id: true },
    });

    const by_status: Record<string, number> = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    let myTasksTotal = 0;
    myTasksCount.forEach((item) => {
      by_status[item.status] = item._count.id;
      myTasksTotal += item._count.id;
    });

    // 2. Personal compliance rate
    let complianceRate = 0;
    try {
      const myCompleted = await prisma.task.findMany({
        where: { creatorId: userId, status: 'COMPLETED' },
        select: { id: true },
      });
      if (myCompleted.length > 0) {
        const myViolationTasks = await prisma.taskDetail.groupBy({
          by: ['taskId'],
          where: {
            taskId: { in: myCompleted.map(t => t.id) },
            issueType: 'VIOLATION',
          },
        });
        complianceRate = Math.round(((myCompleted.length - myViolationTasks.length) / myCompleted.length) * 10000) / 100;
      }
    } catch (e) {
      console.error('Error calculating personal compliance rate', e);
    }

    // 3. Pending issues (top 5 unhandled)
    let pendingIssues: { id: string; fileName: string; severity: string; description: string | null }[] = [];
    try {
      const issues = await prisma.taskDetail.findMany({
        where: {
          task: { creatorId: userId },
          isFalsePositive: false,
          issueType: 'VIOLATION',
        },
        include: {
          file: {
            select: { fileName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      pendingIssues = issues.map((issue) => ({
        id: issue.id,
        fileName: issue.file?.fileName || '未知文件',
        severity: issue.severity,
        description: issue.description,
      }));
    } catch (e) {
      console.error('Error fetching pending issues', e);
    }

    // 4. Average processing time for user's completed tasks
    let avgProcessingTimeMs = 0;
    try {
      const result: any = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_time
        FROM "tasks"
        WHERE status = 'COMPLETED' AND "creatorId" = ${userId}
      `;
      if (result && result[0] && result[0].avg_time) {
        avgProcessingTimeMs = parseFloat(result[0].avg_time) * 1000;
      }
    } catch (e) {
      console.error('Error calculating personal avg processing time', e);
    }

    return {
      myTasks: { total: myTasksTotal, by_status },
      complianceRate,
      pendingIssues,
      avgProcessingTimeMs,
    };
  }

  /**
   * 获取审查趋势数据（近N天的任务数和问题数）
   */
  async getTrend(days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // 按天分组统计任务数
    const taskTrendRaw: any = await prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "tasks"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    // 按天分组统计问题数
    const issueTrendRaw: any = await prisma.$queryRaw`
      SELECT DATE(td."createdAt") as date, COUNT(*)::int as count
      FROM "task_details" td
      WHERE td."createdAt" >= ${since}
      GROUP BY DATE(td."createdAt")
      ORDER BY date ASC
    `;

    const task_trend = taskTrendRaw.map((row: any) => ({
      date: row.date instanceof Date ? row.date.toISOString().substring(0, 10) : String(row.date),
      count: row.count,
    }));

    const issue_trend = issueTrendRaw.map((row: any) => ({
      date: row.date instanceof Date ? row.date.toISOString().substring(0, 10) : String(row.date),
      count: row.count,
    }));

    return { task_trend, issue_trend };
  }
}
