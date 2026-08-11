import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { auditLog } from './middlewares/audit.middleware';
import { globalLimiter } from './middlewares/security.middleware';
import { getUploadDir, onPathChange } from './config/upload';
import { TokenService } from './services/auth/token.service';
import authRoutes from './routes/auth.routes';
import departmentRoutes from './routes/department.routes';
import employeeRoutes from './routes/employee.routes';
import standardRoutes from './routes/standard.routes';
import taskRoutes from './routes/task.routes';
import dashboardRoutes from './routes/dashboard.routes';
import auditRoutes from './routes/audit.routes';
import systemConfigRoutes from './routes/systemConfig.routes';
import ruleRoutes from './routes/rule.routes';

import standardFolderRoutes from './routes/standardFolder.routes';
import terminologyRoutes from './routes/terminology.routes';
import falsePositiveLibraryRoutes from './routes/falsePositiveLibrary.routes';

import systemRoutes from './routes/system.routes';
import feedbackRoutes from './routes/feedback.routes';
import announcementRoutes from './routes/announcement.routes';
import ruleLibraryRoutes from './routes/rule-library.routes';
import healthRoutes from './routes/health.routes';
import selfCheckRoutes from './routes/self-check.routes';
import maxkbRoutes from './routes/maxkb.routes';
import dwgVisionRoutes from './routes/dwg-vision.routes';
import checkpointRoutes from './routes/checkpoint.routes';
import metricsRoutes from './routes/metrics.routes';
import agentRoutes from './routes/agent.routes';

// 注：定时清理（scheduler）与异步队列（queue）的初始化已移至 index.ts，
// 按 PROCESS_ROLE 角色门控，避免 app.ts 被 import 时产生副作用（API/Worker 进程拆分）。

const app: Express = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// 安全响应头（X-Content-Type-Options / X-Frame-Options 等）。
// 关闭 CSP：前端样式为内联注入 + MaxKB 管理面板走 iframe 嵌入，默认 CSP 会破坏两者
app.use(helmet({ contentSecurityPolicy: false }));

// CORS：生产环境使用白名单（由 CORS_ALLOWED_ORIGINS 配置），开发环境默认放开
app.use(cors({
  origin: env.corsAllowedOrigins,
  credentials: true,
}));
// 信任一层反向代理（nginx），使 req.ip 取 X-Forwarded-For 首段，
// 与 rate-limit.middleware 的 getClientIp 口径一致；直连后端时回退 socket 地址
app.set('trust proxy', 1);

// 访问日志：脱敏 URL 中的敏感 query 参数（如 /uploads?token=），避免 token 明文进日志
const sanitizeUrl = (rawUrl: string): string =>
  rawUrl.replace(/([?&](?:token|authorization|key|secret)=)[^&]+/gi, '$1***');
app.use(morgan((tokens, req, res) => {
  return [
    tokens.method(req, res),
    sanitizeUrl(tokens.url(req, res) || ''),
    tokens.status(req, res),
    `${tokens['response-time'](req, res)} ms`,
  ].join(' ');
}));

// OPT-039: 全局 API 限流
app.use('/api', globalLimiter);

// 静态文件服务：提供上传文件的访问（支持运行时切换路径）
let _staticMw = express.static(getUploadDir());
onPathChange(() => { _staticMw = express.static(getUploadDir()); });
// 安全：/uploads/agent_temp/** 是 Agent 用户上传的临时文件，匿名静态挂载会泄露任意用户文件。
// 仅对 agent_temp 子目录做登录校验（Authorization: Bearer 或 ?token=），其余子目录维持现状
// （task/feedback/selfcheck 等历史链路仍走匿名静态访问）。
app.use('/uploads', (req, res, next) => {
  const pathname = (req.path || '').replace(/\\/g, '/');
  if (!pathname.startsWith('/agent_temp/')) {
    return _staticMw(req, res, next);
  }
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = bearer || queryToken;
  if (!token) {
    return res.status(401).json({ error: '未提供认证 Token' });
  }
  try {
    TokenService.verifyToken(token);
    return _staticMw(req, res, next);
  } catch {
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
});

// Global Audit Logging (will log POST/PUT/DELETE requests)
app.use(auditLog);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/standard-folders', standardFolderRoutes);
app.use('/api/standards', standardRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/system-config', systemConfigRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/rule-libraries', ruleLibraryRoutes);

app.use('/api/terminology', terminologyRoutes);
app.use('/api/false-positive-library', falsePositiveLibraryRoutes);

app.use('/api/system', systemRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/self-check', selfCheckRoutes);
app.use('/api/maxkb', maxkbRoutes);
app.use('/api/dwg', dwgVisionRoutes);
app.use('/api/checkpoint', checkpointRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api', healthRoutes);
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// 404 JSON 兜底（与全站 { code, message, data } 格式一致，避免返回 HTML 404）
app.use((req: Request, res: Response) => {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}`, data: null });
});

// Global Error Handler
app.use(errorHandler);

export default app;
