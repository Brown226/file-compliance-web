/**
 * QASessionService 单元测试（任务 4 会话隔离 + 任务 9 会话复制）
 *
 * 覆盖：
 * - completeActiveSessions：只关闭 status=active 的会话，返回数量
 * - listSessions：返回 status（默认 active）、预览截断、messageCount
 * - ensureSession：不存在时创建并显式带 status=active；存在无标题时补标题
 * - duplicateSession：权限校验、事务内复制全部消息、标题加「（副本）」
 * - persistAssistantMessage：确保会话 + 写入消息（含 sources）
 *
 * 按 rbac.test.ts 样板 mock prisma（config/db）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    qASession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    qAMessage: { findMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../config/db', () => ({
  __esModule: true,
  default: {
    qASession: prismaMock.qASession,
    qAMessage: prismaMock.qAMessage,
    $transaction: prismaMock.$transaction,
  },
}));

import { QASessionService } from '../qa-session.service';

beforeEach(() => {
  for (const model of [prismaMock.qASession, prismaMock.qAMessage]) {
    for (const fn of Object.values(model)) {
      (fn as any).mockReset();
    }
  }
  prismaMock.$transaction.mockReset();
});

describe('completeActiveSessions（单活跃会话约束）', () => {
  it('只关闭 status=active 的会话并返回数量', async () => {
    prismaMock.qASession.updateMany.mockResolvedValue({ count: 2 });
    const n = await QASessionService.completeActiveSessions('user-1');
    expect(n).toBe(2);
    expect(prismaMock.qASession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'active' },
      data: { status: 'completed' },
    });
  });

  it('无活跃会话 → 返回 0', async () => {
    prismaMock.qASession.updateMany.mockResolvedValue({ count: 0 });
    expect(await QASessionService.completeActiveSessions('user-1')).toBe(0);
  });
});

describe('listSessions', () => {
  it('返回 status 字段（缺省按 active）', async () => {
    prismaMock.qASession.findMany.mockResolvedValue([
      {
        id: 's1',
        title: '会话A',
        taskId: null,
        status: 'completed',
        _count: { messages: 3 },
        messages: [{ content: '你好', createdAt: new Date('2026-01-01') }],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      {
        id: 's2',
        title: null,
        taskId: null,
        // 无 status → 默认 active
        _count: { messages: 0 },
        messages: [],
        createdAt: new Date('2026-01-03'),
        updatedAt: new Date('2026-01-03'),
      },
    ]);
    const list = await QASessionService.listSessions('user-1');
    expect(list[0].status).toBe('completed');
    expect(list[1].status).toBe('active');
    expect(list[1].lastMessagePreview).toBeNull();
  });

  it('预览超 80 字符截断', async () => {
    prismaMock.qASession.findMany.mockResolvedValue([
      {
        id: 's1',
        title: null,
        taskId: null,
        status: 'active',
        _count: { messages: 1 },
        messages: [{ content: 'x'.repeat(100), createdAt: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const list = await QASessionService.listSessions('user-1');
    expect(list[0].lastMessagePreview!.length).toBeLessThanOrEqual(83);
    expect(list[0].lastMessagePreview).toContain('...');
  });
});

describe('ensureSession', () => {
  it('不存在时创建会话并显式 status=active', async () => {
    prismaMock.qASession.findUnique.mockResolvedValue(null);
    await QASessionService.ensureSession('new-id', 'user-1', '标题', { modelKey: 'm1', toolPreset: 'full', thinkingLevel: 'high' });
    expect(prismaMock.qASession.create).toHaveBeenCalledWith({
      data: {
        id: 'new-id',
        userId: 'user-1',
        title: '标题',
        status: 'active',
        modelKey: 'm1',
        toolPreset: 'full',
        thinkingLevel: 'high',
      },
    });
  });

  it('已存在但无标题且有新标题 → 更新标题', async () => {
    prismaMock.qASession.findUnique.mockResolvedValue({ id: 's1', title: null });
    await QASessionService.ensureSession('s1', 'user-1', '新标题');
    expect(prismaMock.qASession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { title: '新标题' } });
    expect(prismaMock.qASession.create).not.toHaveBeenCalled();
  });
});

describe('duplicateSession（会话复制）', () => {
  it('无权访问（非本人会话）→ 报错', async () => {
    prismaMock.qASession.findFirst.mockResolvedValue(null);
    await expect(QASessionService.duplicateSession('s1', 'other-user')).rejects.toThrow('会话不存在或无权访问');
  });

  it('事务内创建新会话 + 复制全部消息', async () => {
    const source = { id: 's1', userId: 'user-1', title: '原会话', taskId: null, modelKey: 'm1', toolPreset: 'full', thinkingLevel: null };
    const messages = [
      { sessionId: 's1', role: 'user', content: '问', status: 'completed', sources: null, debug: null, createdAt: new Date('2026-01-01') },
      { sessionId: 's1', role: 'assistant', content: '答', status: 'completed', sources: [{}], debug: null, createdAt: new Date('2026-01-02') },
    ];
    prismaMock.qASession.findFirst.mockResolvedValue(source);
    prismaMock.qAMessage.findMany.mockResolvedValue(messages);
    const created = { id: 'new-id', title: '原会话（副本）', taskId: null, userId: 'user-1', modelKey: 'm1', toolPreset: 'full', thinkingLevel: null, createdAt: new Date(), updatedAt: new Date() };
    let capturedTx: any;
    prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      capturedTx = {
        qASession: { create: vi.fn().mockResolvedValue(created) },
        qAMessage: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };
      return cb(capturedTx);
    });

    const result = await QASessionService.duplicateSession('s1', 'user-1');
    expect(result.title).toBe('原会话（副本）');
    // 事务内：新会话 status=active，标题带「（副本）」
    expect(capturedTx.qASession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: '原会话（副本）', status: 'active', userId: 'user-1' }),
    });
    // 消息全部复制（含 role/content；sessionId 为事务内生成的新 UUID）
    const createManyArg = capturedTx.qAMessage.createMany.mock.calls[0][0];
    expect(createManyArg.data).toHaveLength(2);
    expect(createManyArg.data[0]).toMatchObject({ role: 'user', content: '问' });
    expect(typeof createManyArg.data[0].sessionId).toBe('string');
    expect(createManyArg.data[0].sessionId).not.toBe('s1');
  });
});

describe('persistAssistantMessage', () => {
  it('确保会话存在并写入消息（含 sources）', async () => {
    prismaMock.qASession.findUnique.mockResolvedValue(null); // 会话不存在 → 创建
    prismaMock.qAMessage.create.mockResolvedValue({ id: 'm1' });
    await QASessionService.persistAssistantMessage('s1', 'user-1', '回答内容', 'completed', [{ docName: 'a.pdf' }]);
    expect(prismaMock.qAMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 's1',
          content: '回答内容',
          sources: [{ docName: 'a.pdf' }],
        }),
      }),
    );
  });
});
