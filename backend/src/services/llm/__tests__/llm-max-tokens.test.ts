// resolveMaxTokens 回归测试（BUG 2026-09-02）
//
// 现象：网关 /models 只带上下文窗口（262144）不带 maxOutput，探测结果 maxOutput=0
// 被回填进配置，resolveMaxTokens 判 0 为 falsy 不钳制，用户保存的
// maxTokens=284000 原样发出 → vLLM 400 "max_tokens cannot be greater than
// max_model_len=max_total_tokens=262144"（审查 smart-judge 与 Agent 对话均报错）。
//
// 修复口径：
// - maxOutput > 0 时钳到 maxOutput
// - 新增上下文窗口钳制（预留 4096 prompt，下限 1024）作为防御
// - 非法值（≤0/NaN/undefined 且无 config.maxTokens）回退 4096
import { describe, it, expect } from 'vitest';
import { LlmService } from '../llm.service';

describe('LlmService.resolveMaxTokens（BUG 2026-09-02 max_tokens 超限回归）', () => {
  it('maxOutput 有效时钳到模型真实 maxOutput（284000 → 16000）', () => {
    const out = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 284000,
      modelMaxOutput: 16000,
    });
    expect(out).toBe(16000);
  });

  it('maxOutput 未知但上下文窗口已知时按窗口钳制（预留 4096）', () => {
    const out = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 284000,
      modelContextWindow: 262144,
    });
    expect(out).toBe(262144 - 4096);
  });

  it('maxOutput=0（历史探测回填脏值）不钳制，仍走上下文钳制兜底', () => {
    const out = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 284000,
      modelMaxOutput: 0,
      modelContextWindow: 262144,
    });
    expect(out).toBe(262144 - 4096);
  });

  it('maxOutput 与上下文同时存在时取更小者', () => {
    const out = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 284000,
      modelMaxOutput: 16000,
      modelContextWindow: 262144,
    });
    expect(out).toBe(16000);
  });

  it('requested 显式小于上限时尊重调用方取值', () => {
    const out = LlmService.resolveMaxTokens(1024, {
      maxTokens: 284000,
      modelMaxOutput: 16000,
      modelContextWindow: 262144,
    });
    expect(out).toBe(1024);
  });

  it('推理模型抬升下限到 16384，但仍被 maxOutput 钳住', () => {
    const lifted = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 4096,
      modelReasoning: true,
    });
    expect(lifted).toBe(16384);

    const clamped = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 4096,
      modelReasoning: true,
      modelMaxOutput: 8192,
    });
    expect(clamped).toBe(8192);
  });

  it('非法值（0/负数/NaN/undefined 兜底）回退 4096', () => {
    expect(LlmService.resolveMaxTokens(0, { maxTokens: 8192 })).toBe(8192);
    expect(LlmService.resolveMaxTokens(-5, { maxTokens: 8192 })).toBe(8192);
    expect(LlmService.resolveMaxTokens(NaN, { maxTokens: 8192 })).toBe(8192);
    expect(LlmService.resolveMaxTokens(undefined, { maxTokens: NaN })).toBe(4096);
    expect(LlmService.resolveMaxTokens(undefined, { maxTokens: 0 })).toBe(4096);
  });

  it('窗口极小时下限 1024 兑底（max(1024, ctx-4096)）', () => {
    const out = LlmService.resolveMaxTokens(undefined, {
      maxTokens: 284000,
      modelContextWindow: 2048,
    });
    expect(out).toBe(1024);
  });

  it('无任何能力元数据时原样返回 config.maxTokens', () => {
    const out = LlmService.resolveMaxTokens(undefined, { maxTokens: 8192 });
    expect(out).toBe(8192);
  });
});
