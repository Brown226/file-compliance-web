// getLlmConfig 配置来源回归测试（2026-09-02「Provider 配置唯一权威」重构）
//
// 原则：模型能力（上下文窗口/最大输出/推理）全局只认 Provider 配置
// （llm_profiles[].capabilities）里填的那一份：
// - 网关 /models 探测不再参与运行时取值（内网网关上报不了能力，探测无意义）
// - 预置能力库（model-capabilities.registry）不再作为运行时兜底
// - 多来源合并正是「界面数值不同步」问题的根源
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock('../../../config/db', () => ({ default: { systemConfig: { findUnique: findUniqueMock } } }));

import { LlmService } from '../llm.service';

function mockDb(chatModel: any, profiles: any) {
  findUniqueMock.mockImplementation(({ where: { key } }: any) => {
    if (key === 'llm_chat_model') return Promise.resolve({ key, value: chatModel });
    if (key === 'llm_profiles') return Promise.resolve({ key, value: profiles });
    return Promise.resolve(null);
  });
}

describe('LlmService.getLlmConfig（Provider 配置唯一权威）', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    LlmService.invalidateLlmCaches();
  });

  it('Provider caps 已填时透传为运行时能力', async () => {
    mockDb(
      { providerId: 'p1', temperature: 0.1, timeout: 120 },
      [{ id: 'p1', apiBase: 'http://gw/v1', apiKey: 'sk', model: 'm1', capabilities: { contextWindowTokens: 262144, maxOutputTokens: 16000, reasoning: true } }],
    );
    const cfg = await LlmService.getLlmConfig();
    expect(cfg?.modelContextWindow).toBe(262144);
    expect(cfg?.modelMaxOutput).toBe(16000);
    expect(cfg?.modelReasoning).toBe(true);
    expect(cfg?.maxTokens).toBe(8192); // 未显式配置时用缺省请求值，运行时再被 resolveMaxTokens 钳制
  });

  it('Provider caps 未填时不回退预置能力库（即使模型名在预置库中存在）', async () => {
    mockDb(
      { providerId: 'p1', temperature: 0.1, timeout: 120 },
      [{ id: 'p1', apiBase: 'http://gw/v1', apiKey: 'sk', model: 'deepseek-v4-flash', capabilities: {} }],
    );
    const cfg = await LlmService.getLlmConfig();
    expect(cfg?.modelContextWindow).toBeUndefined();
    expect(cfg?.modelMaxOutput).toBeUndefined();
    expect(cfg?.modelReasoning).toBeUndefined();
  });

  it('旧结构（apiKey+modelName 直连）无能力字段，不影响主流程', async () => {
    mockDb(
      { apiKey: 'sk', modelName: 'legacy-model', maxTokens: 4096, temperature: 0.2, timeout: 60 },
      [],
    );
    const cfg = await LlmService.getLlmConfig();
    expect(cfg?.modelName).toBe('legacy-model');
    expect(cfg?.maxTokens).toBe(4096);
    expect(cfg?.modelContextWindow).toBeUndefined();
    expect(cfg?.modelMaxOutput).toBeUndefined();
  });

  it('显式配置的 maxTokens 透传（作为场景缺省请求值）', async () => {
    mockDb(
      { providerId: 'p1', maxTokens: 48000, temperature: 0.1, timeout: 120 },
      [{ id: 'p1', apiBase: 'http://gw/v1', apiKey: 'sk', model: 'm1', capabilities: { contextWindowTokens: 1000000, maxOutputTokens: 384000 } }],
    );
    const cfg = await LlmService.getLlmConfig();
    expect(cfg?.maxTokens).toBe(48000);
    expect(cfg?.modelMaxOutput).toBe(384000);
  });
});
