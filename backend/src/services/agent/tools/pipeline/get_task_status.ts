/**
 * get_task_status 工具 — 查询 pipeline 任务状态
 *
 * 查询 Task.status + 文件处理进度 + 队列 job 状态。
 * Agent 委托任务后可用本工具轮询进度，决定何时调 get_task_results 取结果。
 *
 * 参数：
 * - taskId: 任务 ID（由 create_pipeline_task 返回）
 *
 * 返回：
 * - taskId / title / status / reviewMode
 * - files: [{ fileName, fileType, status, textLength, processedLength, errorCount }]
 * - progress: 0-100 进度百分比（基于 processedLength / textLength）
 * - queueState: 队列 job 状态（waiting/active/completed/failed/unknown）
 * - createdAt / updatedAt
 */

import { z } from 'zod';
import prisma from '../../../../config/db';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 文件状态 */
interface FileStatusInfo {
  fileName: string;
  fileType: string;
  status: string;
  textLength: number;
  processedLength: number;
  errorCount: number;
}

/** 任务状态结果 */
interface GetTaskStatusResult {
  taskId: string;
  title: string;
  status: string;
  reviewMode: string;
  files: FileStatusInfo[];
  progress: number;
  queueState: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建 get_task_status 工具
 */
export function createGetTaskStatusTool(context: ToolContext) {
  return tool({
    description: '查询 pipeline 审查任务的状态和进度。返回任务状态（PENDING/PROCESSING/COMPLETED/FAILED）、文件处理进度（textLength/processedLength）、队列 job 状态。Agent 委托任务后用本工具轮询，COMPLETED 后调 get_task_results 取结果。',
    inputSchema: z.object({
      taskId: z.string().min(1).describe('任务 ID（由 create_pipeline_task 返回）'),
    }),
    execute: async ({ taskId }): Promise<GetTaskStatusResult> => {
      // 1. 查 Task + Files（限制只能查当前用户创建的任务）
      const task = await prisma.task.findFirst({
        where: { id: taskId, creatorId: context.userId },
        include: {
          files: {
            select: {
              fileName: true,
              fileType: true,
              status: true,
              textLength: true,
              processedLength: true,
              errorCount: true,
            },
          },
        },
      });

      if (!task) {
        throw new Error(`任务不存在或无权访问: ${taskId}`);
      }

      // 2. 计算进度百分比（基于已处理字符数 / 总字符数）
      const totalTextLength = task.files.reduce((sum, f) => sum + (f.textLength || 0), 0);
      const totalProcessed = task.files.reduce((sum, f) => sum + (f.processedLength || 0), 0);
      const progress = totalTextLength > 0
        ? Math.min(100, Math.round((totalProcessed / totalTextLength) * 100))
        : (task.status === 'COMPLETED' ? 100 : 0);

      // 3. 查询队列 job 状态（best-effort，失败时返回 unknown）
      let queueState = 'unknown';
      try {
        // 动态导入避免循环依赖
        const { getReviewQueue } = require('../../../../services/system/queue.service');
        const queue = getReviewQueue();
        const job = await queue.getJob(`review:${taskId}`);
        if (job) {
          queueState = await job.getState().catch(() => 'unknown');
        }
      } catch (e) {
        console.warn(`[Agent:get_task_status] 查询队列状态失败: ${(e as Error).message}`);
      }

      console.log(`[Agent:get_task_status] 任务 ${taskId}: status=${task.status} progress=${progress}% queueState=${queueState}`);

      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        reviewMode: task.reviewMode,
        files: task.files.map(f => ({
          fileName: f.fileName,
          fileType: f.fileType,
          status: f.status,
          textLength: f.textLength || 0,
          processedLength: f.processedLength || 0,
          errorCount: f.errorCount || 0,
        })),
        progress,
        queueState,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      };
    },
  });
}
