/**
 * search_maxkb_knowledge 工具 — 调 MaxKB 知识库做 RAG 检索
 *
 * 复用 RAGService.retrieve()，它内部调 MaxKB 的 hit_test API，
 * 支持 embedding / blend / keywords 三种检索模式。
 *
 * 工作方式：
 * - 不传 knowledgeId：自动获取所有可用知识库，联合检索（合并结果按相似度排序）
 * - 传 knowledgeId：只检索指定知识库
 *
 * 返回结构（与 RAGService.RAGRetrievedChunk 兼容）：
 * - results: [{ id, content, document_name, knowledge_name, similarity, comprehensive_score }]
 * - total: 结果数
 * - searchedKnowledgeBases: 实际检索的知识库 [{ id, name }]
 *
 * 典型用途：
 * - LLM 审查时检索相关标准规范条文
 * - 查询法规依据、合同条款参考、技术规范要点
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { RAGService } from '../../../knowledge/rag.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 检索结果项 */
interface KnowledgeSearchResult {
  id: string;
  content: string;
  document_name: string;
  knowledge_name: string;
  similarity: number;
  comprehensive_score: number;
}

/** 检索结果 */
interface SearchKnowledgeResult {
  results: KnowledgeSearchResult[];
  total: number;
  searchedKnowledgeBases: Array<{ id: string; name: string }>;
}

/**
 * 创建 search_maxkb_knowledge 工具
 */
export function createSearchMaxkbKnowledgeTool(_context: ToolContext) {
  return tool({
    description: '从 MaxKB 知识库检索相关标准规范、法规条文、技术要点。不传 knowledgeId 时自动跨所有可用知识库联合检索（合并结果按相似度排序）。返回每条结果的 content/document_name/similarity，可作为审查依据注入 prompt。',
    inputSchema: z.object({
      query: z.string().min(1).describe('检索查询文本（如条款关键词、审查要点、规范编号）'),
      knowledgeId: z.string().optional().describe('指定知识库 ID（不传时跨所有可用知识库联合检索）'),
      topNumber: z.number().int().min(1).max(20).optional().default(5).describe('每个知识库返回的最大结果数（默认 5）'),
      searchMode: z.enum(['embedding', 'blend', 'keywords']).optional().default('blend')
        .describe('检索模式：embedding（向量）/ blend（混合，默认）/ keywords（关键词）'),
    }),
    execute: async ({ query, knowledgeId, topNumber, searchMode }): Promise<SearchKnowledgeResult> => {
      // 1. 确定要检索的知识库列表
      const searchedKnowledgeBases: Array<{ id: string; name: string }> = [];
      let knowledgeIds: string[];

      if (knowledgeId) {
        // 指定知识库
        knowledgeIds = [knowledgeId];
        try {
          const allKbs = await RAGService.getFlatKnowledgeList();
          const found = allKbs.find(kb => kb.id === knowledgeId);
          if (found) {
            searchedKnowledgeBases.push({ id: found.id, name: found.name });
          } else {
            searchedKnowledgeBases.push({ id: knowledgeId, name: '（未知知识库）' });
          }
        } catch {
          searchedKnowledgeBases.push({ id: knowledgeId, name: '（未知知识库）' });
        }
      } else {
        // 跨所有可用知识库联合检索
        const allKbs = await RAGService.getFlatKnowledgeList();
        if (allKbs.length === 0) {
          return { results: [], total: 0, searchedKnowledgeBases: [] };
        }
        knowledgeIds = allKbs.map(kb => kb.id);
        for (const kb of allKbs) {
          searchedKnowledgeBases.push({ id: kb.id, name: kb.name });
        }
      }

      // 2. 并发检索所有知识库
      const retrievePromises = knowledgeIds.map(kid =>
        RAGService.retrieve(kid, query, { topNumber, searchMode })
          .catch(e => {
            console.warn(`[Agent] 检索知识库 ${kid} 失败:`, (e as Error)?.message);
            return [];
          })
      );
      const nestedResults = await Promise.all(retrievePromises);

      // 3. 合并结果并按相似度倒序排序
      const allResults: KnowledgeSearchResult[] = [];
      for (const chunks of nestedResults) {
        for (const chunk of chunks) {
          allResults.push({
            id: chunk.id || '',
            content: chunk.content || '',
            document_name: chunk.document_name || '未知文档',
            knowledge_name: chunk.knowledge_name || '',
            similarity: chunk.similarity ?? 0,
            comprehensive_score: chunk.comprehensive_score ?? 0,
          });
        }
      }

      allResults.sort((a, b) => b.similarity - a.similarity);

      // 4. 限制总数（最多 20 条，避免上下文过载）
      const trimmed = allResults.slice(0, 20);

      return {
        results: trimmed,
        total: trimmed.length,
        searchedKnowledgeBases,
      };
    },
  });
}
