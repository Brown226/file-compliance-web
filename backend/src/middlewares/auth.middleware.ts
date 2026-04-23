import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token.service';

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '未提供认证 Token' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: '无效的 Token 格式' });
      return;
    }

    // 检查是否在黑名单中
    const isBlacklisted = await TokenService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      res.status(401).json({ error: 'Token 已失效，请重新登录' });
      return;
    }

    // 验证并解码
    const decoded = TokenService.verifyToken(token);
    req.user = decoded;

    // 传递原始 Token 方便后续登出使用
    (req as any).token = token;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Token 无效或已过期' });
    return;
  }
};
