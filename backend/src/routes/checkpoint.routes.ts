// backend/src/routes/checkpoint.routes.ts
/**
 * 审点管理路由
 *
 * 提供审点工程化的 CRUD + 离线加工 + 预绑定触发接口。
 * 路径前缀：/api/checkpoint
 *
 * 权限：查询类（GET）所有登录用户可用；写操作（POST/PATCH/DELETE）需 MANAGER 及以上。
 */
import { Router } from 'express';
import prisma from '../config/db';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { success, error } from '../utils/response';
import { CheckpointService, CheckpointExtractorService } from '../services/standard/checkpoint';

const router = Router();

// 所有审点接口都需要认证
router.use(authenticate);

// 触发离线加工（切分 + LLM 加工 + 落库，幂等）— MANAGER 及以上
router.post('/standards/:id/checkpoints/generate', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const id = req.params.id as string;
    const { concurrency } = req.body || {};
    const result = await CheckpointExtractorService.extractAndSave(id, { concurrency });
    success(res, result, '审点生成完成');
  } catch (e) {
    console.error('[Checkpoint Route] 生成失败:', e);
    error(res, (e as Error).message, 500);
  }
});

// 查看审点列表 + 统计
router.get('/standards/:id/checkpoints', async (req, res) => {
  try {
    const id = req.params.id as string;
    const checkpoints = await CheckpointService.listByStandard(id);
    const stats = await CheckpointService.getStats(id);
    success(res, { checkpoints, stats });
  } catch (e) {
    error(res, (e as Error).message, 500);
  }
});

// 人工修正审点 — MANAGER 及以上
router.patch('/checkpoints/:id', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const id = req.params.id as string;
    const { clauseCode, mandatory, auditDimension, checkPrompt } = req.body;
    const updated = await CheckpointService.update(id, { clauseCode, mandatory, auditDimension, checkPrompt });
    success(res, updated, '审点已更新');
  } catch (e) {
    error(res, (e as Error).message, 500);
  }
});

// 删除审点 — MANAGER 及以上
router.delete('/checkpoints/:id', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const id = req.params.id as string;
    await CheckpointService.delete(id);
    success(res, null, '审点已删除');
  } catch (e) {
    error(res, (e as Error).message, 500);
  }
});

// 触发设计 chunk 预绑定 — MANAGER 及以上
router.post('/tasks/:taskId/prebind-checkpoints', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const taskId = req.params.taskId as string;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        files: true,
        taskStandards: { include: { standard: true } },
      },
    });
    if (!task) return error(res, '任务不存在', 404);

    const standardIds = task.taskStandards.map(ts => ts.standardId);
    if (standardIds.length === 0) {
      return error(res, '任务未关联标准', 400);
    }

    // TODO: 对每个文件做章节切块 + 预绑定（阶段 2 完善）
    success(res, { triggered: true }, '预绑定已触发（完整实现见阶段 2）');
  } catch (e) {
    error(res, (e as Error).message, 500);
  }
});

export default router;
