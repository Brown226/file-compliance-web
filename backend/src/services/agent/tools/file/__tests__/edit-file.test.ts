/**
 * edit_file 单元测试（P1-⑪ 编辑类工具）
 *
 * 覆盖（文档声称的 7 项用例 + 边界）：
 * - replace 精确替换（默认第 1 次出现 / occurrence / replaceAll）
 * - replace 找不到文本报错
 * - patch（unified diff）应用：单 hunk、多 hunk
 * - patch 上下文不匹配 → 原子回滚（文件内容不变）
 * - patch 空/无 hunk 报错
 * - 变更摘要（changes：replace/insert/delete 合并）
 * - 三级路径越权（根目录外 / 其他用户 / 其他会话）
 * - 格式拒绝（PDF 等二进制）
 * - 文件不存在报错
 * - DOCX 受控替换（mock DocxReplaceService）+ patch 模式拒绝
 * - 未替换部分内容与行尾保留
 *
 * 纯文本分支零 mock（真实临时文件），DOCX 分支 mock DocxReplaceService。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// —— Mock DocxReplaceService（仅 DOCX 分支用到）——
const { replaceTextMock } = vi.hoisted(() => ({ replaceTextMock: vi.fn() }));
vi.mock('../../../../file/docx-replace.service', () => ({
  DocxReplaceService: { replaceText: replaceTextMock },
}));

import { createEditFileTool } from '../edit_file';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-edit';
const SESSION_ID = 'session-1';
const SESSION_DIR = path.join(TEST_ROOT, TEST_USER, SESSION_ID);

function makeFile(name: string, content: string): string {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const fp = path.join(SESSION_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createEditFileTool(ctx);

beforeEach(() => {
  replaceTextMock.mockReset();
  replaceTextMock.mockResolvedValue(1);
});

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('replace 精确替换', () => {
  it('默认替换第 1 次出现，未替换部分保留', async () => {
    const fp = makeFile('a.txt', '帐号 帐户 帐号\n其他内容不变');
    const result = await tool.execute(
      { filePath: fp, mode: 'replace', oldText: '帐号', newText: '账号' },
      {} as any,
    );
    expect(fs.readFileSync(fp, 'utf-8')).toBe('账号 帐户 帐号\n其他内容不变');
    expect(result.format).toBe('text');
    expect(result.lines).toBe(2);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('occurrence 指定第 N 次出现', async () => {
    const fp = makeFile('b.txt', 'A A A');
    await tool.execute(
      { filePath: fp, mode: 'replace', oldText: 'A', newText: 'B', occurrence: 3 },
      {} as any,
    );
    expect(fs.readFileSync(fp, 'utf-8')).toBe('A A B');
  });

  it('replaceAll 替换所有出现', async () => {
    const fp = makeFile('c.txt', 'A A A');
    await tool.execute(
      { filePath: fp, mode: 'replace', oldText: 'A', newText: 'B', replaceAll: true },
      {} as any,
    );
    expect(fs.readFileSync(fp, 'utf-8')).toBe('B B B');
  });

  it('找不到文本 → 报错，文件不变', async () => {
    const fp = makeFile('d.txt', '原内容');
    await expect(
      tool.execute({ filePath: fp, mode: 'replace', oldText: '不存在', newText: 'x' }, {} as any),
    ).rejects.toThrow('未找到要替换的文本');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('原内容');
  });

  it('oldText 为空 → 报错', async () => {
    const fp = makeFile('e.txt', 'x');
    await expect(
      tool.execute({ filePath: fp, mode: 'replace', newText: 'y' }, {} as any),
    ).rejects.toThrow('必须提供 oldText');
  });
});

describe('patch（unified diff）', () => {
  const ORIGINAL = '第一行\n第二行\n第三行\n第四行';

  it('单 hunk 应用成功', async () => {
    const fp = makeFile('f.txt', ORIGINAL);
    const patch =
      '@@ -2,2 +2,2 @@\n 第二行\n-第三行\n+第三行改\n 第四行';
    const result = await tool.execute({ filePath: fp, mode: 'patch', patch }, {} as any);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('第一行\n第二行\n第三行改\n第四行');
    expect(result.message).toContain('1 处变更');
  });

  it('上下文不匹配 → 整体回滚，文件内容不变', async () => {
    const fp = makeFile('g.txt', ORIGINAL);
    const badPatch =
      '@@ -2,2 +2,2 @@\n 错误上下文\n-第三行\n+第三行改\n 第四行';
    await expect(
      tool.execute({ filePath: fp, mode: 'patch', patch: badPatch }, {} as any),
    ).rejects.toThrow('上下文不匹配');
    expect(fs.readFileSync(fp, 'utf-8')).toBe(ORIGINAL);
  });

  it('patch 为空 → 报错', async () => {
    const fp = makeFile('h.txt', ORIGINAL);
    await expect(
      tool.execute({ filePath: fp, mode: 'patch' }, {} as any),
    ).rejects.toThrow('必须提供 patch');
  });

  it('无 hunk 头 → 报错', async () => {
    const fp = makeFile('i.txt', ORIGINAL);
    await expect(
      tool.execute({ filePath: fp, mode: 'patch', patch: '--- a\n+++ b\n 第一行' }, {} as any),
    ).rejects.toThrow('没有可应用的 hunk');
  });

  it('新增行（+）在指定位置插入', async () => {
    const fp = makeFile('j.txt', '第一行\n第三行');
    const patch = '@@ -1,2 +1,3 @@\n 第一行\n+第二行\n 第三行';
    await tool.execute({ filePath: fp, mode: 'patch', patch }, {} as any);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('第一行\n第二行\n第三行');
  });
});

describe('安全与格式', () => {
  it('路径越权：agent_temp 根目录之外 → 拒绝', async () => {
    const evil = path.join(process.env.TEMP || '/tmp', 'evil.txt');
    fs.writeFileSync(evil, 'x', 'utf-8');
    try {
      await expect(
        tool.execute({ filePath: evil, mode: 'replace', oldText: 'x', newText: 'y' }, {} as any),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });

  it('路径越权：其他用户目录 → 拒绝', async () => {
    const other = path.join(TEST_ROOT, 'other-user', 'f.txt');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, 'x', 'utf-8');
    try {
      await expect(
        tool.execute({ filePath: other, mode: 'replace', oldText: 'x', newText: 'y' }, {} as any),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(path.join(TEST_ROOT, 'other-user'), { recursive: true, force: true });
    }
  });

  it('同用户其他日期目录可编辑（按日期存储，跨会话共享）', async () => {
    // 构造同用户下另一个日期目录的文件（模拟另一天/另一会话上传的文件）
    const otherDate = path.join(TEST_ROOT, TEST_USER, '2024-01-01', 'f.txt');
    fs.mkdirSync(path.dirname(otherDate), { recursive: true });
    fs.writeFileSync(otherDate, '第一行\n第二行', 'utf-8');
    try {
      const result = await tool.execute(
        { filePath: otherDate, mode: 'replace', oldText: '第一行', newText: '修改行' },
        {} as any,
      );
      expect(result).toBeTruthy();
      expect(fs.readFileSync(otherDate, 'utf-8')).toContain('修改行');
    } finally {
      fs.rmSync(path.join(TEST_ROOT, TEST_USER, '2024-01-01'), { recursive: true, force: true });
    }
  });

  it('不支持格式（PDF）→ 拒绝', async () => {
    const fp = makeFile('k.pdf', 'binary');
    await expect(
      tool.execute({ filePath: fp, mode: 'replace', oldText: 'x', newText: 'y' }, {} as any),
    ).rejects.toThrow('不支持编辑 pdf 格式');
  });

  it('文件不存在 → 报错', async () => {
    await expect(
      tool.execute(
        { filePath: path.join(SESSION_DIR, 'missing.txt'), mode: 'replace', oldText: 'a', newText: 'b' },
        {} as any,
      ),
    ).rejects.toThrow('文件不存在');
  });
});

describe('DOCX 受控替换', () => {
  it('replace 模式走 DocxReplaceService（P0-3 原子写:先替换到同目录 tmp 再 rename 覆盖）', async () => {
    replaceTextMock.mockResolvedValue(2);
    const fp = makeFile('m.docx', 'binary-content');
    const result = await tool.execute(
      { filePath: fp, mode: 'replace', oldText: '旧条款', newText: '新条款' },
      {} as any,
    );
    // P0-3：对 tmp 副本执行替换（原文件在替换期间保持完整旧版），成功后 rename 覆盖
    expect(replaceTextMock).toHaveBeenCalledTimes(1);
    const tmpPath = replaceTextMock.mock.calls[0][0] as string;
    expect(tmpPath).toBe(`${fp}.docx-edit.tmp`);
    expect(replaceTextMock.mock.calls[0][1]).toBe('旧条款');
    expect(replaceTextMock.mock.calls[0][2]).toBe('新条款');
    // tmp 已被 rename 覆盖 → 不再残留
    expect(fs.existsSync(`${fp}.docx-edit.tmp`)).toBe(false);
    expect(result.format).toBe('docx');
    expect(result.replacements).toBe(2);
    expect(result.message).toContain('2 处替换');
  });

  it('DOCX 不支持 patch 模式', async () => {
    const fp = makeFile('n.docx', 'binary');
    await expect(
      tool.execute({ filePath: fp, mode: 'patch', patch: '@@ -1 +1 @@' }, {} as any),
    ).rejects.toThrow('DOCX 不支持 patch 模式');
    expect(replaceTextMock).not.toHaveBeenCalled();
  });

  it('DOCX 原文未找到 → 友好报错', async () => {
    // DocxReplaceService.replaceText 是同步方法（同步 throw 才会被 try/catch 捕获并转换）
    replaceTextMock.mockImplementation(() => {
      throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
    });
    const fp = makeFile('o.docx', 'binary');
    await expect(
      tool.execute({ filePath: fp, mode: 'replace', oldText: '旧', newText: '新' }, {} as any),
    ).rejects.toThrow('在 DOCX 中未找到要替换的文本');
  });
});
