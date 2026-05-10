import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import multer from 'multer';
import path from 'path';
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
  getTree,
  listGroupedDocuments,
  updateDocument,
  deleteDocument,
  getDocumentParagraphs,
  updateParagraph,
  deleteParagraph,
  batchVectorize,
} from '../controllers/knowledge-category.controller';

const router = Router();
const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp/') });

router.use(authenticate);

// 知识子库 CRUD（管理员）
router.get('/tree', getTree);
router.get('/', listCategories);
router.get('/all', listAllCategories);
router.post('/', requireRole('ADMIN', 'MANAGER'), createCategory);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), updateCategory);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteCategory);

// 文档分组列表（按标题分组）
router.get('/:id/grouped-documents', listGroupedDocuments);

// 文档上传（管理员）
router.post('/:id/documents', requireRole('ADMIN', 'MANAGER'), upload.single('file'), uploadDocument);

// 单文档操作
router.put('/:id/documents', requireRole('ADMIN', 'MANAGER'), updateDocument);
router.delete('/:id/documents', requireRole('ADMIN', 'MANAGER'), deleteDocument);

// 文档段落
router.get('/:id/document-paragraphs', getDocumentParagraphs);

// 段落操作
router.put('/paragraphs/:paragraphId', requireRole('ADMIN', 'MANAGER'), updateParagraph);
router.delete('/paragraphs/:paragraphId', requireRole('ADMIN', 'MANAGER'), deleteParagraph);

// 批量向量化
router.post('/:id/batch-vectorize', requireRole('ADMIN', 'MANAGER'), batchVectorize);

// 向量文档管理
router.get('/documents', listDocuments);
router.post('/documents/delete', requireRole('ADMIN', 'MANAGER'), deleteDocuments);
router.get('/stats', getStats);

export default router;
