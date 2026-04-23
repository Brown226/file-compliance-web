import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getSystemConfig,
  saveSystemConfig,
  testLlmConnection,
  sendLlmTest,
} from '../controllers/systemConfig.controller';

const router = Router();

// 所有系统配置接口都需要认证
router.use(authenticate);

// 测试 LLM 连接 - 仅管理员（必须在 /:key 之前注册）
router.post('/test-llm', requireRole('ADMIN'), testLlmConnection);

// 发送 LLM 测试消息 - 仅管理员（必须在 /:key 之前注册）
router.post('/test-llm-send', requireRole('ADMIN'), sendLlmTest);

// 获取系统配置 - 所有认证用户可读取
router.get('/:key', getSystemConfig);

// 保存系统配置 - 仅管理员
router.put('/:key', requireRole('ADMIN'), saveSystemConfig);

export default router;
