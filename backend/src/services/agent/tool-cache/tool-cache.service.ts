/**
 * ToolCacheService — Agent 工具缓存服务
 *
 * 对幂等的工具调用结果做 Redis 缓存，避免重复执行相同参数的调用。
 * 全部静态方法，无需实例化。
 *
 * 缓存键生成：
 * - 普通工具：工具名 + 参数 JSON（canonical sorted keys）→ MD5 hash
 * - extract_text / chunk_document（P1-⑫）：参数 + 文件大小 + 文件 mtime + 内容 hash
 *   —— 缓存与「文件内容」绑定而非「参数 filePath」：同一文件多会话复用解析结果，
 *      文件变更（hash/size/mtime 变化）后缓存自动失效。
 *   —— 读文件算 hash 有成本：小文件（≤ CONTENT_HASH_MAX_BYTES）算完整内容 hash（精确失效），
 *      大文件只用 大小 + mtime（stat 一个 syscall，避免读大文件拖慢缓存查询）。
 * 缓存 TTL：86400 秒（24 小时）
 */

import * as fs from 'fs';
import crypto from 'crypto';
import { redisClient } from '../../../utils/redis';

/** 可缓存的工具名集合（幂等 + 结果稳定的工具） */
export const CACHEABLE_TOOLS = new Set([
  'extract_text',
  'chunk_document',
  'search_knowledge',
  'search_rule_library',
  'search_standard_checkpoints',
  'list_available_rules',
  'read_file',
  'list_uploads',
  'compare_documents',
  'extract_tables',
]);

/**
 * 缓存键与「文件内容」绑定的工具集合（P1-⑫）：
 * 这些工具的结果只依赖文件内容 + 参数（如 chunk_document 的 strategy），
 * 与参数里的 filePath 字符串本身无关，因此 key 必须包含文件内容指纹。
 */
const FILE_CONTENT_KEY_TOOLS = new Set(['extract_text', 'chunk_document', 'extract_tables']);

/** 内容 hash 计算的文件大小上限（字节）：超过该大小只取 stat（size+mtime），避免读大文件拖慢缓存 */
const CONTENT_HASH_MAX_BYTES = 10 * 1024 * 1024; // 10MB

/** 缓存 TTL：24 小时 */
const CACHE_TTL = 86400;

/** 缓存键前缀，便于 Redis 中按模式识别 */
const KEY_PREFIX = 'tool-cache:';

export class ToolCacheService {
  /**
   * 生成缓存键
   * 将工具名和参数（canonical sorted keys JSON）拼接后取 MD5。
   * extract_text / chunk_document 额外混入文件内容指纹（大小 + mtime + 内容 hash），
   * 同文件未变 → 命中缓存，文件变更 → 自动失效重新解析。
   */
  static async cacheKey(toolName: string, args: Record<string, unknown>): Promise<string> {
    const canonicalArgs = await this.buildCanonicalArgs(toolName, args);
    const hash = crypto.createHash('md5').update(`${toolName}:${canonicalArgs}`).digest('hex');
    return `${KEY_PREFIX}${hash}`;
  }

  /**
   * 构造 canonical 参数 JSON（P1-⑫）
   * 对文件内容类工具（extract_text/chunk_document）混入文件指纹：
   * - stat 文件拿 size + mtimeMs（一次 syscall，快）
   * - 小文件（≤ CONTENT_HASH_MAX_BYTES）再读内容算 sha1 —— 内容级失效，最精确
   * - 大文件不读内容，只用 size + mtime（mtime 变更即失效，避免读大文件反而拖慢缓存）
   * stat/read 失败（如文件不存在）→ 回退普通参数键，让 execute 抛原始业务错误
   */
  private static async buildCanonicalArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const filePath = args?.filePath;
    if (FILE_CONTENT_KEY_TOOLS.has(toolName) && typeof filePath === 'string') {
      try {
        const st = await fs.promises.stat(filePath);
        let contentHash = '';
        if (st.size <= CONTENT_HASH_MAX_BYTES) {
          const buf = await fs.promises.readFile(filePath);
          contentHash = crypto.createHash('sha1').update(buf).digest('hex');
        } else {
          // 大文件：只标记 mtime 来源（size + mtime 已足够判定变更）
          contentHash = `mtime:${st.mtimeMs}`;
        }
        const enriched = {
          ...args,
          __fileSize: st.size,
          __fileMtimeMs: st.mtimeMs,
          __contentHash: contentHash,
        };
        return JSON.stringify(enriched, Object.keys(enriched).sort());
      } catch (err) {
        console.warn(
          `[ToolCache] ${toolName} 计算文件缓存键失败（stat/read），回退参数键: ${(err as Error).message}`,
        );
      }
    }
    return JSON.stringify(args, Object.keys(args).sort());
  }

  /**
   * 从 Redis 读取缓存
   * @returns 缓存值或 null（未命中）
   */
  static async get(toolName: string, args: Record<string, unknown>): Promise<any | null> {
    const key = await this.cacheKey(toolName, args);
    return redisClient.get<any>(key);
  }

  /**
   * 写入 Redis 缓存
   * @param result 要缓存的结果值
   */
  static async set(toolName: string, args: Record<string, unknown>, result: any): Promise<void> {
    const key = await this.cacheKey(toolName, args);
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
