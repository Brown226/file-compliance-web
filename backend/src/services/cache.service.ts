/**
 * 缓存服务
 *
 * 支持功能：
 * - LRU 内存缓存
 * - TTL 过期
 * - 批量操作
 * - 命中率统计
 *
 * 使用场景：
 * - Embedding 查询缓存
 * - 检索结果缓存
 * - 配置缓存
 */

import crypto from 'crypto';

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

export interface CacheItem<T = any> {
  value: T;
  expireAt: number;
  hits: number;
  createdAt: number;
}

export class CacheService {
  private static store = new Map<string, CacheItem>();
  private static defaultTTL = 300;
  private static maxSize = 5000; // 从 1000 增至 5000，容纳 LLM 响应缓存
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
    if (options.maxSize !== undefined) {
      this.maxSize = options.maxSize;
    }
  }

  static getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.store.size,
    };
  }

  static resetStats() {
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  static clear() {
    this.store.clear();
    this.resetStats();
  }

  static generateKey(...parts: string[]): string {
    return crypto.createHash('md5').update(parts.join('|')).digest('hex');
  }

  static has(key: string): boolean {
    const item = this.store.get(key);
    if (!item) return false;

    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      return false;
    }

    item.hits++;
    return true;
  }

  static get<T = any>(key: string): T | null {
    const item = this.store.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    item.hits++;
    this.stats.hits++;
    return item.value as T;
  }

  static set<T = any>(key: string, value: T, ttl?: number): void {
    if (this.store.size >= this.maxSize) {
      this.evictLRU();
    }

    const expireAt = Date.now() + (ttl ?? this.defaultTTL) * 1000;

    this.store.set(key, {
      value,
      expireAt,
      hits: 0,
      createdAt: Date.now(),
    });

    this.stats.sets++;
  }

  static delete(key: string): boolean {
    return this.store.delete(key);
  }

  static mget<T = any>(keys: string[]): (T | null)[] {
    return keys.map((key) => this.get<T>(key));
  }

  static mset(entries: Array<{ key: string; value: any; ttl?: number }>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.value, entry.ttl);
    }
  }

  static mdel(keys: string[]): void {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  static getOrSet<T = any>(
    key: string,
    factory: () => T | Promise<T>,
    ttl?: number
  ): T | Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const result = factory();
    if (result instanceof Promise) {
      return result.then((value) => {
        this.set(key, value, ttl);
        return value;
      });
    }

    this.set(key, result, ttl);
    return result;
  }

  static async getOrSetAsync<T = any>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  private static evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    let oldestHits = Infinity;

    for (const [key, item] of this.store) {
      if (item.createdAt < oldestTime || (item.createdAt === oldestTime && item.hits < oldestHits)) {
        oldestTime = item.createdAt;
        oldestHits = item.hits;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  static cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.store) {
      if (now > item.expireAt) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired entries`);
    }
  }
}

setInterval(() => {
  CacheService.cleanup();
}, 60000);
