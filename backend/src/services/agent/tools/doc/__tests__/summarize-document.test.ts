/**
 * summarize_document 单元测试（P1-④ 文档摘要）
 *
 * 覆盖：
 * - quick：逐块 chat 摘要 → summary/keyPoints/outline
 * - detailed：分块上限（前 8 块）
 * - 单块失败跳过（不阻断其他块）
 * - 全部块失败 → 「（摘要生成失败）」
 * - 空文本 → 「（文档无文本）」
 * - 文件不存在报错 / 路径越权拒绝
 *
 * 通过 mock parseDocument + LlmService 隔离解析与 LLM。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const parseDocumentMock = vi.fn();
const chatMock = vi.fn();
const splitTextMock = vi.fn();

vi.mock('../file/parse-document', () => ({
  parseDocument: (...args: any[]) => parseDocumentMock(...args),
  isPlainTextExt: (ext: string) => true,
  PLAIN_TEXT_EXTS: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'],
}));

vi.mock('../../../../llm/llm.service', () => ({
  LlmService: {
    chat: (...args: any[]) => chatMock(...args),
    splitText: (...args: any[]) => splitTextMock(...args),
  },
}));

import { createSummarizeDocumentTool } from '../summarize_document';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-sum';
const SESSION_ID = 'session-1';
const FILES_DIR = path.join(TEST_ROOT, TEST_USER, SESSION_ID, 'docs');

function makeFile(name: string, content: string): string {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const fp = path.join(FILES_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createSummarizeDocumentTool(ctx);

beforeEach(() => {
  parseDocumentMock.mockReset();
  chatMock.mockReset();
  splitTextMock.mockReset();
  parseDocumentMock.mockResolvedValue({ text: '第一章 概述\n\n第二章 范围', structure: {}, pageCount: 1 });
  splitTextMock.mockImplementation((text: string) => ['块1', '块2', '块3']);
  chatMock.mockImplementation(async (prompt: string) => `摘要：${prompt.slice(0, 20)}`);
});

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('摘要生成', () => {
  it('quick：逐块摘要 → summary + keyPoints + outline', async () => {
    const fp = makeFile('a.txt', '内容');
    const result = await tool.execute({ filePath: fp, level: 'quick' }, {} as any);
    expect(chatMock).toHaveBeenCalled();
    expect(result.level).toBe('quick');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.keyPoints).toHaveLength(3);
    expect(result.outline).toBeDefined();
    expect(Array.isArray(result.outline)).toBe(true);
  });

  it('detailed：分块上限为 8', async () => {
    splitTextMock.mockImplementation(() => Array.from({ length: 10 }, (_, i) => `块${i}`));
    const fp = makeFile('b.txt', 'x');
    const result = await tool.execute({ filePath: fp, level: 'detailed' }, {} as any);
    expect(chatMock).toHaveBeenCalledTimes(8);
    expect(result.level).toBe('detailed');
  });

  it('单块失败跳过，其他块正常', async () => {
    chatMock.mockImplementationOnce(async () => { throw new Error('llm down'); });
    const fp = makeFile('c.txt', 'x');
    const result = await tool.execute({ filePath: fp, level: 'quick' }, {} as any);
    // 3 块中 1 块失败 → 2 个摘要
    expect(result.keyPoints).toHaveLength(2);
    expect(result.summary).toContain('摘要');
  });

  it('全部块失败 → 「（摘要生成失败）」', async () => {
    chatMock.mockRejectedValue(new Error('llm down'));
    const fp = makeFile('d.txt', 'x');
    const result = await tool.execute({ filePath: fp, level: 'quick' }, {} as any);
    expect(result.summary).toBe('（摘要生成失败）');
    expect(result.keyPoints).toEqual([]);
  });

  it('空文本 → 「（文档无文本）」', async () => {
    parseDocumentMock.mockResolvedValueOnce({ text: '   ', structure: {}, pageCount: 1 });
    const fp = makeFile('e.txt', '');
    const result = await tool.execute({ filePath: fp, level: 'quick' }, {} as any);
    expect(result.summary).toBe('（文档无文本）');
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describe('安全与边界', () => {
  it('文件不存在 → 报错', async () => {
    await expect(
      tool.execute({ filePath: path.join(FILES_DIR, 'missing.txt'), level: 'quick' }, {} as any),
    ).rejects.toThrow('文件不存在');
  });

  it('路径越权（非 agent_temp）→ 拒绝', async () => {
    const evil = path.join(process.env.TEMP || '/tmp', 'evil-sum.txt');
    fs.writeFileSync(evil, 'x', 'utf-8');
    try {
      await expect(
        tool.execute({ filePath: evil, level: 'quick' }, {} as any),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });
});
