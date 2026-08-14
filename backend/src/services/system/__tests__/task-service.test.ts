/**
 * TaskService.reReviewTask 回归测试（整改报告 P0-1）
 *
 * 覆盖 2026-08-14 修复：
 * 1. 主动重审必须同时清除 review_stages（此前只删 taskDetail，
 *    ai/DEC 阶段命中旧 DONE 记录会复用旧轮裁剪 payload → 新旧结果混排）；
 * 2. SELF_CHECK 任务重审直接拒绝（handler 是 stub，重审会产出"无问题"假合规信号）。
 */

const { mockFindUnique, mockDetailDeleteMany, mockStageDeleteMany, mockFileUpdateMany, mockTaskUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockDetailDeleteMany: vi.fn(),
  mockStageDeleteMany: vi.fn(),
  mockFileUpdateMany: vi.fn(),
  mockTaskUpdate: vi.fn(),
}));

vi.mock('../../../config/db', () => ({
  default: {
    task: { findUnique: mockFindUnique, update: mockTaskUpdate },
    taskDetail: { deleteMany: mockDetailDeleteMany },
    reviewStage: { deleteMany: mockStageDeleteMany },
    taskFile: { updateMany: mockFileUpdateMany },
  },
}));

vi.mock('../queue.service', () => ({
  addReviewJob: vi.fn().mockResolvedValue(undefined),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from '../task.service';

describe('TaskService.reReviewTask（P0-1：重审清阶段 + SELF_CHECK 拒绝）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskUpdate.mockResolvedValue({ id: 't1', status: 'PROCESSING' });
  });

  it('重审时删除 taskDetail 且同时清除 review_stages（主动重审 = 全新阶段）', async () => {
    mockFindUnique.mockResolvedValue({ id: 't1', reviewMode: 'LIBRARY_REVIEW' });
    mockDetailDeleteMany.mockResolvedValue({ count: 3 });
    mockStageDeleteMany.mockResolvedValue({ count: 5 });
    mockFileUpdateMany.mockResolvedValue({ count: 1 });

    const result = await TaskService.reReviewTask('t1');

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 't1' }, select: { reviewMode: true } });
    expect(mockDetailDeleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    expect(mockStageDeleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    expect(mockFileUpdateMany).toHaveBeenCalledWith({ where: { taskId: 't1' }, data: { errorCount: 0 } });
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'PROCESSING' } });
    expect(result.status).toBe('PROCESSING');
  });

  it('SELF_CHECK 任务重审直接拒绝，不执行任何删除', async () => {
    mockFindUnique.mockResolvedValue({ id: 't1', reviewMode: 'SELF_CHECK' });

    await expect(TaskService.reReviewTask('t1')).rejects.toThrow('SELF_CHECK 任务使用独立执行端点，不支持重新审查');

    expect(mockDetailDeleteMany).not.toHaveBeenCalled();
    expect(mockStageDeleteMany).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});
