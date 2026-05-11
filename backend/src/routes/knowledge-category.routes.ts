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
  uploadDocumentAsync,
  getTaskStatus,
  getActiveTasks,
  previewDocument,
  confirmImport,
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
  hitTest,
  listTags,
  createTag,
  deleteTag,
  addDocumentTag,
  removeDocumentTag,
  getDocumentTags,
  generateQuestions,
} from '../controllers/knowledge-category.controller';

const router = Router();
const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp/') });

router.use(authenticate);

// 知识子库 CRUD（管理员）
router.get('/tree', getTree);
router.get('/', listCategories);
router.get('/all', listAllCategories);

// 上传任务状态查询（必须在 /:id 之前，避免被匹配为 id 参数）
router.get('/task-status', getTaskStatus);
router.get('/active-tasks', getActiveTasks);

router.post('/', requireRole('ADMIN', 'MANAGER'), createCategory);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), updateCategory);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteCategory);

// 文档分组列表（按标题分组）
router.get('/:id/grouped-documents', listGroupedDocuments);

// 文档上传（管理员）
router.post('/:id/documents', requireRole('ADMIN', 'MANAGER'), upload.single('file'), uploadDocument);

// 异步上传（多文件，后台处理）
router.post('/:id/upload-async', requireRole('ADMIN', 'MANAGER'), upload.array('files', 10), uploadDocumentAsync);

// 分段预览确认
router.post('/:id/preview', requireRole('ADMIN', 'MANAGER'), upload.single('file'), previewDocument);
router.post('/:id/confirm-import', requireRole('ADMIN', 'MANAGER'), confirmImport);

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

// 命中测试
router.post('/hit-test', hitTest);

// 标签管理
router.get('/tags', listTags);
router.post('/tags', requireRole('ADMIN', 'MANAGER'), createTag);
router.delete('/tags/:tagId', requireRole('ADMIN', 'MANAGER'), deleteTag);

// 文档标签关联
router.get('/:id/document-tags', getDocumentTags);
router.post('/:id/document-tags', requireRole('ADMIN', 'MANAGER'), addDocumentTag);
router.delete('/:id/document-tags', requireRole('ADMIN', 'MANAGER'), removeDocumentTag);

// 问题自动生成
router.post('/:id/generate-questions', requireRole('ADMIN', 'MANAGER'), generateQuestions);

export default router;
