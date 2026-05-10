/**
 * 向量文档管理服务
 *
 * 基于 pgvector 的本地向量检索，替代 MaxKB
 * 功能：分块、入库、三阶段混合检索（向量 + 关键词 + Rerank）
 */

import crypto from 'crypto';
import prisma from '../config/db';
import { EmbeddingService } from './embedding.service';

export interface VectorSearchResult {
  id: string;
  source_type: string;
  source_id: string | null;
  title: string | null;
  clause_id: string | null;
  content: string;
  content_hash: string | null;
  chunk_index: number;
  metadata: any;
  score: number;
  rerank_score?: number;
}

interface ImportEntry {
  sourceType: string;
  sourceId?: string;
  title: string;
  clauseId?: string;
  category?: string;
  content: string;
  metadata?: Record<string, any>;
  categoryId?: string;
}

interface SearchOptions {
  limit?: number;
  sourceTypes?: string[];
  categoryId?: string;
  rerank?: boolean;
}

export class VectorService {

  // ============ 分块 ============

  /**
   * 将长文本切分为带重叠的小块
   */
  static splitTextIntoChunks(text: string, { maxChars = 900, overlap = 120 } = {}): string[] {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];

    const paragraphs = normalized
      .split(/(?:\r?\n)+|(?<=[。！？；;.!?])\s*/g)
      .map(item => item.trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let current = '';

    const pushCurrent = () => {
      if (!current.trim()) return;
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap));
    };

    for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
      if (paragraph.length > maxChars) {
        pushCurrent();
        for (let i = 0; i < paragraph.length; i += maxChars - overlap) {
          chunks.push(paragraph.slice(i, i + maxChars).trim());
        }
        current = '';
        continue;
      }
      if ((current + paragraph).length > maxChars) pushCurrent();
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
    pushCurrent();

    return chunks.filter(chunk => chunk.length >= 20);
  }

  // ============ 去重哈希 ============

  private static sourceHash(parts: string[]): string {
    return crypto
      .createHash('sha256')
      .update(parts.map(p => String(p || '')).join('|'))
      .digest('hex');
  }

  // ============ 文档导入 ============

  /**
   * 将文本内容分块、向量化后入库
   */
  static async importDocument(entry: ImportEntry): Promise<{ chunks: number; deduped: number }> {
    const { sourceType, title, content, clauseId, category, metadata, categoryId } = entry;
    const chunks = this.splitTextIntoChunks(content);

    if (chunks.length === 0) return { chunks: 0, deduped: 0 };

    // 构建带元数据的待向量化文本
    const textsForEmbedding = chunks.map(chunk =>
      `${title}\n${category || ''}\n${clauseId || ''}\n${chunk}`
    );

    const embeddings = await EmbeddingService.embedTexts(textsForEmbedding);
    let deduped = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkClauseId = chunks.length > 1 ? `${clauseId || (i + 1)}-${i + 1}` : (clauseId || String(i + 1));
      const contentHash = this.sourceHash([sourceType, title, category || '', chunkClauseId, chunk]);
      const sourceId = entry.sourceId || `${sourceType}:${this.sourceHash([title, category || '', chunkClauseId, contentHash])}`;

      // 去重检查
      const existing = await prisma.vectorDocument.findFirst({
        where: { contentHash },
        select: { id: true },
      });

      if (existing) {
        deduped++;
        continue;
      }

      const embeddingStr = `[${embeddings[i].join(',')}]`;

      await prisma.$executeRawUnsafe(`
        INSERT INTO vector_documents
          (id, "categoryId", source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, embedding, created_at, updated_at)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, NOW(), NOW())
      `,
        categoryId || null,
        sourceType,
        chunks.length > 1 ? `${sourceId}:chunk:${i}` : sourceId,
        title,
        chunkClauseId,
        chunk,
        contentHash,
        i,
        JSON.stringify({ ...metadata, original_source_id: sourceId }),
        embeddingStr
      );
    }

    return { chunks: chunks.length, deduped };
  }

  /**
   * 批量导入多个文档
   */
  static async importDocuments(entries: ImportEntry[]): Promise<{ imported: number; totalChunks: number; deduped: number }> {
    let imported = 0;
    let totalChunks = 0;
    let deduped = 0;

    for (const entry of entries) {
      const result = await this.importDocument(entry);
      totalChunks += result.chunks;
      deduped += result.deduped;
      imported++;
    }

    return { imported, totalChunks, deduped };
  }

  // ============ 文档删除 ============

  static async deleteDocuments(filter: {
    ids?: string[];
    sourceType?: string;
    categoryId?: string;
    title?: string;
  }): Promise<number> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.ids?.length) {
      conditions.push(`id = ANY($${paramIndex}::text[])`);
      params.push(filter.ids);
      paramIndex++;
    }
    if (filter.sourceType) {
      conditions.push(`source_type = $${paramIndex}`);
      params.push(filter.sourceType);
      paramIndex++;
    }
    if (filter.categoryId) {
      conditions.push(`"categoryId" = $${paramIndex}`);
      params.push(filter.categoryId);
      paramIndex++;
    }
    if (filter.title) {
      conditions.push(`title = $${paramIndex}`);
      params.push(filter.title);
      paramIndex++;
    }

    if (conditions.length === 0) throw new Error('至少需要一个删除条件');

    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM vector_documents WHERE ${conditions.join(' AND ')}`,
      ...params
    );
    return result;
  }

  // ============ 三阶段混合检索 ============

  /**
   * 向量相似度搜索（pgvector <=> 算子）
   */
  private static async vectorSearch(
    queryVector: number[],
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const { limit, sourceTypes, categoryId } = options;
    const embeddingStr = `[${queryVector.join(',')}]`;

    const params: any[] = [embeddingStr];
    let paramIndex = 2;

    let sourceTypeFilter = '';
    if (sourceTypes?.length) {
      sourceTypeFilter = `AND source_type = ANY($${paramIndex}::text[])`;
      params.push(sourceTypes);
      paramIndex++;
    }
    let categoryFilter = '';
    if (categoryId) {
      categoryFilter = `AND "categoryId" = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }
    params.push(limit);

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id, source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata,
             1 - (embedding <=> $1::vector) AS score
      FROM vector_documents
      WHERE embedding IS NOT NULL ${sourceTypeFilter} ${categoryFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT $${paramIndex}
    `, ...params);

    return rows.map(row => ({
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      title: row.title,
      clause_id: row.clause_id,
      content: row.content,
      content_hash: row.content_hash,
      chunk_index: Number(row.chunk_index),
      metadata: this.parseMetadata(row.metadata),
      score: Number(row.score),
    }));
  }

  /**
   * 关键词搜索（中文分词 + ILIKE）
   */
  private static async keywordSearch(
    query: string,
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const { limit, sourceTypes, categoryId } = options;
    const terms = this.tokenizeQuery(query);
    if (terms.length === 0) return [];

    let sql = `SELECT id, source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, 0 as score
               FROM vector_documents WHERE (`;
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const term of terms) {
      conditions.push(
        `(title ILIKE $${paramIndex} OR clause_id ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`
      );
      params.push(`%${term}%`);
      paramIndex++;
    }
    sql += conditions.join(' OR ') + ')';

    if (sourceTypes?.length) {
      sql += ` AND source_type = ANY($${paramIndex}::text[])`;
      params.push(sourceTypes);
      paramIndex++;
    }
    if (categoryId) {
      sql += ` AND "categoryId" = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }

    sql += ` LIMIT ${limit * 4}`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    return rows.map(row => {
      const title = `${row.title || ''} ${row.clause_id || ''}`.toLowerCase();
      const content = String(row.content || '').toLowerCase();
      const score = terms.reduce((sum, term) => {
        return sum + (title.includes(term) ? 0.15 : 0) + (content.includes(term) ? 0.05 : 0);
      }, 0);
      return {
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        title: row.title,
        clause_id: row.clause_id,
        content: row.content,
        content_hash: row.content_hash,
        chunk_index: Number(row.chunk_index),
        metadata: this.parseMetadata(row.metadata),
        score,
      };
    }).filter(row => row.score > 0);
  }

  /**
   * 合并去重两个搜索结果
   */
  private static mergeResults(primary: VectorSearchResult[], secondary: VectorSearchResult[], limit: number): VectorSearchResult[] {
    const byHash = new Map<string, VectorSearchResult>();
    for (const row of [...primary, ...secondary]) {
      const key = row.content_hash || row.source_id || row.id;
      const existing = byHash.get(key);
      if (!existing || row.score > existing.score) {
        byHash.set(key, row);
      }
    }
    return [...byHash.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * 三阶段混合检索：向量 + 关键词 + Rerank
   */
  static async hybridSearch(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const { limit = 5, sourceTypes, categoryId, rerank = true } = options;
    const cleanQuery = query.replace(/\s+/g, ' ').trim();
    const candidateLimit = Math.max(limit * 8, limit);

    // Stage 1: 向量搜索
    const queryVector = await EmbeddingService.embedText(cleanQuery);
    const vectorResults = await this.vectorSearch(queryVector, { limit: candidateLimit, sourceTypes, categoryId });

    // Stage 2: 关键词搜索
    const keywordResults = await this.keywordSearch(cleanQuery, { limit: candidateLimit, sourceTypes, categoryId });

    // 合并
    let merged = this.mergeResults(vectorResults, keywordResults, candidateLimit);

    // Stage 3: Rerank
    if (rerank && merged.length > limit) {
      const reranked = await EmbeddingService.rerankDocuments(cleanQuery, merged, limit);
      merged = reranked as unknown as VectorSearchResult[];
    }

    return merged.slice(0, limit);
  }

  // ============ 文档列表查询 ============

  static async listDocuments(options: {
    page?: number;
    pageSize?: number;
    query?: string;
    sourceType?: string;
    categoryId?: string;
  } = {}) {
    const { page = 1, pageSize = 10, query, sourceType, categoryId } = options;
    const skip = (Math.max(1, page) - 1) * pageSize;

    const where: any = {};
    if (sourceType) where.sourceType = sourceType;
    if (categoryId) where.categoryId = categoryId;
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { clauseId: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.vectorDocument.count({ where }),
      prisma.vectorDocument.findMany({
        where,
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          title: true,
          clauseId: true,
          content: true,
          contentHash: true,
          chunkIndex: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return { page, pageSize, total, items };
  }

  // ============ 统计 ============

  static async getStats() {
    const totalCount = await prisma.vectorDocument.count();
    const byType = await prisma.vectorDocument.groupBy({
      by: ['sourceType'],
      _count: { id: true },
    });
    return { totalCount, byType };
  }

  // ============ 工具方法 ============

  private static tokenizeQuery(query: string): string[] {
    const text = query.toLowerCase();
    const terms = text.match(/[一-龥]{2,}|[a-z0-9]{2,}/g) || [];
    const stopwords = new Set(['合同', '条款', '风险', '审查', '问题', '建议', '相关', '依据', '法律', '法规']);
    return [...new Set(terms)]
      .filter(term => !stopwords.has(term) && term.length <= 24)
      .slice(0, 16);
  }

  private static parseMetadata(metadata: any): any {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
      try { return JSON.parse(metadata); } catch { return {}; }
    }
    return metadata;
  }

  private static pgArrayLiteral(items: string[]): string {
    return `ARRAY[${items.map(s => `'${s.replace(/'/g, "''")}'`).join(',')}]`;
  }
}
