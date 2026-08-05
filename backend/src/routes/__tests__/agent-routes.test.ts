/**
 * agent.routes 端点单元测试（saves 收藏 / search 搜索 / duplicate 会话复制 / directories 目录浏览）
 *
 * 用 supertest 挂载完整 agent router，mock authenticate（注入 req.user）与全部重依赖，
 * prisma 用 rbac.test.ts 样板 mock（config/db）。
 *
 * 覆盖：
 * - POST/GET/DELETE /saves：创建/列表（type 过滤）/删除（404 处理）
 * - GET /search：关键词 ILIKE 检索 / 空关键词返回空
 * - POST /sessions/:id/duplicate：复制会话
 * - GET /directories/browse：根目录列表 / 目录浏览 / 越权 403 / 不存在 404
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// —— 鉴权：透传并注入 req.user ——
vi.mock('../middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'admin', role: 'ADMIN' };
    next();
  },
  AuthRequest: {},
}));

// —— prisma（savedItem / qAMessage）——
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedItem: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    qAMessage: { findMany: vi.fn() },
  },
}));
vi.mock('../config/db', () => ({ __esModule: true, default: prismaMock }));

// —— 重依赖服务全部 mock（路由加载不触发真实实现）——
vi.mock('../services/agent/agent.service', () => ({ AgentService: {} }));
const { qaSessionMock } = vi.hoisted(() => ({ qaSessionMock: { duplicateSession: vi.fn() } }));
vi.mock('../services/agent/qa-session.service', () => ({ QASessionService: qaSessionMock }));
vi.mock('../services/agent/session-stats.service', () => ({ SessionStatsService: {} }));
vi.mock('../services/agent/memory/memory.service', () => ({ MemoryService: {} }));
vi.mock('../services/agent/skills/skills.service', () => ({ SkillsService: {} }));
vi.mock('../services/agent/worktree/worktree.service', () => ({ WorktreeService: {} }));
vi.mock('../services/agent/steering/steering.service', () => ({ SteeringService: {} }));
vi.mock('../services/agent/summary/summary.service', () => ({ SummaryService: {} }));
vi.mock('../config/env', () => ({ env: { redisUrl: 'redis://localhost:6379', jwtSecret: 'test', jwtExpiresIn: '1d' } }));
vi.mock('../services/llm/model-capabilities.registry', () => ({ lookupCapabilities: () => [] }));
vi.mock('../services/review/falsePositiveLibrary.service', () => ({ default: {} }));
vi.mock('../services/agent/tools/file/filename', () => ({ fixMojibake: (p: string) => p }));
vi.mock('../config/upload', () => ({ getUploadDir: () => path.join(os.tmpdir(), 'route-test-upload') }));
vi.mock('../services/agent/tools/file/paths', () => ({
  getTodayDir: () => path.join(os.tmpdir(), 'route-test-upload', 'agent_temp', 'u1'),
}));

import agentRoutes from '../agent.routes';

let app: express.Express;
let allowedDir: string;

beforeEach(() => {
  for (const model of [prismaMock.savedItem, prismaMock.qAMessage]) {
    for (const fn of Object.values(model)) (fn as any).mockReset();
  }
  qaSessionMock.duplicateSession.mockReset();

  app = express();
  app.use(express.json());
  app.use('/api/agent', agentRoutes);

  // 真实临时目录作为白名单根（browse 用）
  allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-allowed-'));
  fs.mkdirSync(path.join(allowedDir, 'sub'));
  fs.writeFileSync(path.join(allowedDir, 'a.txt'), 'hello');
  process.env.AGENT_ALLOWED_DIRS = allowedDir;
});

afterEach(() => {
  delete process.env.AGENT_ALLOWED_DIRS;
  fs.rmSync(allowedDir, { recursive: true, force: true });
});

describe('POST /saves（收藏）', () => {
  it('创建收藏：title/content 校验 + 落库', async () => {
    prismaMock.savedItem.create.mockResolvedValue({ id: 'sv1', title: '付款条款', type: 'qa' });
    const res = await request(app)
      .post('/api/agent/saves')
      .send({ type: 'qa', title: '付款条款', content: '付款期限 30 日', sourceSessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prismaMock.savedItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        type: 'qa',
        title: '付款条款',
        content: '付款期限 30 日',
        sourceSessionId: 's1',
      }),
    });
  });

  it('缺少 title/content → 400', async () => {
    const res = await request(app).post('/api/agent/saves').send({ type: 'qa' });
    expect(res.status).toBe(400);
    expect(prismaMock.savedItem.create).not.toHaveBeenCalled();
  });
});

describe('GET /saves（收藏列表）', () => {
  it('列表返回 + type 过滤透传', async () => {
    prismaMock.savedItem.findMany.mockResolvedValue([{ id: 'sv1', type: 'qa' }]);
    const res = await request(app).get('/api/agent/saves?type=qa');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(prismaMock.savedItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', type: 'qa' } }),
    );
  });
});

describe('DELETE /saves/:id', () => {
  it('删除成功', async () => {
    prismaMock.savedItem.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete('/api/agent/saves/sv1');
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(1);
  });

  it('收藏不存在 → 404', async () => {
    prismaMock.savedItem.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete('/api/agent/saves/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /search（全局搜索）', () => {
  it('关键词检索 QAMessage（用户隔离 + ILIKE）', async () => {
    prismaMock.qAMessage.findMany.mockResolvedValue([
      { id: 'm1', content: '付款期限', role: 'assistant', sessionId: 's1', session: { title: '会话A' } },
    ]);
    const res = await request(app).get('/api/agent/search?q=付款');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(prismaMock.qAMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          session: { userId: 'u1' },
          content: { contains: '付款', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('空关键词 → 空数组（不查库）', async () => {
    const res = await request(app).get('/api/agent/search');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(prismaMock.qAMessage.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /sessions/:id/duplicate（会话复制）', () => {
  it('复制会话 → 返回新会话', async () => {
    qaSessionMock.duplicateSession.mockResolvedValue({ id: 'new-s', title: '原（副本）' });
    const res = await request(app).post('/api/agent/sessions/s1/duplicate');
    expect(res.status).toBe(200);
    expect(qaSessionMock.duplicateSession).toHaveBeenCalledWith('s1', 'u1');
    expect(res.body.data.id).toBe('new-s');
  });

  it('复制失败 → 500', async () => {
    qaSessionMock.duplicateSession.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/agent/sessions/s1/duplicate');
    expect(res.status).toBe(500);
  });
});

describe('GET /directories/browse（目录浏览）', () => {
  it('缺省 → 返回白名单根目录', async () => {
    const res = await request(app).get('/api/agent/directories/browse');
    expect(res.status).toBe(200);
    expect(res.body.data.roots.length).toBeGreaterThan(0);
    expect(res.body.data.root).toBeNull();
  });

  it('浏览目录 → 列出文件与子目录（忽略 .git 等）', async () => {
    fs.mkdirSync(path.join(allowedDir, '.git'));
    const res = await request(app).get('/api/agent/directories/browse').query({ path: allowedDir });
    expect(res.status).toBe(200);
    const names = res.body.data.entries.map((e: any) => e.name);
    expect(names).toContain('sub');
    expect(names).toContain('a.txt');
    expect(names).not.toContain('.git');
    const file = res.body.data.entries.find((e: any) => e.name === 'a.txt');
    expect(file.type).toBe('file');
    const dir = res.body.data.entries.find((e: any) => e.name === 'sub');
    expect(dir.type).toBe('dir');
  });

  it('越权路径（白名单外）→ 403', async () => {
    const res = await request(app).get('/api/agent/directories/browse').query({ path: os.tmpdir() });
    expect(res.status).toBe(403);
  });

  it('目录不存在 → 404', async () => {
    const res = await request(app)
      .get('/api/agent/directories/browse')
      .query({ path: path.join(allowedDir, 'not-exist') });
    expect(res.status).toBe(404);
  });
});
