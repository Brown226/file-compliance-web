/**
 * GET /api/agent/models — 模型用途过滤单元测试
 *
 * 背景：对话模型选择器不得展示 embedding/rerank 等工具模型。
 * 供应商配置面板（llm_profiles.usage: 'chat'|'embedding'|'vision'|'rerank'|'all'）
 * 已标记用途；本端点必须过滤 embedding/rerank，其余（chat/未设置/vision/all）保留。
 *
 * 按 agent-routes.test.ts 样板：mock authenticate/requireRole 与 prisma（config/db）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'admin', role: 'ADMIN' };
    next();
  },
  AuthRequest: {},
}));
vi.mock('../../middlewares/rbac.middleware', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { systemConfig: { findUnique: vi.fn() } },
}));
vi.mock('../../config/db', () => ({ __esModule: true, default: prismaMock }));

vi.mock('../../services/llm/llm.service', () => ({ LlmService: {} }));
vi.mock('../../services/llm/model-capabilities.registry', () => ({ lookupCapabilities: () => null }));

import modelRoutes from '../agent/model.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', modelRoutes);
  return app;
}

/** 四类 profile：未设置 usage（旧数据，视为 chat）/ vision / embedding / rerank */
const PROFILES = [
  { id: 'p_chat', name: '基哥', model: 'deepseek-v4-flash', isEnabled: true },
  { id: 'p_vision', name: '基哥', model: 'qwen-vl-max', usage: 'vision', isEnabled: true },
  {
    id: 'p_embed', name: 'GiteeAI', model: 'Qwen3-Embedding-8B', usage: 'embedding', isEnabled: true,
    capabilities: { supportsEmbedding: true },
  },
  { id: 'p_rerank', name: 'GiteeAI', model: 'Qwen3-Reranker-4B', usage: 'rerank', isEnabled: true },
];

beforeEach(() => {
  prismaMock.systemConfig.findUnique.mockReset();
});

describe('GET /api/agent/models — 工具模型过滤', () => {
  it('过滤 embedding/rerank，保留 chat（未设置 usage）/vision', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({
      key: 'llm_profiles',
      value: JSON.stringify(PROFILES),
    });
    const res = await request(buildApp()).get('/api/agent/models');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.models.map((m: any) => m.modelId)).toEqual([
      'deepseek-v4-flash',
      'qwen-vl-max',
    ]);
  });

  it('无 llm_profiles 配置时返回空列表', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/agent/models');
    expect(res.status).toBe(200);
    expect(res.body.data.models).toEqual([]);
  });

  it('scope glob 过滤作用于已过滤后的列表', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({
      key: 'llm_profiles',
      value: JSON.stringify(PROFILES),
    });
    // scope 匹配完整 key（<providerId>::<model>），需用包含式模式
    const res = await request(buildApp()).get('/api/agent/models?scope=*deepseek*');
    expect(res.status).toBe(200);
    expect(res.body.data.models.map((m: any) => m.modelId)).toEqual(['deepseek-v4-flash']);
  });
});
