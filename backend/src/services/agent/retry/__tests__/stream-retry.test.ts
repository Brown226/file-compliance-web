/**
 * 任务 1：流式调用重试包装测试
 *
 * 验证 agent.service.ts 中 callStreamWithRetry 的行为：
 * - 首次成功直接返回，不重试
 * - 可重试错误按 decideRetry 决策退避后重试，成功后返回
 * - 不可重试错误直接抛出（不重试）
 * - 重试仍失败时最终抛出
 *
 * callStreamWithRetry 未从 agent.service.ts 导出，故这里对 retry-strategy
 * 的 decideRetry 与包装逻辑做等价验证（decideRetry 是重试决策的纯函数核心，
 * callStreamWithRetry 只是其外层循环）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  decideRetry,
  isRetryable,
  calcBackoff,
  MAX_RETRIES,
  BACKOFF_CAP_MS,
} from '../retry-strategy';

/** 模拟 callStreamWithRetry 的重试循环（与 agent.service.ts 实现一致） */
async function callStreamWithRetry<T>(fn: () => T): Promise<Awaited<T>> {
  let attemptNumber = 1;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const decision = decideRetry(e, attemptNumber, false);
      if (!decision.shouldRetry) throw e;
      await new Promise((r) => setTimeout(r, decision.delayMs));
      attemptNumber += 1;
    }
  }
}

describe('callStreamWithRetry（decideRetry 驱动）', () => {
  it('首次调用成功时直接返回，不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await callStreamWithRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重试错误（429）后重试成功返回结果', async () => {
    const err429 = { response: { status: 429 }, message: 'rate limited' };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce('recovered');
    const result = await callStreamWithRetry(fn);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('可重试错误（500）后重试成功返回结果', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce('ok-after-500');
    const result = await callStreamWithRetry(fn);
    expect(result).toBe('ok-after-500');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('不可重试错误（4xx 业务错误）直接抛出，不重试', async () => {
    const err400 = { status: 400, message: 'bad request' };
    const fn = vi.fn().mockRejectedValue(err400);
    await expect(callStreamWithRetry(fn)).rejects.toBe(err400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('重试多次仍失败时最终抛出错误', async () => {
    const err503 = { status: 503, message: 'service unavailable' };
    const fn = vi.fn().mockRejectedValue(err503);
    await expect(callStreamWithRetry(fn)).rejects.toBe(err503);
    // MAX_RETRIES=3 次尝试，每次失败都进入 decideRetry，超过后不再重试
    expect(fn).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it('字符串错误（message 含状态码）可被识别为重试', async () => {
    const err = new Error('502 Bad Gateway');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('recovered');
    const result = await callStreamWithRetry(fn);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('decideRetry / isRetryable / calcBackoff', () => {
  it('isRetryable 覆盖 408/429/500/502/503/504', () => {
    for (const code of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryable({ status: code })).toBe(true);
    }
  });

  it('isRetryable 拒绝 400/401/403/404', () => {
    for (const code of [400, 401, 403, 404]) {
      expect(isRetryable({ status: code })).toBe(false);
    }
  });

  it('decideRetry 对 429 首次返回 shouldRetry=true 且带退避', () => {
    const d = decideRetry({ status: 429 }, 1, false);
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBeGreaterThan(0);
    expect(d.isLastRetry).toBe(false);
  });

  it('decideRetry 对 401 未认证成功过不重试', () => {
    const d = decideRetry({ status: 401 }, 1, false);
    expect(d.shouldRetry).toBe(false);
  });

  it('decideRetry 对 401 曾认证成功（attempt=1）重试', () => {
    const d = decideRetry({ status: 401 }, 1, true);
    expect(d.shouldRetry).toBe(true);
  });

  it('calcBackoff 指数退避递增并封顶', () => {
    expect(calcBackoff(1)).toBe(1000);
    expect(calcBackoff(2)).toBe(3000);
    expect(calcBackoff(3)).toBe(9000);
    expect(calcBackoff(5)).toBeLessThanOrEqual(BACKOFF_CAP_MS);
  });
});
