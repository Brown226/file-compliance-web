/**
 * compare_knowledge 单元测试（P2-⑩ 多文档对比问答）
 *
 * 覆盖：
 * - 两文档均有相关片段 → llmCompare 输出结论/条目（一致/不一致/缺失）
 * - A 有 B 无 → 「文档B 未检索到」提示（无片段分支）
 * - 双方均无片段 → 「未检索到可比对内容」
 * - LLM 返回非 JSON → 降级返回片段统计
 * - 路径越权拒绝 / 文件不存在报错
 * - embedding 失败降级关键词筛选（无片段时不报错）
 *
 * 通过 mock parseDocument / EmbeddingService / LlmService 隔离外部依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const parseDocumentMock = vi.fn();
const embedTextMock = vi.fn();
const embedTextsMock = vi.fn();
const chatMock = vi.fn();

vi.mock('../../file/parse-document', () => ({
  parseDocument: (...args: any[]) => parseDocumentMock(...args),
  isPlainTextExt: (ext: string) => true,
  PLAIN_TEXT_EXTS: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'],
}));

vi.mock('../../../../knowledge/embedding.service', () => ({
  EmbeddingService: {
    embedText: (...args: any[]) => embedTextMock(...args),
    embedTexts: (...args: any[]) => embedTextsMock(...args),
  },
}));

vi.mock('../../../../llm/llm.service', () => ({
  LlmService: { chat: (...args: any[]) => chatMock(...args) },
}));

import { createCompareKnowledgeTool } from '../compare_knowledge';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-cmpkb';
const SESSION_ID = 'session-1';
const FILES_DIR = path.join(TEST_ROOT, TEST_USER, SESSION_ID, 'docs');

function makeFile(name: string, content: string): string {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const fp = path.join(FILES_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createCompareKnowledgeTool(ctx);

beforeEach(() => {
  parseDocumentMock.mockReset();
  embedTextMock.mockReset();
  embedTextsMock.mockReset();
  chatMock.mockReset();
});

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('正常比对', () => {
  it('双方有相关片段 → LLM 比对输出结论与条目', async () => {
    const a = makeFile('a.txt', '接地电阻不应大于 1 欧姆。\n\n其他要求。');
    const b = makeFile('b.txt', '接地电阻不应大于 4 欧姆。\n\n其他要求。');
    // embedding 失败 → 降级关键词筛选
    embedTextMock.mockRejectedValue(new Error('embedding down'));
    parseDocumentMock.mockResolvedValue({ text: '', structure: { paragraphs: ['接地电阻不应大于 1 欧姆。', '其他要求。'] }, pageCount: 1 });
    chatMock.mockResolvedValue(
      '{"conclusion":"接地电阻要求不一致","items":[{"topic":"接地电阻","status":"inconsistent","docAText":"1 欧姆","docBText":"4 欧姆"}]}',
    );

    const result = await tool.execute({ query: '接地电阻', docAPath: a, docBPath: b, topNumber: 5 }, {} as any);
    expect(result.conclusion).toBe('接地电阻要求不一致');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ topic: '接地电阻', status: 'inconsistent', docAText: '1 欧姆', docBText: '4 欧姆' });
    expect(result.totalCompared).toBe(1);
  });

  it('A 有 B 无 → 提示 B 未检索到，不调 LLM', async () => {
    const a = makeFile('a2.txt', '有内容');
    const b = makeFile('b2.txt', '完全无关的内容');
    parseDocumentMock.mockResolvedValueOnce({ text: '', structure: { paragraphs: ['有相关表述'] }, pageCount: 1 });
    parseDocumentMock.mockResolvedValueOnce({ text: '', structure: { paragraphs: ['无关内容'] }, pageCount: 1 });
    const result = await tool.execute({ query: '消防疏散', docAPath: a, docBPath: b }, {} as any);
    expect(result.conclusion).toContain('未检索到');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('双方均无相关片段 → 「未检索到可比对内容」', async () => {
    const a = makeFile('a3.txt', '无关');
    const b = makeFile('b3.txt', '无关');
    parseDocumentMock.mockResolvedValue({ text: '', structure: { paragraphs: ['无关键词'] }, pageCount: 1 });
    const result = await tool.execute({ query: '量子计算', docAPath: a, docBPath: b }, {} as any);
    expect(result.conclusion).toBe('未检索到可比对内容');
    expect(result.totalCompared).toBe(0);
  });

  it('LLM 返回非 JSON → 降级返回片段统计', async () => {
    const a = makeFile('a4.txt', '接地电阻 1 欧姆');
    const b = makeFile('b4.txt', '接地电阻 4 欧姆');
    parseDocumentMock.mockResolvedValue({ text: '', structure: { paragraphs: ['接地电阻 1 欧姆', '接地电阻 4 欧姆'] }, pageCount: 1 });
    chatMock.mockResolvedValue('抱歉，我无法回答');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await tool.execute({ query: '接地电阻', docAPath: a, docBPath: b }, {} as any);
      expect(result.conclusion).toContain('LLM 比对失败');
      expect(result.items).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('安全与边界', () => {
  it('路径越权（非 agent_temp）→ 拒绝', async () => {
    const evil = path.join(process.env.TEMP || '/tmp', 'evil-cmp.txt');
    fs.writeFileSync(evil, 'x', 'utf-8');
    try {
      await expect(
        tool.execute({ query: 'q', docAPath: evil, docBPath: evil }, {} as any),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });

  it('文件不存在 → 报错', async () => {
    const missing = path.join(FILES_DIR, 'missing.txt');
    await expect(
      tool.execute({ query: 'q', docAPath: missing, docBPath: missing }, {} as any),
    ).rejects.toThrow('不存在');
  });
});
