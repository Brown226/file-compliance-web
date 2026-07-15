import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getSystemConfig,
  saveSystemConfig,
  testLlmConnection,
  sendLlmTest,
  getLlmProfiles,
  saveLlmProfiles,
  getAiCallStats,
} from '../controllers/systemConfig.controller';
import { OcrService } from '../services/ocr.service';

const router = Router();

// OCR 服务状态检测 — 无需认证（健康检查，无敏感数据）
router.get('/ocr-status', async (_req, res) => {
  const result = await OcrService.healthCheck();
  if (result.healthy) {
    res.json({ success: true, data: result.info });
  } else {
    res.json({ success: false, error: result.error });
  }
});

// 所有系统配置接口都需要认证
router.use(authenticate);

// 测试 LLM 连接 - 仅管理员（必须在 /:key 之前注册）
router.post('/test-llm', requireRole('ADMIN'), testLlmConnection);

// 发送 LLM 测试消息 - 仅管理员（必须在 /:key 之前注册）
router.post('/test-llm-send', requireRole('ADMIN'), sendLlmTest);

// LLM Profiles 管理 - 仅管理员（必须在 /:key 之前注册）
router.get('/llm-profiles', getLlmProfiles);
router.put('/llm-profiles', requireRole('ADMIN'), saveLlmProfiles);

// 可观测性 P2：AI 调用看板统计 - 仅管理员（必须在 /:key 之前注册）
router.get('/ai-call-stats', requireRole('ADMIN'), getAiCallStats);

// 获取系统配置 - 所有认证用户可读取
router.get('/:key', getSystemConfig);

// 保存系统配置 - 仅管理员
router.put('/:key', requireRole('ADMIN'), saveSystemConfig);

export default router;
