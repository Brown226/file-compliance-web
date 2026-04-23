import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { redisClient } from '../utils/redis';

export class TokenService {
  /**
   * 生成 JWT Token
   * @param payload 包含用户信息的数据
   * @returns JWT Token 字符串
   */
  static generateToken(payload: { id: string; role: string; departmentId: string | null }): string {
    return jwt.sign(payload, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn as any,
    });
  }

  /**
   * 验证 JWT Token
   * @param token JWT Token 字符串
   * @returns 解码后的数据
   */
  static verifyToken(token: string): any {
    return jwt.verify(token, env.jwtSecret);
  }

  /**
   * 将 Token 加入黑名单 (登出时使用)
   * @param token JWT Token
   * @param expiresIn 剩余过期时间(秒)
   */
  static async blacklistToken(token: string, expiresIn: number): Promise<void> {
    const key = `blacklist:${token}`;
    await redisClient.set(key, 'true', expiresIn);
  }

  /**
   * 检查 Token 是否在黑名单中
   * @param token JWT Token
   * @returns boolean
   */
  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const key = `blacklist:${token}`;
    const value = await redisClient.get<string>(key);
    return value === 'true';
  }
}
