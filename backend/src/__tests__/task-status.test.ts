/**
 * 任务状态转换单元测试
 * 覆盖 updateTaskStatus 中的状态机校验逻辑
 */

// Mock TaskService
const mockTaskService = {
  getTaskById: jest.fn(),
  updateTaskStatus: jest.fn(),
};
jest.mock('../services/task.service', () => ({
  TaskService: mockTaskService,
}));

// Mock response utils
const mockSuccess = jest.fn();
const mockError = jest.fn();
jest.mock('../utils/response', () => ({
  success: (...args: any[]) => mockSuccess(...args),
  error: (...args: any[]) => mockError(...args),
}));

import { updateTaskStatus } from '../controllers/task.controller';
import type { AuthRequest } from '../middlewares/auth.middleware';
import { Response } from 'express';

describe('updateTaskStatus 状态转换校验', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      params: { id: 'task-1' },
      body: {},
      user: { id: 'admin-1', role: 'ADMIN' },
    };
    mockRes = {};
  });

  // ===== 无效状态值 =====

  it('缺少 status 返回 400', async () => {
    mockReq.body = {};
    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);
    expect(mockError).toHaveBeenCalledWith(expect.anything(), '无效的任务状态', 400);
  });

  it('无效 status 值返回 400', async () => {
    mockReq.body = { status: 'INVALID_STATUS' };
    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);
    expect(mockError).toHaveBeenCalledWith(expect.anything(), '无效的任务状态', 400);
  });

  // ===== 任务不存在 =====

  it('任务不存在返回 404', async () => {
    mockReq.body = { status: 'PROCESSING' };
    mockTaskService.getTaskById.mockResolvedValue(null);
    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);
    expect(mockError).toHaveBeenCalledWith(expect.anything(), '未找到该任务', 404);
  });

  // ===== 合法状态转换 =====

  it.each([
    ['PENDING', 'PROCESSING'],
    ['PENDING', 'FAILED'],
    ['PROCESSING', 'COMPLETED'],
    ['PROCESSING', 'FAILED'],
    ['FAILED', 'PENDING'],
  ])('允许 %s → %s', async (from, to) => {
    mockReq.body = { status: to };
    mockTaskService.getTaskById.mockResolvedValue({ id: 'task-1', status: from });
    mockTaskService.updateTaskStatus.mockResolvedValue({ id: 'task-1', status: to });

    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);

    expect(mockTaskService.updateTaskStatus).toHaveBeenCalledWith('task-1', to);
    expect(mockSuccess).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  // ===== 非法状态转换 =====

  it.each([
    ['PENDING', 'COMPLETED'],   // 不能跳过 PROCESSING
    ['PROCESSING', 'PENDING'],  // 不能回退
    ['COMPLETED', 'PENDING'],   // 终态不可转换
    ['COMPLETED', 'PROCESSING'],// 终态不可转换
    ['COMPLETED', 'FAILED'],    // 终态不可转换
    ['FAILED', 'COMPLETED'],    // 失败不能直接完成
    ['FAILED', 'PROCESSING'],   // 失败必须先回到 PENDING
  ])('拒绝 %s → %s', async (from, to) => {
    mockReq.body = { status: to };
    mockTaskService.getTaskById.mockResolvedValue({ id: 'task-1', status: from });

    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);

    expect(mockError).toHaveBeenCalledWith(
      expect.anything(),
      `不允许从 ${from} 转换到 ${to}`,
      400,
    );
    expect(mockTaskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  // ===== 异常处理 =====

  it('服务层异常返回 500', async () => {
    mockReq.body = { status: 'PROCESSING' };
    mockTaskService.getTaskById.mockRejectedValue(new Error('DB connection lost'));

    await updateTaskStatus(mockReq as AuthRequest, mockRes as Response);

    expect(mockError).toHaveBeenCalledWith(expect.anything(), '服务器内部错误', 500);
  });
});
