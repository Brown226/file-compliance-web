/**
 * 检索服务 — 混合检索、命中测试
 */

import prisma from '../config/db';
import { VectorService, VectorSearchResult } from './vector.service';

export interface SearchOptions {
  limit?: number;
  sourceTypes?: string[];
  categoryId?: string;
  rerank?: boolean;
  directReturnThreshold?: number;
}

export interface HitTestOptions {
  query: string;
  categoryId?: string;
  sourceTypes?: string[];
  topNumber?: number;
  searchMode?: 'vector' | 'keyword' | 'hybrid';
}

export interface HitTestResult {
  originalQuery: string;
  results: Array<{
    id: string;
    title: string | null;
    clauseId: string | null;
    content: string;
    vectorScore: number;
    keywordScore: number;
    rerankScore?: number;
    comprehensiveScore: number;
    chunkIndex: number;
    isTable: boolean;
    metadata: any;
  }>;
  usedConfig: {
    minSimilarity: number;
    directReturnThreshold: number;
    maxReferenceChars: number;
    enableRerank: boolean;
  };
  rerankApplied: boolean;
  directReturnHit: boolean;
  filteredBySimilarity: number;
  stats: {
    totalCandidates: number;
    afterDedup: number;
    afterRerank: number;
    searchTimeMs: number;
  };
}

export class SearchService {
  private static async getCategoryRetrievalConfig(categoryId?: string): Promise<{
    minSimilarity: number;
    directReturnThreshold: number;
    maxReferenceChars: number;
    enableRerank: boolean;
  }> {
    if (!categoryId) {
      return {
        minSimilarity: 0.6,
        directReturnThreshold: 0.9,
        maxReferenceChars: 5000,
        enableRerank: true,
      };
    }

    const category = await prisma.knowledgeCategory.findUnique({
      where: { id: categoryId },
      select: {
        minSimilarity: true,
        directReturnThreshold: true,
        maxReferenceChars: true,
        enableRerank: true,
      },
    });

    return {
      minSimilarity: category?.minSimilarity ?? 0.6,
      directReturnThreshold: category?.directReturnThreshold ?? 0.9,
      maxReferenceChars: category?.maxReferenceChars ?? 5000,
      enableRerank: category?.enableRerank ?? true,
    };
  }

  static async search(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const { limit = 5, sourceTypes, categoryId } = options;
    const cfg = await this.getCategoryRetrievalConfig(categoryId);

    const candidateLimit = Math.max(limit * 8, limit);
    const rerank = options.rerank ?? cfg.enableRerank;

    const candidates = await VectorService.hybridSearch(query, {
      limit: candidateLimit,
      sourceTypes,
      categoryId,
      rerank,
    });

    const filtered = candidates.filter(r => r.score >= cfg.minSimilarity);
    return filtered.slice(0, limit);
  }

  static async searchWithDirectReturn(
    query: string,
    options: SearchOptions & { directReturnThreshold?: number } = {},
  ): Promise<{ results: VectorSearchResult[]; isDirectReturn: boolean }> {
    const cfg = await this.getCategoryRetrievalConfig(options.categoryId);
    const threshold = options.directReturnThreshold ?? cfg.directReturnThreshold;
    const results = await this.search(query, options);

    if (results.length > 0 && results[0].score >= threshold) {
      return { results: [results[0]], isDirectReturn: true };
    }

    return { results, isDirectReturn: false };
  }

  static async hitTest(options: HitTestOptions): Promise<HitTestResult> {
    const startTime = Date.now();
    const {
      query,
      categoryId,
      sourceTypes,
      topNumber = 10,
      searchMode = 'hybrid',
    } = options;

    const cfg = await this.getCategoryRetrievalConfig(categoryId);
    const candidateLimit = Math.max(topNumber * 8, topNumber);

    let candidates: VectorSearchResult[];
    let rerankApplied = false;

    switch (searchMode) {
      case 'vector':
        candidates = await VectorService.vectorSearchByQuery(query, {
          limit: candidateLimit,
          sourceTypes,
          categoryId,
        });
        break;
      case 'keyword':
        candidates = await VectorService.keywordSearchByQuery(query, {
          limit: candidateLimit,
          sourceTypes,
          categoryId,
        });
        break;
      case 'hybrid':
      default:
        rerankApplied = cfg.enableRerank;
        candidates = await VectorService.hybridSearch(query, {
          limit: candidateLimit,
          sourceTypes,
          categoryId,
          rerank: cfg.enableRerank,
        });
        break;
    }

    const totalCandidates = candidates.length;
    const filteredCandidates = candidates.filter(r => r.score >= cfg.minSimilarity);
    const filteredBySimilarity = totalCandidates - filteredCandidates.length;

    const directReturnHit = filteredCandidates.length > 0
      && filteredCandidates[0].score >= cfg.directReturnThreshold;

    const limited = filteredCandidates.slice(0, topNumber);
    const searchResults = limited.map((r) => ({
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
      usedConfig: cfg,
      rerankApplied,
      directReturnHit,
      filteredBySimilarity,
      stats: {
        totalCandidates,
        afterDedup: filteredCandidates.length,
        afterRerank: searchResults.length,
        searchTimeMs: Date.now() - startTime,
      },
    };
  }
}