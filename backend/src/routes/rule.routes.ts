import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getRules,
  getRuleByCode,
  updateRule,
  batchToggleRules,
  resetRulesToDefault,
  getRuleCategories,
  toggleRule,
  createRule,
  deleteRule,
  testRuleMatch,
  importRules,
  getRulePanelData,
  toggleRulesByPrefix,
} from '../controllers/rule.controller';

const router = Router();

// 规则查看 — 所有认证用户
router.use(authenticate);

// GET /api/rules/panel-data — 获取审查模式控制面板数据（统计+状态）
router.get('/panel-data', getRulePanelData);
// GET /api/rules — 获取全部规则
router.get('/', getRules);
// GET /api/rules/categories — 获取规则分类列表（必须在 /:code 之前）
router.get('/categories', getRuleCategories);

// GET /api/rules/:code — 获取单条规则
router.get('/:code', getRuleByCode);

// 写入操作 — 仅管理员
// POST /api/rules — 创建规则
router.post('/', requireRole('ADMIN'), createRule);
// POST /api/rules/import — 批量导入规则
router.post('/import', requireRole('ADMIN'), importRules);
// POST /api/rules/test-match — 测试规则匹配效果
router.post('/test-match', requireRole('ADMIN'), testRuleMatch);
// PATCH /api/rules/:code — 更新规则
router.patch('/:code', requireRole('ADMIN'), updateRule);
// DELETE /api/rules/:code — 删除规则
router.delete('/:code', requireRole('ADMIN'), deleteRule);
// POST /api/rules/:code/toggle — 切换单条规则启用/禁用
router.post('/:code/toggle', requireRole('ADMIN'), toggleRule);
// POST /api/rules/batch-toggle — 批量启用/禁用
router.post('/batch-toggle', requireRole('ADMIN'), batchToggleRules);
// POST /api/rules/toggle-by-prefix — 按前缀批量切换（审查模式控制面板用）
router.post('/toggle-by-prefix', requireRole('ADMIN'), toggleRulesByPrefix);
// POST /api/rules/reset — 重置为默认
router.post('/reset', requireRole('ADMIN'), resetRulesToDefault);

export default router;
