/**
 * extract_tables 单元测试（P1-③ 表格提取）
 *
 * 覆盖：
 * - 纯文本格式（txt/md）→ 空表格（不调 doc-parser）
 * - structure.tables 归一化（headers/rows 字符串化、sheetName/page 保留）
 * - 无表格 → { tables: [], count: 0, totalRows: 0 } 不报错
 * - sheet 过滤
 * - toCsv：RFC 4180 转义（逗号/引号/换行）、多表空行分隔
 * - 文件不存在报错
 *
 * 通过 mock parseDocument + isPlainTextExt 隔离 doc-parser。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const parseDocumentMock = vi.fn();
vi.mock('../parse-document', () => ({
  parseDocument: (...args: any[]) => parseDocumentMock(...args),
  isPlainTextExt: (ext: string) => !['xlsx', 'pdf', 'docx', 'pptx'].includes(ext.toLowerCase()),
  PLAIN_TEXT_EXTS: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'],
}));

import { createExtractTablesTool } from '../extract_tables';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-tbl';
const FILES_DIR = path.join(TEST_ROOT, TEST_USER, 'session-1', 'tbl-files');

function makeFile(name: string, content = ''): string {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const fp = path.join(FILES_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: 'session-1' };
const tool = createExtractTablesTool(ctx);

beforeEach(() => parseDocumentMock.mockReset());

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('纯文本格式', () => {
  it('txt/md 文件返回空表格，不调 doc-parser', async () => {
    const fp = makeFile('a.txt', '名称,数量\nA,1');
    const result = await tool.execute({ filePath: fp }, {} as any);
    expect(result).toEqual({ tables: [], count: 0, totalRows: 0 });
    expect(parseDocumentMock).not.toHaveBeenCalled();
  });
});

describe('二进制文档表格提取', () => {
  const xlsxPath = () => makeFile('b.xlsx', 'binary');

  it('提取 structure.tables 并归一化（数字单元格转字符串）', async () => {
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: {
        tables: [
          { sheetName: 'Sheet1', page: 2, headers: ['名称', '数量'], rows: [[1, 2], ['B', 'x']] },
        ],
      },
      pageCount: 1,
    });
    const result = await tool.execute({ filePath: xlsxPath() }, {} as any);
    expect(result.count).toBe(1);
    expect(result.tables[0]).toEqual({
      sheetName: 'Sheet1',
      page: 2,
      headers: ['名称', '数量'],
      rows: [['1', '2'], ['B', 'x']],
    });
    expect(result.totalRows).toBe(2);
  });

  it('headers 缺省/rows 非数组时容错', async () => {
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: { tables: [{ rows: [['a']] }, { headers: ['H'], rows: 'not-array' }] },
      pageCount: 1,
    });
    const result = await tool.execute({ filePath: xlsxPath() }, {} as any);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].headers).toEqual([]);
    expect(result.tables[1].rows).toEqual([]);
  });

  it('无表格 → 空结果不报错', async () => {
    parseDocumentMock.mockResolvedValueOnce({ text: '', structure: {}, pageCount: 1 });
    const result = await tool.execute({ filePath: xlsxPath() }, {} as any);
    expect(result).toEqual({ tables: [], count: 0, totalRows: 0 });
  });

  it('tableIndex 参数按 0-based 索引过滤表格', async () => {
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: {
        tables: [
          { headers: ['A'], rows: [['1']] },
          { headers: ['B'], rows: [['2']] },
        ],
      },
      pageCount: 1,
    });
    // tableIndex=1 → 取第 2 张表（0-based 索引）
    const result = await tool.execute({ filePath: xlsxPath(), tableIndex: 1 }, {} as any);
    expect(result.count).toBe(1);
    expect(result.tables[0].headers).toEqual(['B']);
    // tableIndex 超界 → 空
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: { tables: [{ headers: ['A'], rows: [['1']] }] },
      pageCount: 1,
    });
    const outOfRange = await tool.execute({ filePath: xlsxPath(), tableIndex: 5 }, {} as any);
    expect(outOfRange.count).toBe(0);
  });
});

describe('toCsv 导出', () => {
  it('RFC 4180 转义：逗号/双引号/换行字段', async () => {
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: {
        tables: [
          {
            headers: ['名称', '备注'],
            rows: [['A, B', '含"引号"'], ['C', '多\n行']],
          },
        ],
      },
      pageCount: 1,
    });
    const result = await tool.execute({ filePath: makeFile('c.xlsx'), toCsv: true }, {} as any);
    const expected =
      '名称,备注\r\n' +
      '"A, B","含""引号"""\r\n' +
      'C,"多\n行"';
    expect(result.csv).toBe(expected);
  });

  it('多表 CSV 用空行分隔', async () => {
    parseDocumentMock.mockResolvedValueOnce({
      text: '',
      structure: {
        tables: [
          { headers: ['A'], rows: [['1']] },
          { headers: ['B'], rows: [['2']] },
        ],
      },
      pageCount: 1,
    });
    const result = await tool.execute({ filePath: makeFile('d.xlsx'), toCsv: true }, {} as any);
    expect(result.csv).toBe('A\r\n1\r\n\r\nB\r\n2');
  });

  it('无表格时 toCsv 不输出 csv 字段', async () => {
    parseDocumentMock.mockResolvedValueOnce({ text: '', structure: {}, pageCount: 1 });
    const result = await tool.execute({ filePath: makeFile('e.xlsx'), toCsv: true }, {} as any);
    expect(result.csv).toBeUndefined();
  });
});

describe('边界', () => {
  it('文件不存在 → 报错', async () => {
    await expect(
      tool.execute({ filePath: path.join(FILES_DIR, 'missing.xlsx') }, {} as any),
    ).rejects.toThrow('文件不存在');
  });
});
