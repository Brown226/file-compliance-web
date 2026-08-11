import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string, stack = '') {
    super(message);
    this.statusCode = statusCode;
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if ((err as any)?.name === 'MulterError') {
    // multer 上传错误：文件超限 → 413，其余 → 400（不能当 500 处理）
    statusCode = (err as any).code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = (err as any).code === 'LIMIT_FILE_SIZE' ? '文件大小超出限制' : `上传失败: ${err.message}`;
  } else if (err instanceof SyntaxError && (err as any)?.status === 400) {
    // express.json 解析失败（body-parser SyntaxError）
    statusCode = 400;
    message = '请求体 JSON 格式错误';
  } else {
    console.error(err);
  }

  // 统一 { code, message, data } 格式
  res.status(statusCode).json({
    code: statusCode,
    message,
    data: process.env.NODE_ENV === 'development' ? { stack: err.stack } : null,
  });
};
