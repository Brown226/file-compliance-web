import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import multer from 'multer';
import {
  listCategories,
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadDocument,
  listDocuments,
  deleteDocuments,
  getStats,
} from '../controllers/knowledge-category.controller';

const router = Router();
const upload = multer({ dest: 'uploads/tmp/' });

router.use(authenticate);

// 知识子库 CRUD（管理员）
router.get('/', listCategories);
router.get('/all', listAllCategories);
router.post('/', requireRole('ADMIN', 'MANAGER'), createCategory);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), updateCategory);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteCategory);

// 文档上传（管理员）
router.post('/:id/documents', requireRole('ADMIN', 'MANAGER'), upload.single('file'), uploadDocument);

// 向量文档管理
router.get('/documents', listDocuments);
router.post('/documents/delete', requireRole('ADMIN', 'MANAGER'), deleteDocuments);
router.get('/stats', getStats);

export default router;
