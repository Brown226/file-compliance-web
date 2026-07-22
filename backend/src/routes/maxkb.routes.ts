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
  getApplications,
  getMaxKBEmbedUrl,
  clearMaxKBEmbedSession,
  getDocumentSegments,
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

// 获取可选的知识库列表
router.get('/knowledge-bases', getKnowledgeBases);

// 获取知识库树形结构
router.get('/knowledge-tree', getKnowledgeTree);

// 获取 MaxKB 应用列表
router.get('/applications', getApplications);

// 嵌入问答（iframe 嵌入 MaxKB 原生界面，按 userId 隔离）
router.get('/embed-url', getMaxKBEmbedUrl);
router.post('/embed-session/clear', clearMaxKBEmbedSession);

// 命中测试
router.post('/hit-test', hitTest);

// OPT-017: 分段质量审计
router.get('/knowledge/:kbId/documents/:docId/segments', getDocumentSegments);

export default router;
