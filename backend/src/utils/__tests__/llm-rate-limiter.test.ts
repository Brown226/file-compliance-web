// LLM 限流器单元测试（2026-09-02 重构：网关维度分桶 + 交互优先配额）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { incrMock, expireMock, getLlmRateLimitMock } = vi.hoisted(() => ({
  incrMock: vi.fn(),
  expireMock: vi.fn(),
  getLlmRateLimitMock: vi.fn(),
}));

vi.mock('../redis', () => ({
  redisClient: { getClient: () => ({ incr: incrMock, expire: expireMock }) },
}));
vi.mock('../system-config', () => ({
  getLlmRateLimit: getLlmRateLimitMock,
}));

import { acquireLlmToken } from '../llm-rate-limiter';

describe('acquireLlmToken（网关分桶 + 交互优先配额）', () => {
  beforeEach(() => {
    incrMock.mockReset().mockResolvedValue(1);
    expireMock.mockReset().mockResolvedValue(1);
    getLlmRateLimitMock.mockReset().mockResolvedValue(20);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batch 通道可用 80% 配额（limit=10 时第 9 个起等待）', async () => {
    getLlmRateLimitMock.mockResolvedValue(10);
    incrMock.mockResolvedValue(8); // 8 ≤ floor(10*0.8)=8 → 通过
    const waited = await acquireLlmToken('http://gw1/v1', 'm1', 'batch');
    expect(waited).toBeLessThan(200);

    incrMock.mockResolvedValue(9); // 9 > 8 → 应等待；下一窗 incr 返回 1 → 通过
    incrMock.mockImplementationOnce(() => Promise.resolve(9));
    incrMock.mockImplementation(() => Promise.resolve(1));
    vi.useFakeTimers();
    const p = acquireLlmToken('http://gw1/v1', 'm1', 'batch');
    await vi.advanceTimersByTimeAsync(2500);
    const waited2 = await p;
    expect(waited2).toBeGreaterThan(0);
  });

  it('interactive 通道可用全部配额（batch 已饱和到 80% 时仍直接通过）', async () => {
    getLlmRateLimitMock.mockResolvedValue(10);
    incrMock.mockResolvedValue(9); // 9 > batch 配额 8，但 ≤ interactive 配额 10
    const waited = await acquireLlmToken('http://gw1/v1', 'm1', 'interactive');
    expect(waited).toBeLessThan(200);
  });

  it('interactive 在配额满（count > limit）时也会等待', async () => {
    getLlmRateLimitMock.mockResolvedValue(10);
    incrMock.mockImplementationOnce(() => Promise.resolve(11)); // 11 > 10
    incrMock.mockImplementation(() => Promise.resolve(1));
    vi.useFakeTimers();
    const p = acquireLlmToken('http://gw1/v1', 'm1', 'interactive');
    await vi.advanceTimersByTimeAsync(2500);
    const waited = await p;
    expect(waited).toBeGreaterThan(0);
  });

  it('桶 key 按「网关+模型」隔离：同名模型不同网关 key 不同', async () => {
    await acquireLlmToken('https://gw-a.example.com/v1', 'deepseek-v4-flash');
    await acquireLlmToken('https://gw-b.example.com/v1', 'deepseek-v4-flash');
    const keys = incrMock.mock.calls.map((c: any[]) => c[0] as string);
    expect(keys[0]).toContain('gw-a.example.com_v1::deepseek-v4-flash');
    expect(keys[1]).toContain('gw-b.example.com_v1::deepseek-v4-flash');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('limit=0 表示不限流，不触碰 Redis', async () => {
    getLlmRateLimitMock.mockResolvedValue(0);
    const waited = await acquireLlmToken('http://gw1/v1', 'm1');
    expect(waited).toBe(0);
    expect(incrMock).not.toHaveBeenCalled();
  });

  it('Redis 异常时降级为不限流（不抛错，返回 0）', async () => {
    incrMock.mockRejectedValue(new Error('connection refused'));
    const waited = await acquireLlmToken('http://gw1/v1', 'm1');
    expect(waited).toBe(0);
  });

  it('安全阀：持续饱和超过 10s 后放行，不无限挂起', async () => {
    getLlmRateLimitMock.mockResolvedValue(10);
    incrMock.mockResolvedValue(99); // 永远超配额
    vi.useFakeTimers();
    const p = acquireLlmToken('http://gw1/v1', 'm1', 'batch');
    const promise = vi.advanceTimersByTimeAsync(11500);
    const waited = await p;
    await promise;
    expect(waited).toBeGreaterThanOrEqual(10_000);
  });
});
