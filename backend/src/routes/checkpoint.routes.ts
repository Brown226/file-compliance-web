// backend/src/routes/checkpoint.routes.ts
/**
 * 审点管理路由
 *
 * 提供审点工程化的 CRUD + 离线加工 + 预绑定触发接口。
 * 路径前缀：/api/checkpoint
 */
import { Router } from 'express';
import prisma from '../config/db';
import { CheckpointService, CheckpointExtractorService } from '../services/standard/checkpoint';

const router = Router();

// 触发离线加工（切分 + LLM 加工 + 落库，幂等）
router.post('/standards/:id/checkpoints/generate', async (req, res) => {
  try {
    const { id } = req.params;
    const { concurrency } = req.body || {};
    const result = await CheckpointExtractorService.extractAndSave(id, { concurrency });
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('[Checkpoint Route] 生成失败:', e);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// 查看审点列表 + 统计
router.get('/standards/:id/checkpoints', async (req, res) => {
  try {
    const { id } = req.params;
    const checkpoints = await CheckpointService.listByStandard(id);
    const stats = await CheckpointService.getStats(id);
    res.json({ success: true, data: { checkpoints, stats } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// 人工修正审点
router.patch('/checkpoints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { clauseCode, mandatory, auditDimension, checkPrompt } = req.body;
    const updated = await CheckpointService.update(id, { clauseCode, mandatory, auditDimension, checkPrompt });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// 删除审点
router.delete('/checkpoints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await CheckpointService.delete(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// 触发设计 chunk 预绑定（阶段 2 完善完整实现）
router.post('/tasks/:taskId/prebind-checkpoints', async (req, res) => {
  try {
    const { taskId } = req.params;
    // 查任务文件 + 关联标准
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        files: true,
        taskStandards: { include: { standard: true } },
      },
    });
    if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

    const standardIds = task.taskStandards.map(ts => ts.standardId);
    if (standardIds.length === 0) {
      return res.status(400).json({ success: false, error: '任务未关联标准' });
    }

    // TODO: 对每个文件做章节切块 + 预绑定（阶段 2 完善）
    res.json({ success: true, message: '预绑定已触发（完整实现见阶段 2）' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
