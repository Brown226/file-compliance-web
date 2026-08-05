/**
 * draft_document 单元测试（P1-⑤ 文档起草）
 *
 * 覆盖：
 * - title 必填校验
 * - 拼 prompt（标题/大纲/参考资料）调 LlmService.chat
 * - saveToDisk=false → 不写盘
 * - saveToDisk=true → 写 .md 到会话 reports 目录
 * - fileName 清洗（路径分隔符/危险字符）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const chatMock = vi.fn();
vi.mock('../../../../llm/llm.service', () => ({
  LlmService: { chat: (...args: any[]) => chatMock(...args) },
}));

import { createDraftDocumentTool } from '../draft_document';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-draft';
const SESSION_ID = 'session-1';
// 存储结构改为日期目录：agent_temp/{userId}/{YYYY-MM-DD}/reports（与 getTodayDir 本地时区一致）
const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createDraftDocumentTool(ctx);

beforeEach(() => {
  chatMock.mockReset();
  chatMock.mockResolvedValue('# 管理制度\n\n第一章 总则\n\n（初稿内容）');
});

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('起草逻辑', () => {
  it('title 必填 → 报错', async () => {
    await expect(tool.execute({ title: '' }, {} as any)).rejects.toThrow('title 必填');
    await expect(tool.execute({ title: '   ' }, {} as any)).rejects.toThrow('title 必填');
  });

  it('拼 prompt 调用 chat（含标题/大纲/参考资料）', async () => {
    const result = await tool.execute(
      { title: '采购管理制度', outline: ['总则', '采购流程'], references: '依据 GB/T 19001' },
      {} as any,
    );
    expect(chatMock).toHaveBeenCalledTimes(1);
    const [prompt, options] = chatMock.mock.calls[0];
    expect(prompt).toContain('采购管理制度');
    expect(prompt).toContain('1. 总则');
    expect(prompt).toContain('2. 采购流程');
    expect(prompt).toContain('GB/T 19001');
    expect(options).toMatchObject({ maxTokens: 3000 });
    expect(result.title).toBe('采购管理制度');
    expect(result.content).toContain('# 管理制度');
    expect(result.chars).toBeGreaterThan(0);
  });

  it('无大纲/无参考资料时给出占位文案', async () => {
    await tool.execute({ title: '简单文档' }, {} as any);
    const [prompt] = chatMock.mock.calls[0];
    expect(prompt).toContain('（无大纲');
    expect(prompt).toContain('（无参考资料）');
  });
});

describe('saveToDisk', () => {
  it('saveToDisk=false → 不写盘，无 filePath', async () => {
    const result = await tool.execute({ title: '不保存' }, {} as any);
    expect(result.filePath).toBeUndefined();
    expect(fs.existsSync(path.join(TEST_ROOT, TEST_USER))).toBe(false);
  });

  it('saveToDisk=true → 写 .md 到 reports 目录', async () => {
    const result = await tool.execute({ title: '管理制度', saveToDisk: true }, {} as any);
    expect(result.filePath).toBeTruthy();
    expect(result.filePath).toContain(path.join(TEST_USER, TODAY, 'reports'));
    expect(result.filePath).toMatch(/管理制度\.md$/);
    const content = fs.readFileSync(result.filePath!, 'utf-8');
    expect(content).toBe('# 管理制度\n\n第一章 总则\n\n（初稿内容）');
  });

  it('fileName 清洗：路径分隔符被替换', async () => {
    const result = await tool.execute(
      { title: 't', fileName: '../恶意/名字', saveToDisk: true },
      {} as any,
    );
    expect(result.filePath).not.toContain('..');
    expect(result.filePath).toMatch(/\.md$/);
  });
});
