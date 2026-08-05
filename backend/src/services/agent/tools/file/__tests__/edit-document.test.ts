/**
 * edit_document 单元测试（计划任务 5 编辑类工具 — 业务语义包装）
 *
 * edit_document 是 edit_file 的一行包装（descriptionOverride），
 * 覆盖：描述覆盖生效 + 委托给 edit_file 的编辑能力仍可用。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

import { createEditDocumentTool } from '../edit_document';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-editdoc';
const SESSION_ID = 'session-1';
const SESSION_DIR = path.join(TEST_ROOT, TEST_USER, SESSION_ID);

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createEditDocumentTool(ctx);

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('edit_document（edit_file 业务包装）', () => {
  it('描述覆盖为「修改文档」业务语义', () => {
    expect(tool.description).toContain('修改文档');
    expect(tool.description).toContain('工作流第 11 步');
  });

  it('replace 模式委托 edit_file 执行并修改文件', async () => {
    const dir = path.join(SESSION_DIR, 'docs');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'a.md');
    fs.writeFileSync(fp, '合同付款期限为 30 日。', 'utf-8');
    const result = await tool.execute(
      { filePath: fp, mode: 'replace', oldText: '30 日', newText: '60 日' },
      {} as any,
    );
    expect(fs.readFileSync(fp, 'utf-8')).toBe('合同付款期限为 60 日。');
    expect(result.message).toContain('已编辑');
  });

  it('路径越权仍生效（与 edit_file 同款约束）', async () => {
    const evil = path.join(process.env.TEMP || '/tmp', 'evil-doc.md');
    fs.writeFileSync(evil, 'x', 'utf-8');
    try {
      await expect(
        tool.execute({ filePath: evil, mode: 'replace', oldText: 'x', newText: 'y' }, {} as any),
      ).rejects.toThrow('路径越权');
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });
});
