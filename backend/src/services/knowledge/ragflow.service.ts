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
import { CacheService } from '../system/cache.service';

// ==================== 配置 ====================

interface RagflowConfig {
  baseUrl: string;     // 如 http://10.102.2.40:9380
  apiKey: string;
  similarityThreshold: number; // 检索相似度阈值，默认 0.2（RAGFlow 推荐）
  // ===== OPT-040: 双源协同策略 =====
  priority?: 'maxkb_first' | 'ragflow_first' | 'parallel'; // 默认 parallel
  dedupEnabled?: boolean;   // 默认 true
  ragflowWeight?: number;   // RAGFlow 分数权重（0-1），默认 1.0；MaxKB 始终 1.0
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
        priority: cfg.priority === 'maxkb_first' || cfg.priority === 'ragflow_first' ? cfg.priority : 'parallel',
        dedupEnabled: typeof cfg.dedupEnabled === 'boolean' ? cfg.dedupEnabled : true,
        ragflowWeight: typeof cfg.ragflowWeight === 'number' && cfg.ragflowWeight > 0 ? cfg.ragflowWeight : 1.0,
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

    const cached = await CacheService.get<RAGRetrievedChunk[]>(cacheKey);
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

  // ==================== OPT-040: 双源协同合并策略 ====================

  /**
   * 合并 MaxKB 与 RAGFlow 检索结果，按优先级/权重排序并去重
   *
   * @param maxkbChunks MaxKB 检索结果
   * @param ragflowChunks RAGFlow 检索结果
   * @param topK 最终返回条数
   * @returns 合并后的 RAGRetrievedChunk[]
   */
  static async mergeRetrievedChunks(
    maxkbChunks: RAGRetrievedChunk[],
    ragflowChunks: RAGRetrievedChunk[],
    topK: number,
  ): Promise<RAGRetrievedChunk[]> {
    const config = await this.getConfig();

    // 无配置时退化为原 parallel 行为：合并 + 按 similarity 降序 + 截断
    if (!config) {
      const merged = [...maxkbChunks, ...ragflowChunks];
      merged.sort((a, b) => b.similarity - a.similarity);
      return merged.slice(0, topK * 2);
    }

    const priority = config.priority || 'parallel';
    const dedupEnabled = config.dedupEnabled !== false;
    const ragflowWeight = config.ragflowWeight ?? 1.0;

    // 1. 权重调整：对 RAGFlow 的 similarity 施加权重（MaxKB 始终 1.0）
    const weightedRagflow = ragflowChunks.map(c => ({
      ...c,
      similarity: c.similarity * ragflowWeight,
      comprehensive_score: c.comprehensive_score * ragflowWeight,
    }));

    let merged: RAGRetrievedChunk[];

    if (priority === 'maxkb_first') {
      // MaxKB 优先：MaxKB 全保留，RAGFlow 仅填充到 2*topK
      const target = topK * 2;
      merged = [...maxkbChunks];
      for (const c of weightedRagflow) {
        if (merged.length >= target) break;
        merged.push(c);
      }
    } else if (priority === 'ragflow_first') {
      // RAGFlow 优先：RAGFlow 全保留，MaxKB 仅填充
      const target = topK * 2;
      merged = [...weightedRagflow];
      for (const c of maxkbChunks) {
        if (merged.length >= target) break;
        merged.push(c);
      }
    } else {
      // parallel：合并后统一按 similarity 排序
      merged = [...maxkbChunks, ...weightedRagflow];
      merged.sort((a, b) => b.similarity - a.similarity);
    }

    // 2. 去重：按 (document_name, content 前 100 字) 指纹去重，保留 similarity 更高的
    if (dedupEnabled && merged.length > 1) {
      const seen = new Map<string, RAGRetrievedChunk>();
      for (const c of merged) {
        const fingerprint = `${c.document_name}::${c.content.substring(0, 100).trim()}`;
        const existing = seen.get(fingerprint);
        if (!existing || c.similarity > existing.similarity) {
          seen.set(fingerprint, c);
        }
      }
      merged = Array.from(seen.values());
      // 去重后重新排序（权重已在上一步应用）
      if (priority === 'parallel') {
        merged.sort((a, b) => b.similarity - a.similarity);
      }
    }

    return merged.slice(0, topK * 2);
  }
}
