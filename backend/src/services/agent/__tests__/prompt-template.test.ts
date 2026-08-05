/**
 * Prompt 模板化单元测试（任务 7：Agent 办公模板加载）
 *
 * 覆盖 PromptLoader.resolve 的加载链语义：
 * - DB 不可达 → registry 回退（Agent 办公模板内容可用）
 * - DB content === defaultValue（用户未改）→ 用 registry 最新值（热更新）
 * - DB content !== defaultValue（用户改过）→ 用用户版本
 * - 未知模板 key → 用调用方 fallback
 *
 * 通过 mock prompt-template.service 隔离 prisma。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPromptBySceneWithMetaMock = vi.fn();
vi.mock('../../llm/prompt-template.service', () => ({
  PromptTemplateService: {
    getPromptBySceneWithMeta: (...args: any[]) => getPromptBySceneWithMetaMock(...args),
    getPrompt: vi.fn(),
  },
}));

import { PromptLoader } from '../../prompts';

beforeEach(() => getPromptBySceneWithMetaMock.mockReset());

const KEY = 'office_contract_review';
const REGISTRY_DEFAULT = '## 办公模板：合同审查'; // registry.ts 中 content 开头

describe('PromptLoader.resolve（agent 办公模板）', () => {
  it('DB 不可达/无记录 → registry 回退返回模板内容', async () => {
    // 返回 undefined 而非 mockRejectedValue/throw：vitest 2.1.9 对 mock 内
    // 抛出的错误有 unhandled 追踪误报（即使调用方已 catch），
    // 与 llm-review-chunk.test.ts 同款规避；语义等效（无 meta → registry 回退）
    getPromptBySceneWithMetaMock.mockResolvedValue(undefined);
    const content = await PromptLoader.resolve('agent', 'system', KEY, 'FALLBACK');
    expect(content).toContain(REGISTRY_DEFAULT);
    expect(content).toContain('付款条款');
  });

  it('DB content === defaultValue（用户未改）→ 用 registry 最新值', async () => {
    getPromptBySceneWithMetaMock.mockResolvedValue({
      content: '旧版本',
      defaultValue: '旧版本', // 用户没改 → 用 registry
    });
    const content = await PromptLoader.resolve('agent', 'system', KEY, 'FALLBACK');
    expect(content).toContain(REGISTRY_DEFAULT);
  });

  it('DB content !== defaultValue（用户改过）→ 用用户版本', async () => {
    getPromptBySceneWithMetaMock.mockResolvedValue({
      content: '管理员自定义模板内容',
      defaultValue: '旧版本',
    });
    const content = await PromptLoader.resolve('agent', 'system', KEY, 'FALLBACK');
    expect(content).toBe('管理员自定义模板内容');
  });

  it('未知模板 key → 用调用方 fallback', async () => {
    getPromptBySceneWithMetaMock.mockResolvedValue(null);
    const content = await PromptLoader.resolve('agent', 'system', 'not_exist_key', 'MINIMAL');
    expect(content).toBe('MINIMAL');
  });
});
