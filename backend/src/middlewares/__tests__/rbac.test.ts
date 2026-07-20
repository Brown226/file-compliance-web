/**
 * RBAC 权限单元测试
 * 覆盖 canAccessTask / checkTaskAccess 中间件
 */

// 阻断所有外部依赖的导入链
jest.mock('../../config/db', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    task: { findUnique: jest.fn() },
    department: { findMany: jest.fn() },
  },
}));

jest.mock('../../config/env', () => ({
  env: { redisUrl: 'redis://localhost:6379', jwtSecret: 'test', jwtExpiresIn: '1d' },
}));

jest.mock('../../utils/redis', () => ({
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn() },
}));

jest.mock('../auth.middleware', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock('../../services/token.service', () => ({
  TokenService: { verifyToken: jest.fn() },
}));

import prisma from '../../config/db';
import { canAccessTask, checkTaskAccess } from '../rbac.middleware';
import { Response } from 'express';

const mockPrisma = prisma as any;

describe('canAccessTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ADMIN 可以访问任何任务', async () => {
    const admin = { id: 'admin-1', role: 'ADMIN', departmentId: null };
    const result = await canAccessTask(admin, 'other-user-id');
    expect(result).toBe(true);
  });

  it('USER 可以访问自己创建的任务', async () => {
    const user = { id: 'user-1', role: 'USER', departmentId: 'dept-1' };
    const result = await canAccessTask(user, 'user-1');
    expect(result).toBe(true);
  });

  it('USER 不能访问他人创建的任务', async () => {
    const user = { id: 'user-1', role: 'USER', departmentId: 'dept-1' };
    const result = await canAccessTask(user, 'user-2');
    expect(result).toBe(false);
  });

  it('MANAGER 可以访问本部门成员创建的任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: 'dept-1' };
    mockPrisma.department.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1' });

    const result = await canAccessTask(manager, 'user-in-dept');
    expect(result).toBe(true);
  });

  it('MANAGER 可以访问子部门成员创建的任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: 'dept-1' };
    mockPrisma.department.findMany.mockResolvedValue([
      { id: 'dept-child-1' },
      { id: 'dept-child-2' },
    ]);
    mockPrisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-child-1' });

    const result = await canAccessTask(manager, 'user-in-child');
    expect(result).toBe(true);
  });

  it('MANAGER 不能访问其他部门创建的任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: 'dept-1' };
    mockPrisma.department.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-other' });

    const result = await canAccessTask(manager, 'user-other-dept');
    expect(result).toBe(false);
  });

  it('MANAGER 无 departmentId 时不能访问他人任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: null };
    const result = await canAccessTask(manager, 'user-2');
    expect(result).toBe(false);
  });
});

describe('checkTaskAccess 中间件', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      params: { id: 'task-1' },
      user: { id: 'user-1', role: 'USER', departmentId: 'dept-1' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('缺少 taskId 返回 400', async () => {
    mockReq.params = {};
    await checkTaskAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('任务不存在返回 404', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await checkTaskAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('无权限返回 403', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'other-user' });
    await checkTaskAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('有权限调用 next()', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'user-1' });
    await checkTaskAccess(mockReq, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('ADMIN 访问任何任务都调用 next()', async () => {
    mockReq.user = { id: 'admin-1', role: 'ADMIN', departmentId: null };
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'someone-else' });
    await checkTaskAccess(mockReq, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
