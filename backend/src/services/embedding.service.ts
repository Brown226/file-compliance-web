/**
 * Embedding + Reranking 服务
 *
 * 使用 OpenAI 兼容 API 进行文本向量化和重排序。
 * Embedding 失败时必须硬失败，禁止写入伪向量。
 *
 * 支持动态维度：不同模型可返回不同维度的向量（如 bge-m3=1024, qwen3=4096）
 * 数据库使用 vector 类型（不指定维度），自动适配。
 */

import prisma from '../config/db';
import { CacheService } from './cache.service';

const EMBEDDING_BATCH_SIZE = 32;
const EMBEDDING_CACHE_TTL = 3600;

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number; // 0 = 自动检测，不限制
}

interface EmbeddingResult {
  embeddings: number[][];
  actualDimensions: number; // API 实际返回的维度
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
            dimensions: typeof v.dimensions === 'number' ? v.dimensions : 0,
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

  private static computeCacheKey(texts: string[], model?: string, dimensions?: number): string {
    return CacheService.generateKey('embedding', model || 'unknown', String(dimensions || 0), ...texts);
  }

  /**
   * 批量文本向量化（带缓存）
   * 返回 EmbeddingResult 包含实际维度信息
   */
  static async embedTextsWithDimensions(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) return { embeddings: [], actualDimensions: 0 };

    // 递归分批
    if (texts.length > EMBEDDING_BATCH_SIZE) {
      const allEmbeddings: number[][] = [];
      let actualDimensions = 0;
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = await this.embedTextsWithDimensions(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
        allEmbeddings.push(...batch.embeddings);
        actualDimensions = batch.actualDimensions;
      }
      return { embeddings: allEmbeddings, actualDimensions };
    }

    const config = await this.getEmbeddingConfig();
    if (!config) {
      throw new Error('Embedding 模型未配置，禁止降级为本地伪向量');
    }

    // 缓存键现在包含 model + dimensions，修改配置后自动失效
    const cacheKey = this.computeCacheKey(texts, config.model, config.dimensions);
    const cached = CacheService.get<EmbeddingResult>(cacheKey);
    if (cached !== null) {
      console.log(`[Embedding] Cache hit for ${texts.length} texts`);
      return cached;
    }

    const startTime = Date.now();

    // 构建请求体：dimensions=0 时不发送该字段（让 API 返回模型默认维度）
    const requestBody: any = {
      model: config.model,
      input: texts,
      encoding_format: 'float',
    };
    if (config.dimensions > 0) {
      requestBody.dimensions = config.dimensions;
    }

    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
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

    // 检测实际维度
    let actualDimensions = 0;
    for (const embedding of embeddings) {
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`Embedding 维度异常: 返回了无效的向量数据`);
      }
      if (actualDimensions === 0) {
        actualDimensions = embedding.length;
      } else if (embedding.length !== actualDimensions) {
        throw new Error(`Embedding 维度不一致: 期望=${actualDimensions}, 实际=${embedding.length}`);
      }
    }

    // 如果配置了 dimensions，验证是否匹配
    if (config.dimensions > 0 && actualDimensions !== config.dimensions) {
      console.warn(`[Embedding] 维度不匹配: 配置=${config.dimensions}, 实际=${actualDimensions}。将使用实际维度。`);
    }

    const latency = Date.now() - startTime;
    console.log(`[Embedding] API call completed in ${latency}ms for ${texts.length} texts, dimensions=${actualDimensions}`);

    const result: EmbeddingResult = { embeddings, actualDimensions };
    CacheService.set(cacheKey, result, EMBEDDING_CACHE_TTL);
    return result;
  }

  /**
   * 批量文本向量化（兼容旧接口，返回 embeddings 数组）
   */
  static async embedTexts(texts: string[]): Promise<number[][]> {
    const result = await this.embedTextsWithDimensions(texts);
    return result.embeddings;
  }

  /**
   * 单文本向量化
   */
  static async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text]);
    return embedding;
  }

  /**
   * 获取当前配置的实际维度（不调用 API）
   * 返回 0 表示自动检测
   */
  static async getConfiguredDimensions(): Promise<number> {
    const config = await this.getEmbeddingConfig();
    return config?.dimensions ?? 0;
  }

  /**
   * 检查 Embedding 服务是否可用
   */
  static async isReady(): Promise<boolean> {
    const config = await this.getEmbeddingConfig();
    if (!config) return false;
    try {
      const result = await this.embedTextsWithDimensions(['测试文本']);
      return result.embeddings.length > 0 && result.actualDimensions > 0;
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
