/**
 * compare_documents 单元测试（P0-① 文档对比）
 *
 * 覆盖：
 * - 完全相同文档 → totalChanges=0 / stats 全 0
 * - 仅空白差异 → 不误报为修改（modified=0，验收标准 3）
 * - 新增/删除段落识别
 * - stats 统计正确
 * - 变更 >30 时跳过 LLM 摘要（省 token）
 * - LLM 摘要成功 / 失败降级（不阻断）
 * - withSummary=false 不调 LLM
 * - 文件不存在报错
 * - 路径越权拒绝（非 agent_temp / 非本用户目录）
 *
 * 通过 mock parseDocument 构造段落结构（不触发 doc-parser HTTP），
 * mock LlmService（generateChangeSummary 惰性 require 命中）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// —— Mock parseDocument（构造段落结构）——
const parseDocumentMock = vi.fn();
vi.mock('../parse-document', () => ({
  parseDocument: (...args: any[]) => parseDocumentMock(...args),
  isPlainTextExt: (ext: string) => true,
  PLAIN_TEXT_EXTS: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'],
}));

// —— Mock LlmService.chat（摘要生成；generateChangeSummary 用惰性 require 加载）——
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock('../../../../llm/llm.service', () => ({
  default: { chat: chatMock },
  LlmService: { chat: chatMock },
}));

import { createCompareDocumentsTool } from '../compare_documents';

// 构造合法 agent_temp 目录（路径校验依赖它）
const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-cmp';
const SESSION_DIR = path.join(TEST_ROOT, TEST_USER, 'session-1');
const FILES_DIR = path.join(SESSION_DIR, 'cmp-files');

function makeFile(name: string, content: string): string {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const fp = path.join(FILES_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: 'session-1' };

function buildTool() {
  return createCompareDocumentsTool(ctx);
}

async function runCompare(oldContent: string, newContent: string, withSummary = true) {
  const oldPath = makeFile('old.txt', oldContent);
  const newPath = makeFile('new.txt', newContent);
  // 默认按空行切分：纯文本直接读（mock 的 parseDocument 用空行结构）
  parseDocumentMock.mockReset();
  parseDocumentMock.mockResolvedValueOnce({ text: oldContent, structure: {}, pageCount: 1 });
  parseDocumentMock.mockResolvedValueOnce({ text: newContent, structure: {}, pageCount: 1 });
  const result = await buildTool().execute(
    { oldFilePath: oldPath, newFilePath: newPath, withSummary },
    { toolCallId: 'tc1', messages: [], context: {} } as any,
  );
  return result;
}

beforeEach(() => {
  parseDocumentMock.mockReset();
  chatMock.mockReset();
  chatMock.mockResolvedValue('摘要内容');
});

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('无差异场景', () => {
  it('完全相同文档 → totalChanges=0，stats 全 0', async () => {
    const text = '第一章 总则\n\n第二条 适用范围\n\n第三条 术语定义';
    const result = await runCompare(text, text);
    expect(result.totalChanges).toBe(0);
    expect(result.stats).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 3 });
  });

  it('仅空白差异 → 不误报为修改（modified=0，totalChanges=0）', async () => {
    const oldText = '付款期限：合同签订后 30 日\n\n违约责任：按日万分之五';
    const newText = '付款期限：合同签订后30日\n\n违约责任：按日万分之五';
    const result = await runCompare(oldText, newText);
    expect(result.totalChanges).toBe(0);
    expect(result.stats.modified).toBe(0);
  });
});

describe('差异识别', () => {
  it('新增段落 → added，旧段落删除 → removed', async () => {
    const oldText = '第一条 目的\n\n第二条 范围';
    const newText = '第一条 目的\n\n第二条 范围\n\n第三条 新增条款';
    const result = await runCompare(oldText, newText);
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    expect(result.changes.some((c: any) => c.type === 'added' && (c.newText || '').includes('第三条'))).toBe(true);
  });

  it('实质内容修改 → 呈现为 removed+added 配对（非误报为 modified）', async () => {
    const oldText = '保修期限：2 年\n\n其他条款不变';
    const newText = '保修期限：3 年\n\n其他条款不变';
    const result = await runCompare(oldText, newText);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.added + result.stats.removed).toBeGreaterThanOrEqual(1);
    expect(result.totalChanges).toBeGreaterThan(0);
  });

  it('stats 统计与实际 changes 一致', async () => {
    const oldText = 'A\n\nB\n\nC';
    const newText = 'A\n\nB2\n\nC\n\nD';
    const result = await runCompare(oldText, newText);
    expect(result.stats.added).toBe(result.changes.filter((c: any) => c.type === 'added').length);
    expect(result.stats.removed).toBe(result.changes.filter((c: any) => c.type === 'removed').length);
    expect(result.totalChanges).toBe(result.changes.length);
  });
});

describe('LLM 摘要', () => {
  it('变更数在 1~30 之间时生成摘要', async () => {
    const oldText = 'A\n\nB\n\nC';
    const newText = 'A\n\nB\n\nC\n\nD';
    const result = await runCompare(oldText, newText);
    expect(chatMock).toHaveBeenCalled();
    expect(result.summary).toBe('摘要内容');
  });

  it('变更 >30 时自动跳过摘要（不调 LLM）', async () => {
    const oldText = Array.from({ length: 40 }, (_, i) => `段落${i}`).join('\n\n');
    const newText = Array.from({ length: 40 }, (_, i) => `段落${i}改`).join('\n\n');
    const result = await runCompare(oldText, newText);
    expect(result.totalChanges).toBeGreaterThan(30);
    expect(chatMock).not.toHaveBeenCalled();
    expect(result.summary).toBeUndefined();
  });

  it('LLM 摘要失败 → summary undefined，不抛错', async () => {
    chatMock.mockRejectedValue(new Error('llm down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const oldText = 'A\n\nB';
      const newText = 'A\n\nB\n\nC';
      const result = await runCompare(oldText, newText);
      expect(result.summary).toBeUndefined();
      expect(warnSpy.mock.calls[0][0]).toContain('LLM 摘要生成失败');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('withSummary=false 不调 LLM', async () => {
    const oldText = 'A\n\nB';
    const newText = 'A\n\nB\n\nC';
    const result = await runCompare(oldText, newText, false);
    expect(chatMock).not.toHaveBeenCalled();
    expect(result.summary).toBeUndefined();
  });
});

describe('安全与边界', () => {
  it('文件不存在 → 报错', async () => {
    const bad = path.join(FILES_DIR, 'not-exist.txt');
    await expect(
      buildTool().execute(
        { oldFilePath: bad, newFilePath: bad, withSummary: false },
        {} as any,
      ),
    ).rejects.toThrow('文件不存在');
  });

  it('路径越权（非 agent_temp 目录）→ 拒绝', async () => {
    const evil = path.join(process.env.TEMP || '/tmp', 'outside.txt');
    fs.writeFileSync(evil, 'x', 'utf-8');
    try {
      await expect(
        buildTool().execute(
          { oldFilePath: evil, newFilePath: evil, withSummary: false },
          {} as any,
        ),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });

  it('路径越权（其他用户目录）→ 拒绝', async () => {
    const otherUserDir = path.join(TEST_ROOT, 'another-user', 'f.txt');
    fs.mkdirSync(path.dirname(otherUserDir), { recursive: true });
    fs.writeFileSync(otherUserDir, 'x', 'utf-8');
    try {
      await expect(
        buildTool().execute(
          { oldFilePath: otherUserDir, newFilePath: otherUserDir, withSummary: false },
          {} as any,
        ),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(path.join(TEST_ROOT, 'another-user'), { recursive: true, force: true });
    }
  });

  it('输出文本字段带 <file_content> 防注入包裹', async () => {
    const oldText = '第一段';
    const newText = '第一段\n\n新增段';
    const result = await runCompare(oldText, newText);
    const added = result.changes.find((c: any) => c.type === 'added');
    expect(added.newText).toContain('<file_content>');
    expect(added.newText).toContain('</file_content>');
  });
});
