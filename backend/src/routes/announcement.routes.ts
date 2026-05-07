import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  withdrawAnnouncement,
  deleteAnnouncement,
  getAnnouncementsForAdmin,
  getAnnouncementDetail,
  getUnreadAnnouncements,
  markAnnouncementRead,
  markAllAnnouncementsRead,
  getAnnouncementHistory,
} from '../controllers/announcement.controller';

const router = Router();

// 所有路由都需要认证
router.use(authenticate);

// ===== 管理员端点 =====
router.post('/', requireRole('ADMIN'), createAnnouncement);
router.put('/:id', requireRole('ADMIN'), updateAnnouncement);
router.put('/:id/publish', requireRole('ADMIN'), publishAnnouncement);
router.put('/:id/withdraw', requireRole('ADMIN'), withdrawAnnouncement);
router.delete('/:id', requireRole('ADMIN'), deleteAnnouncement);
router.get('/admin/list', requireRole('ADMIN'), getAnnouncementsForAdmin);

// ===== 用户端点 =====
router.get('/unread', getUnreadAnnouncements);
router.post('/:id/read', markAnnouncementRead);
router.post('/read-all', markAllAnnouncementsRead);
router.get('/history', getAnnouncementHistory);
router.get('/:id', getAnnouncementDetail);

export default router;
