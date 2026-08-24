/**
 * OPT-039: 安全加固中间件
 *
 * 1. API Rate Limiting（防暴力破解/DDoS）
 * 2. 文件上传 MIME + magic bytes 双重校验
 */

import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// ===== Rate Limiting =====

/**
 * 全局 API 限流：每 IP 每 15 分钟最多 500 次请求
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试', data: null },
  skip: (req: Request) => {
    // 健康检查不限流
    return req.path === '/health' || req.path.startsWith('/api/health');
  },
});

// ===== 文件上传校验 =====

/** 允许的文件扩展名 → MIME 类型映射 */
const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pdf': ['application/pdf'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.dwg': ['application/octet-stream', 'image/vnd.dwg'],
  '.txt': ['text/plain'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
};

/** 文件 magic bytes 签名 */
const MAGIC_BYTES: Array<{ ext: string[]; bytes: number[]; offset?: number }> = [
  { ext: ['.pdf'], bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { ext: ['.docx', '.xlsx', '.pptx'], bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK (ZIP)
  { ext: ['.doc', '.xls', '.ppt'], bytes: [0xD0, 0xCF, 0x11, 0xE0] }, // OLE2
  { ext: ['.jpg', '.jpeg'], bytes: [0xFF, 0xD8, 0xFF] },
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4E, 0x47] },
  { ext: ['.gif'], bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ['.webp'], bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF
];

/**
 * 校验文件扩展名是否在白名单中
 */
export function isAllowedExtension(fileName: string): boolean {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase();
  return ext in ALLOWED_FILE_TYPES;
}

/**
 * 校验文件 MIME 类型是否与扩展名匹配
 */
export function validateFileMime(fileName: string, mimeType: string): boolean {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase();
  const allowedMimes = ALLOWED_FILE_TYPES[ext];
  if (!allowedMimes) return false;
  // 某些浏览器/系统可能报 application/octet-stream，对已知扩展名放行
  if (mimeType === 'application/octet-stream') return true;
  return allowedMimes.includes(mimeType);
}

/**
 * 校验文件 magic bytes（防止伪造扩展名）
 * 返回 true 表示通过或未找到对应签名（放行）
 */
export function validateMagicBytes(fileName: string, buffer: Buffer): boolean {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase();

  // .dwg 和 .txt 没有固定 magic bytes，跳过
  if (['.dwg', '.txt'].includes(ext)) return true;

  const signature = MAGIC_BYTES.find(s => s.ext.includes(ext));
  if (!signature) return true; // 无签名的类型放行

  const offset = signature.offset || 0;
  if (buffer.length < offset + signature.bytes.length) return false;

  return signature.bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Express 中间件：文件上传安全校验
 * 用于 multer 处理后的文件校验
 */
export function fileUploadSecurityCheck(req: Request, res: Response, next: NextFunction): void {
  const files = (req as any).files as Array<{ originalname: string; mimetype: string; buffer?: Buffer }> || [];
  const file = (req as any).file as { originalname: string; mimetype: string; buffer?: Buffer } | undefined;

  const allFiles = file ? [file, ...files] : files;

  for (const f of allFiles) {
    if (!f) continue;

    // 1. 扩展名白名单
    if (!isAllowedExtension(f.originalname)) {
      res.status(400).json({
        code: 400,
        message: `不支持的文件类型: ${f.originalname}`,
        data: null,
      });
      return;
    }

    // 2. MIME 类型校验
    if (f.mimetype && !validateFileMime(f.originalname, f.mimetype)) {
      res.status(400).json({
        code: 400,
        message: `文件类型与扩展名不匹配: ${f.originalname} (${f.mimetype})`,
        data: null,
      });
      return;
    }

    // 3. Magic bytes 校验（需要读取文件头）
    if (f.buffer && f.buffer.length > 0) {
      if (!validateMagicBytes(f.originalname, f.buffer)) {
        res.status(400).json({
          code: 400,
          message: `文件内容与扩展名不符（疑似伪造）: ${f.originalname}`,
          data: null,
        });
        return;
      }
    }
  }

  next();
}
