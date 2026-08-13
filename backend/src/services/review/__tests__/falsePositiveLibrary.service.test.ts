// FalsePositiveLibraryService 测试（误报库同步/移除/批量检查）
// - syncFromTaskDetail：已存在 → update 计数+1；不存在 → create
// - remove：count<=1 删除；count>1 减计数；不存在返回 null
// - batchCheck：批量命中返回 Map
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FalsePositiveLibraryService from '../falsePositiveLibrary.service';
import db from '../../../config/db';

describe('FalsePositiveLibraryService.syncFromTaskDetail', () => {
  let findFirstMock: ReturnType<typeof vi.spyOn>;
  let updateMock: ReturnType<typeof vi.spyOn>;
  let createMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findFirstMock = vi.spyOn(db.falsePositiveLibrary, 'findFirst');
    updateMock = vi.spyOn(db.falsePositiveLibrary, 'update');
    createMock = vi.spyOn(db.falsePositiveLibrary, 'create');
    findFirstMock.mockReset();
    updateMock.mockReset();
    createMock.mockReset();
  });

  afterEach(() => {
    findFirstMock.mockRestore();
    updateMock.mockRestore();
    createMock.mockRestore();
  });

  it('原文已存在时走 update：计数+1、更新时间、有原因则更新原因', async () => {
    findFirstMock.mockResolvedValue({ id: 'fp-1', count: 2, fpReason: '旧原因', originalText: '重复文本' } as any);
    updateMock.mockResolvedValue({ id: 'fp-1', count: 3 } as any);
    await FalsePositiveLibraryService.syncFromTaskDetail({ originalText: '重复文本', fpReason: '新原因' });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    const args = updateMock.mock.calls[0][0];
    expect(args.data.count).toBe(3); // 2 + 1
    expect(args.data.fpReason).toBe('新原因');
  });

  it('原文已存在且无新原因时保留旧原因', async () => {
    findFirstMock.mockResolvedValue({ id: 'fp-1', count: 1, fpReason: '旧原因', originalText: '文本' } as any);
    await FalsePositiveLibraryService.syncFromTaskDetail({ originalText: '文本' });
    const args = updateMock.mock.calls[0][0];
    expect(args.data.fpReason).toBe('旧原因');
  });

  it('原文不存在时走 create 并写入完整字段', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 'fp-new' } as any);
    await FalsePositiveLibraryService.syncFromTaskDetail({
      originalText: '新原文',
      fpReason: '原因',
      issueType: 'TYPO',
      ruleCode: 'TYPO-1',
      severity: 'warning',
      markedById: 'u1',
      markedByName: '用户甲',
      taskId: 'task-1',
      taskTitle: '任务标题',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0];
    expect(args.data.originalText).toBe('新原文');
    expect(args.data.ruleCode).toBe('TYPO-1');
    expect(args.data.markedByName).toBe('用户甲');
  });
});

describe('FalsePositiveLibraryService.remove', () => {
  let findFirstMock: ReturnType<typeof vi.spyOn>;
  let deleteMock: ReturnType<typeof vi.spyOn>;
  let updateMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findFirstMock = vi.spyOn(db.falsePositiveLibrary, 'findFirst');
    deleteMock = vi.spyOn(db.falsePositiveLibrary, 'delete');
    updateMock = vi.spyOn(db.falsePositiveLibrary, 'update');
    findFirstMock.mockReset();
    deleteMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    findFirstMock.mockRestore();
    deleteMock.mockRestore();
    updateMock.mockRestore();
  });

  it('记录不存在时返回 null（不删除不报错）', async () => {
    findFirstMock.mockResolvedValue(null);
    const result = await FalsePositiveLibraryService.remove('不存在的文本');
    expect(result).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('count=1 时直接删除记录', async () => {
    findFirstMock.mockResolvedValue({ id: 'fp-1', count: 1, originalText: '文本' } as any);
    deleteMock.mockResolvedValue({ id: 'fp-1' } as any);
    await FalsePositiveLibraryService.remove('文本');
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('count>1 时减少计数而非删除', async () => {
    findFirstMock.mockResolvedValue({ id: 'fp-1', count: 3, originalText: '文本' } as any);
    updateMock.mockResolvedValue({ id: 'fp-1', count: 2 } as any);
    await FalsePositiveLibraryService.remove('文本');
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
    const args = updateMock.mock.calls[0][0];
    expect(args.data.count).toBe(2); // 3 - 1
  });
});

describe('FalsePositiveLibraryService.batchCheck', () => {
  let findManyMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findManyMock = vi.spyOn(db.falsePositiveLibrary, 'findMany');
    findManyMock.mockReset();
  });

  afterEach(() => {
    findManyMock.mockRestore();
  });

  it('命中文本映射为 true，未命中为 false', async () => {
    findManyMock.mockResolvedValue([
      { originalText: '已知误报 A', count: 1 },
      { originalText: '已知误报 B', count: 2 },
    ] as any);
    const result = await FalsePositiveLibraryService.batchCheck(['已知误报 A', '新文本', '已知误报 B']);
    expect(result.get('已知误报 A')).toBe(true);
    expect(result.get('已知误报 B')).toBe(true);
    expect(result.get('新文本')).toBe(false);
  });
});
