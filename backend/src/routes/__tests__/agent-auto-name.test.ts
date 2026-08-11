/**
 * POST /api/agent/sessions/:sessionId/auto-name 路由测试（2026-08-07 防刷限流）
 *
 * 覆盖：
 * - 正常流程：取会话消息 → LlmService 生成标题 → 清洗 → renameSession 写回
 * - 防刷冷却：同一会话 30s 内第二次 → 429（不触达 LLM）；过期后恢复
 * - 会话隔离：不同 sessionId 互不影响
 * - 边界：会话不存在 404 / 无消息 400 / LLM 返回空标题 500
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'admin', role: 'ADMIN' };
    next();
  },
  AuthRequest: {},
}));

const { agentServiceMock } = vi.hoisted(() => ({
  agentServiceMock: { chatStream: vi.fn(), chatWithGenerateText: vi.fn() },
}));
vi.mock('../../services/agent/agent.service', () => ({ AgentService: agentServiceMock }));

const { qaSessionMock } = vi.hoisted(() => ({
  qaSessionMock: {
    completeActiveSessions: vi.fn(),
    ensureSession: vi.fn(),
    getSession: vi.fn(),
    duplicateSession: vi.fn(),
    listMessages: vi.fn(),
    renameSession: vi.fn(),
  },
}));
vi.mock('../../services/agent/qa-session.service', () => ({ QASessionService: qaSessionMock }));

const { llmMock } = vi.hoisted(() => ({ llmMock: { chat: vi.fn() } }));
vi.mock('../../services/llm/llm.service', () => ({ LlmService: llmMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedItem: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    qAMessage: { findMany: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));
vi.mock('../../config/db', () => ({ __esModule: true, default: prismaMock }));

vi.mock('../../services/agent/session-stats.service', () => ({ SessionStatsService: {} }));
vi.mock('../../services/agent/memory/memory.service', () => ({ MemoryService: {} }));
vi.mock('../../services/agent/skills/skills.service', () => ({ SkillsService: {} }));
vi.mock('../../services/agent/worktree/worktree.service', () => ({ WorktreeService: {} }));
vi.mock('../../services/agent/steering/steering.service', () => ({ SteeringService: {} }));
vi.mock('../../services/agent/summary/summary.service', () => ({ SummaryService: {} }));
vi.mock('../../config/env', () => ({ env: { redisUrl: 'redis://localhost:6379', jwtSecret: 'test', jwtExpiresIn: '1d' } }));
vi.mock('../../services/llm/model-capabilities.registry', () => ({ lookupCapabilities: () => [] }));
vi.mock('../../services/review/falsePositiveLibrary.service', () => ({ default: {} }));
vi.mock('../../services/agent/tools/file/filename', () => ({ fixMojibake: (p: string) => p }));
vi.mock('../../config/upload', () => ({ getUploadDir: () => 'C:\\route-test-upload' }));
vi.mock('../../services/agent/tools/file/paths', () => ({
  getTodayDir: () => 'C:\\route-test-upload\\agent_temp\\u1',
}));

import agentRoutes from '../agent.routes';

let app: express.Express;

beforeEach(() => {
  for (const fn of Object.values(qaSessionMock)) fn.mockReset();
  for (const fn of Object.values(agentServiceMock)) fn.mockReset();
  llmMock.chat.mockReset();
  prismaMock.systemConfig.findUnique.mockReset();
  prismaMock.systemConfig.findUnique.mockResolvedValue(null);

  qaSessionMock.getSession.mockResolvedValue({ id: 's1', userId: 'u1' });
  qaSessionMock.listMessages.mockResolvedValue([
    { role: 'user', content: '帮我审合同' },
    { role: 'assistant', content: '好的' },
  ]);
  qaSessionMock.renameSession.mockResolvedValue({ id: 's1' });
  llmMock.chat.mockResolvedValue('合同审查对话');

  app = express();
  app.use(express.json());
  app.use('/api/agent', agentRoutes);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('auto-name 正常流程', () => {
  // 注意：冷却 Map 是模块级共享的，每个用例用独立 sessionId 防串扰
  it('成功：取消息 → LLM 生成 → 标题清洗 → renameSession 写回', async () => {
    const res = await request(app).post('/api/agent/sessions/n-s1/auto-name');
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('合同审查对话');
    expect(qaSessionMock.listMessages).toHaveBeenCalledWith('n-s1', 'u1');
    expect(qaSessionMock.renameSession).toHaveBeenCalledWith('n-s1', 'u1', '合同审查对话');
  });

  it('标题清洗：去首尾引号与末尾句号', async () => {
    llmMock.chat.mockResolvedValue('「合同审查对话」。');
    const res = await request(app).post('/api/agent/sessions/n-s2/auto-name');
    expect(res.body.data.title).toBe('合同审查对话');
  });

  it('会话不存在 → 404', async () => {
    qaSessionMock.getSession.mockResolvedValue(null);
    const res = await request(app).post('/api/agent/sessions/n-s3/auto-name');
    expect(res.status).toBe(404);
    expect(llmMock.chat).not.toHaveBeenCalled();
  });

  it('会话无 user/assistant 消息 → 400', async () => {
    qaSessionMock.listMessages.mockResolvedValue([]);
    const res = await request(app).post('/api/agent/sessions/n-s4/auto-name');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('尚无消息');
  });

  it('LLM 返回空标题 → 500', async () => {
    llmMock.chat.mockResolvedValue('   。。。');
    const res = await request(app).post('/api/agent/sessions/n-s5/auto-name');
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('空标题');
  });
});

describe('auto-name 防刷冷却（30s）', () => {
  it('同一会话 30s 内第二次 → 429 且不触达 LLM', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T10:00:00Z'));

    const first = await request(app).post('/api/agent/sessions/cd-a/auto-name');
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/agent/sessions/cd-a/auto-name');
    expect(second.status).toBe(429);
    expect(second.body.message).toContain('频繁');
    // 冷却期内不重复取消息/调 LLM
    expect(llmMock.chat).toHaveBeenCalledTimes(1);
    expect(qaSessionMock.renameSession).toHaveBeenCalledTimes(1);
  });

  it('冷却过期（31s 后）→ 恢复可调用', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T10:00:00Z'));

    await request(app).post('/api/agent/sessions/cd-b/auto-name');
    vi.setSystemTime(new Date('2026-08-11T10:00:31Z'));
    const res = await request(app).post('/api/agent/sessions/cd-b/auto-name');
    expect(res.status).toBe(200);
    expect(llmMock.chat).toHaveBeenCalledTimes(2);
  });

  it('不同会话互不影响', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T10:00:00Z'));

    await request(app).post('/api/agent/sessions/cd-c/auto-name');
    const res = await request(app).post('/api/agent/sessions/cd-d/auto-name');
    expect(res.status).toBe(200);
    expect(llmMock.chat).toHaveBeenCalledTimes(2);
  });
});
