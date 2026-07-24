import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { redisClient } from '../../utils/redis';

/** JWT Token payload 接口 */
export interface TokenPayload {
  id: string;
  username: string;
  role: string;
  departmentId: string | null;
  iat?: number;
  exp?: number;
}

export class TokenService {
  /**
   * 生成 JWT Token
   * @param payload 包含用户信息的数据
   */
  static generateToken(payload: TokenPayload): string {
    return jwt.sign(payload, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn as unknown as number,
    });
  }

  /**
   * 验证 JWT Token
   * @param token JWT Token 字符串
   * @returns 解码后的数据
   */
  static verifyToken(token: string): TokenPayload {
    return jwt.verify(token, env.jwtSecret) as TokenPayload;
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
