import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { errorHandler } from './middlewares/error.middleware';
import { auditLog } from './middlewares/audit.middleware';
import authRoutes from './routes/auth.routes';
import departmentRoutes from './routes/department.routes';
import employeeRoutes from './routes/employee.routes';
import standardRoutes from './routes/standard.routes';
import taskRoutes from './routes/task.routes';
import dashboardRoutes from './routes/dashboard.routes';
import auditRoutes from './routes/audit.routes';
import systemConfigRoutes from './routes/systemConfig.routes';
import ruleRoutes from './routes/rule.routes';
import maxkbRoutes from './routes/maxkb.routes';
import standardFolderRoutes from './routes/standardFolder.routes';
import terminologyRoutes from './routes/terminology.routes';
import promptTemplateRoutes from './routes/promptTemplate.routes';
import falsePositiveLibraryRoutes from './routes/falsePositiveLibrary.routes';
import regexRoutes from './routes/regex.routes';
import systemRoutes from './routes/system.routes';

// 定时清理孤立文件（每天凌晨2点执行）
import './services/scheduler.service';


const app: Express = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());
app.use(morgan('dev'));

// 静态文件服务：提供上传文件的访问
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
app.use('/api/maxkb', maxkbRoutes);
app.use('/api/terminology', terminologyRoutes);
app.use('/api/prompt-templates', promptTemplateRoutes);
app.use('/api/false-positive-library', falsePositiveLibraryRoutes);
app.use('/api/regex', regexRoutes);
app.use('/api/system', systemRoutes);
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Global Error Handler
app.use(errorHandler);

export default app;
