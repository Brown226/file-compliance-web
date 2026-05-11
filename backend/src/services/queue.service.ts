/**
 * 异步任务队列 — 基于 Bull (Redis)
 * 替换 setImmediate，提供任务追踪、重试、并发控制
 */

import Bull from 'bull';
import { env } from '../config/env';
import { ReviewService } from './review.service';
import prisma from '../config/db';

export interface ReviewJobData {
  taskId: string;
  /** 重试次数，由 Bull 自动管理 */
  attempt?: number;
}

/** 审查任务队列 */
export const reviewQueue = new Bull<ReviewJobData>('review', env.redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 50 },
  },
});

/** 初始化队列处理器（仅在主进程中调用一次） */
export function initQueueProcessors(): void {
  reviewQueue.process('review', 2, async (job) => {
    const { taskId } = job.data;
    console.log(`[Queue] 开始处理审查任务: ${taskId} (attempt ${job.attemptsMade + 1})`);

    try {
      // 检查任务状态，避免重复处理
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        console.warn(`[Queue] 任务不存在，跳过: ${taskId}`);
        return { skipped: true, reason: 'task_not_found' };
      }
      if (task.status === 'COMPLETED' || task.status === 'FAILED') {
        console.warn(`[Queue] 任务已完成/失败，跳过: ${taskId} (status=${task.status})`);
        return { skipped: true, reason: 'already_terminal' };
      }

      await job.progress(10);
      const result = await ReviewService.processTask(taskId);
      await job.progress(100);

      console.log(`[Queue] 审查任务完成: ${taskId}`);
      return result;
    } catch (err: any) {
      console.error(`[Queue] 审查任务失败: ${taskId}`, err.message);
      throw err; // Bull 会自动重试
    }
  });

  reviewQueue.on('completed', (job, result) => {
    if (result?.skipped) {
      console.log(`[Queue] Job ${job.id} 跳过: ${result.reason}`);
    } else {
      console.log(`[Queue] Job ${job.id} 完成`);
    }
  });

  reviewQueue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job.id} 失败 (${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  });

  reviewQueue.on('stalled', (jobId) => {
    console.warn(`[Queue] Job ${jobId} 停滞，将被重试`);
  });

  console.log('[Queue] 审查队列处理器已启动 (concurrency=2)');
}

/** 添加审查任务到队列 */
export async function addReviewJob(taskId: string): Promise<Bull.Job<ReviewJobData>> {
  const job = await reviewQueue.add('review', { taskId }, {
    jobId: `review:${taskId}`,
  });
  console.log(`[Queue] 审查任务已入队: ${taskId} (jobId=${job.id})`);
  return job;
}

/** 获取任务状态 */
export async function getJobStatus(taskId: string): Promise<{
  status: string;
  progress: number;
  attemptsMade: number;
  failedReason?: string;
} | null> {
  const job = await reviewQueue.getJob(`review:${taskId}`);
  if (!job) return null;

  return {
    status: await job.getState(),
    progress: job.progress() as number || 0,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
  };
}

/** 获取队列统计 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    reviewQueue.getWaitingCount(),
    reviewQueue.getActiveCount(),
    reviewQueue.getCompletedCount(),
    reviewQueue.getFailedCount(),
    reviewQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/** 重试失败任务 */
export async function retryJob(taskId: string): Promise<boolean> {
  const job = await reviewQueue.getJob(`review:${taskId}`);
  if (!job) return false;
  await job.retry();
  return true;
}

/** 移除任务 */
export async function removeJob(taskId: string): Promise<boolean> {
  const job = await reviewQueue.getJob(`review:${taskId}`);
  if (!job) return false;
  await job.remove();
  return true;
}

/** 优雅关闭队列 */
export async function closeQueue(): Promise<void> {
  await reviewQueue.close();
  console.log('[Queue] 队列已关闭');
}
