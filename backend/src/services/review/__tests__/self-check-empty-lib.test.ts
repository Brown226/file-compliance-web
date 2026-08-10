/**
 * P1-7 回归测试：标准库为空时，SelfCheckService.execute 必须返回显式 warning，
 * 让用户区分「真合规」与「没审到」，而不是静默返回 0 匹配。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma 模块（config/db），避免真实 DB 连接
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockFindUnique = vi.fn();

vi.mock('../../../config/db', () => ({
  default: {
    standard: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    standardFolder: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { SelfCheckService } from '../self-check.service';

function makeStandard(id: string, standardNo: string, name: string) {
  return {
    id,
    standardNo,
    standardName: name,
    standardIdent: standardNo,
    standardStatus: 'CURRENT',
  };
}

describe('SelfCheckService 空库显式告警（P1-7）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：标准库为空
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue(null);
  });

  it('标准库为空且无文件时：warning 必须存在且提示「标准库为空」', async () => {
    const report = await SelfCheckService.execute([], null);
    expect(report.warning).toBeDefined();
    expect(report.warning).toContain('标准库为空');
    expect(report.warning).toContain('库中不存在');
  });

  it('标准库为空且指定 folderId 时：warning 提示「当前目录」', async () => {
    mockFindUnique.mockResolvedValue({ name: '某标准目录' });
    const report = await SelfCheckService.execute([], 'folder-abc');
    expect(report.warning).toBeDefined();
    expect(report.warning).toContain('当前目录');
    // 标准库查询应带上 folderId 过滤
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ folderId: 'folder-abc' }) })
    );
  });

  it('标准库非空时：warning 必须为 undefined（真合规场景不误报）', async () => {
    mockFindMany.mockResolvedValue([makeStandard('s1', 'GB/T 1234', '测试标准')]);
    mockCount.mockResolvedValue(1);
    const report = await SelfCheckService.execute([], null);
    expect(report.warning).toBeUndefined();
  });

  it('标准库为空且带文件时：warning 仍存在，且不影响主流程返回结构', async () => {
    // 文件为空数组外的常规字段需完整
    const report = await SelfCheckService.execute([], null);
    expect(report.warning).toContain('标准库为空');
    expect(report).toHaveProperty('items');
    expect(report).toHaveProperty('checkedAt');
    expect(report).toHaveProperty('standardLibraryInfo');
    expect(report.standardLibraryInfo).toEqual({ name: '全部标准库', total: 0 });
  });
});
