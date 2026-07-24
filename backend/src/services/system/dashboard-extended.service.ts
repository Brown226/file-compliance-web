/**
 * 平台运营看板扩展服务
 *
 * 提供以下 4 个维度的统计数据：
 * 1. 在线用户（基于 Redis presence 集合 + User 表）
 * 2. 活跃度趋势（DAU/WAU + 任务提交趋势，基于 Task.createdAt）
 * 3. LLM Token 用量（基于 LlmCallLog 表按天/按模型聚合）
 * 4. 部门使用度（递归子部门统计）
 */
import prisma from '../../config/db';
import { presenceService } from './presence.service';

class DashboardExtendedService {
  /**
   * 1. 在线用户
   * 返回当前在线用户列表 + 今日登录数
   */
  async getOnlineUsers() {
    const onlineUserIds = await presenceService.getOnlineUserIds();

    // 查询用户详情（仅在线用户）
    const users = onlineUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: onlineUserIds } },
          select: {
            id: true,
            name: true,
            username: true,
            role: true,
            lastLoginAt: true,
            department: { select: { name: true } },
          },
        })
      : [];

    // 今日登录数（lastLoginAt 在今天 00:00 之后）
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayLoginCount = await prisma.user.count({
      where: { lastLoginAt: { gte: todayStart } },
    });

    return {
      onlineCount: users.length,
      todayLoginCount,
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        departmentName: u.department?.name ?? null,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * 2. 活跃度趋势
   * DAU（Daily Active Users）= 当日提交任务的 distinct creatorId
   * WAU（Weekly Active Users）= 近 7 天提交任务的 distinct creatorId
   */
  async getActivity(days: number) {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    // 区间内按天聚合：每日活跃用户数 + 任务数
    const tasks = await prisma.task.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: { creatorId: true, createdAt: true },
    });

    // 按天聚合
    const dayMap = new Map<string, { activeUsers: Set<string>; taskCount: number }>();
    const dateStr = (d: Date) => d.toISOString().slice(0, 10);

    for (let i = 0; i < days; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      dayMap.set(dateStr(d), { activeUsers: new Set(), taskCount: 0 });
    }

    for (const t of tasks) {
      const key = dateStr(t.createdAt);
      const entry = dayMap.get(key);
      if (entry) {
        entry.activeUsers.add(t.creatorId);
        entry.taskCount++;
      }
    }

    const trend = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      activeUsers: v.activeUsers.size,
      taskCount: v.taskCount,
    }));

    // DAU = 今日活跃用户数
    const todayKey = dateStr(new Date());
    const dau = dayMap.get(todayKey)?.activeUsers.size ?? 0;

    // WAU = 近 7 天活跃用户数（distinct creatorId）
    const sevenDaysAgo = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const wauSet = new Set<string>();
    for (const t of tasks) {
      if (t.createdAt >= sevenDaysAgo) wauSet.add(t.creatorId);
    }
    const wau = wauSet.size;

    // 区间内 DAU 均值
    const avgDau = trend.length > 0
      ? Math.round(trend.reduce((sum, t) => sum + t.activeUsers, 0) / trend.length)
      : 0;

    const totalTasks = tasks.length;
    const distinctCreators = new Set(tasks.map(t => t.creatorId)).size;
    const avgTasksPerUser = distinctCreators > 0
      ? Math.round((totalTasks / distinctCreators) * 10) / 10
      : 0;

    return {
      days,
      metrics: { dau, wau, avgDau, totalTasks, avgTasksPerUser },
      trend,
    };
  }

  /**
   * 3. LLM Token 用量
   * 基于 LlmCallLog 表按天/按模型聚合
   */
  async getLlmUsage(days: number) {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    const logs = await prisma.llmCallLog.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: {
        model: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        latencyMs: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 汇总
    const totalCalls = logs.length;
    const totalPromptTokens = logs.reduce((s, l) => s + l.promptTokens, 0);
    const totalCompletionTokens = logs.reduce((s, l) => s + l.completionTokens, 0);
    const totalTokens = logs.reduce((s, l) => s + l.totalTokens, 0);
    const successCount = logs.filter(l => l.status === 'success').length;
    const avgLatencyMs = totalCalls > 0
      ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / totalCalls)
      : 0;

    // 按天聚合
    const dayMap = new Map<string, { calls: number; promptTokens: number; completionTokens: number; totalTokens: number }>();
    const dateStr = (d: Date) => d.toISOString().slice(0, 10);
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      dayMap.set(dateStr(d), { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    }
    for (const l of logs) {
      const key = dateStr(l.createdAt);
      const entry = dayMap.get(key);
      if (entry) {
        entry.calls++;
        entry.promptTokens += l.promptTokens;
        entry.completionTokens += l.completionTokens;
        entry.totalTokens += l.totalTokens;
      }
    }
    const byDay = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));

    // 按模型聚合
    const modelMap = new Map<string, { calls: number; totalTokens: number; latencySum: number }>();
    for (const l of logs) {
      const entry = modelMap.get(l.model) ?? { calls: 0, totalTokens: 0, latencySum: 0 };
      entry.calls++;
      entry.totalTokens += l.totalTokens;
      entry.latencySum += l.latencyMs;
      modelMap.set(l.model, entry);
    }
    const byModel = Array.from(modelMap.entries())
      .map(([model, v]) => ({
        model,
        calls: v.calls,
        totalTokens: v.totalTokens,
        avgLatencyMs: v.calls > 0 ? Math.round(v.latencySum / v.calls) : 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      days,
      summary: {
        totalCalls,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        avgLatencyMs,
        successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 1000) / 10 : 0,
      },
      byDay,
      byModel,
    };
  }

  /**
   * 4. 部门使用度
   * 按一级部门（parentId=null）聚合，递归统计子部门
   */
  async getDepartmentStats() {
    // 递归 CTE：取每个一级部门 + 其所有子部门
    const topLevelDepts = await prisma.department.findMany({
      where: { parentId: null },
      select: { id: true, name: true },
    });

    const result = await Promise.all(topLevelDepts.map(async (dept) => {
      // 递归获取所有子部门 id（含自身）
      const subDeptIds = await this.getSubDepartmentIdsRecursive(dept.id);
      const allDeptIds = [dept.id, ...subDeptIds];

      // 该部门树下的用户
      const users = await prisma.user.findMany({
        where: { departmentId: { in: allDeptIds } },
        select: { id: true },
      });
      const userIds = users.map(u => u.id);
      const userCount = userIds.length;

      // 该部门树下的任务
      const tasks = await prisma.task.findMany({
        where: { creatorId: { in: userIds } },
        select: { id: true, status: true, createdAt: true },
      });
      const taskCount = tasks.length;
      const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
      const complianceRate = taskCount > 0
        ? Math.round((completedCount / taskCount) * 1000) / 10
        : 0;

      // LLM token 用量（通过 task.creatorId 关联）
      const taskIds = tasks.map(t => t.id);
      let tokenUsage = 0;
      if (taskIds.length > 0) {
        const agg = await prisma.llmCallLog.aggregate({
          where: { taskId: { in: taskIds } },
          _sum: { totalTokens: true },
        });
        tokenUsage = agg._sum.totalTokens ?? 0;
      }

      // 最近活跃时间
      const lastTask = tasks
        .map(t => t.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const lastActiveAt = lastTask?.toISOString() ?? null;

      return {
        id: dept.id,
        name: dept.name,
        userCount,
        taskCount,
        completedCount,
        complianceRate,
        tokenUsage,
        lastActiveAt,
      };
    }));

    return {
      departments: result.sort((a, b) => b.taskCount - a.taskCount),
      totalDepartments: result.length,
    };
  }

  /**
   * 递归获取部门的所有子部门 id（不含自身）
   * 复用 rbac.middleware 的递归 CTE 逻辑
   */
  private async getSubDepartmentIdsRecursive(parentId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM departments WHERE "parentId" = ${parentId}
        UNION ALL
        SELECT d.id FROM departments d
        INNER JOIN subtree s ON d."parentId" = s.id
      )
      SELECT id FROM subtree
    `;
    return rows.map(r => r.id);
  }
}

export const dashboardExtendedService = new DashboardExtendedService();
