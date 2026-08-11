/**
 * 健康检查和指标路由
 */

import { Router } from 'express';
import { HealthController } from '../controllers/health.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// 读操作保持公开（健康检查/监控探活用途），仅受全局限流保护
router.get('/health', HealthController.getHealth);
router.get('/metrics', HealthController.getMetrics);
router.get('/metrics/counters', HealthController.getCounters);
router.get('/metrics/histogram/:name', HealthController.getHistogram);
router.get('/cache/stats', HealthController.getCacheStats);
router.get('/ocr', HealthController.checkOcr);
router.get('/queue', HealthController.checkQueue);
router.get('/maxkb', HealthController.checkMaxKB);
router.get('/all', HealthController.checkAll); // OPT-037: 综合健康检查

// 写操作需 ADMIN（高危修复：此前 POST /cache/clear、POST /metrics/reset 公开可调，
// 任意人可清缓存/重置指标，影响可观测性与性能）
router.post('/cache/clear', authenticate, requireRole('ADMIN'), HealthController.clearCache);
router.post('/metrics/reset', authenticate, requireRole('ADMIN'), HealthController.resetMetrics);

export default router;
