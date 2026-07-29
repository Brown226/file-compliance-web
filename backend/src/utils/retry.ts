/**
 * 通用重试工具 — 指数退避重试
 *
 * 用于 LLM 调用等可能因 5xx/429/超时 临时失败的场景，
 * 避免上层 catch 吞掉错误导致单个分片静默丢失。
 *
 * 重试策略：
 * - 5xx / 429 / 超时 / 网络层错误 → 重试
 * - 4xx（非 429）→ 不重试，直接抛错
 * - 退避间隔：baseDelay * 2^(retryNo-1)，默认 2s / 4s / 8s
 */

export interface RetryOptions {
  /** 最大重试次数（不含首次执行），默认 3 */
  retries?: number;
  /** 基础退避延迟（毫秒），默认 2000 */
  baseDelay?: number;
  /** 触发重试的 HTTP 状态码列表，默认 [429, 500, 502, 503, 504] */
  retryOn?: number[];
  /** 是否对超时错误重试，默认 true */
  retryOnTimeout?: boolean;
  /** 重试回调（用于记录日志），attempt 为重试序号（从 1 开始） */
  onRetry?: (error: Error, attempt: number) => void;
}

/** 默认重试状态码：429 限流 + 5xx 服务端错误 */
const DEFAULT_RETRY_STATUS = [429, 500, 502, 503, 504];

/** 超时错误名特征（AbortController.abort() 抛 AbortError；fetch 超时为 TimeoutError） */
const TIMEOUT_ERROR_NAMES = ['TimeoutError', 'AbortError'];

/**
 * 从错误对象中提取 HTTP 状态码
 * 兼容多种错误形态：
 * - err.status / err.statusCode（自定义附加字段）
 * - err.response.status（axios 风格）
 */
function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.status === 'number') return e.status as number;
  if (typeof e.statusCode === 'number') return e.statusCode as number;
  const resp = e.response as Record<string, unknown> | undefined;
  if (resp && typeof resp.status === 'number') return resp.status as number;
  return undefined;
}

/** 判断是否为超时类错误（错误名或消息含 timeout/abort 特征） */
function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  if (name && TIMEOUT_ERROR_NAMES.some(n => name.includes(n))) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /timeout|timed?\s*out|aborted/i.test(msg);
}

/**
 * 判断错误是否应该重试
 *
 * 规则：
 * 1. 超时错误 → 重试
 * 2. HTTP 状态码在 retryOn 列表 → 重试
 * 3. 无状态码且非超时（网络层错误如 ECONNRESET/ENOTFOUND）→ 重试（瞬时故障）
 * 4. 4xx（非 429，不在 retryOn 中）→ 不重试
 */
export function shouldRetry(
  error: unknown,
  opts: { retryOn: number[]; retryOnTimeout: boolean },
): boolean {
  // 超时错误
  if (opts.retryOnTimeout && isTimeoutError(error)) return true;

  const status = extractHttpStatus(error);

  // 状态码在重试列表
  if (status !== undefined && opts.retryOn.includes(status)) return true;

  // 有 4xx 状态码但不在重试列表 → 不重试（如 400/401/403/404）
  if (status !== undefined) return false;

  // 无状态码且非超时：视为网络层瞬时错误，允许重试
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带指数退避的重试执行器
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns fn 成功时的返回值
 * @throws 重试耗尽后抛出最后一个错误（或不可重试的原始错误）
 *
 * @example
 * ```ts
 * const result = await retryWithBackoff(() => fetch(url), {
 *   retries: 3,
 *   onRetry: (err, n) => console.log(`第 ${n} 次重试：${err.message}`),
 * });
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelay = options.baseDelay ?? 2000;
  const retryOn = options.retryOn ?? DEFAULT_RETRY_STATUS;
  const retryOnTimeout = options.retryOnTimeout ?? true;
  const onRetry = options.onRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 已是最后一次尝试，或错误不可重试 → 直接抛出
      if (attempt === retries) break;
      if (!shouldRetry(error, { retryOn, retryOnTimeout })) break;

      // 指数退避：baseDelay * 2^(attempt)
      // attempt=0 失败 → 等 baseDelay*2^0 = 2s（第 1 次重试前）
      // attempt=1 失败 → 等 baseDelay*2^1 = 4s（第 2 次重试前）
      // attempt=2 失败 → 等 baseDelay*2^2 = 8s（第 3 次重试前）
      const delay = baseDelay * Math.pow(2, attempt);

      // 通知回调（attempt+1 = 重试序号，从 1 开始）
      if (onRetry) {
        try {
          onRetry(error as Error, attempt + 1);
        } catch {
          // 回调失败不影响重试主流程
        }
      }

      await sleep(delay);
    }
  }

  throw lastError;
}
