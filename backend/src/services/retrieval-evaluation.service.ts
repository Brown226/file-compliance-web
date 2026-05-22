/**
 * 检索质量评估服务
 *
 * 支持功能：
 * - Recall@K 评估
 * - Precision@K 评估
 * - MRR (Mean Reciprocal Rank) 评估
 * - NDCG 评估
 * - 检索延迟统计
 * - A/B 测试对比
 *
 * 使用场景：
 * - 评估不同检索参数的效果
 * - 对比不同 Embedding 模型
 * - 优化检索策略
 */

import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';

export interface EvaluationQuery {
  query: string;
  relevantIds: string[];
  relevantDocIds?: string[];
}

export interface RetrievalResult {
  id: string;
  documentId?: string;
  score: number;
  content: string;
  title?: string;
}

export interface EvaluationMetrics {
  query: string;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  recallAt10: number;
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  precisionAt10: number;
  mrr: number;
  ndcgAt5: number;
  ndcgAt10: number;
  avgPrecision: number;
  retrievedCount: number;
  relevantCount: number;
  retrievedIds: string[];
}

export interface EvaluationResult {
  totalQueries: number;
  avgMetrics: {
    recallAt1: number;
    recallAt3: number;
    recallAt5: number;
    recallAt10: number;
    mrr: number;
    ndcgAt5: number;
    ndcgAt10: number;
    avgPrecision: number;
  };
  queryResults: EvaluationMetrics[];
  latencyStats: {
    avgLatency: number;
    p50Latency: number;
    p90Latency: number;
    p99Latency: number;
  };
}

export interface SearchOptions {
  limit?: number;
  categoryId?: string;
  minSimilarity?: number;
  enableRerank?: boolean;
  searchMode?: 'hybrid' | 'vector' | 'keyword';
}

export class RetrievalEvaluationService {
  /**
   * 评估检索质量
   */
  static async evaluate(
    queries: EvaluationQuery[],
    searchOptions: SearchOptions = {}
  ): Promise<EvaluationResult> {
    const queryResults: EvaluationMetrics[] = [];
    const latencies: number[] = [];

    for (const q of queries) {
      const startTime = Date.now();
      const result = await this.evaluateSingleQuery(q, searchOptions);
      const latency = Date.now() - startTime;

      queryResults.push(result);
      latencies.push(latency);
    }

    return this.aggregateResults(queryResults, latencies);
  }

  /**
   * 评估单个查询
   */
  private static async evaluateSingleQuery(
    query: EvaluationQuery,
    options: SearchOptions
  ): Promise<EvaluationMetrics> {
    const limit = options.limit || 10;
    const searchResults = await VectorService.searchVectors(
      query.query,
      {
        categoryId: options.categoryId,
        limit,
        minSimilarity: options.minSimilarity || 0,
        rerank: options.enableRerank,
      }
    );

    const retrievedIds = searchResults.map((r) => r.id);
    const retrievedDocIds = searchResults
      .map((r) => r.documentId)
      .filter((id): id is string => !!id);

    const relevantSet = new Set([
      ...query.relevantIds,
      ...(query.relevantDocIds || []),
    ]);

    const relevantRetrieved = retrievedIds.filter((id) => relevantSet.has(id));
    const relevantRetrievedDocIds = retrievedDocIds.filter((id) =>
      relevantSet.has(id)
    );

    const allRelevantRetrieved = [
      ...relevantRetrieved,
      ...relevantRetrievedDocIds,
    ];
    const uniqueRelevantRetrieved = [...new Set(allRelevantRetrieved)];

    const relevantCount = relevantSet.size;
    const retrievedCount = retrievedIds.length;

    return {
      query: query.query,
      recallAt1: this.recallAtK(uniqueRelevantRetrieved, relevantSet, 1),
      recallAt3: this.recallAtK(uniqueRelevantRetrieved, relevantSet, 3),
      recallAt5: this.recallAtK(uniqueRelevantRetrieved, relevantSet, 5),
      recallAt10: this.recallAtK(uniqueRelevantRetrieved, relevantSet, 10),
      precisionAt1: this.precisionAtK(uniqueRelevantRetrieved, 1),
      precisionAt3: this.precisionAtK(uniqueRelevantRetrieved, 3),
      precisionAt5: this.precisionAtK(uniqueRelevantRetrieved, 5),
      precisionAt10: this.precisionAtK(uniqueRelevantRetrieved, 10),
      mrr: this.calculateMRR(uniqueRelevantRetrieved, relevantSet),
      ndcgAt5: this.calculateNDCG(uniqueRelevantRetrieved, relevantSet, 5),
      ndcgAt10: this.calculateNDCG(uniqueRelevantRetrieved, relevantSet, 10),
      avgPrecision: this.calculateAveragePrecision(
        uniqueRelevantRetrieved,
        relevantSet
      ),
      retrievedCount,
      relevantCount,
      retrievedIds,
    };
  }

  /**
   * Recall@K
   */
  private static recallAtK(
    retrieved: string[],
    relevant: Set<string>,
    k: number
  ): number {
    const topK = retrieved.slice(0, k);
    const relevantRetrieved = topK.filter((id) => relevant.has(id));
    return relevant.size > 0 ? relevantRetrieved.length / relevant.size : 0;
  }

  /**
   * Precision@K
   */
  private static precisionAtK(retrieved: string[], k: number): number {
    const topK = retrieved.slice(0, k);
    return k > 0 ? topK.length / k : 0;
  }

  /**
   * MRR (Mean Reciprocal Rank)
   */
  private static calculateMRR(
    retrieved: string[],
    relevant: Set<string>
  ): number {
    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.has(retrieved[i])) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  /**
   * NDCG (Normalized Discounted Cumulative Gain)
   */
  private static calculateNDCG(
    retrieved: string[],
    relevant: Set<string>,
    k: number
  ): number {
    const topK = retrieved.slice(0, k);
    let dcg = 0;
    let idcg = 0;

    for (let i = 0; i < topK.length; i++) {
      if (relevant.has(topK[i])) {
        dcg += 1 / Math.log2(i + 2);
      }
    }

    const relevantList = [...relevant];
    for (let i = 0; i < Math.min(k, relevantList.length); i++) {
      idcg += 1 / Math.log2(i + 2);
    }

    return idcg > 0 ? dcg / idcg : 0;
  }

  /**
   * Average Precision (AP)
   */
  private static calculateAveragePrecision(
    retrieved: string[],
    relevant: Set<string>
  ): number {
    let sumPrecision = 0;
    let relevantCount = 0;

    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.has(retrieved[i])) {
        relevantCount++;
        sumPrecision += relevantCount / (i + 1);
      }
    }

    return relevant.size > 0 ? sumPrecision / relevant.size : 0;
  }

  /**
   * 聚合多个查询的结果
   */
  private static aggregateResults(
    queryResults: EvaluationMetrics[],
    latencies: number[]
  ): EvaluationResult {
    const n = queryResults.length;
    if (n === 0) {
      return {
        totalQueries: 0,
        avgMetrics: {
          recallAt1: 0,
          recallAt3: 0,
          recallAt5: 0,
          recallAt10: 0,
          mrr: 0,
          ndcgAt5: 0,
          ndcgAt10: 0,
          avgPrecision: 0,
        },
        queryResults: [],
        latencyStats: {
          avgLatency: 0,
          p50Latency: 0,
          p90Latency: 0,
          p99Latency: 0,
        },
      };
    }

    const sortedLatencies = [...latencies].sort((a, b) => a - b);

    const avg = (arr: number[]) =>
      arr.reduce((sum, v) => sum + v, 0) / arr.length;

    return {
      totalQueries: n,
      avgMetrics: {
        recallAt1: avg(queryResults.map((r) => r.recallAt1)),
        recallAt3: avg(queryResults.map((r) => r.recallAt3)),
        recallAt5: avg(queryResults.map((r) => r.recallAt5)),
        recallAt10: avg(queryResults.map((r) => r.recallAt10)),
        mrr: avg(queryResults.map((r) => r.mrr)),
        ndcgAt5: avg(queryResults.map((r) => r.ndcgAt5)),
        ndcgAt10: avg(queryResults.map((r) => r.ndcgAt10)),
        avgPrecision: avg(queryResults.map((r) => r.avgPrecision)),
      },
      queryResults,
      latencyStats: {
        avgLatency: avg(latencies),
        p50Latency: sortedLatencies[Math.floor(n * 0.5)],
        p90Latency: sortedLatencies[Math.floor(n * 0.9)],
        p99Latency: sortedLatencies[Math.floor(n * 0.99)] || sortedLatencies[sortedLatencies.length - 1],
      },
    };
  }

  /**
   * A/B 测试：对比两组参数
   */
  static async compareParams(
    queries: EvaluationQuery[],
    paramsA: SearchOptions,
    paramsB: SearchOptions
  ): Promise<{
    resultA: EvaluationResult;
    resultB: EvaluationResult;
    improvement: Record<string, number>;
  }> {
    const [resultA, resultB] = await Promise.all([
      this.evaluate(queries, paramsA),
      this.evaluate(queries, paramsB),
    ]);

    const improvement: Record<string, number> = {};

    for (const key of Object.keys(resultA.avgMetrics)) {
      const valA = resultA.avgMetrics[key as keyof typeof resultA.avgMetrics];
      const valB = resultB.avgMetrics[key as keyof typeof resultB.avgMetrics];
      if (valA > 0) {
        improvement[key] = ((valB - valA) / valA) * 100;
      } else {
        improvement[key] = valB > 0 ? 100 : 0;
      }
    }

    return { resultA, resultB, improvement };
  }

  /**
   * 生成测试查询集
   * 基于知识库中的文档内容自动生成查询
   */
  static async generateTestQueries(
    categoryId: string,
    count: number = 10
  ): Promise<EvaluationQuery[]> {
    const docs = await VectorService.searchVectors('', {
      categoryId,
      limit: count,
      minSimilarity: 0,
    });

    return docs.map((doc) => ({
      query: doc.content.slice(0, 100),
      relevantIds: [doc.id],
      relevantDocIds: doc.documentId ? [doc.documentId] : [],
    }));
  }
}
