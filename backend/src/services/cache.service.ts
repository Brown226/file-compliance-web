/**
 * 缓存服务（Redis 后端）
 *
 * 支持功能：
 * - Redis 持久化缓存（跨进程共享，重启不丢失）
 * - TTL 过期（由 Redis 原生管理）
 * - 命中率统计（进程内计数器，仅观测用途）
 *
 * 使用场景：
 * - LLM 响应缓存（跨 API/Worker 进程复用，成本敏感）
 * - Embedding 查询缓存
 * - 检索结果缓存
 *
 * 设计说明：
 * - value 级方法（get/set/has/delete/mget/mset/getOrSet）为 async（Redis I/O）
 * - generateKey 为纯哈希，保持同步
 * - Redis 异常时「失败安全」：get 视为未命中、set 静默失败，不影响主流程
 * - 所有键统一 cache: 前缀，便于 clear 与隔离
 */

import crypto from 'crypto';
import { redisClient } from '../utils/redis';

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

const CACHE_PREFIX = 'cache:';

export class CacheService {
  private static defaultTTL = 300;
  private static stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };

  static configure(options: CacheOptions) {
    if (options.ttl !== undefined) {
      this.defaultTTL = options.ttl;
    }
  }

  static getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%',
      backend: 'redis',
    };
  }

  static resetStats() {
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  /** 清空所有缓存键（SCAN + DEL，仅删 cache: 前缀，异步） */
  static async clear(): Promise<void> {
    try {
      const client = redisClient.getClient();
      const stream = client.scanStream({ match: `${CACHE_PREFIX}*`, count: 200 });
      const batch: string[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (keys: string[]) => {
          if (keys.length) batch.push(...keys);
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      if (batch.length > 0) {
        await client.del(...batch);
      }
    } catch (e) {
      console.warn('[Cache] clear 失败:', (e as Error).message);
    }
    this.resetStats();
  }

  static generateKey(...parts: string[]): string {
    return crypto.createHash('md5').update(parts.join('|')).digest('hex');
  }

  static async has(key: string): Promise<boolean> {
    try {
      const exists = await redisClient.getClient().exists(CACHE_PREFIX + key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  static async get<T = any>(key: string): Promise<T | null> {
    try {
      const raw = await redisClient.getClient().get(CACHE_PREFIX + key);
      if (raw === null || raw === undefined) {
        this.stats.misses++;
        return null;
      }
      this.stats.hits++;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    } catch {
      // Redis 异常视为未命中，不影响主流程
      this.stats.misses++;
      return null;
    }
  }

  static async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      const seconds = ttl ?? this.defaultTTL;
      await redisClient.getClient().set(CACHE_PREFIX + key, payload, 'EX', seconds);
      this.stats.sets++;
    } catch (e) {
      // 缓存写入失败不影响主流程
    }
  }

  static async delete(key: string): Promise<boolean> {
    try {
      const n = await redisClient.getClient().del(CACHE_PREFIX + key);
      return n > 0;
    } catch {
      return false;
    }
  }

  static async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  static async mset(entries: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    await Promise.all(entries.map((e) => this.set(e.key, e.value, e.ttl)));
  }

  static async mdel(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  static async getOrSet<T = any>(
    key: string,
    factory: () => T | Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /** 保留兼容旧调用名，等价于 getOrSet */
  static async getOrSetAsync<T = any>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    return this.getOrSet(key, factory, ttl);
  }
}
