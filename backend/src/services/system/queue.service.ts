/**
 * 异步任务队列 — 基于 Bull (Redis)
 * 替换 setImmediate，提供任务追踪、重试、并发控制
 * 
 * 延迟初始化（lazy-init）：Redis 不可用时后端仍可启动，队列降级为同步执行。
 */

import Bull from 'bull';
import { env } from '../../config/env';
import { ReviewService } from '../review/review.service';
import { DwgVisionService } from '../file/dwg-vision.service';
import prisma from '../../config/db';
import { getQueueConcurrency } from '../../utils/system-config';

export interface ReviewJobData {
  taskId: string;
  attempt?: number;
}

export interface DwgVisionJobData {
  jobKey: string;  // 前端生成的唯一 key，用于状态查询
  imageBase64: string;
  analyses: string[];
  refText?: string;
  userId: string;
  fileName?: string;  // 原始图纸文件名（用于历史回放展示）
  kbId?: string;      // Task 15: MaxKB 知识库 ID（用于 compliance 维度的 RAG 注入）
  query?: string;     // Task 15: RAG 检索查询词（可选）
}

/** 内部持有的队列实例（延迟初始化） */
let _reviewQueue: Bull.Queue<ReviewJobData> | null = null;
let _dwgVisionQueue: Bull.Queue<DwgVisionJobData> | null = null;

/** 全局降级标记 —— 在 __QUEUE_DEGRADED 为 true 时跳过所有 Redis 操作 */
declare global {
  var __QUEUE_DEGRADED: boolean | undefined;
}

/**
 * 获取审查任务队列（懒加载）
 * 首次调用时创建 Bull 实例，之后复用
 */
function getReviewQueue(): Bull.Queue<ReviewJobData> {
  if (!_reviewQueue) {
    _reviewQueue = new Bull<ReviewJobData>('review', env.redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },  // 30秒起始延迟，避免频繁重试浪费 API 调用
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400, count: 50 },
      },
    });
  }
  return _reviewQueue;
}

/**
 * 获取图纸视觉分析队列（懒加载）
 */
function getDwgVisionQueue(): Bull.Queue<DwgVisionJobData> {
  if (!_dwgVisionQueue) {
    _dwgVisionQueue = new Bull<DwgVisionJobData>('dwg-vision', env.redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },  // 10秒起始延迟
        removeOnComplete: { age: 3600, count: 200 },
        removeOnFail: { age: 86400, count: 100 },
      },
    });
  }
  return _dwgVisionQueue;
}

/** 初始化队列处理器（仅在主进程中调用一次） */
export async function initQueueProcessors(): Promise<void> {
  try {
    const queue = getReviewQueue();
    await queue.isReady();
  } catch (e) {
    console.warn('[Queue] Redis 不可用，降级为同步执行模式');
    (globalThis as any).__QUEUE_DEGRADED = true;
    return;
  }

  const queue = getReviewQueue();

  // ── 审查队列处理器 ──
  const queueConcurrency = await getQueueConcurrency();
  console.log(`[Queue] 队列并发数: ${queueConcurrency}`);
  queue.process('review', queueConcurrency, async (job) => {
    const { taskId } = job.data;
    console.log(`[Queue] 开始处理审查任务: ${taskId} (attempt ${job.attemptsMade + 1})`);

    try {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        console.warn(`[Queue] 任务不存在，跳过: ${taskId}`);
        return { skipped: true, reason: 'task_not_found' };
      }
      if (task.status === 'COMPLETED' || task.status === 'FAILED') {
        console.warn(`[Queue] 任务已完成/失败，跳过: ${taskId} (status=${task.status})`);
        return { skipped: true, reason: 'already_terminal' };
      }
      if (task.status === 'PROCESSING' && job.attemptsMade > 0) {
        // 重试时如果任务已处于 PROCESSING 状态，检查是否有文件已处理完成
        console.warn(`[Queue] 重试 PROCESSING 任务: ${taskId} (attempt ${job.attemptsMade + 1})`);
      }

      await job.progress(10);
      const result = await ReviewService.processTask(taskId);
      await job.progress(100);

      console.log(`[Queue] 审查任务完成: ${taskId}`);
      return result;
    } catch (err: any) {
      console.error(`[Queue] 审查任务失败: ${taskId}`, err.message);
      throw err;
    }
  });

  // ── 全局事件 ──
  queue.on('completed', (job, result) => {
    if (result?.skipped) {
      console.log(`[Queue] Job ${job.id} 跳过: ${result.reason}`);
    } else {
      console.log(`[Queue] Job ${job.id} 完成`);
    }
  });

  queue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job.id} 失败 (${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  });

  queue.on('stalled', (jobId) => {
    console.warn(`[Queue] Job ${jobId} 停滞，将被重试`);
  });

  console.log('[Queue] 队列处理器已启动 (review:2)');

  // ── DWG 视觉分析队列处理器 ──
  const dwgVisionQueue = getDwgVisionQueue();
  dwgVisionQueue.process('dwg-vision', 2, async (job) => {
    const { imageBase64, analyses, refText, userId, fileName, jobKey, kbId, query } = job.data;
    console.log(`[Queue] 开始处理图纸视觉分析: ${jobKey} (attempt ${job.attemptsMade + 1})`);

    try {
      await job.progress(10);
      const result = await DwgVisionService.analyze(imageBase64, analyses, refText, { userId, fileName, kbId, query });
      await job.progress(100);
      console.log(`[Queue] 图纸视觉分析完成: ${jobKey}`);
      return result;
    } catch (err: any) {
      console.error(`[Queue] 图纸视觉分析失败: ${jobKey}`, err.message);
      throw err;
    }
  });

  dwgVisionQueue.on('completed', (job) => {
    console.log(`[Queue] DWG Vision Job ${job.id} 完成`);
  });

  dwgVisionQueue.on('failed', (job, err) => {
    console.error(`[Queue] DWG Vision Job ${job.id} 失败 (${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  });

  dwgVisionQueue.on('stalled', (jobId) => {
    console.warn(`[Queue] DWG Vision Job ${jobId} 停滞，将被重试`);
  });

  console.log('[Queue] 队列处理器已启动 (dwg-vision:2)');
}

/** 添加审查任务到队列（增强版：细粒度状态检测 + 智能重入队） */
export async function addReviewJob(taskId: string): Promise<Bull.Job<ReviewJobData>> {
  // 降级模式：同步执行
  if ((globalThis as any).__QUEUE_DEGRADED) {
    console.warn('[Queue] 降级模式：同步执行审查任务', taskId);
    setImmediate(() => ReviewService.processTask(taskId).catch((err: Error) => {
      console.error(`[Queue] 降级模式同步执行失败: ${taskId}`, err.message);
    }));
    return { id: `sync:${taskId}`, data: { taskId } } as any;
  }

  const queue = getReviewQueue();
  const jobId = `review:${taskId}`;
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState().catch(() => 'unknown');
    console.log(`[Queue] 📋 发现已存在的job: ${taskId}, 当前状态=${state}`);

    // 可直接替换的终态：已完成/失败的任务
    const terminalStates = new Set(['completed', 'failed']);
    // 可强制替换的异常态：停滞/延迟/等待/暂停（可能卡住）
    const stuckStates = new Set(['stalled', 'delayed', 'waiting', 'paused']);
    // 需要警告但允许继续的状态：正在执行
    const activeState = 'active';

    if (terminalStates.has(state)) {
      await existingJob.remove().catch(() => { /* ignore */ });
      console.log(`[Queue] 🗑️ 已移除${state}状态的旧job: ${taskId}`);
    } else if (stuckStates.has(state)) {
      // 停滞/等待状态可能意味着队列处理器未正常工作
      console.warn(`[Queue] ⚠️ 强制移除停滞job: ${taskId} (原状态=${state})`);
      await existingJob.remove().catch((err) => {
        console.error(`[Queue] ❌ 移除停滞job失败: ${taskId}`, err);
        throw new Error(`无法移除停滞的任务(jobId=${existingJob.id}, state=${state}): ${err instanceof Error ? err.message : String(err)}`);
      });
    } else if (state === activeState) {
      // 任务正在执行中，拒绝重复入队并返回明确的警告信息
      console.warn(`[Queue] ⛔ 任务正在执行中，拒绝重复入队: ${taskId}`);
      const enhancedJob = existingJob as Bull.Job<ReviewJobData> & { warning?: string };
      enhancedJob.warning = '任务正在执行中，请勿重复提交。如需重新审查，请先取消当前任务。';
      return enhancedJob;
    } else {
      // unknown或其他未预料的状态，保守处理：返回现有job
      console.warn(`[Queue] ❓ 未知状态(${state})，保守返回旧job: ${taskId}`);
      return existingJob;
    }
  }

  const job = await queue.add('review', { taskId }, {
    jobId,
  });
  console.log(`[Queue] ✅ 审查任务已入队: ${taskId} (jobId=${job.id}, state=waiting)`);
  return job;
}

/** 添加图纸视觉分析任务到队列 */
export async function addDwgVisionJob(data: DwgVisionJobData): Promise<Bull.Job<DwgVisionJobData>> {
  // 降级模式：同步执行
  if ((globalThis as any).__QUEUE_DEGRADED) {
    console.warn('[Queue] 降级模式：同步执行图纸视觉分析', data.jobKey);
    setImmediate(() => DwgVisionService.analyze(data.imageBase64, data.analyses, data.refText, { userId: data.userId, fileName: data.fileName, kbId: data.kbId, query: data.query }).catch((err: Error) => {
      console.error(`[Queue] 降级模式同步执行失败: ${data.jobKey}`, err.message);
    }));
    return { id: `sync:${data.jobKey}`, data } as any;
  }

  const queue = getDwgVisionQueue();
  const job = await queue.add('dwg-vision', data, {
    jobId: `dwg-vision:${data.jobKey}`,
  });
  console.log(`[Queue] ✅ 图纸视觉分析已入队: ${data.jobKey} (jobId=${job.id})`);
  return job;
}

/** 获取图纸视觉分析任务状态 */
export async function getDwgVisionJobStatus(jobKey: string): Promise<{
  state: string;
  progress: number;
  result?: any;
  failedReason?: string;
} | null> {
  if ((globalThis as any).__QUEUE_DEGRADED) {
    return { state: 'degraded', progress: 0 };
  }
  const job = await getDwgVisionQueue().getJob(`dwg-vision:${jobKey}`);
  if (!job) return null;

  return {
    state: await job.getState(),
    progress: job.progress() as number || 0,
    result: job.returnvalue,
    failedReason: job.failedReason,
  };
}

/** 获取任务状态 */
export async function getJobStatus(taskId: string): Promise<{
  status: string;
  progress: number;
  attemptsMade: number;
  failedReason?: string;
} | null> {
  if ((globalThis as any).__QUEUE_DEGRADED) {
    return { status: 'degraded', progress: 0, attemptsMade: 0 };
  }
  const job = await getReviewQueue().getJob(`review:${taskId}`);
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
  if ((globalThis as any).__QUEUE_DEGRADED) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
  const queue = getReviewQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/** 重试失败任务 */
export async function retryJob(taskId: string): Promise<boolean> {
  if ((globalThis as any).__QUEUE_DEGRADED) {
    console.warn('[Queue] 降级模式：不支持重试', taskId);
    return false;
  }
  const job = await getReviewQueue().getJob(`review:${taskId}`);
  if (!job) return false;
  await job.retry();
  return true;
}

/** 移除任务 */
export async function removeJob(taskId: string): Promise<boolean> {
  if ((globalThis as any).__QUEUE_DEGRADED) {
    console.warn('[Queue] 降级模式：不支持移除', taskId);
    return false;
  }
  const job = await getReviewQueue().getJob(`review:${taskId}`);
  if (!job) return false;
  await job.remove();
  return true;
}

/** 优雅关闭队列 */
export async function closeQueue(): Promise<void> {
  if (_reviewQueue) {
    await _reviewQueue.close();
    console.log('[Queue] review 队列已关闭');
  }
  if (_dwgVisionQueue) {
    await _dwgVisionQueue.close();
    console.log('[Queue] dwg-vision 队列已关闭');
  }
  if (!_reviewQueue && !_dwgVisionQueue) {
    console.log('[Queue] 队列未初始化，无需关闭');
  }
}
