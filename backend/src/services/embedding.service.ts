/**
 * Embedding + Reranking 服务
 *
 * 使用 OpenAI 兼容 API 进行文本向量化和重排序。
 * Embedding 失败时必须硬失败，禁止写入伪向量。
 */

import prisma from '../config/db';

const EMBEDDING_DIM = 4096;
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
      throw new Error('Embedding 模型未配置，禁止降级为本地伪向量');
    }

    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: texts, encoding_format: 'float' }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API 错误 (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const embeddings = (data.data || []).map((item: any) => item.embedding);
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(`Embedding 返回数量异常: expected=${texts.length}, actual=${embeddings.length}`);
    }
    for (const embedding of embeddings) {
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
        throw new Error(`Embedding 维度异常: expected=${EMBEDDING_DIM}, actual=${Array.isArray(embedding) ? embedding.length : 'invalid'}`);
      }
    }
    return embeddings;
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
