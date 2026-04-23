import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getFolderTree,
  getAllFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} from '../controllers/standardFolder.controller';

const router = Router();

// 所有文件夹接口都需要认证
router.use(authenticate);

// 查询接口
router.get('/tree', getFolderTree);
router.get('/', getAllFolders);

// 写入接口（仅 ADMIN）
router.post('/', requireRole('ADMIN'), createFolder);
router.put('/:id', requireRole('ADMIN'), updateFolder);
router.delete('/:id', requireRole('ADMIN'), deleteFolder);

export default router;
