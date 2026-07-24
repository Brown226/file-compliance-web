import { Router } from 'express';
import multer from 'multer';


import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { getUploadPath } from '../config/upload';
import {
  createFeedback,
  getMyFeedbacks,
  getFeedbackDetail,
  getAllFeedbacks,
  updateFeedbackStatus,
  deleteFeedback,
  batchUpdateStatus,
  batchDelete,
  getFeedbackStats,
  downloadAttachment,
} from '../controllers/feedback.controller';

const router = Router();

// 配置反馈文件上传
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getUploadPath('feedback')),
  filename: (_req, _file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // 处理中文文件名编码
    let originalName = _file.originalname;
    try {
      const decoded = decodeURIComponent(_file.originalname);
      if (decoded !== _file.originalname) {
        originalName = decoded;
      }
    } catch (e) {
      // decodeURIComponent 失败则忽略
    }
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
      if (/[\u4e00-\u9fff\u3000-\u303f]/.test(decoded) && !/[]/.test(decoded)) {
        originalName = decoded;
      }
    } catch (e) {
      // 解码失败则使用原始名称
    }
    // 移除文件名中的特殊字符
    const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_');
    cb(null, `${uniqueSuffix}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB 单文件限制
    files: 10, // 最多10个文件
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${file.originalname}`));
    }
  },
});

// 所有反馈接口都需要认证
router.use(authenticate);

// ===== 用户路由 =====

// 提交反馈（支持文件上传）
router.post('/', upload.array('files', 10), createFeedback);

// 获取我的反馈列表
router.get('/my', getMyFeedbacks);

// 获取反馈详情
router.get('/:id', getFeedbackDetail);

// 下载附件
router.get('/download/:fileId', downloadAttachment);

// ===== 管理员路由 =====

// 获取所有反馈列表
router.get('/admin/list', requireRole('ADMIN'), getAllFeedbacks);

// 更新反馈状态
router.put('/:id/status', requireRole('ADMIN'), updateFeedbackStatus);

// 删除反馈
router.delete('/:id', requireRole('ADMIN'), deleteFeedback);

// 批量更新状态
router.put('/admin/batch-status', requireRole('ADMIN'), batchUpdateStatus);

// 批量删除
router.delete('/admin/batch', requireRole('ADMIN'), batchDelete);

// 获取统计信息
router.get('/admin/stats', requireRole('ADMIN'), getFeedbackStats);

export default router;
