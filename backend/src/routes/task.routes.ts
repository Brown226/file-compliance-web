import { Router } from 'express';
import multer from 'multer';
import path from 'path';

import prisma from '../config/db';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole, checkTaskAccess, checkDetailAccess } from '../middlewares/rbac.middleware';
import { uploadRateLimit } from '../middlewares/rate-limit.middleware';
import { success, error } from '../utils/response';
import { getMaxUploadSizeMB } from '../utils/system-config';
import { getUserUploadDir } from '../config/upload';
import {
  createTask,
  getTasks,
  getTaskById,
  getTaskDetails,
  getTaskProgress,
  getTaskFileContent,
  getTaskFileRaw,
  convertDocToDocx,
  updateTaskStatus,
  exportTaskReport,
  exportTaskReportWord,
  deleteTask,
  deleteTasks,
  reReviewTask,
  uploadRefFiles,
  getReviewModes,
  toggleFalsePositive,
  toggleAdopt,
  getModeCapabilities,
  saveModeCapabilities,
  getReviewSummary,
  reviewIssue,
} from '../controllers/task.controller';

const router = Router();

function createStorage() {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const user = (req as any).user || {};
      const dirName = user.username || user.id || 'anonymous';
      const uploadDir = getUserUploadDir(dirName);
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      let originalName = file.originalname;
      try {
        const decoded = decodeURIComponent(file.originalname);
        if (decoded !== file.originalname) {
          originalName = decoded;
        }
      } catch (e) {}
      try {
        const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
        if (/[\u4e00-\u9fff\u3000-\u303f]/.test(decoded) && !/[�]/.test(decoded)) {
          originalName = decoded;
        }
      } catch (e) {}
      const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_');
      cb(null, `${uniqueSuffix}_${safeName}`);
    },
  });
}

const storage = createStorage();

async function createDynamicUpload(_maxFiles: number): Promise<multer.Multer> {
  const maxMB = await getMaxUploadSizeMB();
  return multer({
    storage,
    limits: { fileSize: maxMB * 1024 * 1024 },
  });
}

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// 所有任务接口都需要认证
router.use(authenticate);

// 轻量级文件上传（仅用于预分析，不需要创建任务）— 动态读取上传大小限制
router.post('/upload-only', uploadRateLimit, async (req, res, next) => {
  try {
    const dynUpload = await createDynamicUpload(50);
    dynUpload.array('files', 50)(req, res, next);
  } catch (e) { next(e); }
}, async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ code: 400, message: '没有上传文件' });
    }

    const user = (req as any).user || {};
    const dirName = user.username || user.id || 'anonymous';
    const fileInfos = files.map(f => ({
      fileName: f.originalname,
      filePath: `/uploads/${dirName}/${f.filename}`,
      fileSize: f.size,
      fileType: path.extname(f.originalname).toLowerCase().replace('.', ''),
    }));

    success(res, { files: fileInfos }, '文件上传成功');
  } catch (err) {
    console.error('Upload Only Error:', err);
    error(res, '文件上传失败', 500);
  }
});

// 创建任务 - 支持批量文件上传 + 参照文件 — 动态读取上传大小限制
router.post('/', uploadRateLimit, async (req, res, next) => {
  try {
    const dynUpload = await createDynamicUpload(50);
    dynUpload.fields([
      { name: 'files', maxCount: 50 },
      { name: 'refFiles', maxCount: 20 },
    ])(req, res, next);
  } catch (e) { next(e); }
}, createTask);

// 审查模式列表（必须在 /:id 路由之前）
router.get('/review-modes', getReviewModes);

// 审查模式能力配置（读写）
router.get('/mode-capabilities', getModeCapabilities);
router.put('/mode-capabilities', requireRole('ADMIN'), saveModeCapabilities);

// 更新任务状态 - 仅管理员
router.patch('/:id/status', requireRole('ADMIN'), updateTaskStatus);

// 查询接口（需要任务访问权限校验）
router.get('/', getTasks);
router.get('/:id', checkTaskAccess, getTaskById);
router.get('/:id/details', checkTaskAccess, getTaskDetails);
router.get('/:id/progress', checkTaskAccess, getTaskProgress);
router.get('/:id/files/:fileId/content', checkTaskAccess, getTaskFileContent);
router.get('/:id/files/:fileId/raw', checkTaskAccess, getTaskFileRaw);
router.get('/:id/files/:fileId/convert-doc', checkTaskAccess, convertDocToDocx);
router.get('/:id/export', checkTaskAccess, exportTaskReport);
router.get('/:id/export-word', checkTaskAccess, exportTaskReportWord);
router.get('/:id/review-summary', checkTaskAccess, getReviewSummary);

// 删除接口 - 批量删除和单个删除（注意顺序：精确匹配必须在参数匹配之前）
router.delete('/', deleteTasks);
router.delete('/:id', checkTaskAccess, deleteTask);

// 重新审核
router.post('/:id/review', checkTaskAccess, reReviewTask);

// 上传参照文件（以文审文模式）
router.post('/:id/ref-files', checkTaskAccess, upload.array('files', 20), uploadRefFiles);

// 标记/取消标记误报（高危修复：加 checkDetailAccess 归属校验，防任意用户篡改他人任务结果）
router.patch('/details/:detailId/false-positive', checkDetailAccess, toggleFalsePositive);
router.patch('/details/:detailId/adopt', checkDetailAccess, toggleAdopt);

// 人工复核（仅 MANAGER/ADMIN）
router.patch('/:id/details/:detailId/review', requireRole('MANAGER'), reviewIssue);

// 阶段 3：LLM 推理回放 — 查询任务级 LLM 调用日志（含 prompt/completion 全文）
router.get('/:id/llm-logs', checkTaskAccess, async (req, res) => {
  try {
    const taskId = String(req.params.id);
    const logs = await prisma.llmCallLog.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        mode: true,
        model: true,
        provider: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        latencyMs: true,
        status: true,
        errorMsg: true,
        promptFull: true,
        completionFull: true,
        ragChunks: true,
        createdAt: true,
      },
    });
    // BigInt id 序列化为 string
    const serialized = logs.map(l => ({ ...l, id: l.id.toString() }));
    success(res, serialized);
  } catch (e) {
    error(res, (e as Error).message, 500);
  }
});

export default router;
