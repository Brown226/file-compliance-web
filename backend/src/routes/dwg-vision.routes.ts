import { Router } from 'express';
import { visionAnalyze, visionStatus } from '../controllers/dwg-vision.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 图纸视觉智能分析
router.post('/vision-analyze', authenticate, visionAnalyze);

// 视觉模型配置状态检查
router.get('/vision-status', authenticate, visionStatus);

export default router;
