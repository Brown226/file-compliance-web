/**
 * RAGFlow 知识库提供方
 *
 * 作为主项目（file-compliance-web）的第二个知识库检索源，与 MaxKB 并列。
 * 复用内网已部署的 RAGFlow 容器（如 http://10.102.2.40:9380），纯内网 HTTP 调用。
 *
 * 设计要点：
 * 1. 与 MaxKBService 保持一致的对外契约：返回 RAGRetrievedChunk[]（见 rag.service.ts）。
 * 2. knowledgeId 在下游调用时已是"去前缀"后的纯 dataset id（前缀 ragflow: 由 RAGService 剥离）。
 * 3. 连接配置从 system_configs.ragflow_config 读取，运行时可在管理面板修改；
 *    同时支持环境变量 RAGFLOW_BASE_URL / RAGFLOW_API_KEY 兜底。
 * 4. 未配置或配置缺失时，所有方法安全返回空，不影响 MaxKB 主路径。
 */

import { RAGRetrievedChunk } from './rag.service';
import { CacheService } from './cache.service';

// ==================== 配置 ====================

interface RagflowConfig {
  baseUrl: string;     // 如 http://10.102.2.40:9380
  apiKey: string;
  similarityThreshold: number; // 检索相似度阈值，默认 0.2（RAGFlow 推荐）
}

// ==================== RAGFlow 提供方 ====================

export class RagflowProvider {

  /** 读取 RAGFlow 连接配置（优先环境变量兜底，主体来自 system_configs.ragflow_config） */
  static async getConfig(): Promise<RagflowConfig | null> {
    try {
      const prisma = (global as any).prisma;
      let cfg: any = {};
      if (prisma) {
        const row = await prisma.systemConfig.findUnique({ where: { key: 'ragflow_config' } });
        if (row?.value && typeof row.value === 'object') cfg = row.value;
      }
      const baseUrl = process.env.RAGFLOW_BASE_URL || cfg.baseUrl;
      const apiKey = process.env.RAGFLOW_API_KEY || cfg.apiKey;
      if (!baseUrl || !apiKey) {
        console.warn('[Ragflow] 未配置 ragflow_config（baseUrl/apiKey 缺失），跳过 RAGFlow 检索');
        return null;
      }
      return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey,
        similarityThreshold: typeof cfg.similarityThreshold === 'number' ? cfg.similarityThreshold : 0.2,
      };
    } catch (e) {
      console.warn('[Ragflow] 读取配置失败:', (e as Error).message);
      return null;
    }
  }

  /**
   * 从指定 RAGFlow dataset 中检索相关段落
   * @param datasetId 去前缀后的纯 dataset id
   * @param queryText 查询文本
   * @param options.topNumber 返回条数
   * @param options.similarity 相似度阈值（覆盖配置默认）
   */
  static async retrieve(
    datasetId: string,
    queryText: string,
    options?: { topNumber?: number; similarity?: number },
  ): Promise<RAGRetrievedChunk[]> {
    const config = await this.getConfig();
    if (!config) return [];

    const topNumber = options?.topNumber ?? 5;
    const similarity = options?.similarity ?? config.similarityThreshold;

    // 缓存键：与 MaxKB 检索同策略
    const cacheKey = CacheService.generateKey('ragflow:retrieve', datasetId, String(topNumber), queryText);
    const CACHE_TTL = 5 * 60 * 1000;

    const cached = CacheService.get<RAGRetrievedChunk[]>(cacheKey);
    if (cached !== null) {
      console.log(`[Ragflow] 缓存命中: dataset=${datasetId}, results=${cached.length}`);
      return cached;
    }

    console.log(`[Ragflow] 开始检索: dataset=${datasetId}, query_len=${queryText.length}, top=${topNumber}`);

    try {
      const url = `${config.baseUrl}/api/v1/retrieval`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          dataset_ids: [datasetId],
          question: queryText,
          page_size: topNumber,
          similarity_threshold: similarity,
        }),
      });

      const data = await resp.json() as any;
      // RAGFlow 响应: { code: 0, data: { chunks: [...] } } 或 { code: 0, data: [...] }
      const chunksRaw: any[] = data?.data?.chunks ?? data?.data ?? [];
      if (!Array.isArray(chunksRaw) || chunksRaw.length === 0) {
        console.log(`[Ragflow] 未检索到相关段落`);
        CacheService.set(cacheKey, [], CACHE_TTL);
        return [];
      }

      const chunks: RAGRetrievedChunk[] = chunksRaw.map((r: any, idx: number) => ({
        id: r.id || `rf-${idx}`,
        content: r.content || '',
        document_name: r.document_name || r.name || '未知文档',
        knowledge_name: r.dataset_name || r.knowledgebase_name || '',
        similarity: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : 0),
        comprehensive_score: typeof r.score === 'number' ? r.score : 0,
      }));

      CacheService.set(cacheKey, chunks, CACHE_TTL);
      console.log(`[Ragflow] 检索到 ${chunks.length} 条段落`);
      return chunks;
    } catch (e) {
      console.warn(`[Ragflow] 检索失败:`, (e as Error).message);
      return [];
    }
  }

  /**
   * 获取 RAGFlow dataset 列表，转换为前端知识库树节点
   * 返回的节点 id 已带 ragflow: 前缀，与 MaxKB 节点区分
   */
  static async getKnowledgeTree(): Promise<{ id: string; name: string; type: 'knowledge'; documentCount?: number }[]> {
    const config = await this.getConfig();
    if (!config) return [];

    try {
      const url = `${config.baseUrl}/api/v1/datasets`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });
      const data = await resp.json() as any;
      const list: any[] = data?.data ?? [];
      if (!Array.isArray(list)) return [];

      return list.map((ds: any) => ({
        id: `ragflow:${ds.id}`,
        name: ds.name || ds.id,
        type: 'knowledge' as const,
        documentCount: typeof ds.document_count === 'number' ? ds.document_count : undefined,
      }));
    } catch (e) {
      console.warn(`[Ragflow] 获取 dataset 列表失败:`, (e as Error).message);
      return [];
    }
  }
}
