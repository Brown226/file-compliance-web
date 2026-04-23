import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service';
import { AuthRequest } from './auth.middleware';

const auditService = new AuditService();

export const auditLog = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Capture original end and json methods to intercept response status if needed
  // Alternatively, just log after the request is finished using res.on('finish')
  
  res.on('finish', () => {
    // We only want to log write operations (POST, PUT, PATCH, DELETE) generally,
    // but the requirement says "自动记录敏感操作并写入审计日志记录"
    // So we can check the method. If it's GET, we usually don't log it unless specified.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      // Avoid logging login/logout maybe? Or maybe we DO want to log login/logout.
      const action = req.method;
      const resource = req.originalUrl;
      const details = {
        body: req.body,
        query: req.query,
        params: req.params,
        statusCode: res.statusCode,
      };
      
      const userId = req.user?.id; // From AuthRequest
      const ipAddress = req.ip || req.socket?.remoteAddress;

      // Ensure we don't log passwords
      if (details.body && details.body.password) {
        details.body.password = '***';
      }

      auditService.createLog({
        action,
        resource,
        details,
        userId: userId || undefined,  // 避免 null/空字符串 触发外键约束
        ipAddress,
      }).catch((err: any) => {
        // P2003 = 外键约束失败（用户不存在），静默跳过
        if (err?.code !== 'P2003') {
          console.error('Failed to create audit log', err);
        }
      });
    }
  });

  next();
};
