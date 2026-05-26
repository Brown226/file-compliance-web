import { Document } from '@langchain/core/documents';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { SystemConfigChatModel } from './langchain-llm.adapter';
import { SystemConfigEmbeddings } from './langchain-embedding.adapter';
import { PgVectorRetriever } from './langchain-retriever';
import { VectorService } from '../../services/vector.service';
import { LlmService, ReviewIssue, SourceReference } from '../../services/llm.service';
import { PromptTemplateService } from '../../services/prompt-template.service';
import { EmbeddingService } from '../../services/embedding.service';

export interface LangChainRAGOptions {
  topK?: number;
  chunkSize?: number;
  llmMaxTokens?: number;
  llmTimeout?: number;
  scene?: string;
  enableMultiQuery?: boolean;
  enableHyDE?: boolean;
  enableCompression?: boolean;
  multiQueryCount?: number;
}

export interface LangChainRAGResult {
  issues: ReviewIssue[];
  sourceReferences: SourceReference[];
  debug: {
    multiQueryVariants?: string[];
    hydeAnswer?: string;
    retrievedCount: number;
    afterCompressionCount: number;
    rerankApplied: boolean;
  };
}

export class LangChainRAGService {

  static async reviewWithKnowledge(
    text: string,
    categoryIds: string[],
    options?: LangChainRAGOptions,
  ): Promise<LangChainRAGResult> {
    const ids = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
    if (ids.length === 0) {
      return { issues: [], sourceReferences: [], debug: { retrievedCount: 0, afterCompressionCount: 0, rerankApplied: false } };
    }

    const scene = options?.scene || 'library_review';
    const chunkSize = options?.chunkSize || 4000;
    const topK = options?.topK || 5;
    const llmMaxTokens = options?.llmMaxTokens || 4096;
    const llmTimeout = options?.llmTimeout || 180;
    const enableMultiQuery = options?.enableMultiQuery ?? true;
    const enableHyDE = options?.enableHyDE ?? true;
    const enableCompression = options?.enableCompression ?? true;
    const multiQueryCount = options?.multiQueryCount ?? 3;

    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;
    console.log(`[LangChain-RAG] 文本分为 ${totalChunks} 片, 知识库: [${ids.join(',')}], 场景: ${scene}`);

    const allIssues: ReviewIssue[] = [];
    const allSources: SourceReference[] = [];
    let globalDebug: LangChainRAGResult['debug'] = {
      retrievedCount: 0,
      afterCompressionCount: 0,
      rerankApplied: false,
    };

    const llm = await SystemConfigChatModel.create();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[LangChain-RAG] 处理分片 ${i + 1}/${totalChunks} (${chunk.text.length}字)`);

      try {
        const { documents, debug } = await this.enhancedRetrieve(
          llm, chunk.text, ids, topK,
          { enableMultiQuery, enableHyDE, enableCompression, multiQueryCount },
        );
        globalDebug = {
          ...globalDebug,
          ...debug,
          retrievedCount: globalDebug.retrievedCount + debug.retrievedCount,
          afterCompressionCount: globalDebug.afterCompressionCount + debug.afterCompressionCount,
          rerankApplied: debug.rerankApplied || globalDebug.rerankApplied,
        };

        let standardContext = '';
        let sources: SourceReference[] = [];

        if (documents.length > 0) {
          standardContext = this.formatContext(documents);
          sources = documents.map(d => ({
            content: d.pageContent.substring(0, 200),
            document_name: d.metadata.title || '未知文档',
            similarity: d.metadata.score || 0,
          }));
        }

        const systemPrompt = await PromptTemplateService.getPromptByScene(
          scene, 'system', 'default',
          '你是文件合规审查专家。请根据知识库检索到的标准规范，检查文本中的合规性问题。严格按照 JSON 数组格式输出审查结果。',
        );

        let userPrompt: string;
        if (standardContext) {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'with_context',
            '【知识库检索到的相关标准规范】\n${ragContext}\n\n【待审查文本】\n${text}\n\n请根据以上标准规范检查"待审查文本"中的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl
            .replace(/\$\{ragContext\}/g, standardContext)
            .replace(/\$\{standardContext\}/g, standardContext)
            .replace(/\$\{text\}/g, chunk.text);
        } else {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'no_context',
            '【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl.replace(/\$\{text\}/g, chunk.text);
        }

        const issues = await LlmService.reviewText(userPrompt, {
          maxTokens: llmMaxTokens,
          timeout: llmTimeout,
          systemPrompt,
          skipUserTemplate: true,
          positionInfo: {
            chunkIndex: chunk.chunkIndex,
            chunkStartIndex: chunk.startIndex,
            totalChunks,
          },
        });

        if (sources.length > 0 && issues.length > 0) {
          for (const issue of issues) {
            issue.sourceReferences = sources;
          }
          allSources.push(...sources);
        }

        allIssues.push(...issues);
        console.log(`[LangChain-RAG] 分片 ${i + 1}: 检索到 ${documents.length} 条, 检测到 ${issues.length} 个问题`);
      } catch (e: any) {
        console.warn(`[LangChain-RAG] 分片 ${i + 1} 审查失败:`, e.message);
      }
    }

    console.log(`[LangChain-RAG] 审查完成: ${allIssues.length} 个问题, ${allSources.length} 条引用来源`);
    return { issues: allIssues, sourceReferences: allSources, debug: globalDebug };
  }

  private static async enhancedRetrieve(
    llm: SystemConfigChatModel,
    query: string,
    categoryIds: string[],
    topK: number,
    options: {
      enableMultiQuery: boolean;
      enableHyDE: boolean;
      enableCompression: boolean;
      multiQueryCount: number;
    },
  ): Promise<{ documents: Document[]; debug: LangChainRAGResult['debug'] }> {
    const debug: LangChainRAGResult['debug'] = {
      retrievedCount: 0,
      afterCompressionCount: 0,
      rerankApplied: false,
    };

    const queries = [query];

    if (options.enableMultiQuery) {
      try {
        const variants = await this.generateMultiQuery(llm, query, options.multiQueryCount);
        queries.push(...variants);
        debug.multiQueryVariants = variants;
        console.log(`[LangChain-RAG] MultiQuery: 生成 ${variants.length} 个变体查询`);
      } catch (e: any) {
        console.warn(`[LangChain-RAG] MultiQuery 失败: ${e.message}`);
      }
    }

    let hydeAnswer: string | undefined;
    if (options.enableHyDE) {
      try {
        hydeAnswer = await this.generateHyDE(llm, query);
        debug.hydeAnswer = hydeAnswer;
        queries.push(hydeAnswer);
        console.log(`[LangChain-RAG] HyDE: 生成假设性答案 (${hydeAnswer.length}字)`);
      } catch (e: any) {
        console.warn(`[LangChain-RAG] HyDE 失败: ${e.message}`);
      }
    }

    const allDocs: Document[] = [];
    const seenIds = new Set<string>();

    for (const q of queries) {
      for (const catId of categoryIds) {
        try {
          const retriever = new PgVectorRetriever({
            limit: topK * 2,
            categoryId: catId,
            minSimilarity: 0.3,
            enableRerank: true,
          });
          const docs = await retriever.invoke(q);
          for (const doc of docs) {
            const docId = doc.metadata.id;
            if (!seenIds.has(docId)) {
              seenIds.add(docId);
              allDocs.push(doc);
            }
          }
        } catch (e: any) {
          console.warn(`[LangChain-RAG] 知识库 ${catId} 检索失败:`, e.message);
        }
      }
    }

    debug.retrievedCount = allDocs.length;
    debug.rerankApplied = true;

    let finalDocs = allDocs
      .sort((a, b) => (b.metadata.rerank_score ?? b.metadata.score) - (a.metadata.rerank_score ?? a.metadata.score))
      .slice(0, topK * 2);

    if (options.enableCompression && finalDocs.length > 0) {
      try {
        finalDocs = await this.compressContext(llm, query, finalDocs);
        console.log(`[LangChain-RAG] 上下文压缩: ${allDocs.length} → ${finalDocs.length} 条`);
      } catch (e: any) {
        console.warn(`[LangChain-RAG] 上下文压缩失败: ${e.message}`);
      }
    }

    debug.afterCompressionCount = finalDocs.length;
    finalDocs = finalDocs.slice(0, topK);

    return { documents: finalDocs, debug };
  }

  private static async generateMultiQuery(llm: SystemConfigChatModel, query: string, count: number): Promise<string[]> {
    const result = await llm.invoke([
      new SystemMessage(`你是检索查询优化专家。根据用户的查询，生成 ${count} 个不同角度的检索查询变体。
规则：
1. 每个变体从不同角度表达相同的检索意图
2. 使用同义词、近义词、相关术语
3. 保持查询简洁（每个不超过50字）
4. 严格每行输出一个查询，不要编号，不要额外说明`),
      new HumanMessage(query),
    ]);

    const variants = (result.content as string)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.length <= 100)
      .slice(0, count);

    return variants;
  }

  private static async generateHyDE(llm: SystemConfigChatModel, query: string): Promise<string> {
    const result = await llm.invoke([
      new SystemMessage('请针对用户的问题，写一段详细的假设性答案。这段答案将用于知识库检索，不需要完全正确，但需要包含与问题相关的专业术语和关键概念。答案长度200-500字。'),
      new HumanMessage(query),
    ]);

    return (result.content as string).trim();
  }

  private static async compressContext(llm: SystemConfigChatModel, query: string, documents: Document[]): Promise<Document[]> {
    const scored: Array<{ doc: Document; relevance: number }> = [];

    for (const doc of documents) {
      try {
        const result = await llm.invoke([
          new SystemMessage(`判断以下文档片段与查询的相关性。只输出一个0到1之间的数字，1表示完全相关，0表示完全不相关。不要输出任何其他内容。`),
          new HumanMessage(`查询: ${query}\n\n文档片段:\n${doc.pageContent.slice(0, 1500)}`),
        ]);

        const score = parseFloat((result.content as string).trim());
        if (!isNaN(score) && score > 0.3) {
          scored.push({ doc, relevance: score });
        }
      } catch {
        scored.push({ doc, relevance: doc.metadata.score ?? 0.5 });
      }
    }

    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .map(item => {
        item.doc.metadata.compression_score = item.relevance;
        return item.doc;
      });
  }

  static formatContext(documents: Document[]): string {
    if (documents.length === 0) return '';

    let context = '';
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const title = doc.metadata.title || '未知文档';
      const clauseId = doc.metadata.clause_id;
      const score = doc.metadata.rerank_score ?? doc.metadata.score;

      context += `【来源${i + 1}：${title}${clauseId ? ` (${clauseId})` : ''}】\n`;
      context += `${doc.pageContent}\n\n`;
    }
    return context.trim();
  }

  static async askQuestion(
    question: string,
    categoryIds: string[],
    history: Array<{ role: string; content: string }> = [],
    options?: { topK?: number; enableMultiQuery?: boolean; enableHyDE?: boolean; enableCompression?: boolean },
  ): Promise<{ answer: string; sources: SourceReference[]; debug: LangChainRAGResult['debug'] }> {
    const topK = options?.topK ?? 8;
    const enableMultiQuery = options?.enableMultiQuery ?? true;
    const enableHyDE = options?.enableHyDE ?? true;
    const enableCompression = options?.enableCompression ?? true;

    const llm = await SystemConfigChatModel.create();

    const { documents, debug } = await this.enhancedRetrieve(
      llm, question, categoryIds, topK,
      { enableMultiQuery, enableHyDE, enableCompression, multiQueryCount: 3 },
    );

    const knowledgeContext = this.formatContext(documents);

    const systemPrompt = [
      '你是核审通智能问答助手，专注于核电工程文件合规审查领域。',
      '使用与用户相同的语言回答问题。',
      '你可以基于知识库中的标准规范、法律法规和审查规则来回答问题。',
      '不要编造法规条文编号、标准名称或案例信息。',
      '如果知识库中没有足够的依据，请明确告知用户。',
      '对于技术问题，优先引用知识库中的标准规范作为依据。',
    ].join('\n');

    const evidencePrompt = documents.length > 0
      ? `知识库检索结果:\n${knowledgeContext}\n\n请基于以上知识库内容回答用户问题。如果知识库中没有足够依据，请如实告知。`
      : '未检索到相关内容，请基于你的专业知识回答。如果不确定，请明确说明。';

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const h of history.slice(-12)) {
      messages.push({ role: h.role, content: h.content });
    }

    messages.push({ role: 'system', content: evidencePrompt });
    messages.push({ role: 'user', content: question });

    const config = await LlmService.getLlmConfig();
    if (!config) throw new Error('LLM 未配置');

    const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) throw new Error(`LLM API 错误: ${response.status}`);

    const data = await response.json() as any;
    const answer = (data.choices?.[0]?.message?.content ?? '').replace(/<think[\s\S]*?<\/think>/g, '').trim();

    const sources: SourceReference[] = documents.map(d => ({
      content: d.pageContent.substring(0, 200),
      document_name: d.metadata.title || '未知文档',
      similarity: d.metadata.score || 0,
    }));

    return { answer, sources, debug };
  }
}
