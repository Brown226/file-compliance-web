import { Router } from 'express';
import { visionAnalyze, visionStatus, visionJobStatus, visionHistory, visionHistoryDetail, visionStream, visionLlmLogs, visionCrossFileCompare, visionUploadReference, uploadReferenceFileMiddleware } from '../controllers/dwg-vision.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireFeatureFlag } from '../middlewares/feature-flag.middleware';

const router = Router();

// ── 功能开关（entry.DWG_VISION）──
// 仅拦「产生新任务/新解析」的动作端点；只读端点（进度流、状态、历史、日志）
// 保持开放——关闭入口不应导致用户连既有历史记录都查看不了。
// 此前本文件所有端点均无开关校验，关闭「图纸视觉分析」后仍可直接调用。

// 图纸视觉智能分析（入队）
router.post('/vision-analyze', authenticate, requireFeatureFlag('entry.DWG_VISION'), visionAnalyze);

// 参照文件上传解析（Word/Excel/PDF/PPT/TXT → 文本，供合规审查注入）
router.post('/vision-upload-ref', authenticate, requireFeatureFlag('entry.DWG_VISION'), uploadReferenceFileMiddleware, visionUploadReference);

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
router.post('/vision-cross-compare', authenticate, requireFeatureFlag('entry.DWG_VISION'), visionCrossFileCompare);

export default router;
