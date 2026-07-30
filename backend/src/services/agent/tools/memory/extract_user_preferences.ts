/**
 * extract_user_preferences 工具 — 从当前会话历史提取用户偏好
 *
 * 调 MemoryService.extractUserPreferences，用 LLM 分析本会话的对话历史，
 * 自动提取用户表达的偏好/反馈/例行习惯，逐条 saveMemory 存入 AgentMemory（scope=global, source=sessionId）。
 *
 * 使用时机：
 * - 会话结束前（用户说"再见"/"结束"）主动调本工具，把会话中的偏好沉淀下来
 * - Agent 完成审查任务后，若发现用户在对话中表达了明确偏好（如"以后..."句式），可调本工具批量提取
 * - 不要在会话中途频繁调用（会重复 LLM 提取，浪费 token）
 *
 * 参数：
 * - 无（自动用 context.sessionId 查会话历史）
 *
 * 返回：
 * - extractedCount: 提取并保存的偏好数
 * - message: 描述信息
 */

import { z } from 'zod';
import { MemoryService } from '../../memory/memory.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** extract_user_preferences 返回结果 */
interface ExtractPreferencesResult {
  extractedCount: number;
  message: string;
}

/**
 * 创建 extract_user_preferences 工具
 */
export function createExtractUserPreferencesTool(context: ToolContext) {
  return tool({
    description: '从当前会话历史自动提取用户偏好/反馈/例行习惯并保存到长期记忆。会话结束前（用户说"再见"/"结束"）或完成审查任务后调用。提取的偏好会保存到 global 作用域，后续会话的 recall_memory 可召回。不要在会话中途频繁调用（避免重复 LLM 提取浪费 token）。',
    inputSchema: z.object({}).describe('无参数（自动用当前 sessionId 查会话历史提取偏好）'),
    execute: async (): Promise<ExtractPreferencesResult> => {
      if (!context.sessionId) {
        return {
          extractedCount: 0,
          message: '无 sessionId，无法提取会话偏好',
        };
      }

      try {
        const count = await MemoryService.extractUserPreferences({
          userId: context.userId,
          sessionId: context.sessionId,
        });

        console.log(`[Agent:extract_user_preferences] userId=${context.userId} sessionId=${context.sessionId} 提取 ${count} 条偏好`);

        return {
          extractedCount: count,
          message: count > 0
            ? `已提取并保存 ${count} 条用户偏好到长期记忆`
            : '本会话未提取到明确偏好（用户表达模糊或无偏好内容）',
        };
      } catch (e) {
        console.error(`[Agent:extract_user_preferences] 提取失败:`, (e as Error).message);
        return {
          extractedCount: 0,
          message: `提取失败: ${(e as Error).message}`,
        };
      }
    },
  });
}
