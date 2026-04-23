import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getMaxKBStatus,
  initializeMaxKB,
  hitTest,
  saveMaxKBConfig,
  testMaxKBConnection,
  getMaxKBConfig,

  getMaxKBKnowledgeUrl,
  maxkbWebhook,
  getKnowledgeBases,
  getKnowledgeTree,
} from '../controllers/maxkb.controller';

const router = Router();

// Webhook 接口（不需要认证，MaxKB 服务器回调）
router.post('/webhook', maxkbWebhook);

// 所有 MaxKB 接口都需要认证
router.use(authenticate);

// 获取集成状态
router.get('/status', getMaxKBStatus);

// 获取 MaxKB 知识库管理页面 URL
router.get('/knowledge-url', getMaxKBKnowledgeUrl);

// 获取/保存配置
router.get('/config', getMaxKBConfig);
router.put('/config', requireRole('ADMIN'), saveMaxKBConfig);
router.post('/test-connection', requireRole('ADMIN'), testMaxKBConnection);


// 一键初始化（仅管理员）
router.post('/initialize', requireRole('ADMIN'), initializeMaxKB);

// 获取可选的知识库列表（审查时选择）
router.get('/knowledge-bases', getKnowledgeBases);

// 获取知识库树形结构（含目录分组和文档数）
router.get('/knowledge-tree', getKnowledgeTree);

// 命中测试
router.post('/hit-test', hitTest);

export default router;
