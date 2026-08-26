/**
 * recall_memory 工具 — 语义检索用户长期记忆
 *
 * 调 MemoryService.recallMemory 做 pgvector L2 距离匹配，返回与 query 语义相似的记忆项。
 * 支持按 scope 过滤（global/project/session），默认跨所有 scope 按 session > project > global 优先级排序。
 *
 * 使用时机：
 * - 审查开始前先 recall_memory(query="用户偏好")，把用户习惯注入审查上下文
 * - 用户提问"我之前的审查偏好是什么"时直接调本工具
 * - 任何需要参考用户历史反馈/习惯的场景
 *
 * 参数：
 * - query: 查询文本（自然语言，会被 embedding）
 * - topK: 返回数量（默认 5，最多 20）
 * - scope: 可选作用域过滤（global/project/session）
 *
 * 返回：
 * - memories: [{ id, key, value, type, scope, confidence, similarity }]
 * - total: 命中数量
 * - degraded: 是否降级到关键词匹配（embedding 服务不可用时为 true）
 */

import { z } from 'zod';
import { MemoryService, type MemoryScope } from '../../memory/memory.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 单条记忆结果（精简版，去掉时间戳） */
interface RecalledMemoryItem {
  id: string;
  key: string;
  value: string;
  type: string;
  scope: string;
  confidence: number;
  similarity: number;
}

/** recall_memory 返回结果 */
interface RecallMemoryResult {
  memories: RecalledMemoryItem[];
  total: number;
  /** embedding 服务不可用、已降级为关键词匹配时为 true（服务内真实标志，2026 修复） */
  degraded: boolean;
  /** 检索失败时非空（与 degraded 区分：失败 ≠ 降级） */
  error?: string;
}

/**
 * 创建 recall_memory 工具
 */
export function createRecallMemoryTool(context: ToolContext) {
  return tool({
    description: '语义检索用户长期记忆。返回与查询文本语义相似的记忆项（用户偏好/审查习惯/反馈），按作用域优先级（session > project > global）+ 相似度排序。审查开始前建议先调本工具召回用户偏好，注入到后续审查上下文。',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('查询文本（自然语言，如"用户偏好的审查关注点"或"合同审查习惯"）'),
      topK: z.number().int().min(1).max(20).optional().default(5).describe('返回数量（默认 5，最多 20）'),
      scope: z.enum(['global', 'project', 'session']).optional().describe('限定作用域（不传时跨所有 scope，按优先级排序）'),
    }),
    execute: async ({ query, topK, scope }): Promise<RecallMemoryResult> => {
      try {
        // 2026 修复：用 recallMemoryDetailed 拿真实 degraded 标志
        // （原实现从 similarity===0.5 弱信号猜测，可能误报/漏报；失败也被标成降级）
        const { memories, degraded } = await MemoryService.recallMemoryDetailed({
          userId: context.userId,
          query,
          topK,
          ...(scope ? { scope: scope as MemoryScope } : {}),
        });

        const memoryItems: RecalledMemoryItem[] = memories.map(m => ({
          id: m.id,
          key: m.key,
          value: m.value,
          type: m.type,
          scope: m.scope,
          confidence: m.confidence,
          similarity: Number(m.similarity.toFixed(4)),
        }));

        console.log(`[Agent:recall_memory] userId=${context.userId} query="${query.slice(0, 50)}" 命中 ${memoryItems.length} 条 degraded=${degraded}`);

        return {
          memories: memoryItems,
          total: memoryItems.length,
          degraded,
        };
      } catch (e) {
        // 工具失败不中断 Agent 流程，返回空结果 + error 字段（失败 ≠ 降级，分开标注）
        console.error(`[Agent:recall_memory] 检索失败:`, (e as Error).message);
        return {
          memories: [],
          total: 0,
          degraded: false,
          error: `记忆检索失败: ${(e as Error).message}`,
        };
      }
    },
  });
}
