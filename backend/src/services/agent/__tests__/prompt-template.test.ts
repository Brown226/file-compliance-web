/**
 * Prompt 模板化单元测试（Agent 办公模板加载，纯 registry 语义）
 *
 * 管理面板移除后 PromptLoader.resolve 不再查询 DB，prompt 内容以 registry.ts 为准：
 * - registry 命中 → 返回模板内容（Agent 办公模板）
 * - 指定 variant 未命中 → 降级到 default variant
 * - 未知模板 key → 返回调用方 fallback
 */
import { describe, it, expect } from 'vitest';

import { PromptLoader } from '../../prompts';

describe('PromptLoader.resolve（纯 registry 加载）', () => {
  it('agent 办公模板命中 registry → 返回模板内容', async () => {
    const content = await PromptLoader.resolve('agent', 'system', 'office_contract_review', 'FALLBACK');
    expect(content).toContain('## 办公模板：合同审查');
    expect(content).toContain('付款条款');
  });

  it('指定 variant 未命中 → 降级到 default variant', async () => {
    const content = await PromptLoader.resolve('library_review', 'system', 'no_such_variant', 'FALLBACK');
    expect(content).not.toBe('FALLBACK');
    expect(content.length).toBeGreaterThan(0);
  });

  it('未知模块/key → 返回调用方 fallback', async () => {
    const content = await PromptLoader.resolve('not_a_module', 'system', 'not_exist_key', 'MINIMAL');
    expect(content).toBe('MINIMAL');
  });

  it('loadSystemPrompt 返回系统提示词', async () => {
    const content = await PromptLoader.loadSystemPrompt('library_review', { hasContext: false });
    expect(content.length).toBeGreaterThan(0);
  });
});
