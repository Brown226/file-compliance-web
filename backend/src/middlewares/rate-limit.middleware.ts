import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../utils/redis';

/**
 * 基于 Redis 的固定窗口限流中间件（不引入新依赖，复用现有 ioredis）
 *
 * 设计要点：
 * - 固定窗口计数：INCR + 首次 EXPIRE，原子性足够应对登录/上传等场景
 * - Redis 不可用时「失败放行」（fail-open），不因限流组件故障拖垮主业务
 * - 限流键包含路由标识 + 客户端 IP，避免不同接口互相干扰
 */
export interface RateLimitOptions {
  /** 窗口时长（秒） */
  windowSeconds: number;
  /** 窗口内最大请求数 */
  max: number;
  /** 限流键前缀（区分不同接口） */
  keyPrefix: string;
  /** 超限时的提示信息 */
  message?: string;
}

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  const { windowSeconds, max, keyPrefix, message } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    const key = `ratelimit:${keyPrefix}:${ip}`;

    try {
      const client = redisClient.getClient();
      const current = await client.incr(key);
      if (current === 1) {
        // 首次计数时设置过期，窗口结束自动清零
        await client.expire(key, windowSeconds);
      }

      if (current > max) {
        const ttl = await client.ttl(key);
        res.setHeader('Retry-After', ttl > 0 ? ttl : windowSeconds);
        res.status(429).json({
          code: 429,
          message: message || '请求过于频繁，请稍后再试',
          data: null,
        });
        return;
      }
    } catch (e) {
      // Redis 异常时失败放行，避免限流组件故障影响主业务
      console.warn('[RateLimit] Redis 异常，本次放行:', (e as Error).message);
    }

    next();
  };
}

/** 登录限流：单 IP 每分钟最多 10 次，防暴力破解 */
export const loginRateLimit = rateLimit({
  windowSeconds: 60,
  max: 10,
  keyPrefix: 'login',
  message: '登录尝试过于频繁，请 1 分钟后再试',
});

/** 上传/建任务限流：单 IP 每分钟最多 30 次，防滥用 */
export const uploadRateLimit = rateLimit({
  windowSeconds: 60,
  max: 30,
  keyPrefix: 'upload',
  message: '上传操作过于频繁，请稍后再试',
});
