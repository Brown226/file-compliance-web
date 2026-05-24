import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middlewares/auth.middleware';
import { runSelfCheck, exportSelfCheckReport, getLibraryInfo } from '../controllers/self-check.controller';

const router = Router();

// Multer 配置 - 临时文件上传
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, 'selfcheck-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.docx', '.xlsx', '.xls', '.pdf'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 docx/xlsx/xls/pdf 文件'));
    }
  },
});

// 所有接口需要认证
router.use(authenticate);

// 获取可用的标准库列表
router.get('/library-info', getLibraryInfo);

// 执行自检
router.post('/run', upload.array('files', 20), runSelfCheck);

// 导出报告
router.get('/report/:id/export', exportSelfCheckReport);

export default router;
