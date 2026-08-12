/**
 * POST /api/agent/chat/stream 路由测试（2026-08-07 流式中断/输入校验/竞态防护）
 *
 * 覆盖：
 * - 输入校验：空 messages / 超 200 条 / 非法 role / 体量超 200 万字符 → 400 且不触达 LLM
 * - 会话归属：携带 sessionId 时 getSession 校验失败 → 403；通过 → 放行
 * - 并发竞态：无 sessionId 时 completeActiveSessions 收到 requestStartedAt（Date）
 * - AbortController：chatStream 收到 AbortSignal（客户端断开/超时中止控制）
 * - SSE 正常流：状态码/响应头/首块与后续块完整管道
 * - 降级链：chatStream 抛错 → chatWithGenerateText → LlmService.chat 两级兜底
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// —— 鉴权：透传并注入 req.user ——
vi.mock('../../middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'admin', role: 'ADMIN' };
    next();
  },
  AuthRequest: {},
}));

// —— 重依赖服务全部 mock ——
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
    qASession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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

/** 构造 chatStream 返回值：带 toUIMessageStreamResponse() 的流式响应对象 */
function makeStreamResult(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  return {
    toUIMessageStreamResponse: () => ({
      status,
      headers: new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }),
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
    }),
  };
}

beforeEach(() => {
  for (const fn of Object.values(agentServiceMock)) fn.mockReset();
  for (const fn of Object.values(qaSessionMock)) fn.mockReset();
  llmMock.chat.mockReset();
  prismaMock.systemConfig.findUnique.mockReset();
  prismaMock.systemConfig.findUnique.mockResolvedValue(null);
  prismaMock.qASession.findUnique.mockReset();
  // 默认：会话不存在（触发前端新会话自动创建分支），各用例可覆盖
  prismaMock.qASession.findUnique.mockResolvedValue(null);

  qaSessionMock.completeActiveSessions.mockResolvedValue(0);
  qaSessionMock.ensureSession.mockResolvedValue({ id: 'new-session' });
  qaSessionMock.getSession.mockResolvedValue({ id: 's1', userId: 'u1' });

  agentServiceMock.chatStream.mockResolvedValue(makeStreamResult(['data: {"type":"text-delta","delta":"你好"}\n\n']));
  agentServiceMock.chatWithGenerateText.mockResolvedValue({ text: '降级回复：generateText' });
  llmMock.chat.mockResolvedValue('降级回复：LlmService');

  app = express();
  // 与 app.ts 生产配置一致（50mb），否则 200 万字符用例会被 body-parser 默认 100kb 先拦成 413
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/agent', agentRoutes);
});

afterEach(() => {
  vi.useRealTimers();
});

const validMessages = [{ role: 'user', content: '你好' }];

describe('输入校验（不触达 LLM）', () => {
  it('messages 缺失/非数组/空 → 400', async () => {
    for (const body of [{}, { messages: 'x' }, { messages: [] }]) {
      const res = await request(app).post('/api/agent/chat/stream').send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('messages');
    }
    expect(agentServiceMock.chatStream).not.toHaveBeenCalled();
  });

  it('messages 超过 200 条 → 400', async () => {
    const messages = Array.from({ length: 201 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const res = await request(app).post('/api/agent/chat/stream').send({ messages });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('200');
    expect(agentServiceMock.chatStream).not.toHaveBeenCalled();
  });

  it('非法 role → 400', async () => {
    const res = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: [{ role: 'admin', content: 'hi' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('role');
    expect(agentServiceMock.chatStream).not.toHaveBeenCalled();
  });

  it('体量超过 200 万字符 → 400', async () => {
    const messages = [{ role: 'user', content: 'x'.repeat(2_000_100) }];
    const res = await request(app).post('/api/agent/chat/stream').send({ messages });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('总体量过大');
    expect(agentServiceMock.chatStream).not.toHaveBeenCalled();
  });
});

describe('会话归属与并发竞态', () => {
  it('无 sessionId：completeActiveSessions 收到 requestStartedAt（Date）并创建新会话', async () => {
    const before = new Date();
    const res = await request(app).post('/api/agent/chat/stream').send({ messages: validMessages });
    expect(res.status).toBe(200);

    expect(qaSessionMock.completeActiveSessions).toHaveBeenCalledTimes(1);
    const [uid, notCreatedAfter] = qaSessionMock.completeActiveSessions.mock.calls[0];
    expect(uid).toBe('u1');
    expect(notCreatedAfter).toBeInstanceOf(Date);
    expect(notCreatedAfter.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // ensureSession 用服务端生成的 UUID
    const ensureArg = qaSessionMock.ensureSession.mock.calls[0][0];
    expect(ensureArg).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(qaSessionMock.ensureSession).toHaveBeenCalledWith(ensureArg, 'u1', undefined, expect.any(Object));
  });

  it('携带 sessionId 且会话不存在（前端新会话场景）→ 自动创建并放行', async () => {
    // 前端 startNewSession() 生成 UUID 传入，后端应 ensureSession 自动创建而非 403
    prismaMock.qASession.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: validMessages, sessionId: 'new-uuid-0001' });
    expect(res.status).toBe(200);
    expect(qaSessionMock.ensureSession).toHaveBeenCalledWith(
      'new-uuid-0001', 'u1', undefined, expect.any(Object),
    );
    expect(agentServiceMock.chatStream).toHaveBeenCalled();
  });

  it('携带 sessionId 且会话属于其他用户 → 403（防越权写入）', async () => {
    prismaMock.qASession.findUnique.mockResolvedValue({ id: 's-other', userId: 'u2' });
    const res = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: validMessages, sessionId: 's-other' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('无权访问');
    expect(agentServiceMock.chatStream).not.toHaveBeenCalled();
    expect(qaSessionMock.ensureSession).not.toHaveBeenCalled();
  });

  it('携带 sessionId 且存在且属于当前用户 → 放行（不创建不关闭）', async () => {
    prismaMock.qASession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    const res = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: validMessages, sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(qaSessionMock.completeActiveSessions).not.toHaveBeenCalled();
    expect(qaSessionMock.ensureSession).not.toHaveBeenCalled();
  });
});

describe('AbortController 传递', () => {
  it('chatStream 收到 AbortSignal（非已中止）', async () => {
    await request(app).post('/api/agent/chat/stream').send({ messages: validMessages });
    const args = agentServiceMock.chatStream.mock.calls[0][0];
    expect(args.signal).toBeInstanceOf(AbortSignal);
    expect(args.signal.aborted).toBe(false);
    expect(args.userId).toBe('u1');
    expect(args.sessionId).toMatch(/^[0-9a-f]{8}-/);
  });
});

describe('SSE 正常流', () => {
  it('多块流：200 + text/event-stream 头 + 内容完整', async () => {
    agentServiceMock.chatStream.mockResolvedValue(
      makeStreamResult(['data: {"type":"start"}\n\n', 'data: {"type":"text-delta","delta":"A"}\n\n', 'data: {"type":"finish"}\n\n']),
    );
    const res = await request(app).post('/api/agent/chat/stream').send({ messages: validMessages });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"delta":"A"');
    expect(res.text).toContain('"type":"finish"');
  });
});

describe('降级链（流式失败两级兜底）', () => {
  // 降级用例聚焦 LLM 故障路径：会话视为已存在且属于当前用户
  beforeEach(() => {
    prismaMock.qASession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
  });

  it('chatStream 抛错 → 降级 chatWithGenerateText 并回显其文本', async () => {
    agentServiceMock.chatStream.mockRejectedValue(new Error('LLM 网关 500'));
    const res = await request(app).post('/api/agent/chat/stream').send({ messages: validMessages, sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('降级回复：generateText');
    expect(agentServiceMock.chatWithGenerateText).toHaveBeenCalled();
    expect(llmMock.chat).not.toHaveBeenCalled();
  });

  it('chatStream 与 generateText 都失败 → 降级 LlmService.chat（取最后一条 user 消息）', async () => {
    agentServiceMock.chatStream.mockRejectedValue(new Error('boom'));
    agentServiceMock.chatWithGenerateText.mockRejectedValue(new Error('gen boom'));
    const res = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: [{ role: 'user', content: '请审查这份合同' }], sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('降级回复：LlmService');
    expect(llmMock.chat).toHaveBeenCalledWith('请审查这份合同', expect.objectContaining({ mode: 'agent' }));
  });
});
