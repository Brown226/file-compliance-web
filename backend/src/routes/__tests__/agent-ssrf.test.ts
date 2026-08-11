/**
 * assertSafeFetchUrl SSRF 防护单元测试（providers/discover 的 Base URL 校验）
 *
 * 直接测导出的纯函数（不发起真实网络），dns.lookup 用 vi.mock('dns') 可控注入；
 * 另补 2 个走 HTTP 的端点用例验证 400 回显与错误正文不回显。
 *
 * 策略要点（内网部署刚需）：
 * - 仅 http/https；拒绝 0.0.0.0 / link-local（169.254.0.0/16 含云元数据）/ 组播 / 广播
 * - 放行 127.0.0.1、10.x、172.16-31.x、192.168.x、100.64-127.x（CGNAT）、ULA
 * - 域名经 dns.lookup 全量解析，任一地址命中黑名单即拒绝（缓解 DNS rebinding）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// —— 鉴权：透传并注入 req.user（ADMIN 才能调 discover）——
vi.mock('../../middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', username: 'admin', role: 'ADMIN' };
    next();
  },
  AuthRequest: {},
}));

// —— prisma 桩（路由加载需要）——
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedItem: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    qAMessage: { findMany: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));
vi.mock('../../config/db', () => ({ __esModule: true, default: prismaMock }));

// —— dns.lookup 可控注入（SSRF 域名解析路径）——
const { dnsMock } = vi.hoisted(() => ({ dnsMock: { lookup: vi.fn() } }));
vi.mock('dns', () => dnsMock);

// —— 重依赖服务全部 mock（路由加载不触发真实实现）——
vi.mock('../../services/agent/agent.service', () => ({ AgentService: {} }));
vi.mock('../../services/agent/qa-session.service', () => ({ QASessionService: {} }));
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

import { assertSafeFetchUrl } from '../agent.routes';
import agentRoutes from '../agent.routes';

/** 便捷构造 URL + 断言拒绝 */
async function expectRejected(url: string) {
  await expect(assertSafeFetchUrl(new URL(url))).rejects.toThrow();
}

/** 便捷构造 URL + 断言放行 */
async function expectAllowed(url: string) {
  await expect(assertSafeFetchUrl(new URL(url))).resolves.toBeUndefined();
}

beforeEach(() => {
  dnsMock.lookup.mockReset();
  prismaMock.systemConfig.findUnique.mockReset();
  prismaMock.systemConfig.findUnique.mockResolvedValue(null);
  // 默认：域名解析到公网地址
  dnsMock.lookup.mockImplementation((hostname: string, _opts: any, cb: any) => {
    cb(null, [{ address: '8.8.8.8' }]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('协议白名单', () => {
  it('仅 http/https 放行，其余协议拒绝', async () => {
    await expectRejected('ftp://example.com/models');
    await expectRejected('file:///etc/passwd');
    await expectRejected('ws://example.com/models');
    await expectRejected('gopher://example.com');
    await expectAllowed('http://example.com/models');
    await expectAllowed('https://example.com/models');
  });
});

describe('IP 字面量', () => {
  it('拒绝云元数据 169.254.169.254（link-local）', async () => {
    await expectRejected('http://169.254.169.254/latest/meta-data/');
  });

  it('拒绝 169.254.0.0/16 其他地址', async () => {
    await expectRejected('http://169.254.5.5/');
  });

  it('拒绝 0.0.0.0 / 组播 / 广播', async () => {
    await expectRejected('http://0.0.0.0:8000/');
    await expectRejected('http://224.0.0.1/');
    await expectRejected('http://239.255.255.250/');
    await expectRejected('http://255.255.255.255/');
  });

  it('放行 127.0.0.1（本地 LLM）', async () => {
    await expectAllowed('http://127.0.0.1:11434/v1');
  });

  it('放行内网网段（10.x / 172.16-31.x / 192.168.x / CGNAT）', async () => {
    await expectAllowed('http://10.0.0.8:8000/');
    await expectAllowed('http://172.16.0.1/');
    await expectAllowed('http://172.31.255.254/');
    await expectAllowed('http://192.168.1.1/');
    await expectAllowed('http://100.64.0.1/');
    await expectAllowed('http://100.127.255.254/');
  });

  it('放行公网地址', async () => {
    await expectAllowed('http://8.8.8.8/');
  });

  it('IPv6：拒绝环回 / 链路本地，放行 ULA', async () => {
    await expectRejected('http://[::1]:8000/');
    await expectRejected('http://[::]:8000/');
    await expectRejected('http://[fe80::1]/');
    await expectAllowed('http://[fd00::1]:8000/');
    await expectAllowed('http://[fc00::1]:8000/');
  });

  it('IPv4 映射 IPv6：Node 规范化的十六进制形式（::ffff:a9fe:a9fe=169.254.169.254）拒绝', async () => {
    await expectRejected('http://[::ffff:a9fe:a9fe]/');
  });

  it('IPv4 映射 IPv6：十六进制 0.0.0.0 / 广播 也拒绝', async () => {
    await expectRejected('http://[::ffff:0:0]/');
    await expectRejected('http://[::ffff:ffff:ffff]/');
  });

  it('IPv4 映射 IPv6：十六进制 127.0.0.1 / 10.0.0.1 放行', async () => {
    await expectAllowed('http://[::ffff:7f00:1]/');
    await expectAllowed('http://[::ffff:0a00:1]/');
  });

  it('IPv4 映射 IPv6：点分形式输入同样拒绝（防御非 URL 规范化路径）', async () => {
    await expectRejected('http://[::ffff:169.254.169.254]/');
  });
});

describe('域名解析（DNS rebinding 缓解）', () => {
  it('解析到公网地址 → 放行', async () => {
    await expectAllowed('http://llm.example.com/v1');
  });

  it('解析到 169.254.169.254 → 拒绝', async () => {
    dnsMock.lookup.mockImplementation((_hostname: string, _opts: any, cb: any) => {
      cb(null, [{ address: '169.254.169.254' }]);
    });
    await expectRejected('http://metadata.example.com/');
  });

  it('多地址中任一命中黑名单 → 拒绝（其余为公网）', async () => {
    dnsMock.lookup.mockImplementation((_hostname: string, _opts: any, cb: any) => {
      cb(null, [{ address: '8.8.8.8' }, { address: '169.254.169.254' }]);
    });
    await expectRejected('http://mixed.example.com/');
  });

  it('lookup 报错 → 拒绝（视为解析失败）', async () => {
    dnsMock.lookup.mockImplementation((_hostname: string, _opts: any, cb: any) => {
      cb(new Error('ENOTFOUND'));
    });
    await expectRejected('http://nope.example.com/');
  });

  it('解析结果为空 → 拒绝', async () => {
    dnsMock.lookup.mockImplementation((_hostname: string, _opts: any, cb: any) => {
      cb(null, []);
    });
    await expectRejected('http://empty.example.com/');
  });

  it('解析到内网地址 → 放行（内网 LLM 网关刚需）', async () => {
    dnsMock.lookup.mockImplementation((_hostname: string, _opts: any, cb: any) => {
      cb(null, [{ address: '10.10.10.10' }]);
    });
    await expectAllowed('http://cnpe.internal/v1');
  });
});

describe('POST /providers/discover 端点集成', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agent', agentRoutes);
  });

  it('非法协议 Base URL → 400 且回显校验消息', async () => {
    const res = await request(app)
      .post('/api/agent/providers/discover')
      .send({ providerName: 'test-llm', provider: { baseUrl: 'ftp://example.com', api: 'openai' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('仅支持 http/https');
  });

  it('云元数据 Base URL → 400（SSRF 拦截）', async () => {
    const res = await request(app)
      .post('/api/agent/providers/discover')
      .send({ providerName: 'test-llm', provider: { baseUrl: 'http://169.254.169.254/latest/meta-data/', api: 'openai' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('禁止访问');
  });

  it('IPv6 十六进制映射云元数据 → 400（SSRF 绕过修复验证）', async () => {
    const res = await request(app)
      .post('/api/agent/providers/discover')
      .send({ providerName: 'test-llm', provider: { baseUrl: 'http://[::ffff:a9fe:a9fe]/latest/meta-data/', api: 'openai' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('禁止访问');
  });

  it('上游错误正文不回显（防 apiKey 泄漏）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('{"error":{"message":"sk-very-secret-key"}}'),
      }),
    );
    const res = await request(app)
      .post('/api/agent/providers/discover')
      .send({ providerName: 'test-llm', provider: { baseUrl: 'http://llm.example.com/v1', api: 'openai', apiKey: 'sk-test' } });
    expect(res.status).toBe(502);
    expect(res.body.message).not.toContain('sk-very-secret-key');
    expect(res.body.message).toContain('500');
  });
});
