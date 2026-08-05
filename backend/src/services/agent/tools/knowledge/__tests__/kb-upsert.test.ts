/**
 * kb_upsert 单元测试（P2-⑪ 会话式知识库维护）
 *
 * 覆盖：
 * - append 模式：createTextDocument 入库 + 段落数 chunkCount
 * - update 模式：先按 source 名查旧文档删除，再重建（upsert 去重）
 * - 无同名旧文档：直接创建（不调 delete）
 * - 指定不存在的 knowledgeId → 报错（存在性/权限校验）
 * - 无可用的知识库 → 报错
 * - MaxKB 不可达（getAvailableKnowledgeBases 抛错）→ 友好报错
 * - source 缺省 → 用「Agent 入库 + 日期」文档名
 *
 * 通过 mock maxkb.service 隔离 MaxKB HTTP。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { maxkbMock } = vi.hoisted(() => ({
  maxkbMock: {
    getAvailableKnowledgeBases: vi.fn(),
    getDefaultWorkspaceId: vi.fn(),
    listDocuments: vi.fn(),
    deleteDocument: vi.fn(),
    createTextDocument: vi.fn(),
  },
}));

vi.mock('../../../../knowledge/maxkb.service', () => ({
  MaxKBService: maxkbMock,
}));

import { createKbUpsertTool } from '../kb_upsert';

const tool = createKbUpsertTool({ userId: 'u1', sessionId: 's1' });

beforeEach(() => {
  for (const fn of Object.values(maxkbMock)) (fn as any).mockReset();
  maxkbMock.getAvailableKnowledgeBases.mockResolvedValue([
    { id: 'kb-1', name: '标准库' },
    { id: 'kb-2', name: '制度库' },
  ]);
  maxkbMock.getDefaultWorkspaceId.mockResolvedValue('ws-1');
  maxkbMock.createTextDocument.mockResolvedValue([{ id: 'doc-1' }]);
});

describe('append 模式', () => {
  it('入库新文档并计算段落数', async () => {
    const result = await tool.execute(
      { content: '第一条 目的\n\n第二条 范围', source: '合同管理办法', mode: 'append' },
      {} as any,
    );
    expect(maxkbMock.createTextDocument).toHaveBeenCalledWith('ws-1', 'kb-1', {
      name: '合同管理办法',
      content: '第一条 目的\n\n第二条 范围',
    });
    expect(result.success).toBe(true);
    expect(result.knowledgeId).toBe('kb-1');
    expect(result.documentId).toBe('doc-1');
    expect(result.chunkCount).toBe(2);
    expect(result.mode).toBe('append');
    expect(result.message).toContain('合同管理办法');
  });

  it('source 缺省 → 用「Agent 入库 + 日期」文档名', async () => {
    await tool.execute({ content: '内容' }, {} as any);
    const name = maxkbMock.createTextDocument.mock.calls[0][2].name;
    expect(name).toMatch(/^Agent 入库 \d{4}-\d{2}-\d{2}$/);
  });

  it('指定存在的 knowledgeId → 入库到指定库', async () => {
    await tool.execute({ content: 'x', knowledgeId: 'kb-2' }, {} as any);
    expect(maxkbMock.createTextDocument).toHaveBeenCalledWith('ws-1', 'kb-2', expect.anything());
  });
});

describe('update 模式（upsert 去重）', () => {
  it('存在同名旧文档 → 先删后建', async () => {
    maxkbMock.listDocuments.mockResolvedValue([{ id: 'old-doc', name: '同一来源' }]);
    const result = await tool.execute(
      { content: '新内容', source: '同一来源', mode: 'update' },
      {} as any,
    );
    // deleteDocument 需传 (workspaceId, knowledgeId, documentId) 三参
    expect(maxkbMock.deleteDocument).toHaveBeenCalledWith('ws-1', 'kb-1', 'old-doc');
    expect(maxkbMock.createTextDocument).toHaveBeenCalled();
    expect(result.mode).toBe('update');
  });

  it('无同名旧文档 → 直接创建，不调 delete', async () => {
    maxkbMock.listDocuments.mockResolvedValue([{ id: 'other', name: '别的文档' }]);
    await tool.execute({ content: '新内容', source: '新来源', mode: 'update' }, {} as any);
    expect(maxkbMock.deleteDocument).not.toHaveBeenCalled();
    expect(maxkbMock.createTextDocument).toHaveBeenCalledTimes(1);
  });

  it('查文档失败 → 直接创建（findDocumentByName 内部 catch）', async () => {
    maxkbMock.listDocuments.mockRejectedValue(new Error('list down'));
    await tool.execute({ content: 'x', source: 's', mode: 'update' }, {} as any);
    expect(maxkbMock.deleteDocument).not.toHaveBeenCalled();
    expect(maxkbMock.createTextDocument).toHaveBeenCalledTimes(1);
  });
});

describe('权限与错误处理', () => {
  it('指定不存在的 knowledgeId → 报错', async () => {
    await expect(
      tool.execute({ content: 'x', knowledgeId: 'kb-nope' }, {} as any),
    ).rejects.toThrow('知识库不存在或无权访问');
    expect(maxkbMock.createTextDocument).not.toHaveBeenCalled();
  });

  it('没有可用知识库 → 报错', async () => {
    maxkbMock.getAvailableKnowledgeBases.mockResolvedValue([]);
    await expect(tool.execute({ content: 'x' }, {} as any)).rejects.toThrow('没有可用的 MaxKB 知识库');
  });

  it('MaxKB 不可达 → 友好报错', async () => {
    maxkbMock.getAvailableKnowledgeBases.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(tool.execute({ content: 'x' }, {} as any)).rejects.toThrow('无法获取知识库列表');
  });
});
