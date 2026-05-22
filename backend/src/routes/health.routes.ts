/**
 * 健康检查和指标路由
 */

import { Router } from 'express';
import { HealthController } from '../controllers/health.controller';

const router = Router();

router.get('/health', HealthController.getHealth);
router.get('/metrics', HealthController.getMetrics);
router.get('/metrics/counters', HealthController.getCounters);
router.get('/metrics/histogram/:name', HealthController.getHistogram);
router.get('/cache/stats', HealthController.getCacheStats);
router.post('/cache/clear', HealthController.clearCache);
router.post('/metrics/reset', HealthController.resetMetrics);

export default router;
