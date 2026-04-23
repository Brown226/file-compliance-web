import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  createTask,
  getTasks,
  getTaskById,
  getTaskDetails,
  getTaskProgress,
  getTaskFileContent,
  updateTaskStatus,
  exportTaskReport,
  deleteTask,
  deleteTasks,
  reReviewTask,
  uploadRefFiles,
  getReviewModes,
  toggleFalsePositive,
  getModeCapabilities,
  saveModeCapabilities,
} from '../controllers/task.controller';

const router = Router();

// 配置文件上传 - 支持中文文件名
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // 处理中文文件名编码：
    // 1. 先尝试 decodeURIComponent（某些客户端/Node.js HTTP 会 URL 编码中文）
    // 2. 再尝试 latin1→utf8 解码（某些浏览器以 latin1 传输中文）
    let originalName = file.originalname;
    try {
      const decoded = decodeURIComponent(file.originalname);
      if (decoded !== file.originalname) {
        originalName = decoded;
      }
    } catch (e) {
      // decodeURIComponent 失败则忽略
    }
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
      if (/[\u4e00-\u9fff\u3000-\u303f]/.test(decoded) && !/[�]/.test(decoded)) {
        originalName = decoded;
      }
    } catch (e) {
      // 解码失败则使用原始名称
    }
    // 移除文件名中的特殊字符，保留中文、英文、数字、常见符号
    const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_');
    cb(null, `${uniqueSuffix}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 限制
});

// 所有任务接口都需要认证
router.use(authenticate);

// 创建任务 - 支持批量文件上传
router.post('/', upload.array('files', 50), createTask);

// 审查模式列表（必须在 /:id 路由之前）
router.get('/review-modes', getReviewModes);

// 审查模式能力配置（读写）
router.get('/mode-capabilities', getModeCapabilities);
router.put('/mode-capabilities', requireRole('ADMIN'), saveModeCapabilities);

// 更新任务状态 - 仅管理员
router.patch('/:id/status', requireRole('ADMIN'), updateTaskStatus);

// 查询接口
router.get('/', getTasks);
router.get('/:id', getTaskById);
router.get('/:id/details', getTaskDetails);
router.get('/:id/progress', getTaskProgress);
router.get('/:id/files/:fileId/content', getTaskFileContent);
router.get('/:id/export', exportTaskReport);

// 删除接口 - 单个删除和批量删除
router.delete('/:id', deleteTask);
router.delete('/', deleteTasks);

// 重新审核
router.post('/:id/review', reReviewTask);

// 上传参照文件（以文审文模式）
router.post('/:id/ref-files', upload.array('files', 20), uploadRefFiles);

// 标记/取消标记误报
router.patch('/details/:detailId/false-positive', toggleFalsePositive);

export default router;
