import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  createStandard,
  createStandardFromFile,
  getStandards,
  getStandardById,
  getStandardDetail,
  updateStandard,
  deleteStandard,
  exportStandardsExcel,
  importStandardsExcel,
  downloadTemplate,
  checkStandard,
  extractStandardRefs,
  extractFromExcelColumn,
  importTempLibrary,
  getTempLibrary,
  clearTempLibrary,
  checkStandardWithTempLibrary,
  archiveTempToStandard,
  archiveAllTempToStandard,
  importNormativeExcel,
  previewNormativeExcel,
  downloadNormativeTemplate,
} from '../controllers/standard.controller';

const router = Router();

// ===== Multer 配置 =====

const excelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, 'import-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const standardFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, 'standard-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const excelUpload = multer({
  storage: excelStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    (ext === '.xlsx' || ext === '.xls') ? cb(null, true) : cb(new Error('仅支持 .xlsx 或 .xls 文件'));
  }
});

const standardFileUpload = multer({
  storage: standardFileStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.docx', '.pdf', '.xlsx', '.xls'];
    (allowed.includes(path.extname(file.originalname).toLowerCase()))
      ? cb(null, true)
      : cb(new Error('仅支持 docx/pdf/xlsx/xls 文件'));
  }
});

// 所有标准库接口都需要认证
router.use(authenticate);

// ===== 查询接口（所有认证用户） =====

router.get('/', getStandards);
router.get('/export/excel', exportStandardsExcel);
router.get('/import/template', downloadTemplate);
router.get('/import/normative-template', downloadNormativeTemplate);
router.get('/temp-library', getTempLibrary);

// 单个标准（动态路径放后面，避免匹配固定路径）
router.get('/:id/detail', getStandardDetail);
router.get('/:id', getStandardById);

// 写入接口
router.post('/', requireRole('ADMIN'), createStandard);
router.post('/upload', requireRole('ADMIN'), standardFileUpload.single('file'), createStandardFromFile);
router.post('/import/excel', requireRole('ADMIN'), excelUpload.single('file'), importStandardsExcel);
router.post('/check', checkStandard);
router.post('/extract-refs', extractStandardRefs);
router.post('/extract/excel-column', excelUpload.single('file'), extractFromExcelColumn);
router.post('/temp-library', excelUpload.single('file'), importTempLibrary);
router.post('/check-temp', checkStandardWithTempLibrary);
router.delete('/temp-library', clearTempLibrary);
router.post('/temp-library/archive', archiveTempToStandard);
router.post('/temp-library/archive-all', archiveAllTempToStandard);
router.post('/import/normative', requireRole('ADMIN'), excelUpload.single('file'), importNormativeExcel);
router.post('/import/normative-preview', excelUpload.single('file'), previewNormativeExcel);
router.put('/:id', requireRole('ADMIN'), updateStandard);
router.delete('/:id', requireRole('ADMIN'), deleteStandard);

export default router;
