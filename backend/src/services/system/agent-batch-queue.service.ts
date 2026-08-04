/**
 * 批量文档处理异步队列服务（P1-②）
 *
 * 基于 Bull（Redis）的异步批次任务：
 * - 复用 batch_process 的核心执行逻辑（runBatchProcess），不重复实现
 * - lazy-init + Redis 降级（与 queue.service 同模式）
 * - Prisma AgentBatchJob 落库：状态 / 进度 / 结果 / 失败原因
 *
 * API：
 * - submitBatchJob(userId, files) → 创建记录 + 入队
 * - getBatchJob(jobId, userId) → 查询批次状态/结果
 * - listBatchJobs(userId, page, pageSize) → 批次列表
 * - cancelBatchJob(jobId, userId) → 取消批次
 * - initAgentBatchQueue() → 注册队列处理器（主进程启动时调用一次）
 */

import Bull from 'bull';
import { env } from '../../config/env';
import prisma from '../../config/db';
import { runBatchProcess, type BatchTask } from '../agent/tools/batch/batch_process';
import type { ToolContext } from '../agent/tools/file/upload_file';

/** 批量任务队列数据 */
export interface AgentBatchJobData {
  jobRecordId: string; // Prisma AgentBatchJob.id
  userId: string;
  files: Array<{ filePath: string; tasks: BatchTask[] }>;
}

/** 内部持有的队列实例（延迟初始化） */
let _batchQueue: Bull.Queue<AgentBatchJobData> | null = null;

/** 全局降级标记（复用 queue.service 的声明，此处只读判断） */
declare global {
  var __QUEUE_DEGRADED: boolean | undefined;
}

/** 获取批量任务队列（懒加载） */
function getBatchQueue(): Bull.Queue<AgentBatchJobData> {
  if (!_batchQueue) {
    _batchQueue = new Bull<AgentBatchJobData>('agent-batch', env.redisUrl, {
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: { age: 86400, count: 200 },
      },
    });
  }
  return _batchQueue;
}

/**
 * 初始化批量队列处理器（主进程启动时调用一次）
 * Redis 不可用时降级为同步执行（__QUEUE_DEGRADED=true）
 */
export async function initAgentBatchQueue(): Promise<void> {
  try {
    const queue = getBatchQueue();
    await queue.isReady();
  } catch (e) {
    console.warn('[AgentBatch] Redis 不可用，批量任务降级为同步执行');
    (globalThis as any).__QUEUE_DEGRADED = true;
    return;
  }

  const queue = getBatchQueue();
  queue.process('agent-batch', 2, async (job) => {
    const { jobRecordId, userId, files } = job.data;
    console.log(`[AgentBatch] 开始处理批次 ${jobRecordId} (${files.length} 文件, attempt ${job.attemptsMade + 1})`);

    try {
      await prisma.agentBatchJob.update({
        where: { id: jobRecordId },
        data: { status: 'PROCESSING', progress: 5 },
      });
      await job.progress(10);

      // 构建工具上下文（路径校验需要 userId/sessionId）
      const context: ToolContext = { userId, sessionId: '' };
      const result = await runBatchProcess(files, context);

      await prisma.agentBatchJob.update({
        where: { id: jobRecordId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          total: result.total,
          succeeded: result.succeeded,
          failed: result.failed,
          result: result as any,
        },
      });
      await job.progress(100);
      console.log(`[AgentBatch] 批次完成 ${jobRecordId}: ${result.succeeded}/${result.total} 成功`);
      return result;
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`[AgentBatch] 批次失败 ${jobRecordId}:`, msg);
      await prisma.agentBatchJob.update({
        where: { id: jobRecordId },
        data: { status: 'FAILED', error: msg },
      }).catch((e) => console.warn('[AgentBatch] 写失败状态出错:', e));
      throw err;
    }
  });

  queue.on('failed', (job, err) => {
    console.error(`[AgentBatch] Job ${job.id} 失败 (${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  });
  queue.on('stalled', (jobId) => {
    console.warn(`[AgentBatch] Job ${jobId} 停滞，将被重试`);
  });

  console.log('[AgentBatch] 批量队列处理器已启动 (agent-batch:2)');
}

/** 提交批量任务 */
export async function submitBatchJob(
  userId: string,
  files: Array<{ filePath: string; tasks: BatchTask[] }>,
): Promise<{ id: string; status: string }> {
  // 落库
  const record = await prisma.agentBatchJob.create({
    data: {
      userId,
      status: 'PENDING',
      taskType: (files[0]?.tasks || []).join(',') || 'extract',
      fileCount: files.length,
      input: files as any,
    },
  });

  // 降级模式：同步执行
  if ((globalThis as any).__QUEUE_DEGRADED) {
    console.warn('[AgentBatch] 降级模式：同步执行批次', record.id);
    setImmediate(async () => {
      try {
        const context: ToolContext = { userId, sessionId: '' };
        const result = await runBatchProcess(files, context);
        await prisma.agentBatchJob.update({
          where: { id: record.id },
          data: {
            status: 'COMPLETED', progress: 100,
            total: result.total, succeeded: result.succeeded, failed: result.failed,
            result: result as any,
          },
        });
      } catch (err: any) {
        await prisma.agentBatchJob.update({
          where: { id: record.id },
          data: { status: 'FAILED', error: err?.message || String(err) },
        }).catch(() => {});
      }
    });
    return { id: record.id, status: 'PROCESSING' };
  }

  // 入队
  await getBatchQueue().add('agent-batch', {
    jobRecordId: record.id,
    userId,
    files,
  }, { jobId: `agent-batch:${record.id}` });

  return { id: record.id, status: 'PENDING' };
}

/** 查询批次状态/结果 */
export async function getBatchJob(jobId: string, userId: string) {
  const record = await prisma.agentBatchJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!record) return null;

  // 若 Redis 队列可用，附带实时队列状态
  let queueState: string | null = null;
  if (!(globalThis as any).__QUEUE_DEGRADED) {
    try {
      const job = await getBatchQueue().getJob(`agent-batch:${record.id}`);
      if (job) queueState = await job.getState();
    } catch { /* ignore */ }
  }
  return { ...record, queueState };
}

/** 批次列表 */
export async function listBatchJobs(userId: string, page = 1, pageSize = 20) {
  const where = { userId };
  const [records, total] = await Promise.all([
    prisma.agentBatchJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.agentBatchJob.count({ where }),
  ]);
  return { records, total, page, pageSize };
}

/** 取消批次（仅 PENDING/PROCESSING 可取消） */
export async function cancelBatchJob(jobId: string, userId: string): Promise<boolean> {
  const record = await prisma.agentBatchJob.findFirst({ where: { id: jobId, userId } });
  if (!record) return false;
  if (record.status !== 'PENDING' && record.status !== 'PROCESSING') {
    throw new Error(`当前状态(${record.status})不可取消`);
  }

  // 尝试移除队列中的 job
  if (!(globalThis as any).__QUEUE_DEGRADED) {
    try {
      const job = await getBatchQueue().getJob(`agent-batch:${record.id}`);
      if (job) {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'paused') {
          await job.remove();
        }
      }
    } catch (e) {
      console.warn('[AgentBatch] 移除队列 job 失败（继续标记取消）:', e);
    }
  }

  await prisma.agentBatchJob.update({
    where: { id: jobId },
    data: { status: 'CANCELLED', error: '用户取消' },
  });
  return true;
}
