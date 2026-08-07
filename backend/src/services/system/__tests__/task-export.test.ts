/**
 * exportTaskReport 口径单元测试
 *
 * 覆盖 2026-08 修复：
 * - 概览 sheet 错误数排除 NO_RESULT / REVIEW_SUMMARY（此前含这两类，与页面/文件 sheet 口径矛盾）
 * - 状态中文映射（此前输出英文枚举）
 * - 明细 sheet 新增"复核状态/误报标记"列
 */

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock('../../../config/db', () => ({
  default: {
    task: { findUnique: mockFindUnique },
  },
}));

import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { TaskService } from '../task.service';

function makeTask(): any {
  const base = {
    id: 't1',
    title: '测试任务',
    status: 'COMPLETED',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    creator: { id: 'u1', username: 'admin', name: '张三' },
    files: [
      { id: 'f1', fileName: 'a.pdf', fileType: 'pdf', fileSize: 1024, errorCount: 1 },
    ],
  };
  const details = [
    {
      id: 'd1', taskId: 't1', fileId: 'f1',
      issueType: 'VIOLATION', ruleCode: 'STD_001', severity: 'error',
      originalText: 'GB/T 5000', suggestedText: 'GB/T 50001-2017',
      description: '标准编号有误', cadHandleId: null,
      reviewStatus: 'PENDING_REVIEW', isFalsePositive: false,
      file: { id: 'f1', fileName: 'a.pdf' },
    },
    // 应被排除：NO_RESULT 占位
    {
      id: 'd2', taskId: 't1', fileId: 'f1',
      issueType: 'INFO', ruleCode: 'NO_RESULT', severity: 'info',
      originalText: '', suggestedText: null, description: '该文件未发现问题',
      cadHandleId: null, reviewStatus: null, isFalsePositive: false,
      file: { id: 'f1', fileName: 'a.pdf' },
    },
    // 应被排除：REVIEW_SUMMARY 统计条目
    {
      id: 'd3', taskId: 't1', fileId: 'f1',
      issueType: 'REVIEW_SUMMARY', ruleCode: 'SUMMARY', severity: 'info',
      originalText: '', suggestedText: null, description: '{"total":3}',
      cadHandleId: null, reviewStatus: null, isFalsePositive: false,
      file: { id: 'f1', fileName: 'a.pdf' },
    },
    // 误报条目：保留但带标记（此前无标记列）
    {
      id: 'd4', taskId: 't1', fileId: 'f1',
      issueType: 'TYPO', ruleCode: 'TYPO_001', severity: 'warning',
      originalText: '帐号', suggestedText: '账号', description: '错别字',
      cadHandleId: null, reviewStatus: 'CONFIRMED', isFalsePositive: true,
      file: { id: 'f1', fileName: 'a.pdf' },
    },
  ];
  return { ...base, details };
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb;
}

describe('TaskService.exportTaskReport 口径', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(makeTask());
  });

  it('概览错误数排除 NO_RESULT 与 REVIEW_SUMMARY（2026-08 修复）', async () => {
    const buffer = await TaskService.exportTaskReport('t1');
    const wb = await loadWorkbook(buffer);
    const overview = wb.getWorksheet('任务概览');
    const row = overview!.getRow(2);
    // 4 条 detail 中 2 条被排除 → 错误数 = 2
    expect(row.getCell(6).value).toBe(2);
  });

  it('状态输出中文映射（2026-08 修复）', async () => {
    const buffer = await TaskService.exportTaskReport('t1');
    const wb = await loadWorkbook(buffer);
    const row = wb.getWorksheet('任务概览')!.getRow(2);
    expect(row.getCell(3).value).toBe('已完成');
  });

  it('明细 sheet 只含有效条目并带复核状态/误报标记列', async () => {
    const buffer = await TaskService.exportTaskReport('t1');
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('审查结果明细')!;
    // header + 2 条有效（d1 VIOLATION、d4 TYPO）
    expect(sheet.rowCount).toBe(3);
    // 表头含新增列
    const headerRow = sheet.getRow(1);
    const headers = Array.from({ length: headerRow.cellCount }, (_, i) => headerRow.getCell(i + 1).value);
    expect(headers).toContain('复核状态');
    expect(headers).toContain('误报标记');
    // 数据行：误报标记为"是"的行存在
    let fpMarked = 0;
    for (let r = 2; r <= sheet.rowCount; r++) {
      if (sheet.getRow(r).getCell(10).value === '是') fpMarked++;
    }
    expect(fpMarked).toBe(1);
  });

  it('任务不存在时抛错', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(TaskService.exportTaskReport('nope')).rejects.toThrow('Task not found');
  });
});
