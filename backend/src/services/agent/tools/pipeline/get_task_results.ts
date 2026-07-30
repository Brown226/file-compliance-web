/**
 * get_task_results 工具 — 获取 pipeline 任务的审查结果
 *
 * 查询 TaskDetail 列表 + 聚合为 ReviewIssue[] 格式。
 * 仅当 Task.status === 'COMPLETED' 时才有完整结果；其他状态返回空数组 + 当前状态。
 *
 * 参数：
 * - taskId: 任务 ID
 *
 * 返回：
 * - taskId / status / reviewMode
 * - issues: ReviewIssue[]（从 TaskDetail 聚合）
 * - totalIssues: 问题总数
 * - files: [{ fileName, errorCount }]
 * - completedAt: 完成时间
 */

import { z } from 'zod';
import prisma from '../../../../config/db';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 问题项（从 TaskDetail 聚合） */
interface TaskResultIssue {
  issueType: string;
  originalText: string;
  suggestedText?: string;
  description?: string;
  severity?: string;
  riskLevel?: string;
  ruleCode?: string;
  standardRef?: string;
  fileName?: string;
}

/** 文件结果 */
interface TaskResultFile {
  fileName: string;
  errorCount: number;
  status: string;
}

/** 结果 */
interface GetTaskResultsResult {
  taskId: string;
  status: string;
  reviewMode: string;
  issues: TaskResultIssue[];
  totalIssues: number;
  files: TaskResultFile[];
  completedAt: string | null;
  message?: string;
}

/**
 * 创建 get_task_results 工具
 */
export function createGetTaskResultsTool(context: ToolContext) {
  return tool({
    description: '获取 pipeline 审查任务的结果。仅当任务状态为 COMPLETED 时返回完整 ReviewIssue[]，其他状态返回空数组 + 当前状态。Agent 应在 get_task_status 显示 COMPLETED 后调本工具取结果。',
    inputSchema: z.object({
      taskId: z.string().min(1).describe('任务 ID（由 create_pipeline_task 返回）'),
    }),
    execute: async ({ taskId }): Promise<GetTaskResultsResult> => {
      // 1. 查 Task + Details + Files（限制只能查当前用户创建的任务）
      const task = await prisma.task.findFirst({
        where: { id: taskId, creatorId: context.userId },
        include: {
          files: {
            select: {
              fileName: true,
              errorCount: true,
              status: true,
            },
          },
          details: {
            select: {
              issueType: true,
              originalText: true,
              suggestedText: true,
              description: true,
              severity: true,
              riskLevel: true,
              ruleCode: true,
              standardRef: true,
              file: { select: { fileName: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!task) {
        throw new Error(`任务不存在或无权访问: ${taskId}`);
      }

      // 2. 非 COMPLETED 状态返回空结果
      if (task.status !== 'COMPLETED') {
        console.log(`[Agent:get_task_results] 任务 ${taskId} 状态为 ${task.status}，暂无结果`);
        return {
          taskId: task.id,
          status: task.status,
          reviewMode: task.reviewMode,
          issues: [],
          totalIssues: 0,
          files: task.files.map(f => ({
            fileName: f.fileName,
            errorCount: f.errorCount || 0,
            status: f.status,
          })),
          completedAt: null,
          message: `任务状态为 ${task.status}，请等待 COMPLETED 后再查询结果`,
        };
      }

      // 3. 聚合 TaskDetail → ReviewIssue[]
      const issues: TaskResultIssue[] = task.details.map(d => ({
        issueType: d.issueType || 'UNKNOWN',
        originalText: d.originalText || '',
        suggestedText: d.suggestedText || undefined,
        description: d.description || undefined,
        severity: d.severity || undefined,
        riskLevel: d.riskLevel || undefined,
        ruleCode: d.ruleCode || undefined,
        standardRef: d.standardRef || undefined,
        fileName: d.file?.fileName,
      }));

      console.log(`[Agent:get_task_results] 任务 ${taskId}: 返回 ${issues.length} 个问题`);

      return {
        taskId: task.id,
        status: task.status,
        reviewMode: task.reviewMode,
        issues,
        totalIssues: issues.length,
        files: task.files.map(f => ({
          fileName: f.fileName,
          errorCount: f.errorCount || 0,
          status: f.status,
        })),
        completedAt: task.updatedAt.toISOString(),
      };
    },
  });
}
