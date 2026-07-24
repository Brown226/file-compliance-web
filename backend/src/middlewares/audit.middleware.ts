import { Response, NextFunction } from 'express';
import { AuditService } from '../services/system/audit.service';
import { AuthRequest } from './auth.middleware';

const auditService = new AuditService();

/**
 * 敏感字段名（大小写不敏感匹配，命中即脱敏为 '***'）
 * 覆盖密码、令牌、密钥、凭证等，避免审计日志泄露敏感信息。
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'oldpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'chatusertoken',
  'apikey',
  'apisecret',
  'secret',
  'authorization',
  'credential',
  'privatekey',
];

/** 单个字符串值最大保留长度，超出截断，避免文件内容/长文本灌满日志 */
const MAX_STRING_LEN = 2000;
/** 递归脱敏的最大深度，防御深层/循环结构 */
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\-\s]/g, '');
  return SENSITIVE_KEYS.some((s) => k === s || k.includes(s));
}

/**
 * 递归脱敏：命中敏感 key 的值替换为 '***'，超长字符串截断。
 * 返回全新对象，不改动原始 req.body/query/params。
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[Truncated: max depth]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + '...[truncated]' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '***' : sanitize(v, depth + 1);
    }
    return out;
  }

  return '[Unsupported]';
}

export const auditLog = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // 仅记录写操作，在响应结束后异步写入，避免阻塞请求
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const action = req.method;
      const resource = req.originalUrl;
      const details = {
        body: sanitize(req.body),
        query: sanitize(req.query),
        params: sanitize(req.params),
        statusCode: res.statusCode,
      };

      const userId = req.user?.id; // From AuthRequest
      const ipAddress = req.ip || req.socket?.remoteAddress;

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
