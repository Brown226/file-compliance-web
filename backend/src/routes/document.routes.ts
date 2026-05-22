/**
 * 文档管理路由
 */

import { Router } from 'express';
import { DocumentController } from '../controllers/document.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', DocumentController.listDocuments);
router.get('/stats', DocumentController.getStats);
router.get('/check-duplicate', DocumentController.checkDuplicate);
router.get('/:id', DocumentController.getDocument);
router.put('/:id', DocumentController.updateDocument);
router.delete('/:id', DocumentController.deleteDocument);
router.post('/:id/archive', DocumentController.archiveDocument);
router.post('/:id/unarchive', DocumentController.unarchiveDocument);
router.get('/:id/versions', DocumentController.listVersions);
router.get('/:id/chunks', DocumentController.getDocumentChunks);
router.post('/:id/tags', DocumentController.addTag);
router.delete('/:id/tags', DocumentController.removeTag);
router.get('/:id/versions/:version', DocumentController.getVersion);
router.post('/:id/versions/:version/restore', DocumentController.restoreVersion);

export default router;
