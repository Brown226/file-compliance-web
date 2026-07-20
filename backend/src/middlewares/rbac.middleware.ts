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
 */
async function getSubDepartmentIds(parentId: string): Promise<string[]> {
  const children = await prisma.department.findMany({
    where: { parentId },
    select: { id: true },
  });

  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    const subIds = await getSubDepartmentIds(child.id);
    ids.push(...subIds);
  }
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
