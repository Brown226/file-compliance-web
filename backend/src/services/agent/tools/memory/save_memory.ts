/**
 * save_memory 工具 — 保存用户长期记忆
 *
 * 调 MemoryService.saveMemory 把偏好/反馈/例行习惯存入 AgentMemory 表（含 embedding 向量）。
 * 相同 userId + key + scope 的记忆会自动 upsert（更新 value/embedding/confidence）。
 *
 * 使用时机：
 * - 用户明确表达偏好（如"以后审查合同优先关注付款条款"）→ 主动 save_memory
 * - 用户纠正 Agent 行为（如"不要把格式问题标为 error"）→ 存为 feedback 类型
 * - 用户告知例行习惯（如"每周审查 3 份招标文件"）→ 存为 routine 类型
 * - 不要擅自保存模糊或猜测性的偏好（confidence 应 ≤ 0.6）
 *
 * 参数：
 * - key: 记忆键（snake_case，如 preferred_review_focus）
 * - value: 记忆值（中文描述）
 * - type: preference / routine / feedback（默认 preference）
 * - scope: global / project / session（默认 global）
 * - confidence: 0.5-1.0（默认 0.7）
 *
 * 返回：
 * - memoryId: 记忆 ID
 * - saved: 是否保存成功
 * - message: 描述信息（含失败原因）
 */

import { z } from 'zod';
import { MemoryService, type MemoryType, type MemoryScope } from '../../memory/memory.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** save_memory 返回结果 */
interface SaveMemoryResult {
  memoryId: string;
  saved: boolean;
  message: string;
}

/**
 * 创建 save_memory 工具
 */
export function createSaveMemoryTool(context: ToolContext) {
  return tool({
    description: '保存用户长期记忆（偏好/反馈/例行习惯）。相同 key + scope 的记忆会自动更新。仅保存用户明确表达的偏好，不要保存猜测性内容。常用 key：preferred_review_focus（审查关注点）/ preferred_output_format（输出格式）/ file_type_routine（例行文件类型）/ correction_feedback（纠正反馈）。',
    inputSchema: z.object({
      key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'key 必须是 snake_case（小写字母+下划线）').describe('记忆键（snake_case，如 preferred_review_focus）'),
      value: z.string().min(1).max(1000).describe('记忆值（中文描述，如"合同审查优先关注付款条款"）'),
      type: z.enum(['preference', 'routine', 'feedback']).optional().default('preference').describe('记忆类型：preference（偏好）/ routine（例行习惯）/ feedback（纠正反馈）'),
      scope: z.enum(['global', 'project', 'session']).optional().default('global').describe('作用域：global（全局，所有会话生效）/ project（项目级）/ session（仅当前会话）'),
      confidence: z.number().min(0.5).max(1.0).optional().default(0.7).describe('置信度 0.5-1.0（用户明确表达 0.8+，推断 0.5-0.7）'),
    }),
    execute: async ({ key, value, type, scope, confidence }): Promise<SaveMemoryResult> => {
      try {
        const memoryId = await MemoryService.saveMemory({
          userId: context.userId,
          key,
          value,
          type: type as MemoryType,
          scope: scope as MemoryScope,
          confidence,
          source: context.sessionId || undefined,
        });

        if (!memoryId) {
          return {
            memoryId: '',
            saved: false,
            message: '保存失败：未返回 memoryId',
          };
        }

        console.log(`[Agent:save_memory] userId=${context.userId} key=${key} scope=${scope} type=${type} confidence=${confidence}`);

        return {
          memoryId,
          saved: true,
          message: `记忆已保存（key=${key}, scope=${scope}, type=${type}）`,
        };
      } catch (e) {
        console.error(`[Agent:save_memory] 保存失败:`, (e as Error).message);
        return {
          memoryId: '',
          saved: false,
          message: `保存失败: ${(e as Error).message}`,
        };
      }
    },
  });
}
