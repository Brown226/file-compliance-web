/**
 * create_pipeline_task 工具 — Agent 委托复杂审查给 pipeline（Bull 队列 + ReviewService.processTask）
 *
 * 工作方式：
 * 1. 复用 TaskService.createTask 创建 Task 记录（指定 reviewMode + creatorId，统一知识库 JSON 格式与服务端校验）
 * 2. createTask 内部为每个 filePath 创建 TaskFile 记录（关联到 uploads/agent_temp 的文件）并入 Bull 队列
 * 3. 返回 taskId，Agent 可用 get_task_status / get_task_results 轮询结果
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
import { TaskService } from '../../../system/task.service';
import { isFeatureEnabled } from '../../../system/feature-flag.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 有效的审查模式（与 TaskService.createTask 一致）。
 *  SELF_CHECK 已移除：它有独立端点 /api/self-check/run，经通用管道执行只会产出假合规空报告。 */
const VALID_REVIEW_MODES = [
  'LIBRARY_REVIEW', 'DOC_REVIEW', 'CONSISTENCY', 'TYPO_GRAMMAR',
  'RULE_ONLY', 'CONTRACT_REVIEW', 'DEC_REVIEW',
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
        '审查模式：LIBRARY_REVIEW（规则库审查）/ DOC_REVIEW（文档审查）/ CONSISTENCY（一致性）/ TYPO_GRAMMAR（校对）/ RULE_ONLY（仅规则）/ CONTRACT_REVIEW（合同审查）/ DEC_REVIEW（DEC 三维度）。注意：SELF_CHECK 自检不走此工具，请引导用户使用独立自检入口'
      ),
      filePaths: z.array(z.string()).min(1).max(20).describe('文件路径数组（uploads/agent_temp 下的绝对路径，由 upload_file 返回，最多 20 个）'),
      standardId: z.string().optional().describe('标准 ID（DEC_REVIEW 等模式需要）'),
      knowledgeId: z.string().optional().describe('MaxKB 知识库 ID'),
      ruleLibraryId: z.string().optional().describe('规则库 ID'),
      perspective: z.string().optional().describe('审查立场（如甲方/乙方）'),
    }),
    execute: async ({ title, reviewMode, filePaths, standardId, knowledgeId, ruleLibraryId, perspective }): Promise<CreatePipelineTaskResult> => {
      // 0. 检查 feature flag 门禁（如果该审查模式的入口被禁用，则拒绝创建任务）
      const modeToFlagKey: Record<string, string> = {
        'LIBRARY_REVIEW': 'entry.LIBRARY',
        'TYPO_GRAMMAR': 'entry.PROOFREAD',
        'CONSISTENCY': 'entry.CONSISTENCY',
        'DOC_REVIEW': 'entry.DOC_REVIEW',
        'CONTRACT_REVIEW': 'entry.CONTRACT',
        'RULE_ONLY': 'entry.RULE_ONLY',
      };
      const flagKey = modeToFlagKey[reviewMode];
      if (flagKey) {
        const enabled = await isFeatureEnabled(flagKey);
        if (!enabled) {
          return {
            taskId: '',
            status: 'FAILED',
            fileCount: 0,
            jobEnqueued: false,
            message: `该审查模式已被管理员禁用（${flagKey}=false），请在 AI 引擎配置中启用后再试`,
          };
        }
      }

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

      // 2. 创建 Task 记录 —— 复用 TaskService.createTask（统一知识库格式与校验）
      //    ★ 知识库格式统一：将 knowledgeId 放入 maxkbKnowledgeIds 数组，交由 TaskService
      //    ★ 按「多库 JSON 序列化」规则写入 maxkbKnowledgeId 字段（task.service.ts 存储策略）。
      //    ★ 同时获得 TaskService 的服务端校验（files 非空 / RULE_ONLY 前缀约束等）。
      //
      //    agent_temp 已落盘文件映射为 Multer 兼容对象，让 createTask 生成 /uploads/agent_temp/...
      //    的 TaskFile 记录，并内部完成入 Bull 队列（失败自动回滚状态不发异常）。
      const files = validFilePaths.map(fp => {
        // fp = {uploadDir}/agent_temp/{userId}/{date}/{basename}
        const relUser = path.relative(getAgentTempRoot(), fp).replace(/\\/g, '/'); // {userId}/{date}/{basename}
        const seg = relUser.split('/');
        const dateDir = seg[1] || '';
        const basename = seg.slice(2).join('/') || path.basename(fp);
        return {
          originalname: basename,
          // 拼接 date 子目录，配合 creatorUsername 组装出正确路径
          filename: dateDir ? `${dateDir}/${basename}` : basename,
          size: fs.statSync(fp).size,
        } as any;
      });

      const task = await TaskService.createTask({
        title,
        creatorId: context.userId,
        // 使 createTask 生成的 filePath 落到 /uploads/agent_temp/{userId}/... 而非默认用户目录
        creatorUsername: `agent_temp/${context.userId}`,
        reviewMode: reviewMode as string,
        standardId: standardId || undefined,
        // 统一知识库格式：数组写入 → TaskService JSON 序列化（与前端多选知识库一致）
        maxkbKnowledgeIds: knowledgeId ? [knowledgeId] : [],
        ruleLibraryId: ruleLibraryId || undefined,
        perspective: perspective || undefined,
        files: files as any,
      });

      // createTask 内部已完成 TaskFile 记录 + 入队，返回 PROCESSING（files>0 且非 COMPARE 延迟）
      console.log(`[Agent:create_pipeline_task] 任务已创建(复用 TaskService): ${task.id} (mode=${reviewMode}, files=${validFilePaths.length})`);

      return {
        taskId: task.id,
        status: task.status as string,
        fileCount: validFilePaths.length,
        jobEnqueued: task.status === 'PROCESSING',
        message: `任务已创建并委托给 pipeline 处理（复用 TaskService），可用 get_task_status 轮询进度`,
      };
    },
  });
}
