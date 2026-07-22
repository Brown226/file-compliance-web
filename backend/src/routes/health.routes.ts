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
router.get('/ocr', HealthController.checkOcr);
router.get('/queue', HealthController.checkQueue);
router.get('/maxkb', HealthController.checkMaxKB);
router.get('/all', HealthController.checkAll); // OPT-037: 综合健康检查

export default router;
