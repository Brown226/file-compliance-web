import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { auditLog } from './middlewares/audit.middleware';
import { globalLimiter } from './middlewares/security.middleware';
import { getUploadDir, onPathChange } from './config/upload';
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
import promptTemplateRoutes from './routes/promptTemplate.routes';
import falsePositiveLibraryRoutes from './routes/falsePositiveLibrary.routes';

import systemRoutes from './routes/system.routes';
import feedbackRoutes from './routes/feedback.routes';
import announcementRoutes from './routes/announcement.routes';
import ruleLibraryRoutes from './routes/rule-library.routes';
import healthRoutes from './routes/health.routes';
import selfCheckRoutes from './routes/self-check.routes';
import llmProxyRoutes from './routes/llm-proxy.routes';
import maxkbRoutes from './routes/maxkb.routes';
import generationRoutes from './routes/generation.routes';
import polishRoutes from './routes/polish.routes';
import templateRoutes from './routes/template.routes';
import dwgVisionRoutes from './routes/dwg-vision.routes';
import checkpointRoutes from './routes/checkpoint.routes';

// 注：定时清理（scheduler）与异步队列（queue）的初始化已移至 index.ts，
// 按 PROCESS_ROLE 角色门控，避免 app.ts 被 import 时产生副作用（API/Worker 进程拆分）。

const app: Express = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// CORS：生产环境使用白名单（由 CORS_ALLOWED_ORIGINS 配置），开发环境默认放开
app.use(cors({
  origin: env.corsAllowedOrigins,
  credentials: true,
}));
app.use(morgan('dev'));

// OPT-039: 全局 API 限流
app.use('/api', globalLimiter);

// 静态文件服务：提供上传文件的访问（支持运行时切换路径）
let _staticMw = express.static(getUploadDir());
onPathChange(() => { _staticMw = express.static(getUploadDir()); });
app.use('/uploads', (req, res, next) => _staticMw(req, res, next));

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
app.use('/api/prompt-templates', promptTemplateRoutes);
app.use('/api/false-positive-library', falsePositiveLibraryRoutes);

app.use('/api/system', systemRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/self-check', selfCheckRoutes);
app.use('/api/llm-proxy', llmProxyRoutes);
app.use('/api/maxkb', maxkbRoutes);
app.use('/api/generation', generationRoutes);
app.use('/api/polish', polishRoutes);
app.use('/api/template', templateRoutes);
app.use('/api/dwg', dwgVisionRoutes);
app.use('/api/checkpoint', checkpointRoutes);
app.use('/api', healthRoutes);
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Global Error Handler
app.use(errorHandler);

export default app;
