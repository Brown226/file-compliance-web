/**
 * RBAC 权限单元测试
 * 覆盖 canAccessTask / checkTaskAccess 中间件
 */

// 阻断所有外部依赖的导入链
vi.mock('../../config/db', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    taskDetail: { findUnique: vi.fn() },
    department: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../config/env', () => ({
  env: { redisUrl: 'redis://localhost:6379', jwtSecret: 'test', jwtExpiresIn: '1d' },
}));

vi.mock('../../utils/redis', () => ({
  redisClient: { get: vi.fn(), set: vi.fn(), del: vi.fn(), on: vi.fn() },
}));

vi.mock('../auth.middleware', () => ({
  authenticate: vi.fn((req: any, res: any, next: any) => next()),
}));

vi.mock('../../services/auth/token.service', () => ({
  TokenService: { verifyToken: vi.fn() },
}));

import prisma from '../../config/db';
import { canAccessTask, checkTaskAccess, checkDetailAccess, clearSubDeptCache } from '../rbac.middleware';
import { Response } from 'express';

const mockPrisma = prisma as any;

describe('canAccessTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSubDeptCache();
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
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1' });

    const result = await canAccessTask(manager, 'user-in-dept');
    expect(result).toBe(true);
  });

  it('MANAGER 可以访问子部门成员创建的任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: 'dept-1' };
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'dept-child-1' },
      { id: 'dept-child-2' },
    ]);
    mockPrisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-child-1' });

    const result = await canAccessTask(manager, 'user-in-child');
    expect(result).toBe(true);
  });

  it('MANAGER 不能访问其他部门创建的任务', async () => {
    const manager = { id: 'mgr-1', role: 'MANAGER', departmentId: 'dept-1' };
    mockPrisma.$queryRaw.mockResolvedValue([]);
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
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks()
    clearSubDeptCache();
    mockReq = {
      params: { id: 'task-1' },
      user: { id: 'user-1', role: 'USER', departmentId: 'dept-1' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
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

describe('checkDetailAccess 中间件（误报/采纳归属校验，高危修复）', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSubDeptCache();
    mockReq = {
      params: { detailId: 'detail-1' },
      user: { id: 'user-1', role: 'USER', departmentId: 'dept-1' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    // 默认：detail 存在且属于 user-1 的任务
    mockPrisma.taskDetail.findUnique.mockResolvedValue({ taskId: 'task-1' });
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'user-1' });
  });

  it('缺少 detailId 返回 400', async () => {
    mockReq.params = {};
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('问题条目不存在返回 404', async () => {
    mockPrisma.taskDetail.findUnique.mockResolvedValue(null);
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('条目所属任务不存在返回 404', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('他人任务的问题条目返回 403（高危修复核心场景）', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'other-user' });
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('本人任务的问题条目调用 next() 并透传 taskId', async () => {
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.taskId).toBe('task-1');
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('ADMIN 可访问任意任务的问题条目', async () => {
    mockReq.user = { id: 'admin-1', role: 'ADMIN', departmentId: null };
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: 'someone-else' });
    await checkDetailAccess(mockReq, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
