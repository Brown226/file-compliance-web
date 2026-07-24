/**
 * 用户在线状态服务（Presence Service）
 *
 * 基于 Redis 维护实时在线用户集合，支持 WS 心跳续期 + 异常断开兜底清理。
 *
 * 数据结构：
 * - presence:online              → Set，存所有在线 userId
 * - presence:session:<userId>    → String key，60 秒 TTL，心跳续期
 *
 * 工作流：
 * 1. WS 连接成功 → markOnline(userId)
 * 2. 前端每 25 秒发心跳 → heartbeat(userId) 续期
 * 3. WS close 事件 → markOffline(userId)
 * 4. 兜底：定时清理任务每 60 秒扫描 online set，移除 session key 已过期的 userId
 *    （应对浏览器崩溃/断网导致 close 事件丢失）
 */
import { redisClient } from '../../utils/redis';

const ONLINE_SET_KEY = 'presence:online';
const SESSION_KEY_PREFIX = 'presence:session:';
const SESSION_TTL_SECONDS = 60; // 60 秒，心跳间隔 25 秒，留 35 秒冗余

class PresenceService {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 标记用户上线（WS 连接建立时调用） */
  async markOnline(userId: string): Promise<void> {
    try {
      const client = redisClient.getClient();
      await client.sadd(ONLINE_SET_KEY, userId);
      await client.set(SESSION_KEY_PREFIX + userId, '1', 'EX', SESSION_TTL_SECONDS);
    } catch (e) {
      console.warn('[Presence] markOnline 失败:', (e as Error).message);
    }
  }

  /** 心跳续期（前端每 25 秒发心跳时调用） */
  async heartbeat(userId: string): Promise<void> {
    try {
      const client = redisClient.getClient();
      // 续期 session key；如果已过期则重新加入 online set
      const renewed = await client.set(SESSION_KEY_PREFIX + userId, '1', 'EX', SESSION_TTL_SECONDS, 'NX');
      // renewed === 'OK' 表示 key 之前不存在（已过期被清理），需要重新加入 online set
      if (renewed === 'OK') {
        await client.sadd(ONLINE_SET_KEY, userId);
      }
    } catch (e) {
      // 心跳失败静默处理，不影响业务
    }
  }

  /** 标记用户离线（WS close/error 事件时调用） */
  async markOffline(userId: string): Promise<void> {
    try {
      const client = redisClient.getClient();
      await client.srem(ONLINE_SET_KEY, userId);
      await client.del(SESSION_KEY_PREFIX + userId);
    } catch (e) {
      console.warn('[Presence] markOffline 失败:', (e as Error).message);
    }
  }

  /** 获取所有在线 userId 列表 */
  async getOnlineUserIds(): Promise<string[]> {
    try {
      const client = redisClient.getClient();
      const userIds = await client.smembers(ONLINE_SET_KEY);
      return userIds;
    } catch (e) {
      console.warn('[Presence] getOnlineUserIds 失败:', (e as Error).message);
      return [];
    }
  }

  /** 获取在线人数 */
  async getOnlineCount(): Promise<number> {
    try {
      const client = redisClient.getClient();
      const count = await client.scard(ONLINE_SET_KEY);
      return count;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 启动定时清理任务（兜底机制）
   * 每 60 秒扫描 online set，移除 session key 已过期的 userId。
   * 应对浏览器崩溃/断网导致 WS close 事件丢失的场景。
   */
  startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions().catch(() => { /* 静默 */ });
    }, 60 * 1000);
    console.log('[Presence] 兜底清理任务已启动（每 60 秒）');
  }

  /** 停止定时清理任务 */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** 清理 online set 中 session key 已过期的 userId */
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const client = redisClient.getClient();
      const userIds = await client.smembers(ONLINE_SET_KEY);
      if (userIds.length === 0) return;

      // 批量检查 session key 是否存在
      const pipeline = client.pipeline();
      userIds.forEach(uid => pipeline.exists(SESSION_KEY_PREFIX + uid));
      const results = await pipeline.exec();

      if (!results) return;
      const expiredUserIds: string[] = [];
      results.forEach((result, index) => {
        // result[0] = error, result[1] = value
        const exists = result[1] as number;
        if (exists === 0 && userIds[index]) {
          expiredUserIds.push(userIds[index]);
        }
      });

      if (expiredUserIds.length > 0) {
        await client.srem(ONLINE_SET_KEY, ...expiredUserIds);
        console.log(`[Presence] 清理过期在线会话: ${expiredUserIds.length} 个`);
      }
    } catch (e) {
      // 清理失败不影响业务
    }
  }
}

export const presenceService = new PresenceService();
