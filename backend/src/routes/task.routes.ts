import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { success, error } from '../utils/response';
import {
  createTask,
  getTasks,
  getTaskById,
  getTaskDetails,
  getTaskProgress,
  getTaskFileContent,
  getTaskFileRaw,
  updateTaskStatus,
  exportTaskReport,
  exportTaskReportWord,
  deleteTask,
  deleteTasks,
  reReviewTask,
  uploadRefFiles,
  getReviewModes,
  toggleFalsePositive,
  getModeCapabilities,
  saveModeCapabilities,
  preAnalyze,
  getReviewSummary,
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

// 轻量级文件上传（仅用于预分析，不需要创建任务）
router.post('/upload-only', upload.array('files', 50), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ code: 400, message: '没有上传文件' });
    }
    
    // 返回文件信息，不创建任务
    const fileInfos = files.map(f => ({
      fileName: f.originalname,
      filePath: `/uploads/${f.filename}`,
      fileSize: f.size,
      fileType: path.extname(f.originalname).toLowerCase().replace('.', ''),
    }));
    
    success(res, { files: fileInfos }, '文件上传成功');
  } catch (err) {
    console.error('Upload Only Error:', err);
    error(res, '文件上传失败', 500);
  }
});

// 创建任务 - 支持批量文件上传
router.post('/', upload.array('files', 50), createTask);

// 审查模式列表（必须在 /:id 路由之前）
router.get('/review-modes', getReviewModes);

// 预分析 — 智能推荐审查方案（必须在 /:id 路由之前）
router.post('/pre-analyze', preAnalyze);

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
router.get('/:id/files/:fileId/raw', getTaskFileRaw);
router.get('/:id/export', exportTaskReport);
router.get('/:id/export-word', exportTaskReportWord);
router.get('/:id/review-summary', getReviewSummary);

// 删除接口 - 批量删除和单个删除（注意顺序：精确匹配必须在参数匹配之前）
router.delete('/', deleteTasks);
router.delete('/:id', deleteTask);

// 重新审核
router.post('/:id/review', reReviewTask);

// 上传参照文件（以文审文模式）
router.post('/:id/ref-files', upload.array('files', 20), uploadRefFiles);

// 标记/取消标记误报
router.patch('/details/:detailId/false-positive', toggleFalsePositive);

export default router;
