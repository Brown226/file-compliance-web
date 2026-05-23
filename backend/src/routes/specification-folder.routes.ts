import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getTree,
  createFolder,
  updateFolder,
  deleteFolder,
  moveFolders,
  mergeFolders,
} from '../controllers/specification-folder.controller';

const router = Router();

router.use(authenticate);

router.get('/', getTree);
router.post('/', requireRole('ADMIN', 'MANAGER'), createFolder);
router.put('/:id', requireRole('ADMIN', 'MANAGER'), updateFolder);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteFolder);
router.post('/move', requireRole('ADMIN', 'MANAGER'), moveFolders);
router.post('/merge', requireRole('ADMIN', 'MANAGER'), mergeFolders);

export default router;