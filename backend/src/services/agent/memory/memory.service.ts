/**
 * Agent 记忆服务 — 用户级长期记忆系统
 *
 * 功能：
 * 1. save_memory(key, value, type, scope, confidence) — 保存记忆（含 embedding 向量）
 * 2. recall_memory(query, topK, scope) — 语义检索记忆（pgvector L2 距离匹配）
 * 3. extract_user_preferences(sessionId) — 会话结束自动提取偏好
 * 4. list_memories(userId, type?, scope?) — 列出记忆（供前端管理 UI 用）
 * 5. update_memory(id, value?) / delete_memory(id) — 编辑/删除记忆
 *
 * 设计要点：
 * - 三级作用域：session（会话级，最优先）> project（项目级）> global（全局，最次）
 * - 检索时按 scope 优先级排序，同 scope 内按相似度排序
 * - embedding 用 EmbeddingService.embedText 生成（OpenAI 兼容协议）
 * - pgvector 写入用 prisma.$executeRaw（Prisma 不支持 vector 类型直接写入）
 * - pgvector 查询用 prisma.$queryRaw + `<=>` L2 距离运算符
 *
 * 依赖：
 * - EmbeddingService.embedText（生成查询向量）
 * - prisma.$executeRaw / $queryRaw（pgvector 操作）
 * - LlmService.chat（extract_user_preferences 提取偏好）
 */

import prisma from '../../../config/db';
import { EmbeddingService } from '../../knowledge/embedding.service';
import { LlmService } from '../../llm/llm.service';

/** 记忆类型 */
export type MemoryType = 'preference' | 'routine' | 'feedback';

/** 记忆作用域 */
export type MemoryScope = 'global' | 'project' | 'session';

/** scope 优先级（数字越大越优先） */
const SCOPE_PRIORITY: Record<MemoryScope, number> = {
  session: 3,
  project: 2,
  global: 1,
};

/** 记忆项 */
export interface MemoryItem {
  id: string;
  userId: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  scope: MemoryScope;
  createdAt: string;
  updatedAt: string;
}

/** 检索结果项（含相似度） */
export interface RecalledMemory extends MemoryItem {
  similarity: number;  // 0-1，1 表示完全匹配
}

/**
 * Agent 记忆服务
 */
export class MemoryService {
  /**
   * 保存记忆（含 embedding 向量）
   *
   * @param params.userId 用户 ID
   * @param params.key 记忆键（如 "preferred_review_focus"）
   * @param params.value 记忆值（如 "合同审查优先关注付款条款"）
   * @param params.type 记忆类型（preference / routine / feedback）
   * @param params.scope 作用域（global / project / session）
   * @param params.confidence 置信度 0-1
   * @param params.source 来源（sessionId 或 fileType）
   * @returns 记忆 ID
   */
  static async saveMemory(params: {
    userId: string;
    key: string;
    value: string;
    type?: MemoryType;
    scope?: MemoryScope;
    confidence?: number;
    source?: string;
  }): Promise<string> {
    const {
      userId,
      key,
      value,
      type = 'preference',
      scope = 'global',
      confidence = 0.7,
      source,
    } = params;

    // 生成 embedding 向量（失败时不阻断保存，仅记 warning）
    let embedding: number[] | null = null;
    try {
      embedding = await EmbeddingService.embedText(`${key}: ${value}`);
    } catch (e) {
      console.warn('[Agent:Memory] 生成 embedding 失败，记忆仍会保存但无法语义检索:', (e as Error).message);
    }

    // 用 $executeRaw 写入（Prisma 不支持 vector 类型直接 create）
    // embedding 转 pgvector 字面量格式：'[0.1,0.2,...]'
    const embeddingLiteral = embedding
      ? `'[${embedding.map(v => Number(v).toFixed(8)).join(',')}]'`
      : 'NULL';

    // upsert：相同 userId + key + scope 时更新 value/embedding/confidence
    const id = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO agent_memories (id, user_id, type, key, value, embedding, confidence, source, scope, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${userId},
        ${type},
        ${key},
        ${value},
        ${embeddingLiteral}::vector,
        ${confidence},
        ${source || null},
        ${scope},
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id, key, scope)  -- 需要唯一约束，见下方说明
      DO UPDATE SET
        value = EXCLUDED.value,
        embedding = EXCLUDED.embedding,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING id
    `;

    console.log(`[Agent:Memory] 保存记忆: userId=${userId} key=${key} scope=${scope} embedding=${embedding ? 'yes' : 'no'}`);

    return id[0]?.id || '';
  }

  /**
   * 语义检索记忆（pgvector L2 距离匹配 + scope 优先级排序）
   *
   * @param params.userId 用户 ID
   * @param params.query 查询文本
   * @param params.topK 返回数量（默认 5）
   * @param params.scope 限定作用域（不传时跨所有 scope，按优先级排序）
   * @returns RecalledMemory[]（按 scope 优先级 + 相似度排序）
   */
  /**
   * 语义检索记忆（兼容旧签名，返回 memories 数组；降级信息用 recallMemoryDetailed）
   */
  static async recallMemory(params: {
    userId: string;
    query: string;
    topK?: number;
    scope?: MemoryScope;
  }): Promise<RecalledMemory[]> {
    const { memories } = await this.recallMemoryInternal(params);
    return memories;
  }

  /**
   * 语义检索记忆（带降级标志）— 工具链路专用
   * @returns { memories, degraded } degraded=true 表示 embedding 服务不可用、已降级为关键词匹配（2026
   *           从「similarity===0.5 弱信号猜测」改为服务内真实标志）
   */
  static async recallMemoryDetailed(params: {
    userId: string;
    query: string;
    topK?: number;
    scope?: MemoryScope;
  }): Promise<{ memories: RecalledMemory[]; degraded: boolean }> {
    return this.recallMemoryInternal(params);
  }

  /** 内部实现：共享逻辑，返回 { memories, degraded } */
  private static async recallMemoryInternal(params: {
    userId: string;
    query: string;
    topK?: number;
    scope?: MemoryScope;
  }): Promise<{ memories: RecalledMemory[]; degraded: boolean }> {
    const { userId, query, topK = 5, scope } = params;

    // 生成查询向量
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await EmbeddingService.embedText(query);
    } catch (e) {
      console.warn('[Agent:Memory] 生成查询向量失败，降级到关键词匹配:', (e as Error).message);
    }
    // degraded = embedding 生成失败（降级到关键词匹配的真实标志）
    const degraded = queryEmbedding === null;

    // 无 embedding 时降级到 ILIKE 关键词匹配
    if (!queryEmbedding) {
      const keywordResults = await prisma.agentMemory.findMany({
        where: {
          userId,
          ...(scope ? { scope } : {}),
          OR: [
            { key: { contains: query, mode: 'insensitive' } },
            { value: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: topK,
      });
      return { memories: keywordResults.map(m => ({ ...this.toMemoryItem(m), similarity: 0.5 })), degraded };
    }

    // pgvector L2 距离查询（<=> 运算符，距离越小相似度越高）
    const queryLiteral = `'[${queryEmbedding.map(v => Number(v).toFixed(8)).join(',')}]'`;
    const scopeFilter = scope ? `AND scope = ${scope}` : '';

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      user_id: string;
      type: string;
      key: string;
      value: string;
      confidence: number;
      source: string | null;
      scope: string;
      created_at: Date;
      updated_at: Date;
      distance: number;  // L2 距离（0 表示完全匹配）
    }>>`
      SELECT id, user_id, type, key, value, confidence, source, scope, created_at, updated_at,
             embedding <=> ${queryLiteral}::vector AS distance
      FROM agent_memories
      WHERE user_id = ${userId} AND embedding IS NOT NULL ${scopeFilter}
      ORDER BY distance ASC
      LIMIT ${topK * 2}  -- 多取一些用于 scope 优先级重排
    `;

    // 转换为 RecalledMemory[]，计算 similarity = 1 / (1 + distance)
    let recalled: RecalledMemory[] = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type as MemoryType,
      key: r.key,
      value: r.value,
      confidence: r.confidence,
      source: r.source,
      scope: r.scope as MemoryScope,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      similarity: 1 / (1 + (r.distance || 0)),
    }));

    // scope 优先级重排（同相似度时 session > project > global）
    recalled.sort((a, b) => {
      const scopeDiff = SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope];
      if (Math.abs(scopeDiff) > 0) return scopeDiff;
      return b.similarity - a.similarity;
    });

    // 截断到 topK
    recalled = recalled.slice(0, topK);

    console.log(`[Agent:Memory] 检索记忆: userId=${userId} query="${query.slice(0, 50)}" 命中 ${recalled.length} 条 degraded=${degraded}`);

    return { memories: recalled, degraded };
  }

  /**
   * 列出用户记忆（供前端管理 UI 用）
   */
  static async listMemories(params: {
    userId: string;
    type?: MemoryType;
    scope?: MemoryScope;
  }): Promise<MemoryItem[]> {
    const { userId, type, scope } = params;
    const memories = await prisma.agentMemory.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
        ...(scope ? { scope } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return memories.map(m => this.toMemoryItem(m));
  }

  /**
   * 更新记忆
   */
  static async updateMemory(params: {
    id: string;
    userId: string;  // 权限校验
    value?: string;
    confidence?: number;
  }): Promise<void> {
    const { id, userId, value, confidence } = params;
    const data: any = {};
    if (value !== undefined) data.value = value;
    if (confidence !== undefined) data.confidence = confidence;

    // 重新生成 embedding（value 变化时）
    if (value !== undefined) {
      try {
        const embedding = await EmbeddingService.embedText(value);
        // 用 $executeRaw 更新 embedding（Prisma 不支持 vector 类型）
        // embeddingLiteral 是 pgvector 字面量字符串（如 '[0.1,0.2,...]'）
        const embeddingLiteral = `'[${embedding.map(v => Number(v).toFixed(8)).join(',')}]'`;

        if (confidence !== undefined) {
          // 同时更新 value/embedding/confidence
          await prisma.$executeRaw`
            UPDATE agent_memories
            SET value = ${value},
                confidence = ${confidence},
                embedding = ${embeddingLiteral}::vector,
                updated_at = NOW()
            WHERE id = ${id} AND user_id = ${userId}
          `;
        } else {
          // 仅更新 value/embedding（保持 confidence 不变）
          await prisma.$executeRaw`
            UPDATE agent_memories
            SET value = ${value},
                embedding = ${embeddingLiteral}::vector,
                updated_at = NOW()
            WHERE id = ${id} AND user_id = ${userId}
          `;
        }
        return;
      } catch (e) {
        console.warn('[Agent:Memory] 更新 embedding 失败，仅更新文本:', (e as Error).message);
      }
    }

    await prisma.agentMemory.updateMany({
      where: { id, userId },
      data,
    });
  }

  /**
   * 删除记忆
   */
  static async deleteMemory(params: { id: string; userId: string }): Promise<void> {
    const { id, userId } = params;
    await prisma.agentMemory.deleteMany({
      where: { id, userId },
    });
  }

  /**
   * 从会话历史提取用户偏好（会话结束时调用）
   *
   * 流程：
   * 1. 查 QAMessage 历史
   * 2. 用 LLM 提取偏好（JSON 格式 [{type, key, value, confidence}]）
   * 3. 逐条 saveMemory
   *
   * @param params.userId 用户 ID
   * @param params.sessionId 会话 ID
   * @returns 提取的记忆数
   */
  static async extractUserPreferences(params: {
    userId: string;
    sessionId: string;
  }): Promise<number> {
    const { userId, sessionId } = params;

    // 1. 查会话消息历史
    const messages = await prisma.qAMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
      take: 100,  // 最多取 100 条避免 prompt 过长
    });

    if (messages.length === 0) {
      console.log(`[Agent:Memory] 会话 ${sessionId} 无消息，跳过偏好提取`);
      return 0;
    }

    // 2. 用 LLM 提取偏好
    const conversationText = messages
      .map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n')
      .slice(0, 10000);  // 截断到 10k 字符

    const prompt = `分析以下用户与审查 Agent 的对话历史，提取用户的审查偏好和习惯。

只提取明确的、可复用的偏好（不要猜测），格式为 JSON 数组：
[
  {
    "type": "preference" | "routine" | "feedback",
    "key": "偏好键（英文 snake_case，如 preferred_review_focus）",
    "value": "偏好值（中文描述）",
    "confidence": 0.5-1.0
  }
]

偏好示例：
- preferred_review_focus: 用户偏好关注的审查维度（如"合同审查优先关注付款条款"）
- preferred_output_format: 用户偏好的输出格式（如"问题列表用表格展示"）
- file_type_routine: 用户例行审查的文件类型（如"每周审查 3 份招标文件"）
- correction_feedback: 用户纠正过的 Agent 行为（如"不要把格式问题标为 error"）

对话历史：
${conversationText}

只输出 JSON 数组，不要输出其他文字。若无明确偏好，输出 []。`;

    let preferences: Array<{ type: MemoryType; key: string; value: string; confidence: number }> = [];
    try {
      const response = await LlmService.chat(prompt, {
        systemPrompt: '你是用户偏好提取专家。只输出 JSON 数组，不要输出其他文字。',
        temperature: 0.1,
        timeout: 30,
        mode: 'agent-memory-extract',
      });

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        preferences = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[Agent:Memory] LLM 提取偏好失败:', (e as Error).message);
      return 0;
    }

    if (!Array.isArray(preferences) || preferences.length === 0) {
      console.log(`[Agent:Memory] 会话 ${sessionId} 未提取到偏好`);
      return 0;
    }

    // 3. 逐条保存（scope=global，source=sessionId）
    let saved = 0;
    for (const pref of preferences) {
      if (!pref.key || !pref.value) continue;
      try {
        await MemoryService.saveMemory({
          userId,
          key: pref.key,
          value: pref.value,
          type: pref.type || 'preference',
          scope: 'global',
          confidence: Math.min(1, Math.max(0.5, pref.confidence || 0.7)),
          source: sessionId,
        });
        saved++;
      } catch (e) {
        console.warn(`[Agent:Memory] 保存偏好 ${pref.key} 失败:`, (e as Error).message);
      }
    }

    console.log(`[Agent:Memory] 会话 ${sessionId} 提取 ${saved} 条偏好`);

    return saved;
  }

  /** Prisma AgentMemory → MemoryItem */
  private static toMemoryItem(m: any): MemoryItem {
    return {
      id: m.id,
      userId: m.userId,
      type: m.type as MemoryType,
      key: m.key,
      value: m.value,
      confidence: m.confidence,
      source: m.source,
      scope: (m.scope || 'global') as MemoryScope,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
