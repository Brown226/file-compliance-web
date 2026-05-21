import { BaseRetriever, BaseRetrieverInput } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';
import prisma from '../../config/db';
import { EmbeddingService } from '../../services/embedding.service';
import { jiebaSplit } from '../../services/common/jieba';

export type SearchMode = 'embedding' | 'keyword' | 'hybrid';

export interface PgVectorRetrieverInput extends BaseRetrieverInput {
  limit?: number;
  categoryId?: string;
  sourceTypes?: string[];
  minSimilarity?: number;
  enableRerank?: boolean;
  searchMode?: SearchMode;
  embeddingWeight?: number;
  rerankWeight?: number;
}

interface RawSearchResult {
  id: string;
  source_type: string;
  source_id: string;
  title: string | null;
  clause_id: string | null;
  content: string;
  content_hash: string | null;
  chunk_index: number;
  metadata: any;
  score: number;
  rerank_score?: number;
}

interface WeightedRecallList {
  weight: number;
  list: RawSearchResult[];
}

function countRecallLimit(searchMode: SearchMode, baseLimit: number) {
  const scale = Math.max(baseLimit * 10, 80);
  if (searchMode === 'embedding') {
    return { embeddingLimit: scale, keywordLimit: 0 };
  }
  if (searchMode === 'keyword') {
    return { embeddingLimit: 0, keywordLimit: scale };
  }
  return { embeddingLimit: Math.round(scale * 0.8), keywordLimit: Math.round(scale * 0.6) };
}

function rrfConcat(arr: WeightedRecallList[]): RawSearchResult[] {
  arr = arr.filter(item => item.list.length > 0);
  if (arr.length === 0) return [];
  if (arr.length === 1) return arr[0].list;

  const map = new Map<string, RawSearchResult & { rrfScore: number }>();

  for (const item of arr) {
    const weight = item.weight;
    for (let index = 0; index < item.list.length; index++) {
      const data = item.list[index];
      const rank = index + 1;
      const score = weight * (1 / (60 + rank));
      const key = data.id;
      const record = map.get(key);
      if (record) {
        record.rrfScore += score;
        if (data.score > record.score) {
          record.score = data.score;
        }
      } else {
        map.set(key, { ...data, rrfScore: score });
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ rrfScore: _, ...result }) => result);
}

export class PgVectorRetriever extends BaseRetriever {
  lc_serializable = false;

  get lc_namespace() {
    return ['pgvector', 'retriever'];
  }

  limit: number;
  categoryId?: string;
  sourceTypes?: string[];
  minSimilarity: number;
  enableRerank: boolean;
  searchMode: SearchMode;
  embeddingWeight: number;
  rerankWeight: number;

  constructor(fields: PgVectorRetrieverInput) {
    super(fields);
    this.limit = fields.limit ?? 5;
    this.categoryId = fields.categoryId;
    this.sourceTypes = fields.sourceTypes;
    this.minSimilarity = fields.minSimilarity ?? 0.3;
    this.enableRerank = fields.enableRerank ?? true;
    this.searchMode = fields.searchMode ?? 'hybrid';
    this.embeddingWeight = fields.embeddingWeight ?? 0.7;
    this.rerankWeight = fields.rerankWeight ?? 0.6;
  }

  async _getRelevantDocuments(query: string, runManager?: CallbackManagerForRetrieverRun): Promise<Document[]> {
    const { embeddingLimit, keywordLimit } = countRecallLimit(this.searchMode, this.limit);

    const recallLists: WeightedRecallList[] = [];

    if (embeddingLimit > 0) {
      const vectorResults = await this.vectorSearch(query, embeddingLimit);
      recallLists.push({ weight: this.embeddingWeight, list: vectorResults });
    }

    if (keywordLimit > 0) {
      const keywordResults = await this.keywordSearch(query, keywordLimit);
      recallLists.push({ weight: 1 - this.embeddingWeight, list: keywordResults });
    }

    let merged = rrfConcat(recallLists);

    if (this.enableRerank && merged.length > this.limit) {
      const reranked = await this.weightedRerank(query, merged);
      merged = reranked;
    }

    const filtered = merged.filter(r => r.score >= this.minSimilarity);

    return filtered.slice(0, this.limit).map(r => new Document({
      pageContent: r.content,
      metadata: {
        id: r.id,
        source_type: r.source_type,
        source_id: r.source_id,
        title: r.title,
        clause_id: r.clause_id,
        chunk_index: r.chunk_index,
        score: r.score,
        rerank_score: r.rerank_score,
        is_table: r.metadata?.is_table ?? false,
        heading: r.metadata?.heading ?? '',
      },
    }));
  }

  private async vectorSearch(query: string, limit: number): Promise<RawSearchResult[]> {
    const queryVector = await EmbeddingService.embedText(query);
    const embeddingStr = `[${queryVector.join(',')}]`;

    const params: any[] = [embeddingStr];
    let paramIndex = 2;

    let sourceTypeFilter = '';
    if (this.sourceTypes?.length) {
      sourceTypeFilter = `AND source_type = ANY($${paramIndex}::text[])`;
      params.push(this.sourceTypes);
      paramIndex++;
    }
    let categoryFilter = '';
    if (this.categoryId) {
      categoryFilter = `AND "categoryId" = $${paramIndex}`;
      params.push(this.categoryId);
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

    return rows.map((row: any) => ({
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      title: row.title,
      clause_id: row.clause_id,
      content: row.content,
      content_hash: row.content_hash,
      chunk_index: Number(row.chunk_index),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      score: Number(row.score),
    }));
  }

  private async keywordSearch(query: string, limit: number): Promise<RawSearchResult[]> {
    const terms = await jiebaSplit(query);
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

    if (this.sourceTypes?.length) {
      sql += ` AND source_type = ANY($${paramIndex}::text[])`;
      params.push(this.sourceTypes);
      paramIndex++;
    }
    if (this.categoryId) {
      sql += ` AND "categoryId" = $${paramIndex}`;
      params.push(this.categoryId);
      paramIndex++;
    }

    sql += ` LIMIT ${limit}`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    return rows.map((row: any) => {
      const title = `${row.title || ''} ${row.clause_id || ''}`.toLowerCase();
      const content = String(row.content || '').toLowerCase();
      const score = terms.reduce((sum: number, term: string) => {
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
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        score,
      };
    }).filter((row: any) => row.score > 0);
  }

  private async weightedRerank(query: string, documents: RawSearchResult[]): Promise<RawSearchResult[]> {
    try {
      const rerankInput = documents.map(d => ({ title: d.title, content: d.content }));
      const reranked = await EmbeddingService.rerankDocuments(query, rerankInput, this.limit * 2);

      const rerankList: RawSearchResult[] = reranked.map((r: any) => {
        const idx = (r as any).index;
        const source = documents[idx] || documents[0];
        return { ...source, rerank_score: r.rerank_score ?? r.score, score: r.rerank_score ?? r.score };
      }).filter(Boolean);

      return rrfConcat([
        { weight: 1 - this.rerankWeight, list: documents },
        { weight: this.rerankWeight, list: rerankList },
      ]);
    } catch (e: any) {
      console.warn(`[PgVectorRetriever] Rerank 失败，使用原始 RRF 排序: ${e.message}`);
      return documents;
    }
  }
}
