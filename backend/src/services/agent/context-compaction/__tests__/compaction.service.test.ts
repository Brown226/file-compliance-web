/**
 * CompactionService 单元测试（P1-1 摘要缓存 + P1-2 后台预计算）
 *
 * 覆盖 compactWithCache 四分支 + 边界：
 * 1. 消息数不足（<= KEEP_RECENT_ROUNDS×2）→ 退化为 compact()，不碰 Redis
 * 2. Redis 缓存命中（sourceCount 一致）→ 秒回摘要，不触发后台
 * 3. 缓存未命中 → 机械折叠 + fire-and-forget 后台预计算（LLM 摘要写 Redis）
 * 4. sourceCount 不匹配 → 视为未命中（同 3）
 * 5. Redis get/set 抛错 → 静默降级，仅 console.warn，不崩
 * 6. 后台预计算进程内去重（backgroundJobs Set）
 * 7. sessionId 为空 → 纯机械折叠，不读缓存、不触发后台
 * 8. 后台计算失败后 finally 清理 Set → 同一 sessionId 可再次触发
 *
 * 通过 vi.mock 隔离 redis 与 LlmService（避免真实 ioredis 连接与 LLM 调用）。
 * 注意：本文件位于 __tests__/ 子目录，mock 路径需 4 级相对路径（../../../../）。
 * 每用例使用不同 sessionId，避免模块级 backgroundJobs Set 交叉污染。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/redis', () => ({
  redisClient: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../../llm/llm.service', () => ({
  LlmService: { chat: vi.fn() },
}));

import { CompactionService, KEEP_RECENT_ROUNDS } from '../compaction.service';
import type { Message } from '../compaction.service';
import { redisClient } from '../../../../utils/redis';
import { LlmService } from '../../../llm/llm.service';

// ==================== 常量（与实现对齐，FALLBACK_KEEP_COUNT / TTL 未导出，按实现值硬编码） ====================
const recentCount = KEEP_RECENT_ROUNDS * 2; // 6
const FALLBACK_KEEP_COUNT = 20;
const SUMMARY_CACHE_TTL_SECONDS = 7 * 24 * 3600; // 604800
const REDIS_PREFIX = 'agent:compaction:';

/** 构造 rounds 轮交替 user/assistant 消息（2×rounds 条） */
function mkMessages(rounds: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < rounds; i++) {
    messages.push({ role: 'user', content: `用户消息${i}` });
    messages.push({ role: 'assistant', content: `助手回复${i}` });
  }
  return messages;
}

beforeEach(() => {
  // 清调用记录；resetAllMocks 同时清除上一次测试遗留的 mock 实现（clearAllMocks 不重置实现）
  vi.clearAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  // 兜底恢复（如某用例失败未走到 finally 的 spy 还原）
  vi.restoreAllMocks();
});

// ==================== 分支一：消息数不足（<= KEEP_RECENT_ROUNDS×2） ====================

describe('compactWithCache：消息数不足 → 退化 compact()，不碰 Redis', () => {
  it('恰好 6 条（边界）→ 返回原数组副本，redis.get 不被调用', async () => {
    const messages = mkMessages(3); // 6 条
    const result = await CompactionService.compactWithCache('sess-1-boundary', messages);

    expect(result.compacted).toEqual(messages);
    expect(result.compacted).not.toBe(messages); // 副本而非原引用
    expect(result.summary).toBeUndefined();
    expect(result.truncatedMessages).toBeUndefined();
    expect(result.estimatedTokens).toBeGreaterThan(0);

    // 关键断言：未命中缓存分支，Redis 完全不碰
    expect(vi.mocked(redisClient.get)).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(redisClient.set)).not.toHaveBeenCalled();
    expect(vi.mocked(LlmService.chat)).not.toHaveBeenCalled();
  });

  it('4 条（远小于 6）同样退化为 compact()', async () => {
    const messages = mkMessages(2); // 4 条
    const result = await CompactionService.compactWithCache('sess-1-short', messages);

    expect(result.compacted).toEqual(messages);
    expect(result.summary).toBeUndefined();
    expect(vi.mocked(redisClient.get)).not.toHaveBeenCalled();
    expect(vi.mocked(redisClient.set)).not.toHaveBeenCalled();
    expect(vi.mocked(LlmService.chat)).not.toHaveBeenCalled();
  });
});

// ==================== 分支二：缓存命中 ====================

describe('compactWithCache：缓存命中（sourceCount 一致）', () => {
  it('直接返回摘要消息 + 最近轮次，redis.set / LlmService.chat 均不被调用', async () => {
    const messages = mkMessages(5); // 10 条 → early = 4
    const earlyMessages = messages.slice(0, -recentCount);
    const cached = { summary: '缓存摘要正文', sourceCount: earlyMessages.length };
    vi.mocked(redisClient.get).mockResolvedValue(cached as any);

    const result = await CompactionService.compactWithCache('sess-hit', messages);

    expect(vi.mocked(redisClient.get)).toHaveBeenCalledWith(`${REDIS_PREFIX}sess-hit`);

    // compacted = [system 摘要, ...最近 6 条]
    expect(result.compacted.length).toBe(1 + recentCount);
    expect(result.compacted[0].role).toBe('system');
    expect(result.compacted[0].content.startsWith('[上下文摘要]')).toBe(true);
    expect(result.compacted[0].content).toBe('[上下文摘要]\n缓存摘要正文');
    expect(result.compacted.slice(1)).toEqual(messages.slice(-recentCount));

    // 摘要字段透传 + 截断数 = earlyMessages 数
    expect(result.summary).toBe('缓存摘要正文');
    expect(result.truncatedMessages).toBe(earlyMessages.length);
    expect(result.estimatedTokens).toBeGreaterThan(0);

    // 命中即秒回：后台不触发（等微任务确认 set / chat 均未被调）
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(redisClient.set)).not.toHaveBeenCalled();
    expect(vi.mocked(LlmService.chat)).not.toHaveBeenCalled();
  });
});

// ==================== 分支三：缓存未命中 → 机械折叠 + 后台预计算 ====================

describe('compactWithCache：缓存未命中 → 机械折叠 + 后台预计算', () => {
  it('24 条消息：立即折叠为最近 20 条，后台触发 LLM 摘要并写 Redis（TTL 7 天）', async () => {
    const messages = mkMessages(12); // 24 条 → early = 18
    const earlyCount = messages.length - recentCount;
    vi.mocked(redisClient.get).mockResolvedValueOnce(null);
    vi.mocked(LlmService.chat).mockResolvedValue('后台预计算摘要');

    const result = await CompactionService.compactWithCache('sess-miss', messages);

    // 即时机械折叠：无 summary、保留最近 20 条
    expect(result.compacted.length).toBe(FALLBACK_KEEP_COUNT);
    expect(result.compacted).toEqual(messages.slice(-FALLBACK_KEEP_COUNT));
    expect(result.summary).toBeUndefined();
    expect(result.truncatedMessages).toBe(messages.length - FALLBACK_KEEP_COUNT);

    // fire-and-forget 后台：LLM 摘要 → 写 Redis（key + {summary, sourceCount} + TTL）
    await vi.waitFor(() => expect(vi.mocked(LlmService.chat)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(LlmService.chat)).toHaveBeenCalledWith(
      expect.stringContaining('对话历史'),
      expect.objectContaining({ temperature: 0.3, timeout: 90 }),
    );
    await vi.waitFor(() => expect(vi.mocked(redisClient.set)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(redisClient.set)).toHaveBeenCalledWith(
      `${REDIS_PREFIX}sess-miss`,
      { summary: '后台预计算摘要', sourceCount: earlyCount },
      SUMMARY_CACHE_TTL_SECONDS,
    );
  });

  it('消息数恰为 20（FALLBACK_KEEP_COUNT 边界）→ 机械折叠不截断，后台仍触发', async () => {
    const messages = mkMessages(10); // 20 条 → early = 14
    vi.mocked(redisClient.get).mockResolvedValueOnce(null);
    vi.mocked(LlmService.chat).mockResolvedValue('边界摘要');

    const result = await CompactionService.compactWithCache('sess-miss-20', messages);

    expect(result.compacted.length).toBe(FALLBACK_KEEP_COUNT);
    expect(result.truncatedMessages).toBe(0);
    expect(result.summary).toBeUndefined();

    await vi.waitFor(() => expect(vi.mocked(redisClient.set)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(redisClient.set)).toHaveBeenCalledWith(
      `${REDIS_PREFIX}sess-miss-20`,
      { summary: '边界摘要', sourceCount: messages.length - recentCount },
      SUMMARY_CACHE_TTL_SECONDS,
    );
  });
});

// ==================== 分支四：sourceCount 不匹配 → 视为未命中 ====================

describe('compactWithCache：sourceCount 不匹配视为未命中', () => {
  it('缓存 sourceCount ≠ 当前早期消息数 → 机械折叠 + 后台预计算', async () => {
    const messages = mkMessages(12); // 24 条 → early = 18
    vi.mocked(redisClient.get).mockResolvedValueOnce({ summary: '过期摘要', sourceCount: 99 } as any);
    vi.mocked(LlmService.chat).mockResolvedValue('重新计算摘要');

    const result = await CompactionService.compactWithCache('sess-stale', messages);

    expect(vi.mocked(redisClient.get)).toHaveBeenCalledWith(`${REDIS_PREFIX}sess-stale`);
    expect(result.summary).toBeUndefined();
    expect(result.compacted.length).toBe(FALLBACK_KEEP_COUNT);

    await vi.waitFor(() => expect(vi.mocked(LlmService.chat)).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(vi.mocked(redisClient.set)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(redisClient.set)).toHaveBeenCalledWith(
      `${REDIS_PREFIX}sess-stale`,
      { summary: '重新计算摘要', sourceCount: messages.length - recentCount },
      SUMMARY_CACHE_TTL_SECONDS,
    );
  });
});

// ==================== 分支五：Redis 异常降级 ====================

describe('compactWithCache：Redis 异常降级', () => {
  it('redis.get 抛错 → 不抛、机械折叠；后台 set 抛错被内部 catch 吞掉（仅 console.warn）', async () => {
    const messages = mkMessages(12);
    vi.mocked(redisClient.get).mockRejectedValueOnce(new Error('redis down'));
    vi.mocked(LlmService.chat).mockResolvedValue('降级摘要');
    vi.mocked(redisClient.set).mockRejectedValueOnce(new Error('set down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // get 抛错被 compactWithCache 内部 catch 吞掉：此处若抛出则测试直接失败
      const result = await CompactionService.compactWithCache('sess-redis-down', messages);

      expect(result.compacted.length).toBe(FALLBACK_KEEP_COUNT);
      expect(result.summary).toBeUndefined();

      // 后台仍触发：set 最终被调用一次，且其抛错被 IIFE 内部 catch 吞掉 → console.warn
      await vi.waitFor(() => expect(vi.mocked(redisClient.set)).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
      // console.warn 实参：(消息模板, 错误 message)，断言首参含失败标记即可
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('后台摘要计算失败');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ==================== 后台预计算去重 ====================

describe('scheduleSummaryCompute：进程内去重（backgroundJobs Set）', () => {
  it('同一 sessionId 在后台计算未完成前再次调用 → LlmService.chat 总共只被调用 1 次', async () => {
    const messages = mkMessages(12);
    vi.mocked(redisClient.get).mockResolvedValue(null); // 两次都未命中
    vi.mocked(LlmService.chat).mockResolvedValue('去重摘要');

    const r1 = await CompactionService.compactWithCache('sess-dedup', messages);
    const r2 = await CompactionService.compactWithCache('sess-dedup', messages);

    expect(r1.compacted.length).toBe(FALLBACK_KEEP_COUNT);
    expect(r2.compacted.length).toBe(FALLBACK_KEEP_COUNT);

    // 两次调用、一次后台：chat 仅 1 次、set 仅 1 次
    await vi.waitFor(() => expect(vi.mocked(LlmService.chat)).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(vi.mocked(redisClient.set)).toHaveBeenCalledTimes(1));
  });
});

// ==================== sessionId 为空 ====================

describe('compactWithCache：sessionId 为空', () => {
  it.each([null, undefined])('sessionId=%s → 纯机械折叠，不读缓存、不触发后台', async (sid) => {
    const messages = mkMessages(12);
    const result = await CompactionService.compactWithCache(sid, messages);

    expect(result.compacted.length).toBe(FALLBACK_KEEP_COUNT);
    expect(result.summary).toBeUndefined();
    expect(result.truncatedMessages).toBe(messages.length - FALLBACK_KEEP_COUNT);
    expect(vi.mocked(redisClient.get)).not.toHaveBeenCalled();

    // 后台不触发：等微任务确认 chat / set 均未被调
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(LlmService.chat)).not.toHaveBeenCalled();
    expect(vi.mocked(redisClient.set)).not.toHaveBeenCalled();
  });
});

// ==================== 后台失败后 Set 清理 ====================

describe('scheduleSummaryCompute：失败后 finally 清理 backgroundJobs', () => {
  it('LLM 摘要失败 → Set 被清理 → 同一 sessionId 再次未命中可重新触发后台', async () => {
    const messages = mkMessages(12);
    vi.mocked(redisClient.get).mockResolvedValue(null);
    vi.mocked(LlmService.chat).mockRejectedValueOnce(new Error('llm down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const r1 = await CompactionService.compactWithCache('sess-fail-cleanup', messages);
      expect(r1.compacted.length).toBe(FALLBACK_KEEP_COUNT);

      // 第一次后台：chat 抛错 → 内部 catch（warn）→ finally 删除 backgroundJobs
      await vi.waitFor(() => expect(vi.mocked(LlmService.chat)).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
      // catch 与 finally 在同一微任务内连续执行：warn 出现时 backgroundJobs 必已删除

      // 同一 sessionId 再次未命中 → 可再次触发后台（证明 Set 已清理）
      const r2 = await CompactionService.compactWithCache('sess-fail-cleanup', messages);
      expect(r2.compacted.length).toBe(FALLBACK_KEEP_COUNT);
      await vi.waitFor(() => expect(vi.mocked(LlmService.chat)).toHaveBeenCalledTimes(2));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
