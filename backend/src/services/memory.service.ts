/**
 * 长期记忆服务
 *
 * 管理用户跨会话的偏好记忆，通过 OpenSpec Agent 的嵌入和检索能力
 * 实现语义级别的记忆存储和召回。
 *
 * 遵循 OpenSpec memory_service.py 的架构：
 * - 保存时自动去重（相似度 > 0.9 跳过）
 * - 召回时按语义相似度排序
 * - 支持按分类过滤
 */

import prisma from '../config/db';
import { OpenSpecAgentService, MemoryItem } from './openspec-agent.service';

export interface MemoryEntry {
  id: number;
  userId: string;
  content: string;
  chapterName: string | null;
  sourceType: string;
  category: string;
  createdAt: Date;
}

const DEDUP_THRESHOLD = 0.9; // 去重阈值（与 OpenSpec 一致）
const RECALL_LIMIT = 5;       // 默认召回数量

export class MemoryService {
  /**
   * 保存记忆（自动去重）
   * 保存前先查询现有记忆，相似度 > 0.9 则跳过
   */
  static async save(
    userId: string,
    content: string,
    options?: {
      chapterName?: string;
      sourceType?: string;
      category?: string;
    },
  ): Promise<void> {
    if (!content || !content.trim()) return;

    // 去重检查：调用 Agent 召回最相似记忆，按相似度阈值跳过
    try {
      const existing = await OpenSpecAgentService.recallMemory(userId, content, 1);
      if (existing.length > 0 && (existing[0].score ?? 0) >= DEDUP_THRESHOLD) {
        console.log('[Memory] 相似记忆已存在（score>=0.9），跳过保存:', content.substring(0, 50));
        return;
      }
    } catch {
      // Agent 不可达时，直接保存（不阻塞）
    }

    await prisma.userMemory.create({
      data: {
        userId,
        content,
        chapterName: options?.chapterName || null,
        sourceType: options?.sourceType || 'requirement',
        category: options?.category || 'other',
      },
    });
    console.log('[Memory] 已保存记忆:', content.substring(0, 50));
  }

  /**
   * 召回记忆（按语义相似度）
   * 通过 Agent 的嵌入能力检索相关记忆
   */
  static async recall(
    userId: string,
    query: string,
    limit: number = RECALL_LIMIT,
  ): Promise<MemoryItem[]> {
    try {
      // 优先通过 Agent 语义检索
      return await OpenSpecAgentService.recallMemory(userId, query, limit);
    } catch {
      // Agent 不可达时，降级为按关键词匹配
      return this.keywordRecall(userId, query, limit);
    }
  }

  /**
   * 关键词匹配降级检索
   */
  private static async keywordRecall(
    userId: string,
    query: string,
    limit: number,
  ): Promise<MemoryItem[]> {
    const keywords = query.split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];

    const conditions = keywords.map(k => ({
      content: { contains: k, mode: 'insensitive' as const },
    }));

    const rows = await prisma.userMemory.findMany({
      where: {
        userId,
        OR: conditions,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map(r => ({
      id: Number(r.id),
      content: r.content,
      chapterName: r.chapterName,
      category: r.category,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      score: undefined,
    }));
  }

  /**
   * 列出用户记忆
   */
  static async list(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ total: number; items: MemoryEntry[] }> {
    const [rows, total] = await Promise.all([
      prisma.userMemory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.userMemory.count({ where: { userId } }),
    ]);

    return {
      total,
      items: rows.map(r => ({
        id: Number(r.id),
        userId: r.userId,
        content: r.content,
        chapterName: r.chapterName,
        sourceType: r.sourceType,
        category: r.category,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * 删除记忆
   */
  static async delete(id: number): Promise<void> {
    await prisma.userMemory.delete({ where: { id } });
  }

  /**
   * 审查完成后自动写入记忆
   * 从用户"采纳/忽略"行为中提取模式
   */
  static async learnFromReview(
    userId: string,
    taskId: string,
    issues: Array<{ issueType: string; originalText: string; severity: string; action?: 'accept' | 'ignore' }>,
  ): Promise<void> {
    // 提取用户采纳的模式
    const acceptedPatterns = issues
      .filter(i => i.action === 'accept')
      .map(i => `用户关注 ${i.issueType} 类型问题：${i.originalText}`);

    // 提取用户忽略的模式
    const ignoredPatterns = issues
      .filter(i => i.action === 'ignore')
      .map(i => `用户忽略 ${i.issueType} 类型问题：${i.originalText}`);

    // 保存为记忆（去重由 save 内部处理）
    for (const pattern of [...acceptedPatterns, ...ignoredPatterns]) {
      await this.save(userId, pattern, {
        sourceType: 'review_behavior',
        category: acceptedPatterns.includes(pattern) ? 'style_preference' : 'other',
      });
    }
  }
}