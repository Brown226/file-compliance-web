// 核智大模型（hezhi 自定义协议）chat 回归测试
//
// 背景：公司内网自部署微调模型「核智大模型 L1」不使用 OpenAI 请求格式，
// 协议（来源：内网测试脚本 test_api.js / index.html）：
//   POST {base}/hz_model
//   body: { appkey, user_id, session_id, stream, user_content, enable_thinking, query, history:[{Q,A}] }
//   非流式响应：{ res: "全文", is_cancel: boolean }
//
// 本测试用 mock fetch 验证协议体构建 / 响应解析 / is_cancel / 异常分支，
// 以及 getLlmConfig apiFormat 透传与 chat() 分支路由。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock('../../../config/db', () => ({
  default: {
    systemConfig: { findUnique: findUniqueMock },
    llmCallLog: { create: vi.fn(() => Promise.resolve({})) },
  },
}));

const { cacheGetMock, cacheSetMock } = vi.hoisted(() => ({
  cacheGetMock: vi.fn(async () => null),
  cacheSetMock: vi.fn(async () => undefined),
}));
vi.mock('../../system/cache.service', () => ({
  CacheService: {
    get: cacheGetMock,
    set: cacheSetMock,
    generateKey: (...args: any[]) => args.join('|'),
  },
}));

// 重试退避真实等待 2s/4s/8s 会拖慢测试：直接透传执行（仅保留同步抛错语义）
vi.mock('../../../utils/retry', () => ({
  retryWithBackoff: (fn: () => Promise<any>) => fn(),
}));

import { LlmService } from '../llm.service';

const HEZHI_CONFIG = {
  apiBaseUrl: 'http://10.139.133.3:8001/',
  apiKey: '027qbFTkXmPaFRcVHv54aOUWFbIiWYyaxNi7b6DYIt72Xo',
  modelName: 'hz-27b',
  provider: 'hezhi',
  timeout: 5,
};

function mockFetch(body: any, status = 200) {
  const fetchMock = vi.fn(async (_url: any, init: any) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LlmService.hezhiChat（核智自定义协议）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cacheGetMock.mockClear();
    cacheSetMock.mockClear();
    findUniqueMock.mockReset();
  });

  it('非流式成功：POST /hz_model，协议体含 appkey/query/history，解析 res 字段', async () => {
    const fetchMock = mockFetch({ res: 'OK', is_cancel: false });
    const out = await LlmService.hezhiChat(HEZHI_CONFIG, '连通性测试', {
      history: [{ Q: '问1', A: '答1' }],
    });
    expect(out).toBe('OK');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://10.139.133.3:8001/hz_model'); // 尾斜杠被去除
    const payload = JSON.parse(init.body);
    expect(payload.appkey).toBe(HEZHI_CONFIG.apiKey); // appkey 在 body 而非 Header
    expect(payload.stream).toBe(false);
    expect(payload.query).toBe('连通性测试');
    expect(payload.history).toEqual([{ Q: '问1', A: '答1' }]);
    expect(payload.session_id).toBeTruthy();
    expect(init.headers['Authorization']).toBeUndefined(); // 不用 Bearer
  });

  it('systemPrompt 前置拼入 query（协议无 system role）', async () => {
    const fetchMock = mockFetch({ res: '好', is_cancel: false });
    await LlmService.hezhiChat(HEZHI_CONFIG, '你好', { systemPrompt: '你是核行业专家' });
    const payload = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(payload.query).toContain('你是核行业专家');
    expect(payload.query.endsWith('你好')).toBe(true);
  });

  it('is_cancel=true（敏感内容收回）返回空字符串且不抛错', async () => {
    mockFetch({ res: '', is_cancel: true });
    const out = await LlmService.hezhiChat(HEZHI_CONFIG, '敏感问题');
    expect(out).toBe('');
  });

  it('响应缺 res 字段时抛「非预期格式」错误', async () => {
    mockFetch({ foo: 'bar' });
    await expect(LlmService.hezhiChat(HEZHI_CONFIG, 'hi')).rejects.toThrow(/非预期格式/);
  });

  it('HTTP 500 抛「核智大模型 API 错误」', async () => {
    mockFetch('server error', 500);
    await expect(
      LlmService.hezhiChat(HEZHI_CONFIG, 'hi', { timeout: 1 }),
    ).rejects.toThrow(/核智大模型 API 错误/);
  });

  it('缓存命中时不发 HTTP 请求', async () => {
    cacheGetMock.mockResolvedValueOnce('缓存答案');
    const fetchMock = mockFetch({ res: 'x' });
    const out = await LlmService.hezhiChat(HEZHI_CONFIG, 'hi');
    expect(out).toBe('缓存答案');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getLlmConfig apiFormat 透传 + chat() hezhi 分支', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cacheGetMock.mockClear();
    findUniqueMock.mockReset();
    LlmService.invalidateLlmCaches();
  });

  it('profile.apiFormat=hezhi 时 getLlmConfig 透传 hezhi', async () => {
    findUniqueMock.mockImplementation(({ where: { key } }: any) => {
      if (key === 'llm_chat_model') {
        return Promise.resolve({ key, value: { providerId: 'p1', timeout: 120 } });
      }
      if (key === 'llm_profiles') {
        return Promise.resolve({
          key,
          value: [{ id: 'p1', apiBase: 'http://hz:8001/', apiKey: 'ak', model: 'hz-27b', apiFormat: 'hezhi' }],
        });
      }
      return Promise.resolve(null);
    });
    const cfg: any = await LlmService.getLlmConfig();
    expect(cfg.apiFormat).toBe('hezhi');
  });

  it('profile.apiFormat 未设置时视为 openai', async () => {
    findUniqueMock.mockImplementation(({ where: { key } }: any) => {
      if (key === 'llm_chat_model') {
        return Promise.resolve({ key, value: { providerId: 'p1', timeout: 120 } });
      }
      if (key === 'llm_profiles') {
        return Promise.resolve({
          key,
          value: [{ id: 'p1', apiBase: 'http://gw/v1', apiKey: 'sk', model: 'm1' }],
        });
      }
      return Promise.resolve(null);
    });
    const cfg: any = await LlmService.getLlmConfig();
    expect(cfg.apiFormat).toBe('openai');
  });

  it('chat() 在 apiFormat=hezhi 时发 /hz_model 而非 /chat/completions', async () => {
    findUniqueMock.mockImplementation(({ where: { key } }: any) => {
      if (key === 'llm_chat_model') {
        return Promise.resolve({ key, value: { providerId: 'p1', timeout: 120 } });
      }
      if (key === 'llm_profiles') {
        return Promise.resolve({
          key,
          value: [{ id: 'p1', apiBase: 'http://hz:8001', apiKey: 'ak', model: 'hz-27b', apiFormat: 'hezhi' }],
        });
      }
      return Promise.resolve(null);
    });
    LlmService.invalidateLlmCaches();
    const fetchMock = mockFetch({ res: '协议内回答', is_cancel: false });
    const out = await LlmService.chat('1+1=?');
    expect(out).toBe('协议内回答');
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/hz_model');
    expect(String(url)).not.toContain('/chat/completions');
  });
});
