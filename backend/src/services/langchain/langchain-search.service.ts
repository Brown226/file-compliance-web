import { Document } from '@langchain/core/documents';
import { PgVectorRetriever, SearchMode } from './langchain-retriever';
import { SystemConfigChatModel } from './langchain-llm.adapter';
import { LangChainRAGService } from './langchain-rag.service';

export interface LangChainSearchResult {
  id: string;
  title: string | null;
  clauseId: string | null;
  content: string;
  score: number;
  rerankScore?: number;
  chunkIndex: number;
  isTable: boolean;
  metadata: any;
  source?: string;
}

export interface LangChainHitTestResult {
  originalQuery: string;
  multiQueryVariants?: string[];
  hydeAnswer?: string;
  results: LangChainSearchResult[];
  stats: {
    totalCandidates: number;
    afterRerank: number;
    searchTimeMs: number;
    multiQueryTimeMs?: number;
    hydeTimeMs?: number;
    searchMode: SearchMode;
  };
}

export class LangChainSearchService {

  static async search(
    query: string,
    options: {
      limit?: number;
      categoryId?: string;
      sourceTypes?: string[];
      enableMultiQuery?: boolean;
      enableHyDE?: boolean;
      minSimilarity?: number;
      searchMode?: SearchMode;
    } = {},
  ): Promise<LangChainSearchResult[]> {
    const {
      limit = 5,
      categoryId,
      sourceTypes,
      enableMultiQuery = false,
      enableHyDE = false,
      minSimilarity = 0.3,
      searchMode = 'hybrid',
    } = options;

    const queries = [query];

    if (enableMultiQuery) {
      try {
        const llm = await SystemConfigChatModel.create();
        const variants = await LangChainRAGService['generateMultiQuery'](llm, query, 3);
        queries.push(...variants);
      } catch (e: any) {
        console.warn(`[LangChain-Search] MultiQuery 失败: ${e.message}`);
      }
    }

    if (enableHyDE) {
      try {
        const llm = await SystemConfigChatModel.create();
        const hyde = await LangChainRAGService['generateHyDE'](llm, query);
        queries.push(hyde);
      } catch (e: any) {
        console.warn(`[LangChain-Search] HyDE 失败: ${e.message}`);
      }
    }

    const allDocs: Document[] = [];
    const seenIds = new Set<string>();

    for (const q of queries) {
      const retriever = new PgVectorRetriever({
        limit: limit * 2,
        categoryId,
        sourceTypes,
        minSimilarity,
        enableRerank: true,
        searchMode,
      });
      const docs = await retriever.invoke(q);
      for (const doc of docs) {
        if (!seenIds.has(doc.metadata.id)) {
          seenIds.add(doc.metadata.id);
          allDocs.push(doc);
        }
      }
    }

    return allDocs
      .sort((a, b) => (b.metadata.rerank_score ?? b.metadata.score) - (a.metadata.rerank_score ?? a.metadata.score))
      .slice(0, limit)
      .map(doc => ({
        id: doc.metadata.id,
        title: doc.metadata.title,
        clauseId: doc.metadata.clause_id,
        content: doc.pageContent,
        score: doc.metadata.score,
        rerankScore: doc.metadata.rerank_score,
        chunkIndex: doc.metadata.chunk_index,
        isTable: doc.metadata.is_table,
        metadata: doc.metadata,
        source: 'langchain',
      }));
  }

  static async hitTest(options: {
    query: string;
    categoryId?: string;
    sourceTypes?: string[];
    topNumber?: number;
    enableMultiQuery?: boolean;
    enableHyDE?: boolean;
    searchMode?: SearchMode;
  }): Promise<LangChainHitTestResult> {
    const startTime = Date.now();
    const {
      query,
      categoryId,
      sourceTypes,
      topNumber = 10,
      enableMultiQuery = true,
      enableHyDE = true,
      searchMode = 'hybrid',
    } = options;

    let multiQueryVariants: string[] | undefined;
    let hydeAnswer: string | undefined;
    let multiQueryTimeMs: number | undefined;
    let hydeTimeMs: number | undefined;

    const queries = [query];

    if (enableMultiQuery) {
      const mqStart = Date.now();
      try {
        const llm = await SystemConfigChatModel.create();
        multiQueryVariants = await LangChainRAGService['generateMultiQuery'](llm, query, 3);
        queries.push(...multiQueryVariants);
      } catch (e: any) {
        console.warn(`[LangChain-HitTest] MultiQuery 失败: ${e.message}`);
      }
      multiQueryTimeMs = Date.now() - mqStart;
    }

    if (enableHyDE) {
      const hydeStart = Date.now();
      try {
        const llm = await SystemConfigChatModel.create();
        hydeAnswer = await LangChainRAGService['generateHyDE'](llm, query);
        queries.push(hydeAnswer);
      } catch (e: any) {
        console.warn(`[LangChain-HitTest] HyDE 失败: ${e.message}`);
      }
      hydeTimeMs = Date.now() - hydeStart;
    }

    const allDocs: Document[] = [];
    const seenIds = new Set<string>();

    for (const q of queries) {
      const retriever = new PgVectorRetriever({
        limit: topNumber * 2,
        categoryId,
        sourceTypes,
        minSimilarity: 0.3,
        enableRerank: true,
        searchMode,
      });
      const docs = await retriever.invoke(q);
      for (const doc of docs) {
        if (!seenIds.has(doc.metadata.id)) {
          seenIds.add(doc.metadata.id);
          allDocs.push(doc);
        }
      }
    }

    const totalCandidates = allDocs.length;
    const results = allDocs
      .sort((a, b) => (b.metadata.rerank_score ?? b.metadata.score) - (a.metadata.rerank_score ?? a.metadata.score))
      .slice(0, topNumber)
      .map(doc => ({
        id: doc.metadata.id,
        title: doc.metadata.title,
        clauseId: doc.metadata.clause_id,
        content: doc.pageContent,
        score: doc.metadata.score,
        rerankScore: doc.metadata.rerank_score,
        chunkIndex: doc.metadata.chunk_index,
        isTable: doc.metadata.is_table,
        metadata: doc.metadata,
        source: 'langchain',
      }));

    return {
      originalQuery: query,
      multiQueryVariants,
      hydeAnswer,
      results,
      stats: {
        totalCandidates,
        afterRerank: results.length,
        searchTimeMs: Date.now() - startTime,
        multiQueryTimeMs,
        hydeTimeMs,
        searchMode,
      },
    };
  }
}
