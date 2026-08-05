/**
 * 任务 1：流式调用重试包装测试（测真身）
 *
 * 直接 import agent.service 导出的 callStreamWithRetry（2026-08-05 加 export），
 * 验证真实实现（非等价重写）：
 * - 首次成功直接返回，不重试
 * - 可重试错误按 decideRetry 决策退避后重试，成功后返回
 * - 不可重试错误直接抛出（不重试）
 * - 重试仍失败时最终抛出
 * 另含 decideRetry / isRetryable / calcBackoff 纯函数测试。
 *
 * agent.service 的重依赖全部 mock（llm/tools/prisma/redis 等），
 * retry-strategy 保留真实（重试决策是测的核心）。
 */
import { describe, it, expect, vi } from 'vitest';

// —— agent.service 重依赖 mock（retry-strategy 保留真实）——
vi.mock('../../../config/db', () => ({ __esModule: true, default: {} }));
vi.mock('@prisma/client', () => ({ Prisma: { ModelName: {} }, PrismaClient: class {} }));
vi.mock('../../../llm/llm.service', () => ({ LlmService: {} }));
vi.mock('../../tools', () => ({ createAllTools: () => ({}) }));
vi.mock('../../tools/file/filename', () => ({ fixMojibake: (p: string) => p }));
vi.mock('../qa-session.service', () => ({ QASessionService: {} }));
vi.mock('../../../config/upload', () => ({ getUploadDir: () => '/tmp' }));
vi.mock('../steering/steering.service', () => ({ SteeringService: {} }));
vi.mock('../skills/skills.service', () => ({ SkillsService: {} }));
vi.mock('../context-compaction/compaction.service', () => ({ CompactionService: {} }));
vi.mock('../security/scrub-sensitive', () => ({ scrubSensitive: (s: string) => s }));
vi.mock('../../../utils/llm-rate-limiter', () => ({ acquireLlmToken: () => Promise.resolve() }));
vi.mock('../../prompts', () => ({ PromptLoader: { resolve: () => Promise.resolve('') } }));

import { callStreamWithRetry } from '../../agent.service';
import {
  decideRetry,
  isRetryable,
  calcBackoff,
  MAX_RETRIES,
  BACKOFF_CAP_MS,
} from '../retry-strategy';

describe('callStreamWithRetry（agent.service 真身）', () => {
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
