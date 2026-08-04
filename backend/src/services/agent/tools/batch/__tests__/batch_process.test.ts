/**
 * batch_process 单元测试（P1-②）
 *
 * 覆盖 runBatchProcess 核心逻辑：
 * - 路径校验（越权拒绝）
 * - 多文件并行处理、子任务分发（extract/chunk/summarize/review/knowledge）
 * - 单文件失败隔离（不影响其他文件）
 * - 输出结构（total/succeeded/failed/results）
 *
 * 通过 mock 隔离 parseDocument / LlmService / getChunkConcurrency。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// 构造合法的 agent_temp 目录（路径校验依赖它）
const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-1';
const USER_DIR = path.join(TEST_ROOT, TEST_USER);

// —— Mock parseDocument ——
const parseDocumentMock = vi.fn();
vi.mock('../../file/parse-document', () => ({
  parseDocument: (...args: any[]) => parseDocumentMock(...args),
  isPlainTextExt: (ext: string) => ['txt', 'md', 'csv'].includes(ext.toLowerCase()),
  PLAIN_TEXT_EXTS: ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'],
}));

// —— Mock LlmService（splitText / chat / reviewText）——
const splitTextMock = vi.fn();
const chatMock = vi.fn();
const reviewTextMock = vi.fn();
vi.mock('../../../../llm/llm.service', () => ({
  LlmService: {
    splitText: (...args: any[]) => splitTextMock(...args),
    chat: (...args: any[]) => chatMock(...args),
    reviewText: (...args: any[]) => reviewTextMock(...args),
  },
}));

// —— Mock getChunkConcurrency ——
vi.mock('../../../../utils/system-config', () => ({
  getChunkConcurrency: vi.fn().mockResolvedValue(4),
}));

import { runBatchProcess } from '../batch_process';
import type { ToolContext } from '../../file/upload_file';

const ctx: ToolContext = { userId: TEST_USER, sessionId: 'session-1' };

function makeFile(name: string): string {
  // 在测试根目录下建文件（路径校验通过需要真实存在）
  const dir = path.join(USER_DIR, 'test-batch');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'line1\nline2\n', 'utf-8');
  return fp;
}

beforeEach(() => {
  parseDocumentMock.mockReset();
  splitTextMock.mockReset();
  chatMock.mockReset();
  reviewTextMock.mockReset();
  parseDocumentMock.mockImplementation(async () => ({
    text: 'line1\nline2',
    structure: {},
    pageCount: 1,
  }));
  splitTextMock.mockImplementation((text: string, size: number) => [text]);
  chatMock.mockResolvedValue('摘要内容');
  reviewTextMock.mockResolvedValue([
    { issueType: 'TYPO', originalText: 'line1', description: '拼写', severity: 'warning' },
  ]);
});

describe('runBatchProcess (P1-②)', () => {
  it('路径越权拒绝（非 agent_temp 目录）', async () => {
    const evilPath = path.join(process.env.TEMP || '/tmp', 'outside.txt');
    fs.writeFileSync(evilPath, 'x', 'utf-8');
    await expect(
      runBatchProcess([{ filePath: evilPath, tasks: ['extract'] }], ctx),
    ).rejects.toThrow(/路径越权/);
  });

  it('extract 子任务返回文本长度', async () => {
    const fp = makeFile('a.txt');
    const result = await runBatchProcess([{ filePath: fp, tasks: ['extract'] }], ctx);
    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].extract).toEqual({ textLength: 11, pages: 1 });
  });

  it('chunk 子任务返回分块数', async () => {
    const fp = makeFile('b.txt');
    splitTextMock.mockImplementation(() => ['c1', 'c2', 'c3']);
    const result = await runBatchProcess([{ filePath: fp, tasks: ['chunk'] }], ctx);
    expect(result.results[0].chunk).toEqual({ count: 3, totalChars: 11 });
  });

  it('review 子任务调用 reviewText 并映射结果', async () => {
    const fp = makeFile('c.txt');
    const result = await runBatchProcess([{ filePath: fp, tasks: ['review'] }], ctx);
    expect(reviewTextMock).toHaveBeenCalled();
    expect(result.results[0].review).toEqual({
      issueCount: 1,
      issues: [{ issueType: 'TYPO', severity: 'warning', description: '拼写' }],
    });
  });

  it('路径预校验：文件不存在时整个批次抛错（非隔离路径）', async () => {
    const goodFp = makeFile('good.txt');
    const badFp = path.join(USER_DIR, 'not-exist.txt'); // 不存在 → 预校验抛错
    await expect(
      runBatchProcess(
        [{ filePath: goodFp, tasks: ['extract'] }, { filePath: badFp, tasks: ['extract'] }],
        ctx,
      ),
    ).rejects.toThrow(/文件不存在/);
  });

  it('子任务异常被降级捕获（doReview 内部 catch），不阻断批次且结果为空', async () => {
    const badFp = makeFile('bad.txt');
    // reviewText 抛错 → doReview 内部 catch → 返回空 review 结果，文件仍标记成功
    reviewTextMock.mockRejectedValueOnce(new Error('llm down'));
    const result = await runBatchProcess([{ filePath: badFp, tasks: ['review'] }], ctx);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].ok).toBe(true);
    // review 降级为空结果（不抛错，不阻断批次）
    expect(result.results[0].review).toEqual({ issueCount: 0, issues: [] });
  });

  it('文件级异常（parseDocument 抛错）时该文件标记失败，其他文件成功（隔离）', async () => {
    const goodFp = makeFile('good3.txt');
    const badFp = makeFile('bad2.txt');
    // 让 bad2.txt 的 parseDocument 抛错（文件级异常 → res.ok=false）
    parseDocumentMock
      .mockResolvedValueOnce({ text: 'good text', structure: {}, pageCount: 1 }) // good3
      .mockRejectedValueOnce(new Error('parse failed')); // bad2
    const result = await runBatchProcess(
      [
        { filePath: goodFp, tasks: ['extract'] },
        { filePath: badFp, tasks: ['extract'] },
      ],
      ctx,
    );
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1].ok).toBe(false);
    expect(result.results[1].error).toBe('parse failed');
  });

  it('输出结构完整（total/succeeded/failed/results）', async () => {
    const fp = makeFile('d.txt');
    const result = await runBatchProcess([{ filePath: fp, tasks: ['extract', 'chunk'] }], ctx);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
  });
});
