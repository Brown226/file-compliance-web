import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import multer from 'multer';
import {
  listLibraries,
  getLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  parseRulesFromFile,
  addItem,
  updateItem,
  deleteItem,
} from '../controllers/rule-library.controller';

const router = Router();
const upload = multer({ dest: 'uploads/tmp/' });

router.use(authenticate);

// 规则库 CRUD
router.get('/', listLibraries);
router.get('/:id', getLibrary);
router.post('/', requireRole('ADMIN', 'MANAGER'), createLibrary);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), updateLibrary);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteLibrary);

// 上传文件解析规则
router.post('/:id/parse', requireRole('ADMIN', 'MANAGER'), upload.single('file'), parseRulesFromFile);

// 规则条目管理
router.post('/:id/items', requireRole('ADMIN', 'MANAGER'), addItem);
router.put('/:id/items/:itemId', requireRole('ADMIN', 'MANAGER'), updateItem);
router.delete('/:id/items/:itemId', requireRole('ADMIN', 'MANAGER'), deleteItem);

export default router;
