/**
 * Agent 批量路由 — 批量文档处理（异步任务）
 *
 * 端点（挂载于 /api/agent）：
 *   POST /batch              — 提交批量文档处理任务（异步）
 *   GET  /batch/:jobId       — 查询批量任务状态/结果
 *   GET  /batch              — 批量任务列表
 *   POST /batch/:jobId/cancel — 取消批量任务
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import {
  submitBatchJob,
  getBatchJob,
  listBatchJobs,
  cancelBatchJob,
} from '../../services/system/agent-batch-queue.service';
import type { BatchTask } from '../../services/agent/tools/batch/batch_process';

const router = Router();

// ===== 批量文档处理（P1-② 异步化）=====

const BATCH_TASKS: BatchTask[] = ['extract', 'chunk', 'summarize', 'review', 'knowledge'];

/**
 * POST /api/agent/batch — 提交批量文档处理任务（异步）
 *
 * Body: { files: [{ filePath, tasks: string[] }] }
 *   - filePath 必须是已上传到 agent_temp 的绝对路径（upload_file 返回值）
 *   - tasks ∈ { extract, chunk, summarize, review, knowledge }
 *
 * 返回：{ success, data: { id, status } } —— 客户端用 GET /batch/:id 轮询结果
 */
router.post('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const files = (req.body || {}).files;
    if (!Array.isArray(files) || files.length === 0 || files.length > 10) {
      return res.status(400).json({ success: false, message: 'files 必须是 1-10 个文件数组' });
    }
    for (const f of files) {
      if (!f || typeof f.filePath !== 'string' || !Array.isArray(f.tasks) || f.tasks.length === 0) {
        return res.status(400).json({ success: false, message: '每个文件必须包含 filePath 和 tasks' });
      }
      // 子任务去重 + 上限（BATCH_TASKS 共 5 种，超长数组是重复子任务刷 LLM 配额的入口）
      const tasks = [...new Set(f.tasks)];
      if (tasks.length > BATCH_TASKS.length) {
        return res.status(400).json({ success: false, message: `每个文件最多提交 ${BATCH_TASKS.length} 个去重后的子任务` });
      }
      f.tasks = tasks;
      for (const t of f.tasks) {
        if (!BATCH_TASKS.includes(t)) {
          return res.status(400).json({ success: false, message: `不支持的子任务: ${t}（可选 ${BATCH_TASKS.join('/')}）` });
        }
      }
    }

    const data = await submitBatchJob(userId, files as Array<{ filePath: string; tasks: BatchTask[] }>);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error('[Agent] 提交批量任务失败:', e?.message || e);
    if (/does not exist|relation/i.test(e?.message || '')) {
      return res.status(500).json({ success: false, message: 'agent_batch_jobs 表未创建，请先执行 prisma db push' });
    }
    return res.status(500).json({ success: false, message: `提交批量任务失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/batch/:jobId — 查询批量任务状态/结果
 */
router.get('/batch/:jobId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const record = await getBatchJob(String(req.params.jobId), userId);
    if (!record) return res.status(404).json({ success: false, message: '批次不存在' });
    return res.json({ success: true, data: record });
  } catch (e: any) {
    console.error('[Agent] 查询批量任务失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询批量任务失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/batch — 批量任务列表
 *
 * Query: page / pageSize
 */
router.get('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const data = await listBatchJobs(userId, page, pageSize);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error('[Agent] 批量任务列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `批量任务列表失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/batch/:jobId/cancel — 取消批量任务
 */
router.post('/batch/:jobId/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const ok = await cancelBatchJob(String(req.params.jobId), userId);
    if (!ok) return res.status(404).json({ success: false, message: '批次不存在' });
    return res.json({ success: true, data: { cancelled: true } });
  } catch (e: any) {
    console.error('[Agent] 取消批量任务失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `取消批量任务失败: ${e?.message || e}` });
  }
});

export default router;
