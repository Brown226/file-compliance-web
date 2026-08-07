/**
 * 重试策略 — 纯函数工具集
 *
 * 提供统一的错误可重试性判断、指数退避计算、401 认证重试逻辑，
 * 以及 trace 记录能力。
 *
 * 设计要点：
 * - 核心函数为纯函数（无副作用），便于测试
 * - 错误格式兼容 axios/fetch/自定义等常见风格
 */

// ──────────────────────────────── 常量 ────────────────────────────────

/** 最大重试次数（含首次重试 1，即最多重试 3 次） */
export const MAX_RETRIES = 3;

/** 退避上限（毫秒） */
export const BACKOFF_CAP_MS = 15_000;

/** 可重试的 HTTP 状态码集合 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * 网络层错误特征（不含 HTTP 状态码，但属于可重试的瞬时故障）：
 * - Node fetch/undici：ECONNRESET / ECONNREFUSED / ETIMEDOUT / EAI_AGAIN / ENOTFOUND / socket hang up
 * - ai-sdk：APICallError（网关超时无状态码）、AbortError 除外（用户主动中止不重试）
 */
const NETWORK_ERROR_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network error|network timeout|请求超时|timed out|fetch failed|connection (closed|reset|refused)/i;

// ──────────────────────────── 类型定义 ────────────────────────────

/** decideRetry 返回值 */
export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  isLastRetry: boolean;
}

// ────────────────────────── 私有函数 ──────────────────────────

/**
 * 从各种错误对象格式中提取 HTTP 状态码
 *
 * 兼容以下格式：
 * - axios: { response: { status: 502 } }
 * - fetch: { status: 502 }
 * - 自定义: { statusCode: 502 }
 * - 字符串/Error: message 中包含状态码数字（如 "502 Bad Gateway"）
 *
 * @param error 任意错误对象
 * @returns HTTP 状态码，无法提取时返回 0
 */
function extractHttpStatus(error: unknown): number {
  if (!error) return 0;

  const err = error as Record<string, any>;

  // axios 风格: { response: { status } }
  if (err.response && typeof err.response.status === 'number') {
    return err.response.status;
  }

  // fetch / 普通 HTTP 响应风格: { status }
  if (typeof err.status === 'number') {
    return err.status;
  }

  // 自定义风格: { statusCode }
  if (typeof err.statusCode === 'number') {
    return err.statusCode;
  }

  // 从 message 中提取状态码
  const message: string | undefined =
    typeof error === 'string'
      ? error
      : err.message ?? err.messageText ?? undefined;

  if (message) {
    const match = message.match(/\b([45]\d{2})\b/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return 0;
}

// ────────────────────────── 导出函数 ──────────────────────────

/**
 * 判断错误是否可重试
 *
 * 可重试的 HTTP 状态码：408（超时）、429（限流）、
 * 500/502/503/504（服务端错误）。
 *
 * 修复：网络层错误（连接重置/拒绝/超时/DNS 失败）无 HTTP 状态码，
 * 原实现一律判为不可重试——一次网络抖动即导致工具/流式调用直接失败。
 * 这里对错误信息中的网络故障特征做识别（AbortError 除外，主动中止不重试）。
 *
 * @param error 任意错误对象
 * @returns 是否应该重试
 */
export function isRetryable(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (RETRYABLE_STATUSES.has(status)) return true;

  // 主动中止不重试
  const err = error as Record<string, any>;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return false;

  const message: string | undefined =
    typeof error === 'string' ? error : (err?.message ?? err?.messageText ?? undefined);
  if (message && NETWORK_ERROR_RE.test(message)) return true;

  return false;
}

/**
 * 401 认证失败特殊重试判断
 *
 * 仅在首次失败（attemptNumber === 1）且之前曾认证成功
 * （previouslyAuthenticated === true）时重试，这表示
 * token 可能过期需要刷新。
 *
 * @param attemptNumber    当前已尝试次数（从 1 开始）
 * @param previouslyAuthenticated 之前是否成功认证过
 * @returns 是否应该重试
 */
export function shouldRetryAuth(
  attemptNumber: number,
  previouslyAuthenticated: boolean,
): boolean {
  return attemptNumber === 1 && previouslyAuthenticated === true;
}

/**
 * 计算指数退避延迟
 *
 * 公式：min(baseMs * 3^(attemptNumber-1), BACKOFF_CAP_MS)
 *
 * 典型值（baseMs=1000）：
 *   attempt 1 →  1000ms (1s)
 *   attempt 2 →  3000ms (3s)
 *   attempt 3 →  9000ms (9s)
 *   attempt 4+ → 15000ms (15s, cap)
 *
 * @param attemptNumber 当前已尝试次数（从 1 开始）
 * @param baseMs        基础延迟毫秒，默认 1000
 * @returns 等待毫秒数
 */
export function calcBackoff(
  attemptNumber: number,
  baseMs: number = 1000,
): number {
  const delay = baseMs * Math.pow(3, attemptNumber - 1);
  return Math.min(delay, BACKOFF_CAP_MS);
}

/**
 * 综合判断是否重试，并返回延迟及是否为最后一次重试
 *
 * 决策逻辑：
 * 1. 401 错误 → 委托 shouldRetryAuth 判断
 * 2. 其他可重试错误 → 检查是否超过 MAX_RETRIES
 * 3. 不可重试错误 → 不重试
 *
 * @param error                   当前错误
 * @param attemptNumber           当前已尝试次数（从 1 开始）
 * @param previouslyAuthenticated 401 场景下是否曾认证成功
 * @returns RetryDecision
 */
export function decideRetry(
  error: unknown,
  attemptNumber: number,
  previouslyAuthenticated: boolean,
): RetryDecision {
  const status = extractHttpStatus(error);

  // 401 特殊处理
  if (status === 401) {
    if (shouldRetryAuth(attemptNumber, previouslyAuthenticated)) {
      const delayMs = calcBackoff(attemptNumber);
      return {
        shouldRetry: true,
        delayMs,
        isLastRetry: attemptNumber >= MAX_RETRIES,
      };
    }
    return { shouldRetry: false, delayMs: 0, isLastRetry: true };
  }

  // 不可重试
  if (!isRetryable(error)) {
    return { shouldRetry: false, delayMs: 0, isLastRetry: true };
  }

  // 超过最大重试次数
  if (attemptNumber >= MAX_RETRIES) {
    return { shouldRetry: false, delayMs: 0, isLastRetry: true };
  }

  // 正常重试
  const delayMs = calcBackoff(attemptNumber);
  return { shouldRetry: true, delayMs, isLastRetry: attemptNumber + 1 >= MAX_RETRIES };
}
