/**
 * Embedding + Reranking 服务
 *
 * 使用 OpenAI 兼容 API 进行文本向量化和重排序
 * 支持 hash fallback（API 不可用时降级）
 */

import crypto from 'crypto';
import prisma from '../config/db';

const EMBEDDING_DIM = 1024;
const EMBEDDING_BATCH_SIZE = 32;

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface RerankConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class EmbeddingService {

  // ============ 配置读取 ============

  private static async getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
    try {
      const config = await prisma.systemConfig.findUnique({ where: { key: 'embedding_model' } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey) {
          return {
            baseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
            apiKey: v.apiKey,
            model: v.modelName || 'BAAI/bge-m3',
          };
        }
      }
    } catch (e) {
      console.warn('[Embedding] 获取配置失败:', e);
    }
    return null;
  }

  private static async getRerankConfig(): Promise<RerankConfig | null> {
    try {
      const config = await prisma.systemConfig.findUnique({ where: { key: 'reranker_model' } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey) {
          return {
            baseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
            apiKey: v.apiKey,
            model: v.modelName || 'BAAI/bge-reranker-v2-m3',
          };
        }
      }
    } catch (e) {
      console.warn('[Reranker] 获取配置失败:', e);
    }
    return null;
  }

  // ============ Hash Fallback ============

  private static hashFallbackEmbedding(text: string): number[] {
    const vector = new Array(EMBEDDING_DIM).fill(0);
    const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const tokens = normalized.match(/[一-龥]|[a-z0-9]+/g) || [];
    const grams: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) grams.push(`${tokens[i]}${tokens[i + 1]}`);
    for (const token of grams) {
      const digest = crypto.createHash('sha256').update(token).digest();
      const index = digest.readUInt32BE(0) % EMBEDDING_DIM;
      vector[index] += digest[4] % 2 === 0 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return norm ? vector.map(v => Number((v / norm).toFixed(6))) : vector;
  }

  // ============ 核心方法 ============

  /**
   * 批量文本向量化
   */
  static async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // 递归分批
    if (texts.length > EMBEDDING_BATCH_SIZE) {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = await this.embedTexts(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
        results.push(...batch);
      }
      return results;
    }

    const config = await this.getEmbeddingConfig();
    if (!config) {
      console.warn('[Embedding] 未配置 Embedding API，使用本地 hash 向量');
      return texts.map(t => this.hashFallbackEmbedding(t));
    }

    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, input: texts }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Embedding API 错误 (${response.status}): ${errText}`);
      }

      const data = await response.json() as any;
      return (data.data || []).map((item: any) => item.embedding);
    } catch (error: any) {
      console.warn(`[Embedding] API 调用失败: ${error.message}，降级为本地 hash 向量`);
      return texts.map(t => this.hashFallbackEmbedding(t));
    }
  }

  /**
   * 单文本向量化
   */
  static async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text]);
    return embedding;
  }

  /**
   * 检查 Embedding 服务是否可用
   */
  static async isReady(): Promise<boolean> {
    const config = await this.getEmbeddingConfig();
    if (!config) return false;
    try {
      const [embedding] = await this.embedTexts(['测试文本']);
      return Array.isArray(embedding) && embedding.length === EMBEDDING_DIM;
    } catch {
      return false;
    }
  }

  // ============ Reranking ============

  /**
   * 重排序文档列表
   */
  static async rerankDocuments(
    query: string,
    documents: Array<{ title?: string; content: string; [key: string]: any }>,
    topN?: number
  ): Promise<Array<{ [key: string]: any; rerank_score?: number }>> {
    if (documents.length === 0) return [];

    const config = await this.getRerankConfig();
    if (!config) {
      return documents.slice(0, topN || documents.length);
    }

    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          query,
          documents: documents.map(item => `${item.title || ''}\n${item.content}`),
          top_n: topN || documents.length,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Rerank API 错误 (${response.status}): ${errText}`);
      }

      const data = await response.json() as any;
      const results = data.results || [];
      if (!Array.isArray(results) || results.length === 0) {
        return documents.slice(0, topN || documents.length);
      }

      return results
        .map((result: any) => {
          const source = documents[result.index];
          if (!source) return null;
          return { ...source, rerank_score: result.relevance_score ?? result.score };
        })
        .filter(Boolean);
    } catch (error: any) {
      console.warn(`[Rerank] API 调用失败: ${error.message}，使用原始排序`);
      return documents.slice(0, topN || documents.length);
    }
  }
}
