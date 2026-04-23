/**
 * 提示词模板管理路由
 */

import { Router } from 'express';
import { PromptTemplateController } from '../controllers/promptTemplate.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 所有路由需要认证
router.use(authenticate);

// 模块列表
router.get('/modules', PromptTemplateController.getModules);

// 初始化内置模板
router.post('/seed', PromptTemplateController.seed);

// 批量重置
router.post('/reset-all', PromptTemplateController.resetAll);

// 单个模板操作
router.get('/:key', PromptTemplateController.getByKey);
router.put('/:key', PromptTemplateController.update);
router.post('/:key/reset', PromptTemplateController.reset);
router.patch('/:key/toggle', PromptTemplateController.toggle);

// 列表（放在最后，避免与 /modules 等冲突）
router.get('/', PromptTemplateController.list);

export default router;
