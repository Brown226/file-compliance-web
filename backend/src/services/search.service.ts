/**
 * 检索服务 — 混合检索、命中测试
 *
 * 在 VectorService 之上提供应用级检索能力：
 * - 混合检索：向量 + 关键词 + Rerank
 * - 命中测试：专门的检索效果测试接口
 * - 相似度阈值过滤：高置信度结果直接返回
 */

import { VectorService, VectorSearchResult } from './vector.service';

export interface SearchOptions {
  limit?: number;
  sourceTypes?: string[];
  categoryId?: string;
  rerank?: boolean;
  /** 相似度阈值：超过此值的结果视为高置信度 */
  directReturnThreshold?: number;
}

export interface HitTestOptions {
  query: string;
  categoryId?: string;
  sourceTypes?: string[];
  topNumber?: number;
  /** 搜索模式：vector / keyword / hybrid */
  searchMode?: 'vector' | 'keyword' | 'hybrid';
}

export interface HitTestResult {
  /** 原始查询 */
  originalQuery: string;
  /** 检索结果列表 */
  results: Array<{
    id: string;
    title: string | null;
    clauseId: string | null;
    content: string;
    /** 向量相似度 */
    vectorScore: number;
    /** 关键词匹配分 */
  keywordScore: number;
    /** Rerank 分数 */
    rerankScore?: number;
    /** 综合评分 */
    comprehensiveScore: number;
    chunkIndex: number;
    isTable: boolean;
    metadata: any;
  }>;
  /** 检索统计 */
  stats: {
    totalCandidates: number;
    afterDedup: number;
    afterRerank: number;
    searchTimeMs: number;
  };
}

export class SearchService {

  /**
   * 混合检索（供问答等业务调用）
   */
  static async search(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const {
      limit = 5,
      sourceTypes,
      categoryId,
      rerank = true,
    } = options;

    return VectorService.hybridSearch(query, {
      limit,
      sourceTypes,
      categoryId,
      rerank,
    });
  }

  /**
   * 高置信度直接返回 — 相似度超过阈值时跳过 LLM
   */
  static async searchWithDirectReturn(
    query: string,
    options: SearchOptions & { directReturnThreshold?: number } = {},
  ): Promise<{ results: VectorSearchResult[]; isDirectReturn: boolean }> {
    const threshold = options.directReturnThreshold ?? 0.85;
    const results = await this.search(query, options);

    if (results.length > 0 && results[0].score >= threshold) {
      console.log(`[Search] 高置信度命中 (score=${results[0].score.toFixed(4)} >= ${threshold})，直接返回`);
      return { results: [results[0]], isDirectReturn: true };
    }

    return { results, isDirectReturn: false };
  }

  /**
   * 命中测试 — 专门的检索效果测试接口
   * 向量模式：仅向量相似度搜索
   * 关键词模式：仅关键词ILIKE搜索
   * 混合模式：向量+关键词+Rerank
   */
  static async hitTest(options: HitTestOptions): Promise<HitTestResult> {
    const startTime = Date.now();
    const {
      query,
      categoryId,
      sourceTypes,
      topNumber = 10,
      searchMode = 'hybrid',
    } = options;

    let results: VectorSearchResult[];

    switch (searchMode) {
      case 'vector':
        results = await VectorService.vectorSearchByQuery(query, {
          limit: topNumber,
          sourceTypes,
          categoryId,
        });
        break;
      case 'keyword':
        results = await VectorService.keywordSearchByQuery(query, {
          limit: topNumber,
          sourceTypes,
          categoryId,
        });
        break;
      case 'hybrid':
      default:
        results = await VectorService.hybridSearch(query, {
          limit: topNumber,
          sourceTypes,
          categoryId,
          rerank: true,
        });
        break;
    }

    const afterDedup = results.length;

    const searchResults = results.slice(0, topNumber).map((r) => ({
      id: r.id,
      title: r.title,
      clauseId: r.clause_id,
      content: r.content,
      vectorScore: r.score,
      keywordScore: 0,
      rerankScore: r.rerank_score,
      comprehensiveScore: r.rerank_score ?? r.score,
      chunkIndex: r.chunk_index,
      isTable: r.metadata?.is_table ?? false,
      metadata: r.metadata,
    }));

    return {
      originalQuery: query,
      results: searchResults,
      stats: {
        totalCandidates: afterDedup,
        afterDedup,
        afterRerank: afterDedup,
        searchTimeMs: Date.now() - startTime,
      },
    };
  }
}
