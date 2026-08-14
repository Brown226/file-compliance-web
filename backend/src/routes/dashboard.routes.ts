import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';
import { checkDetailAccess } from '../middlewares/rbac.middleware';

const router = Router();
const dashboardController = new DashboardController();

router.use(authenticate);
router.use(auditLog);

// role: 'admin' | 'user', userId: required when role=user
router.get('/stats', dashboardController.getStats);
router.get('/trend', dashboardController.getTrend);

// OPT-015: 审查质量指标
router.get('/review-metrics', dashboardController.getReviewMetrics);
// P1-4: feedback 挂 checkDetailAccess 归属校验（此前仅 authenticate，任意用户可对任意 detail 灌水指标）
router.post('/tasks/:taskId/details/:detailId/feedback', checkDetailAccess, dashboardController.submitFeedback);

// 平台运营看板扩展
router.get('/online-users', dashboardController.getOnlineUsers);
router.get('/activity', dashboardController.getActivity);
router.get('/llm-usage', dashboardController.getLlmUsage);
router.get('/department-stats', dashboardController.getDepartmentStats);

export default router;
