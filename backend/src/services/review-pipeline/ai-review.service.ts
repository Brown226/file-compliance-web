/**
 * AI 审查服务 — 从 BasePipeline 提取的静态方法集合
 *
 * 包含 RAG 审查、LLM 直接调用、降级策略等 AI 审查核心逻辑。
 * 所有方法均为 static，由 BasePipeline 委托调用。
 */

import { PipelineContext, PipelineReviewConfig } from './types';
import { ReviewIssue, SourceReference, LlmService } from '../llm.service';
import { RAGService } from '../rag.service';
import { VectorService } from '../vector.service';
import { PromptTemplateService } from '../prompt-template.service';
import { StandardTraceabilityService } from '../standard-traceability.service';

export class AiReviewService {
  // ==================== AI 审查实现 ====================

  /**
   * 自建 RAG 审查（推荐方案）
   *
   * 直接使用本地 pgvector 向量检索，
   * 获取相关段落后组装 prompt，调用自有 LLM 进行审查。
   */
  static async runRAGReview(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    // 获取知识子库 ID
    const knowledgeIds = ctx.knowledgeCategoryIds && ctx.knowledgeCategoryIds.length > 0
      ? ctx.knowledgeCategoryIds
      : ctx.knowledgeCategoryId
        ? [ctx.knowledgeCategoryId]
        : [];

    if (knowledgeIds.length === 0) {
      console.warn('[Pipeline] runRAGReview: 未指定知识子库ID');
      return { issues: [], engine: 'none' };
    }

    console.log(`[Pipeline] 启动自建 RAG 审查: kbs=[${knowledgeIds.join(',')}], text_len=${text.length}`);

    try {
      const result = await RAGService.reviewWithKnowledge(text, knowledgeIds, {
        chunkSize: config.chunkSize || 4000,
        topK: 5,
        llmMaxTokens: config.llmMaxTokens || 4096,
        llmTimeout: config.llmTimeout || 180,
        scene,
      });

      // 进度回调（一次性传完所有 issues，RAG 内部已处理所有分片）
      const enriched = StandardTraceabilityService.enrichWithStandardRef(result.issues);
      ctx.onChunkProgress?.(text.length, enriched, 0, 1, 'rag-llm');
      return { issues: enriched, engine: 'rag-llm', sources: result.sourceReferences };
    } catch (e) {
      console.error('[Pipeline] 自建 RAG 审查失败:', e);
      // RAG 失败时降级到纯 LLM
      return AiReviewService.fallbackToLLMWithKnowledge(text, ctx, config);
    }
  }

  /**
   * 从本地向量库检索标准内容作为上下文，传给自有 LLM 进行审查
   */
  static async fallbackToLLMWithKnowledge(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string }> {
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    let knowledgeContext = '';

    // 从本地向量库检索相关段落作为上下文
    const categoryIds = ctx.knowledgeCategoryIds && ctx.knowledgeCategoryIds.length > 0
      ? ctx.knowledgeCategoryIds
      : ctx.knowledgeCategoryId
        ? [ctx.knowledgeCategoryId]
        : [];

    for (const catId of categoryIds) {
      try {
        const results = await VectorService.hybridSearch(text.slice(0, 2000), {
          limit: 10,
          categoryId: catId,
          rerank: false,
        });
        if (results.length > 0) {
          const context = results.map(r => r.content).join('\n\n');
          knowledgeContext += context + '\n\n';
        }
      } catch (e) {
        console.warn(`[Pipeline] 获取知识子库 ${catId} 段落失败:`, e);
      }
    }

    if (knowledgeContext) {
      console.log(`[Pipeline] 获取到知识库段落作为上下文: ${knowledgeContext.length} 字符 (${categoryIds.length} 个知识子库)`);
    }

    // 使用自有 LLM 进行审查（带位置信息）
    const issues: ReviewIssue[] = [];
    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;

    // 按场景加载系统提示词
    const scene = AiReviewService.resolveScene(ctx);
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      scene, 'system', 'default',
      '你是文件合规审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
    );

    for (const chunk of chunks) {
      try {
        let llmIssues: ReviewIssue[];
        if (knowledgeContext) {
          // 将知识库内容作为标准上下文传给 LLM
          const userTpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'with_context',
            `【审查标准】\n${knowledgeContext}\n\n【待审查文本】\n${chunk.text}\n\n请根据以上审查标准，检查待审查文本的合规性问题。`,
          );
          const userContent = userTpl
            .replace(/\$\{ragContext\}/g, knowledgeContext)
            .replace(/\$\{standardContext\}/g, knowledgeContext)
            .replace(/\$\{text\}/g, chunk.text);

          llmIssues = await LlmService.reviewText(userContent, {
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
        } else {
          const userTpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'no_context',
            `【待审查文本】\n${chunk.text}\n\n请检查以上文本的合规性问题。`,
          );
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);

          llmIssues = await LlmService.reviewText(userContent, {
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
        }
        issues.push(...llmIssues);
        // 每个 chunk 完成后回调进度并传递该片的 issues（用于立即入库推送）
        ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, knowledgeContext ? 'llm-with-knowledge' : 'llm-direct');
      } catch (e: any) {
        console.warn(`[Pipeline] LLM 审查分片失败:`, e.message);
      }
    }

    const engineName = knowledgeContext ? 'llm-with-knowledge' : 'llm-direct';
    return { issues, engine: engineName };
  }

  /**
   * 公共步骤: AI 审查（标准路径）
   * 支持 auto/rag/rag_llm/llm_only/disabled 引擎策略
   */
  static async runAIReview(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const aiEngine = config.aiEngine || 'auto';

    const hasKnowledgeIds = (ctx.knowledgeCategoryIds && ctx.knowledgeCategoryIds.length > 0) || ctx.knowledgeCategoryId;

    // AI 引擎禁用
    if (aiEngine === 'disabled') {
      return { issues: [], engine: 'none' };
    }

    // 自建 RAG 模式（推荐：向量检索 + 自有 LLM）
    if (aiEngine === 'rag' || aiEngine === 'rag_llm') {
      if (!hasKnowledgeIds) {
        console.warn('[Pipeline] RAG 模式需要选择知识库，降级到 LLM 直接调用');
        return AiReviewService.runLLMWithFallback(text, ctx, scene, config);
      }
      return AiReviewService.runRAGReview(text, ctx, scene, config);
    }

    // 仅 LLM 模式
    if (aiEngine === 'llm_only') {
      return AiReviewService.runLLMDirect(text, ctx, scene, config);
    }

    // auto 模式：有知识库时使用 RAG，无知识库时使用 LLM
    if (hasKnowledgeIds) {
      console.log('[Pipeline] auto 模式: 检测到知识库选择，使用自建 RAG');
      try {
        const ragResult = await AiReviewService.runRAGReview(text, ctx, scene, config);
        if (ragResult.issues.length > 0 || ragResult.engine !== 'none') {
          return ragResult;
        }
        console.log('[Pipeline] 自建 RAG 无结果，降级到 LLM + 知识库段落');
      } catch (e) {
        console.warn('[Pipeline] 自建 RAG 失败，降级到 LLM + 知识库段落:', e);
      }
      // RAG 失败或无结果时，降级到 LLM + 知识库段落
      return AiReviewService.runLLMWithFallback(text, ctx, scene, config);
    } else {
      // 无知识库选择，直接使用 LLM
      console.log('[Pipeline] auto 模式: 无知识库选择，使用 LLM 直接调用');
      return AiReviewService.runLLMDirect(text, ctx, scene, config);
    }
  }

  /**
   * LLM 直接调用（无知识库上下文）
   */
  static async runLLMDirect(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const issues: ReviewIssue[] = [];

    try {
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        scene, 'system', 'default',
        '你是文件审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
      );
      const userTpl = await PromptTemplateService.getPromptByScene(
        scene, 'user', 'no_context',
        `【待审查文本】\n\n请检查以上文本的合规性问题。`,
      );

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      for (const chunk of chunks) {
        try {
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);
          const llmIssues = await LlmService.reviewText(userContent, {
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
          issues.push(...llmIssues);
          // 每个 chunk 完成后回调进度并传递该片的 issues
          ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, 'llm-direct');
        } catch (e: any) {
          console.warn(`[Pipeline] LLM 审查分片失败:`, e.message);
        }
      }
      return { issues: StandardTraceabilityService.enrichWithStandardRef(issues), engine: 'llm-direct' };
    } catch (e) {
      console.error('[Pipeline] LLM 直接调用失败:', e);
      return { issues: [], engine: 'none' };
    }
  }

  /**
   * LLM 调用（带知识库段落上下文，降级路径）
   */
  static async runLLMWithFallback(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ) {
    const fallback = await AiReviewService.fallbackToLLMWithKnowledge(text, ctx, config);
    return {
      issues: StandardTraceabilityService.enrichWithStandardRef(fallback.issues),
      engine: fallback.engine,
    };
  }

  /**
   * AI 策略: 纯 LLM 直接调用（跳过 RAG）
   * 用于 TYPO_GRAMMAR 等轻量模式
   */
  static async runLLMOnlyStrategy(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    try {
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        scene, 'system', 'default',
        '你是文件审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
      );

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const issues: ReviewIssue[] = [];
      for (const chunk of chunks) {
        try {
          const userTpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'default',
            `【待审查文本】\n${chunk.text}\n\n请检查以上文本的问题。`,
          );
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);

          const llmIssues = await LlmService.reviewText(userContent, {
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
          issues.push(...llmIssues);
          ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, 'llm-only');
        } catch (e: any) {
          console.warn(`[Pipeline] LLM 审查分片失败:`, e.message);
        }
      }
      return { issues: StandardTraceabilityService.enrichWithStandardRef(issues), engine: 'llm-direct' };
    } catch (e) {
      console.error('[Pipeline] LLM 调用失败:', e);
      return { issues: [], engine: 'none' };
    }
  }

  /**
   * @deprecated 使用 runLLMOnlyStrategy 替代。保留用于向后兼容。
   */
  static async runLLMOnly(text: string, ctx: PipelineContext, scene: string, config: PipelineReviewConfig): Promise<ReviewIssue[]> {
    const result = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);
    return result.issues;
  }

  // ==================== 内部辅助方法 ====================

  /**
   * 从 PipelineContext 推断审查场景（用于 PromptTemplateService 加载提示词）
   * 对应 BasePipeline.scene getter 的逻辑
   */
  private static resolveScene(ctx: PipelineContext): string {
    const modeMap: Record<string, string> = {
      LIBRARY_REVIEW: 'library_review',
      FULL_REVIEW: 'library_review',
      CONSISTENCY: 'consistency',
      TYPO_GRAMMAR: 'typo_grammar',
      DOC_REVIEW: 'doc_review',
      MULTIMODAL: 'multimodal',
      CUSTOM_RULE: 'library_review',
    };
    return modeMap[ctx.reviewMode] || 'library_review';
  }
}
