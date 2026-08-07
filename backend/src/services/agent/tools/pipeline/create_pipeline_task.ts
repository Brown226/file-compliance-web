/**
 * create_pipeline_task 工具 — Agent 委托复杂审查给 pipeline（Bull 队列 + ReviewService.processTask）
 *
 * 工作方式：
 * 1. 创建 Task 记录（指定 reviewMode + creatorId）
 * 2. 为每个 filePath 创建 TaskFile 记录（关联到 uploads/agent_temp 的文件）
 * 3. 调 addReviewJob(taskId) 入 Bull 队列
 * 4. 返回 taskId，Agent 可用 get_task_status / get_task_results 轮询结果
 *
 * 使用场景：
 * - 复杂审查（如多文件交叉验证、DEC 三维度审查）委托给 pipeline
 * - Agent 自身做简单审查，复杂任务委托给 pipeline（C 路线双模式）
 *
 * 参数：
 * - title: 任务标题
 * - reviewMode: 审查模式（LIBRARY_REVIEW/DOC_REVIEW/CONSISTENCY/TYPO_GRAMMAR/RULE_ONLY/CONTRACT_REVIEW/DEC_REVIEW/SELF_CHECK）
 * - filePaths: 文件路径数组（uploads/agent_temp 下的绝对路径，由 upload_file 返回）
 * - standardId?: 标准 ID（DEC_REVIEW 等模式需要）
 * - knowledgeId?: MaxKB 知识库 ID
 * - ruleLibraryId?: 规则库 ID
 * - perspective?: 审查立场
 *
 * 返回：
 * - taskId: 任务 ID
 * - status: 初始状态（PENDING 或 PROCESSING）
 * - fileCount: 文件数
 * - jobEnqueued: 是否成功入队
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from '../file/paths';
import { getUploadDir } from '../../../../config/upload';
import prisma from '../../../../config/db';
import { addReviewJob } from '../../../../services/system/queue.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 有效的审查模式（与 TaskService.createTask 一致） */
const VALID_REVIEW_MODES = [
  'LIBRARY_REVIEW', 'DOC_REVIEW', 'CONSISTENCY', 'TYPO_GRAMMAR',
  'RULE_ONLY', 'SELF_CHECK', 'CONTRACT_REVIEW', 'DEC_REVIEW',
] as const;

/** 创建结果 */
interface CreatePipelineTaskResult {
  taskId: string;
  status: string;
  fileCount: number;
  jobEnqueued: boolean;
  message: string;
}

/**
 * 创建 create_pipeline_task 工具
 */
export function createCreatePipelineTaskTool(context: ToolContext) {
  return tool({
    description: '委托复杂审查任务给 pipeline（Bull 队列 + ReviewService）。Agent 提供文件路径和审查模式，工具创建 Task + TaskFile 记录并入队。返回 taskId，可用 get_task_status / get_task_results 轮询。适用场景：多文件交叉验证、DEC 三维度审查、重度任务由 pipeline 处理。',
    inputSchema: z.object({
      title: z.string().min(1).max(200).describe('任务标题'),
      reviewMode: z.enum(VALID_REVIEW_MODES).describe(
        '审查模式：LIBRARY_REVIEW（规则库审查）/ DOC_REVIEW（文档审查）/ CONSISTENCY（一致性）/ TYPO_GRAMMAR（校对）/ RULE_ONLY（仅规则）/ SELF_CHECK（自检）/ CONTRACT_REVIEW（合同审查）/ DEC_REVIEW（DEC 三维度）'
      ),
      filePaths: z.array(z.string()).min(1).max(20).describe('文件路径数组（uploads/agent_temp 下的绝对路径，由 upload_file 返回，最多 20 个）'),
      standardId: z.string().optional().describe('标准 ID（DEC_REVIEW 等模式需要）'),
      knowledgeId: z.string().optional().describe('MaxKB 知识库 ID'),
      ruleLibraryId: z.string().optional().describe('规则库 ID'),
      perspective: z.string().optional().describe('审查立场（如甲方/乙方）'),
    }),
    execute: async ({ title, reviewMode, filePaths, standardId, knowledgeId, ruleLibraryId, perspective }): Promise<CreatePipelineTaskResult> => {
      // 1. 校验文件路径安全（必须在当前用户 agent_temp 目录内）
      const uploadsRoot = getAgentTempRoot();
      const normalizedRoot = path.resolve(uploadsRoot);
      const expectedUserDir = path.join(normalizedRoot, context.userId);

      const validFilePaths: string[] = [];
      for (const fp of filePaths) {
        const normalizedPath = path.resolve(fp);
        if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
          console.warn(`[Agent:create_pipeline_task] 跳过越权文件路径: ${fp}`);
          continue;
        }
        if (!fs.existsSync(normalizedPath)) {
          console.warn(`[Agent:create_pipeline_task] 跳过不存在的文件: ${fp}`);
          continue;
        }
        validFilePaths.push(normalizedPath);
      }

      if (validFilePaths.length === 0) {
        return {
          taskId: '',
          status: 'FAILED',
          fileCount: 0,
          jobEnqueued: false,
          message: '无有效文件路径（全部越权或不存在）',
        };
      }

      // 2. 创建 Task 记录
      const task = await prisma.task.create({
        data: {
          title,
          creatorId: context.userId,
          reviewMode: reviewMode as any,
          standardId: standardId || null,
          maxkbKnowledgeId: knowledgeId || null,
          ruleLibraryId: ruleLibraryId || null,
          perspective: perspective || null,
          status: 'PROCESSING',  // 直接进入处理中（文件已存在）
        },
      });

      // 3. 创建 TaskFile 记录（关联 agent_temp 下的文件）
      await prisma.taskFile.createMany({
        data: validFilePaths.map(fp => {
          const fileName = path.basename(fp);
          const ext = path.extname(fileName).toLowerCase().replace('.', '');
          // 把绝对路径转为 /uploads/ 相对路径，便于后续静态服务访问（用配置化的上传根，与工具路径根一致）
          const uploadDir = getUploadDir();
          const relativePath = '/uploads/' + path.relative(uploadDir, fp).replace(/\\/g, '/');
          return {
            taskId: task.id,
            fileName,
            filePath: relativePath,
            fileSize: fs.statSync(fp).size,
            fileType: ext || 'unknown',
            status: 'PENDING',
          };
        }),
      });

      // 4. 入 Bull 队列（降级模式会同步执行）
      let jobEnqueued = false;
      try {
        await addReviewJob(task.id);
        jobEnqueued = true;
        console.log(`[Agent:create_pipeline_task] 任务已入队: ${task.id} (mode=${reviewMode}, files=${validFilePaths.length})`);
      } catch (e) {
        console.error(`[Agent:create_pipeline_task] 入队失败: ${task.id}`, (e as Error).message);
        // 入队失败时更新 Task 状态为 FAILED
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }).catch(() => { /* ignore */ });
        return {
          taskId: task.id,
          status: 'FAILED',
          fileCount: validFilePaths.length,
          jobEnqueued: false,
          message: `入队失败: ${(e as Error).message}`,
        };
      }

      return {
        taskId: task.id,
        status: 'PROCESSING',
        fileCount: validFilePaths.length,
        jobEnqueued,
        message: `任务已创建并入队，可用 get_task_status 轮询进度`,
      };
    },
  });
}
