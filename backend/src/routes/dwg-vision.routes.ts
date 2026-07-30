import { Router } from 'express';
import { visionAnalyze, visionStatus, visionJobStatus, visionHistory, visionHistoryDetail, visionStream, visionLlmLogs, visionCrossFileCompare } from '../controllers/dwg-vision.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 图纸视觉智能分析（入队）
router.post('/vision-analyze', authenticate, visionAnalyze);

// Task 16: SSE 流式推送分析进度（长连接，需在 vite.config.ts 单独代理）
router.get('/vision-stream/:jobKey', authenticate, visionStream);

// 视觉模型配置状态检查
router.get('/vision-status', authenticate, visionStatus);

// 图纸视觉分析任务状态查询
router.get('/vision-job-status/:jobKey', authenticate, visionJobStatus);

// 图纸视觉分析历史查询（Task 25）
router.get('/vision-history', authenticate, visionHistory);

// 图纸视觉分析历史详情（Task 25）
router.get('/vision-history/:id', authenticate, visionHistoryDetail);

// Task 29: LLM 调用日志查询（推理回放抽屉用，按 traceId=jobKey 查询）
router.get('/vision-llm-logs/:traceId', authenticate, visionLlmLogs);

// Task 39: 跨文件轴线对齐比对（从历史记录选 ≥2 条做交叉一致性检查）
router.post('/vision-cross-compare', authenticate, visionCrossFileCompare);

export default router;
