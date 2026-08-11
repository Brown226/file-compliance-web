import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../config/db';

/**
 * 角色权限等级：ADMIN > MANAGER > USER
 * ADMIN: 可看全局数据
 * MANAGER: 可看本部门及下属部门数据
 * USER: 只能看自己的数据
 */

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: '未认证用户' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: '没有操作权限' });
      return;
    }

    next();
  };
};

/**
 * 根据角色过滤任务查询的 where 条件
 * - ADMIN: 无限制
 * - MANAGER: 本部门及下属部门
 * - USER: 仅自己的
 */
export const getTaskFilterByRole = async (user: any): Promise<any> => {
  if (user.role === 'ADMIN') {
    return {}; // 管理员看全部
  }

  if (user.role === 'MANAGER' && user.departmentId) {
    // 获取本部门及所有下属部门ID
    const departmentIds = await getSubDepartmentIds(user.departmentId);
    departmentIds.push(user.departmentId);

    return {
      creator: {
        departmentId: { in: departmentIds },
      },
    };
  }

  // 普通用户只看自己的
  return {
    creatorId: user.id,
  };
};

/**
 * 递归获取所有下属部门ID
 *
 * 用 PostgreSQL 递归 CTE 一次查完整棵子树，替代原先按层递归的 N+1 查询。
 * 部门树结构变化不频繁，结果加 30s 进程内缓存（只读、短 TTL，容许少量陈旧）。
 */
const SUBDEPT_CACHE_TTL_MS = 30_000;
const subDeptCache = new Map<string, { ids: string[]; expireAt: number }>();

/** 清空子部门缓存（部门结构变更时调用，测试中也用于隔离用例） */
export function clearSubDeptCache(): void {
  subDeptCache.clear();
}

async function getSubDepartmentIds(parentId: string): Promise<string[]> {
  const now = Date.now();
  const cached = subDeptCache.get(parentId);
  if (cached && cached.expireAt > now) {
    return cached.ids;
  }

  // 递归 CTE：一次查询取回整棵子树（不含 parentId 自身）
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM departments WHERE "parentId" = ${parentId}
      UNION ALL
      SELECT d.id FROM departments d
      INNER JOIN subtree s ON d."parentId" = s.id
    )
    SELECT id FROM subtree
  `;
  const ids = rows.map((r) => r.id);

  subDeptCache.set(parentId, { ids, expireAt: now + SUBDEPT_CACHE_TTL_MS });
  return ids;
}

/**
 * 检查用户是否有权访问某个资源（如员工信息）
 * - ADMIN: 全部
 * - MANAGER: 本部门及下属部门的员工
 * - USER: 仅自己
 */
export const canAccessUser = async (currentUser: any, targetUserId: string): Promise<boolean> => {
  if (currentUser.role === 'ADMIN') return true;
  if (currentUser.id === targetUserId) return true;

  if (currentUser.role === 'MANAGER' && currentUser.departmentId) {
    const departmentIds = await getSubDepartmentIds(currentUser.departmentId);
    departmentIds.push(currentUser.departmentId);

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { departmentId: true },
    });

    if (targetUser && targetUser.departmentId && departmentIds.includes(targetUser.departmentId)) {
      return true;
    }
  }

  return false;
};

/**
 * 检查用户是否有权访问某个任务
 * - ADMIN: 全部
 * - MANAGER: 本部门及下属部门创建的任务
 * - USER: 仅自己创建的任务
 */
export const canAccessTask = async (currentUser: any, taskCreatorId: string): Promise<boolean> => {
  if (currentUser.role === 'ADMIN') return true;
  if (currentUser.id === taskCreatorId) return true;

  if (currentUser.role === 'MANAGER' && currentUser.departmentId) {
    const departmentIds = await getSubDepartmentIds(currentUser.departmentId);
    departmentIds.push(currentUser.departmentId);

    const taskCreator = await prisma.user.findUnique({
      where: { id: taskCreatorId },
      select: { departmentId: true },
    });

    if (taskCreator && taskCreator.departmentId && departmentIds.includes(taskCreator.departmentId)) {
      return true;
    }
  }

  return false;
};

/**
 * Express 中间件：检查当前用户是否有权访问指定任务
 * 需要从 req.params.id 获取 taskId
 */
export const checkTaskAccess = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    if (!taskId) {
      res.status(400).json({ error: '缺少任务ID' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { creatorId: true },
    });

    if (!task) {
      res.status(404).json({ error: '未找到该任务' });
      return;
    }

    const hasAccess = await canAccessTask(req.user, task.creatorId);
    if (!hasAccess) {
      res.status(403).json({ error: '无权访问该任务' });
      return;
    }

    next();
  } catch (err) {
    console.error('Check Task Access Error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * Express 中间件：检查当前用户是否有权访问某问题条目（误报/采纳等按 detailId 定位的写操作）
 *
 * URL 无 taskId（如 PATCH /tasks/details/:detailId/false-positive），
 * 需从 detailId 反查 TaskDetail → task.creatorId → canAccessTask 归属校验。
 * 修复高危：此前该类端点仅 authenticate，任意用户猜到 detailId 可篡改任意任务结果。
 */
export const checkDetailAccess = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const detailId = req.params.detailId as string;
    if (!detailId) {
      res.status(400).json({ error: '缺少问题条目ID' });
      return;
    }

    const detail = await prisma.taskDetail.findUnique({
      where: { id: detailId },
      select: { taskId: true },
    });

    if (!detail) {
      res.status(404).json({ error: '未找到该问题条目' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id: detail.taskId },
      select: { creatorId: true },
    });

    if (!task) {
      res.status(404).json({ error: '未找到该任务' });
      return;
    }

    const hasAccess = await canAccessTask(req.user, task.creatorId);
    if (!hasAccess) {
      res.status(403).json({ error: '无权访问该任务的问题条目' });
      return;
    }

    // 透传 taskId，供 controller 复用（避免重复查询）
    (req as any).taskId = detail.taskId;
    next();
  } catch (err) {
    console.error('Check Detail Access Error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
