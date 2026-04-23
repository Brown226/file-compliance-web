import { Response } from 'express';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export function success<T>(res: Response, data: T, message = 'success'): Response {
  return res.json({ code: 200, message, data });
}

export function error(res: Response, message: string, code = 500, data: any = null): Response {
  // 5xx 错误保持 HTTP 状态码，4xx 错误使用 200 HTTP 状态码让前端拦截器统一处理
  return res.status(code >= 500 ? code : 200).json({ code, message, data });
}

export function paginated<T>(res: Response, data: T[], total: number, message = 'success'): Response {
  return res.json({ code: 200, message, data: { items: data, total } });
}
