/**
 * ToolCacheService — Agent 工具缓存服务
 *
 * 对幂等的工具调用结果做 Redis 缓存，避免重复执行相同参数的调用。
 * 全部静态方法，无需实例化。
 *
 * 缓存键生成：工具名 + 参数 JSON（canonical sorted keys）→ MD5 hash
 * 缓存 TTL：86400 秒（24 小时）
 */

import crypto from 'crypto';
import { redisClient } from '../../../utils/redis';

/** 可缓存的工具名集合（幂等 + 结果稳定的工具） */
export const CACHEABLE_TOOLS = new Set([
  'extract_text',
  'search_maxkb_knowledge',
  'search_rule_library',
  'search_standard_checkpoints',
  'list_available_rules',
  'read_file',
  'list_uploads',
]);

/** 缓存 TTL：24 小时 */
const CACHE_TTL = 86400;

/** 缓存键前缀，便于 Redis 中按模式识别 */
const KEY_PREFIX = 'tool-cache:';

export class ToolCacheService {
  /**
   * 生成缓存键
   * 将工具名和参数（canonical sorted keys JSON）拼接后取 MD5
   */
  static cacheKey(toolName: string, args: Record<string, unknown>): string {
    const canonicalArgs = JSON.stringify(args, Object.keys(args).sort());
    const hash = crypto.createHash('md5').update(`${toolName}:${canonicalArgs}`).digest('hex');
    return `${KEY_PREFIX}${hash}`;
  }

  /**
   * 从 Redis 读取缓存
   * @returns 缓存值或 null（未命中）
   */
  static async get(toolName: string, args: Record<string, unknown>): Promise<any | null> {
    const key = this.cacheKey(toolName, args);
    return redisClient.get<any>(key);
  }

  /**
   * 写入 Redis 缓存
   * @param result 要缓存的结果值
   */
  static async set(toolName: string, args: Record<string, unknown>, result: any): Promise<void> {
    const key = this.cacheKey(toolName, args);
    await redisClient.set(key, result, CACHE_TTL);
  }

  /**
   * 缓存预热（简化实现）
   * 当前直接返回 0，后续可按需实现预加载逻辑
   */
  static async warmup(_userId: string, _fileType: string): Promise<number> {
    return 0;
  }
}
