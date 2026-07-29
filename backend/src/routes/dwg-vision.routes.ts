import { Router } from 'express';
import { visionAnalyze, visionStatus, visionJobStatus, visionHistory, visionHistoryDetail } from '../controllers/dwg-vision.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 图纸视觉智能分析（入队）
router.post('/vision-analyze', authenticate, visionAnalyze);

// 视觉模型配置状态检查
router.get('/vision-status', authenticate, visionStatus);

// 图纸视觉分析任务状态查询
router.get('/vision-job-status/:jobKey', authenticate, visionJobStatus);

// 图纸视觉分析历史查询（Task 25）
router.get('/vision-history', authenticate, visionHistory);

// 图纸视觉分析历史详情（Task 25）
router.get('/vision-history/:id', authenticate, visionHistoryDetail);

export default router;
