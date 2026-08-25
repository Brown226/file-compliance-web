/**
 * Redis 分布式锁工具类
 *
 * 基于 Redis SET NX EX 原子操作，支持：
 * - 阻塞/非阻塞获取锁
 * - 自动过期防止死锁
 * - Watchdog 自动续期
 * - Lua 脚本原子释放
 *
 * 借鉴 ContractReviewSystem redis_lock.py 的实现。
 */

import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../utils/redis';

const LUA_RELEASE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const LUA_EXTEND = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export class RedisLock {
  private lockKey: string;
  private lockValue: string;
  private timeout: number;
  private acquired: boolean = false;
  /** 最近一次 acquire() 因 Redis 异常失败的错误。供调用方区分「并发冲突」与「锁服务故障」。 */
  public lastError: unknown = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private extendInterval: number;

  /**
   * @param lockKey 锁的键名（自动添加 lock: 前缀）
   * @param timeout 锁过期时间（秒），默认 30
   * @param autoExtend 是否启用 Watchdog 自动续期，默认 false
   * @param extendInterval 续期间隔（秒），默认 timeout/3
   */
  constructor(
    lockKey: string,
    timeout: number = 30,
    private autoExtend: boolean = false,
    extendInterval?: number,
  ) {
    this.lockKey = `lock:${lockKey}`;
    this.lockValue = uuidv4();
    this.timeout = timeout;
    this.extendInterval = extendInterval ?? Math.max(1, Math.floor(timeout / 3));
  }

  /**
   * 获取锁（非阻塞）
   * @returns 是否成功获取锁
   */
  async acquire(): Promise<boolean> {
    this.lastError = null;
    try {
      // ioredis 类型定义不支持 NX+EX 组合，使用 as any 绕过
      const client = redisClient.getClient() as any;
      const result: string | null = await client.set(this.lockKey, this.lockValue, 'NX', 'EX', this.timeout);
      this.acquired = result === 'OK';

      if (this.acquired && this.autoExtend) {
        this.startWatchdog();
      }

      return this.acquired;
    } catch (e) {
      // 记录故障原因：调用方据此区分「未抢到锁（并发冲突）」与「Redis 异常（锁服务故障）」
      this.lastError = e;
      console.error('[RedisLock] 获取锁失败:', e);
      return false;
    }
  }

  /**
   * 获取锁（阻塞，带重试间隔）
   * @param maxWaitMs 最大等待时间（毫秒），默认 30000
   * @param retryIntervalMs 重试间隔（毫秒），默认 500
   */
  async acquireBlocking(maxWaitMs: number = 30000, retryIntervalMs: number = 500): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (await this.acquire()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
    return false;
  }

  /**
   * 释放锁（Lua 脚本原子操作，确保只释放自己的锁）
   */
  async release(): Promise<void> {
    this.stopWatchdog();

    if (!this.acquired) return;

    try {
      await redisClient.getClient().eval(LUA_RELEASE, 1, this.lockKey, this.lockValue);
    } catch (e) {
      console.error('[RedisLock] 释放锁失败:', e);
    } finally {
      this.acquired = false;
    }
  }

  /**
   * 检查当前是否持有锁
   */
  isAcquired(): boolean {
    return this.acquired;
  }

  /**
   * 启动 Watchdog 自动续期
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(async () => {
      try {
        await redisClient.getClient().eval(LUA_EXTEND, 1, this.lockKey, this.lockValue, String(this.timeout));
      } catch (e) {
        console.warn('[RedisLock] Watchdog 续期失败:', e);
      }
    }, this.extendInterval * 1000);

    // 允许进程退出时不阻塞
    if (this.watchdogTimer && typeof this.watchdogTimer === 'object') {
      this.watchdogTimer.unref?.();
    }
  }

  /**
   * 停止 Watchdog
   */
  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

/**
 * 便捷函数：在回调中执行带锁的操作
 *
 * @param lockKey 锁的键名
 * @param fn 回调函数
 * @param timeout 锁过期时间（秒）
 * @param autoExtend 是否自动续期
 * @returns 是否获取到锁并执行了回调
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  timeout: number = 30,
  autoExtend: boolean = true,
): Promise<{ acquired: boolean; result?: T; error?: unknown }> {
  const lock = new RedisLock(lockKey, timeout, autoExtend);
  if (await lock.acquire()) {
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await lock.release();
    }
  }
  // error 非空 = 锁服务本身故障（Redis 异常）；error 为空 = 正常并发冲突（他人持有锁）
  return { acquired: false, error: lock.lastError ?? undefined };
}
