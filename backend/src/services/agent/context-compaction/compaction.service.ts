/**
 * 上下文压缩服务 — 管理 Agent 对话历史的 Token 预算
 *
 * 当对话历史接近 70% 的硬限制（120k）时，自动对早期消息执行 LLM 摘要压缩，
 * 保留最近 KEEP_RECENT_ROUNDS 轮完整消息，确保长期对话的连贯性和预算可控。
 *
 * @module CompactionService
 */

import { LlmService } from '../../llm/llm.service';
import { redisClient } from '../../../utils/redis';

// ==================== 常量 ====================

/** 硬限制 Token 上限（120k — 适配主流 128k 上下文窗口的安全边界） */
export const HARD_LIMIT_TOKENS = 120000;

/** 压缩触发阈值：HARD_LIMIT_TOKENS 的 70% */
export const COMPACTION_THRESHOLD = 84000;

/** 压缩时保留的最近完整对话轮数（每轮 = user + assistant） */
export const KEEP_RECENT_ROUNDS = 3;

/** LLM 摘要调用超时时间（秒） */
export const SUMMARY_TIMEOUT_SECONDS = 90;

/** 机械折叠降级时保留的最新消息数 */
const FALLBACK_KEEP_COUNT = 20;

// ==================== P1-1：摘要缓存（把 LLM 摘要移出请求关键路径） ====================

/** Redis 缓存 key 前缀（agent:compaction:{sessionId}） */
const REDIS_PREFIX = 'agent:compaction:';

/** Redis 摘要缓存 TTL（7 天，覆盖会话生命周期绰绰有余） */
const SUMMARY_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/** 缓存的摘要结构：sourceCount = 生成摘要时的早期消息数（用于命中判断） */
interface CachedSummary {
  summary: string;
  sourceCount: number;
}

/** 进程内后台预计算去重锁（多实例下至多多算一次，幂等无害） */
const backgroundJobs = new Set<string>();

// ==================== 类型定义 ====================

export interface Message {
  role: string;
  content: string;
  [key: string]: unknown;
}

/**
 * 压缩执行结果
 */
export interface CompactionResult {
  /** 压缩后的消息数组（摘要消息 + 最近轮次消息） */
  compacted: Message[];
  /** LLM 生成的文本摘要（压缩时存在；机械折叠时为 undefined） */
  summary?: string;
  /** 被压缩/截断的消息数量 */
  truncatedMessages?: number;
  /** 压缩后的估算 Token 数 */
  estimatedTokens: number;
}

// ==================== 服务 ====================

/**
 * 上下文压缩服务
 *
 * 使用方式：
 * ```ts
 * if (CompactionService.needsCompaction(messages, systemPrompt.length)) {
 *   const result = await CompactionService.compact(messages);
 *   // 使用 result.compacted 替换原始 messages
 * }
 * ```
 */
export class CompactionService {
  /**
   * 粗略估算一组消息的 Token 数
   *
   * 算法：字符总数 / 2.5（中文约占 1.5-2 token，英文约占 1 token，
   * 取 2.5 作为中英文混合场景的经验折中值）
   *
   * 修复：原实现只统计 string content，工具调用/结果的 parts 数组与
   * 对象型 content（UIMessage 格式）完全不计入，导致实际 token 远超
   * 84k 阈值后仍不压缩（长对话模型退化）。这里对非字符串字段做 JSON
   * 序列化后一并统计。
   */
  static estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => {
      let s = 0;
      if (typeof m.content === 'string') {
        s = m.content.length;
      } else if (m.content != null) {
        s = JSON.stringify(m.content)?.length ?? 0;
      }
      // 工具调用/结果等附加字段（ai-sdk steps 结构、UIMessage parts 等）
      for (const key of ['parts', 'toolCalls', 'toolResults', 'tool_calls', 'toolCallId', 'toolName', 'input', 'output']) {
        const v = (m as any)[key];
        if (v != null) s += JSON.stringify(v)?.length ?? 0;
      }
      return sum + s;
    }, 0);
    return Math.round(totalChars / 2.5);
  }

  /**
   * 判断是否需要执行上下文压缩
   *
   * @param messages          当前对话消息数组
   * @param systemPromptLength 系统提示词的字符长度（用于估算其 Token 贡献）
   * @returns 总 Token（消息 + 系统提示）超过 COMPACTION_THRESHOLD 时返回 true
   */
  static needsCompaction(messages: Message[], systemPromptLength: number): boolean {
    const msgTokens = this.estimateTokens(messages);
    const systemTokens = Math.round(systemPromptLength / 2.5);
    return msgTokens + systemTokens > COMPACTION_THRESHOLD;
  }

  /**
   * P1-1：带缓存的压缩入口（chatStream 主链路专用）
   *
   * 目标：把「LLM 生成摘要」移出请求关键路径——此前 compact() 同步等 LLM
   * （超时上限 90s），用户视角是发消息后卡住近一分钟。
   *
   * 策略：
   * 1. Redis 缓存命中（同一会话、早期消息数量一致）→ 秒回摘要结果
   * 2. 未命中 → 本次立即机械折叠（保住响应速度），并 fire-and-forget 后台
   *    预计算 LLM 摘要写入 Redis，下一轮对话生效
   * 3. Redis 不可用 → 纯机械折叠（与项目其他组件的 Redis 降级策略一致）
   *
   * 权衡：首次超阈值的请求会丢失早期上下文（仅保留最近 FALLBACK_KEEP_COUNT 条），
   * 换取零阻塞；下一轮起由缓存摘要恢复完整上下文语义。
   *
   * @param sessionId 会话 ID（缓存键；空则退化为纯机械折叠）
   * @param messages  当前对话消息数组
   */
  static async compactWithCache(
    sessionId: string | null | undefined,
    messages: Message[],
  ): Promise<CompactionResult> {
    const recentCount = KEEP_RECENT_ROUNDS * 2;
    if (messages.length <= recentCount) {
      return CompactionService.compact(messages);
    }
    if (!sessionId) {
      return CompactionService.mechanicalFold(messages);
    }

    const earlyMessages = messages.slice(0, -recentCount);
    const recentMessages = messages.slice(-recentCount);

    // 1. 读缓存：sourceCount 与当前早期消息数一致才算命中（会话消息只增不减，前缀稳定）
    try {
      const cached = await redisClient.get<CachedSummary>(`${REDIS_PREFIX}${sessionId}`);
      if (cached && cached.summary && cached.sourceCount === earlyMessages.length) {
        const compacted: Message[] = [
          { role: 'system', content: `[上下文摘要]\n${cached.summary}` },
          ...recentMessages,
        ];
        return {
          compacted,
          summary: cached.summary,
          truncatedMessages: earlyMessages.length,
          estimatedTokens: this.estimateTokens(compacted),
        };
      }
    } catch {
      // Redis 不可用：走下方机械折叠（静默降级，与其他组件策略一致）
    }

    // 2. 未命中：立即机械折叠 + 后台预计算下一轮用的 LLM 摘要
    CompactionService.scheduleSummaryCompute(sessionId, messages);
    return CompactionService.mechanicalFold(messages);
  }

  /**
   * 机械折叠：只保留最近 FALLBACK_KEEP_COUNT 条消息（即时返回，无 LLM 调用）。
   * 原 compact() 的超时降级路径与此同语义，此处抽为独立方法供缓存未命中的即时路径复用。
   */
  private static mechanicalFold(messages: Message[]): CompactionResult {
    const keep = Math.min(FALLBACK_KEEP_COUNT, messages.length);
    const kept = messages.slice(-keep);
    return {
      compacted: kept,
      truncatedMessages: messages.length - keep,
      estimatedTokens: this.estimateTokens(kept),
    };
  }

  /**
   * 后台预计算 LLM 摘要并写 Redis（进程内去重；失败静默，不影响主流程）。
   * 计算的是「当前这一刻」的早期消息摘要；若下一轮消息继续增长导致 sourceCount
   * 不再匹配，会再次触发后台预计算（渐进收敛，每轮最多一次）。
   */
  private static scheduleSummaryCompute(sessionId: string, messages: Message[]): void {
    if (backgroundJobs.has(sessionId)) return;
    backgroundJobs.add(sessionId);
    void (async () => {
      try {
        const recentCount = KEEP_RECENT_ROUNDS * 2;
        const earlyMessages = messages.slice(0, -recentCount);
        const summary = await this.summarizeWithLLM(earlyMessages);
        await redisClient.set(
          `${REDIS_PREFIX}${sessionId}`,
          { summary, sourceCount: earlyMessages.length } satisfies CachedSummary,
          SUMMARY_CACHE_TTL_SECONDS,
        );
      } catch (e) {
        console.warn('[Agent:Compaction] 后台摘要计算失败（下次超阈值时重试）:', (e as Error)?.message);
      } finally {
        backgroundJobs.delete(sessionId);
      }
    })();
  }

  /**
   * 执行上下文压缩
   *
   * 策略：
   * 1. 保留最近 KEEP_RECENT_ROUNDS × 2 条消息（KEEP_RECENT_ROUNDS 轮完整对话）
   * 2. 对更早的消息调用 LLM 生成结构化摘要（6 段式）
   * 3. LLM 调用超时时降级为机械折叠：只保留最近 FALLBACK_KEEP_COUNT 条消息
   *
   * @param messages  原始对话消息数组
   * @returns         压缩结果
   */
  static async compact(messages: Message[]): Promise<CompactionResult> {
    const recentCount = KEEP_RECENT_ROUNDS * 2;

    // 如果消息总数不足保留量，直接返回
    if (messages.length <= recentCount) {
      return {
        compacted: [...messages],
        estimatedTokens: this.estimateTokens(messages),
      };
    }

    const earlyMessages = messages.slice(0, -recentCount);
    const recentMessages = messages.slice(-recentCount);

    try {
      // 优先使用 LLM 生成结构化摘要
      const summary = await this.summarizeWithLLM(earlyMessages);

      const summaryMessage: Message = {
        role: 'system',
        content: `[上下文摘要]\n${summary}`,
      };

      const compacted = [summaryMessage, ...recentMessages];
      const estimatedTokens = this.estimateTokens(compacted);

      return {
        compacted,
        summary,
        truncatedMessages: earlyMessages.length,
        estimatedTokens,
      };
    } catch {
      // 超时或 LLM 不可用时降级为机械折叠
      const fallbackMessages = messages.slice(-FALLBACK_KEEP_COUNT);
      const estimatedTokens = this.estimateTokens(fallbackMessages);

      return {
        compacted: fallbackMessages,
        truncatedMessages: messages.length - fallbackMessages.length,
        estimatedTokens,
      };
    }
  }

  /**
   * 调用 LLM 对早期消息生成结构化摘要
   *
   * 输出格式为 Markdown，包含 6 段（实际为 7 段，涵盖用户列出的所有维度）：
   * Standing facts / Goal / Decisions / Files / Commands / Errors / Pending
   */
  private static async summarizeWithLLM(messages: Message[]): Promise<string> {
    const conversationText = messages
      .map((m) => `[${m.role}]\n${m.content}`)
      .join('\n\n---\n\n');

    const prompt = `请对以下对话历史进行结构化摘要，提炼对后续对话有长期参考价值的关键信息。

使用以下 6 段式 Markdown 格式：

## Standing facts
（当前已确认无误的事实、背景信息与环境状态）

## Goal
（用户的核心目标与当前正在执行的任务）

## Decisions
（已做出的决定、达成的共识与选定的方案）

## Files
（涉及的文件路径、代码模块、文档名称与关键变更）

## Commands
（已执行的重要命令及其结果摘要）

## Errors & Pending
（遇到的错误、异常以及待办/未完成的事项）

要求：
- 保持客观，只基于对话原文提炼，不添加推测
- 省略一次性讨论细节和中间试探过程
- 每条摘要使用简洁的项目符号（-）

对话历史：
${conversationText}`;

    // LlmService.chat() 返回 Promise<string>
    const result = await LlmService.chat(prompt, {
      temperature: 0.3,
      timeout: SUMMARY_TIMEOUT_SECONDS,
    });

    return result;
  }
}
