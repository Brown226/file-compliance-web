/**
 * 自建 RAG 检索服务
 *
 * 使用本地 pgvector 向量检索（VectorService）替代 MaxKB
 * 获取相关段落，然后组装 prompt 调用自有 LLM 进行审查。
 */

import prisma from '../config/db';
import { VectorService } from './vector.service';
import { LlmService, ReviewIssue, SourceReference } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { SearchService } from './search.service';

// ==================== 类型定义 ====================

/** RAG 检索到的单个段落 */
export interface RAGRetrievedChunk {
  id: string;
  content: string;
  document_name: string;
  similarity: number;
  comprehensive_score: number;
}

/** 知识库树节点 */
export interface KnowledgeTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'knowledge';
  documentCount?: number;
  parentId?: string | null;
  children?: KnowledgeTreeNode[];
}

/** RAG 审查结果 */
export interface RAGReviewResult {
  issues: ReviewIssue[];
  sourceReferences: SourceReference[];
}

/** RAG 审查选项 */
export interface RAGReviewOptions {
  chunkSize?: number;
  topK?: number;
  llmMaxTokens?: number;
  llmTimeout?: number;
  scene?: string;
}

// ==================== RAG 检索服务 ====================

export class RAGService {

  /**
   * 从本地向量库检索与查询文本相关的段落
   */
  static async retrieve(
    categoryIdOrSourceType: string,
    queryText: string,
    options?: { topNumber?: number; sourceTypes?: string[] },
  ): Promise<RAGRetrievedChunk[]> {
    const topNumber = options?.topNumber ?? 5;
    const sourceTypes = options?.sourceTypes;

    console.log(`[RAG] 开始检索: query_len=${queryText.length}, top=${topNumber}`);

    const results = await SearchService.search(queryText, {
      limit: topNumber,
      sourceTypes,
      rerank: true,
    });

    if (results.length === 0) {
      console.log(`[RAG] 未检索到相关段落`);
      return [];
    }

    const chunks: RAGRetrievedChunk[] = results.map(r => ({
      id: r.id,
      content: r.content,
      document_name: r.title || '未知文档',
      similarity: r.score,
      comprehensive_score: r.rerank_score ?? r.score,
    }));

    console.log(`[RAG] 检索到 ${chunks.length} 条段落, 相似度范围: [${Math.min(...chunks.map(c => c.similarity)).toFixed(4)}, ${Math.max(...chunks.map(c => c.similarity)).toFixed(4)}]`);
    return chunks;
  }

  /**
   * 将检索结果组装为 RAG 上下文文本
   */
  static formatRAGContext(chunks: RAGRetrievedChunk[]): string {
    if (chunks.length === 0) return '';

    let context = '';
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      context += `【来源${i + 1}：${chunk.document_name}】\n`;
      context += `(相似度: ${(chunk.similarity * 100).toFixed(1)}%)\n`;
      context += `${chunk.content}\n\n`;
    }
    return context.trim();
  }

  /**
   * 核心方法：使用知识库 RAG 检索增强的 LLM 审查
   */
  static async reviewWithKnowledge(
    text: string,
    categoryIds: string | string[],
    options?: RAGReviewOptions,
  ): Promise<RAGReviewResult> {
    const ids = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
    if (ids.length === 0) {
      return { issues: [], sourceReferences: [] };
    }

    const scene = options?.scene || 'library_review';
    const chunkSize = options?.chunkSize || 4000;
    const topK = options?.topK || 5;
    const llmMaxTokens = options?.llmMaxTokens || 4096;
    const llmTimeout = options?.llmTimeout || 180;

    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;
    console.log(`[RAG] 文本分为 ${totalChunks} 片, 总长度 ${text.length}, 知识库: [${ids.join(',')}], 场景: ${scene}`);

    const allIssues: ReviewIssue[] = [];
    const allSources: SourceReference[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[RAG] 处理分片 ${i + 1}/${totalChunks} (${chunk.text.length}字)`);

      try {
        // 向量检索：从本地 pgvector 获取相关标准规范
        const allRetrievedChunks: RAGRetrievedChunk[] = [];
        for (const catId of ids) {
          try {
            const results = await VectorService.hybridSearch(chunk.text, {
              limit: topK,
              categoryId: catId,
              rerank: true,
            });
            allRetrievedChunks.push(...results.map(r => ({
              id: r.id,
              content: r.content,
              document_name: r.title || '未知文档',
              similarity: r.score,
              comprehensive_score: r.rerank_score ?? r.score,
            })));
          } catch (e: any) {
            console.warn(`[RAG] 知识库 ${catId} 检索失败:`, e.message);
          }
        }

        allRetrievedChunks.sort((a, b) => b.similarity - a.similarity);
        const retrievedChunks = allRetrievedChunks.slice(0, topK * 2);

        let standardContext = '';
        let sources: SourceReference[] = [];

        if (retrievedChunks.length > 0) {
          standardContext = this.formatRAGContext(retrievedChunks);
          sources = retrievedChunks.map(c => ({
            content: c.content.substring(0, 200),
            document_name: c.document_name,
            similarity: c.similarity,
          }));
        }

        const systemPrompt = await PromptTemplateService.getPromptByScene(
          scene, 'system', 'default',
          '你是文件合规审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
        );

        let userPrompt: string;
        if (standardContext) {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'with_context',
            '【参考标准】\n${ragContext}\n\n【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl
            .replace(/\$\{ragContext\}/g, standardContext)
            .replace(/\$\{standardContext\}/g, standardContext)
            .replace(/\$\{text\}/g, chunk.text);
        } else {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'no_context',
            '【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl.replace(/\$\{text\}/g, chunk.text);
        }

        const issues = await LlmService.reviewText(userPrompt, {
          maxTokens: llmMaxTokens,
          timeout: llmTimeout,
          systemPrompt,
          skipUserTemplate: true,
          positionInfo: {
            chunkIndex: chunk.chunkIndex,
            chunkStartIndex: chunk.startIndex,
            totalChunks,
          },
        });

        if (sources.length > 0 && issues.length > 0) {
          for (const issue of issues) {
            issue.sourceReferences = sources;
          }
          allSources.push(...sources);
        }

        allIssues.push(...issues);
        console.log(`[RAG] 分片 ${i + 1}: 检测到 ${issues.length} 个问题`);
      } catch (e: any) {
        console.warn(`[RAG] 分片 ${i + 1} 审查失败:`, e.message);
      }
    }

    console.log(`[RAG] 审查完成: ${allIssues.length} 个问题, ${allSources.length} 条引用来源`);
    return { issues: allIssues, sourceReferences: allSources };
  }

  /**
   * 获取知识库树形结构（来自 KnowledgeCategory 表）
   */
  static async getKnowledgeTree(): Promise<KnowledgeTreeNode[]> {
    const categories = await prisma.knowledgeCategory.findMany({
      where: { status: 'ACTIVE' },
      include: { _count: { select: { vectorDocuments: true } } },
      orderBy: { name: 'asc' },
    });

    const map = new Map<string, KnowledgeTreeNode>();
    const roots: KnowledgeTreeNode[] = [];

    for (const cat of categories) {
      map.set(cat.id, {
        id: cat.id,
        name: cat.name,
        parentId: cat.parentId,
        type: cat.isLeaf ? 'knowledge' : 'folder',
        documentCount: cat._count.vectorDocuments,
        children: [],
      });
    }

    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        const parent = map.get(node.parentId)!;
        parent.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    const normalize = (node: KnowledgeTreeNode): KnowledgeTreeNode => {
      const children = (node.children || []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      if (children.length === 0) {
        return {
          id: node.id,
          name: node.name,
          parentId: node.parentId,
          type: 'knowledge',
          documentCount: node.documentCount,
        };
      }
      return {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        type: 'folder',
        documentCount: node.documentCount,
        children: children.map(normalize),
      };
    };

    return roots
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map(normalize);
  }

  /**
   * 获取扁平化的知识子库列表
   */
  static async getFlatKnowledgeList(): Promise<Array<{ id: string; name: string; documentCount?: number }>> {
    const categories = await prisma.knowledgeCategory.findMany({
      where: { status: 'ACTIVE' },
      include: { _count: { select: { vectorDocuments: true, children: true } } },
      orderBy: { name: 'asc' },
    });

    return categories
      .filter(cat => cat._count.children === 0)
      .map(cat => ({
      id: cat.id,
      name: cat.name,
      documentCount: cat._count.vectorDocuments,
    }));
  }
}
