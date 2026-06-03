import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middlewares/auth.middleware';
import { runSelfCheck, exportSelfCheckReport, getLibraryInfo } from '../controllers/self-check.controller';
import { getUploadPath } from '../config/upload';

const router = Router();

// Multer 配置 - 自检文件上传
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getUploadPath('selfcheck')),
  filename: (_req, file, cb) => {
    cb(null, 'selfcheck-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.doc', '.docx', '.xls', '.xlsx', '.pdf', '.ppt', '.pptx', '.dwg', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 doc/docx/xls/xlsx/pdf/ppt/pptx/dwg/txt 文件'));
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
