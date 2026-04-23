import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import FileCleanupService from '../services/file-cleanup.service';
import path from 'path';

const router = Router();

// 获取存储统计信息
router.get('/storage-stats', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const stats = await FileCleanupService.getStorageStats(uploadsDir);

    res.json({
      code: 200,
      message: 'success',
      data: {
        ...stats,
        totalSizeMB: (stats.totalSize / 1024 / 1024).toFixed(2),
        referencedSizeMB: (stats.referencedSize / 1024 / 1024).toFixed(2),
        orphanedSizeMB: (stats.orphanedSize / 1024 / 1024).toFixed(2),
      }
    });
  } catch (error: any) {
    console.error('获取存储统计失败:', error);
    res.status(500).json({ success: false, message: '获取存储统计失败', error: error.message });
  }
});

// 清理孤立文件（保留最近7天的）
router.post('/cleanup-files', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const daysOld = parseInt(req.query.days as string) || 7;
    const uploadsDir = path.join(__dirname, '../../uploads');

    const result = await FileCleanupService.cleanupOrphanedFiles(uploadsDir, daysOld);

    res.json({
      code: 200,
      message: `已清理 ${result.deleted} 个孤立文件，释放 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`,
      data: result
    });
  } catch (error: any) {
    console.error('清理文件失败:', error);
    res.status(500).json({ success: false, message: '清理文件失败', error: error.message });
  }
});

export default router;
