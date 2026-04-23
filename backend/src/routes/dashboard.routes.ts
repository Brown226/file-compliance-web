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

export default router;
