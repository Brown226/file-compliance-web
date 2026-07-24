import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';

const router = Router();
const dashboardController = new DashboardController();

router.use(authenticate);
router.use(auditLog);

// role: 'admin' | 'user', userId: required when role=user
router.get('/stats', dashboardController.getStats);
router.get('/trend', dashboardController.getTrend);

// OPT-015: 审查质量指标
router.get('/review-metrics', dashboardController.getReviewMetrics);
router.post('/tasks/:taskId/details/:detailId/feedback', dashboardController.submitFeedback);

// 平台运营看板扩展
router.get('/online-users', dashboardController.getOnlineUsers);
router.get('/activity', dashboardController.getActivity);
router.get('/llm-usage', dashboardController.getLlmUsage);
router.get('/department-stats', dashboardController.getDepartmentStats);

export default router;
