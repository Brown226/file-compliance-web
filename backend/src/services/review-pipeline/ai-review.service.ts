/**
 * AI 审查服务 — 从 BasePipeline 提取的静态方法集合
 *
 * 包含 RAG 审查、LLM 直接调用、降级策略等 AI 审查核心逻辑。
 * 所有方法均为 static，由 BasePipeline 委托调用。
 */

import { PipelineContext, PipelineReviewConfig } from './types';
import { ReviewIssue, SourceReference, LlmService } from '../llm.service';
import { LangChainRAGService } from '../langchain/langchain-rag.service';
import { VectorService } from '../vector.service';
import { PromptTemplateService } from '../prompt-template.service';
import { PromptLoader } from '../prompts';
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
      const result = await LangChainRAGService.reviewWithKnowledge(text, knowledgeIds, {
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

    // 按场景加载提示词（统一使用 PromptLoader，回退链：DB → Registry → 兜底）
    const scene = AiReviewService.resolveScene(ctx);
    const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, {
      hasContext: !!knowledgeContext,
    });
    const systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);

    for (const chunk of chunks) {
      try {
        let llmIssues: ReviewIssue[];
        if (knowledgeContext) {
          const userContent = await PromptLoader.loadUserPrompt(scene, 'with_context', {
            ragContext: knowledgeContext,
            standardContext: knowledgeContext,
            text: chunk.text,
          });

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
          const userContent = await PromptLoader.loadUserPrompt(scene, 'no_context', {
            text: chunk.text,
          });

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
      // runLLMDirect 始终无标准上下文，使用 no_context 变体
      const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, {
        hasContext: false,
      });
      const systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);
      const userTpl = await PromptLoader.loadUserPrompt(scene, 'no_context');

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
      const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, { hasContext: false });
      const systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const issues: ReviewIssue[] = [];
      for (const chunk of chunks) {
        try {
          const userTpl = await PromptLoader.loadUserPrompt(scene, 'default');
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

  // ==================== 参照文件比对策略 ====================

  /**
   * 参照文件比对策略（以文审文模式）
   * 将待审文件与参照文件进行 LLM 语义级逐项比对
   * 无参照文件时降级到标准 AI 审查
   */
  static async runRefCompareStrategy(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    // 无参照文件时降级到标准 AI 审查
    if (!ctx.refFileGroup || ctx.refFileGroup.refFiles.length === 0) {
      console.log('[AiReview] 无参照文件，降级到标准 AI 审查');
      return AiReviewService.runAIReview(text, ctx, 'library_review', config);
    }

    // 解析参照文件文本，带来源标注
    const { TextExtractionService } = await import('./text-extraction.service');
    const refTexts: string[] = [];
    const refFileNames: string[] = [];
    for (const refFile of ctx.refFileGroup.refFiles) {
      let refContent = refFile.extractedText || null;
      if (!refContent) {
        try {
          refContent = await TextExtractionService.extractFileText(refFile.filePath, refFile.fileType, refFile.fileName);
        } catch (e) {
          console.warn(`[AiReview] 参照文件解析失败: ${refFile.fileName}`, e);
        }
      }
      if (refContent) {
        refTexts.push(`【参照文件: ${refFile.fileName}】\n${refContent}`);
        refFileNames.push(refFile.fileName);
      }
    }

    if (refTexts.length === 0) {
      console.warn('[AiReview] 参照文件均无文本内容，降级到标准 AI 审查');
      return AiReviewService.runAIReview(text, ctx, 'library_review', config);
    }

    const refFileCount = refTexts.length;
    console.log(`[AiReview] 以文审文: ${refFileCount} 个参照文件 (${refFileNames.join(', ')})`);

    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;

    try {
      // 动态计算参照内容可用空间：优先从 LLM 模型配置读取上下文窗口
      let contextWindow = 131072; // 默认值（字符数）
      try {
        const { default: prisma } = await import('../../config/db');
        const llmCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_chat_model' } });
        if (llmCfg?.value && typeof llmCfg.value === 'object') {
          const v = llmCfg.value as any;
          if (typeof v.contextLength === 'number' && v.contextLength > 0) {
            contextWindow = v.contextLength;
          }
        }
      } catch (e) {
        // 数据库不可达，使用默认值
      }
      const outputBudget = llmMaxTokens * 3.5;             // 输出 token → 字符估算
      const safetyMargin = 4000;                            // 安全裕量
      const maxTargetChunkPerRequest = chunkSize;           // 单次请求的待审分片

      // 验证系统提示词
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        scene, 'system', 'default',
        '你是核电工程文件合规审查专家。请按照审查策略逐项核对待审文件是否与参照文件完全一致。严格按照 JSON 数组格式输出审查结果。',
      );
      const finalSystemPrompt = AiReviewService.injectSemanticContext(systemPrompt, ctx);
      const actualSystemPromptLen = finalSystemPrompt.length;

      // 可用参照空间 = 上下文 - 输出 - 系统提示词 - 待审分片 - 安全裕量 - userPrompt 模板开销
      const maxRefChars = contextWindow - outputBudget - actualSystemPromptLen - maxTargetChunkPerRequest - safetyMargin;

      // 全量参照文本
      const rawRefTextsJoined = refTexts.join('\n\n---\n\n');

      // 分支: 参照能放下 → 全量传递; 放不下 → 向量检索取最相关段落
      const useFullRefs = rawRefTextsJoined.length <= maxRefChars;
      let refTextsJoined: string;

      if (useFullRefs) {
        refTextsJoined = rawRefTextsJoined;
        console.log(`[AiReview] 参照全量传递: ${rawRefTextsJoined.length} 字符 / 可用 ${Math.floor(maxRefChars)} 字符 (上下文=${contextWindow}, 输出=${Math.floor(outputBudget)}, 系统=${actualSystemPromptLen})`);
      } else {
        console.log(`[AiReview] 参照过长 (${rawRefTextsJoined.length} > ${Math.floor(maxRefChars)})，启用向量检索`);
        // fallback: 简单截断到上限（向量检索路径在 per-chunk 循环中实现）
        refTextsJoined = rawRefTextsJoined.substring(0, Math.floor(maxRefChars));
      }

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];
      let failedChunks = 0;
      const errors: string[] = [];

      // 向量检索兜底: 只在参照过长时预先构建参照向量索引
      let refChunks: string[] | null = null;
      let refVectors: number[][] | null = null;
      if (!useFullRefs) {
        try {
          const { EmbeddingService } = await import('../embedding.service');
          // 将参照文本按段落分块（~1500 字符）
          refChunks = [];
          for (const refText of refTexts) {
            const paras = refText.split('\n').reduce((acc: string[], line: string) => {
              if (!line.trim()) { acc.push(''); return acc; }
              const last = acc.length > 0 ? acc[acc.length - 1] : '';
              if (last.length + line.length < 1500) {
                acc[acc.length - 1] = last + '\n' + line;
              } else {
                acc.push(line);
              }
              return acc;
            }, ['']);
            refChunks.push(...paras.filter(p => p.length >= 50));
          }
          if (refChunks.length > 0) {
            refVectors = await EmbeddingService.embedTexts(refChunks);
            console.log(`[AiReview] 参照向量索引完成: ${refChunks.length} 个分块×${refVectors[0]?.length || 0}d`);
          }
        } catch (e: any) {
          console.warn(`[AiReview] 参照向量索引失败: ${e.message}，回退到截断模式`);
          refChunks = null;
          refVectors = null;
        }
      }

      // 每分片循环
      for (const chunk of chunks) {
        try {
          let effectiveRefTexts: string;

          if (useFullRefs || !refChunks || !refVectors) {
            // 全量传递 或 向量索引失败 → 使用已截断/全量的参照文本
            effectiveRefTexts = refTextsJoined;
          } else {
            // 向量检索: 嵌入当前待审分片 → 计算余弦相似度 → 取 Top-5 参照段落
            try {
              const { EmbeddingService } = await import('../embedding.service');
              const chunkVec = await EmbeddingService.embedText(chunk.text);

              // 余弦相似度计算
              const scored = refChunks.map((rc, i) => {
                const rv = refVectors![i];
                let dot = 0, na = 0, nb = 0;
                for (let j = 0; j < rv.length; j++) {
                  dot += chunkVec[j] * rv[j];
                  na += chunkVec[j] * chunkVec[j];
                  nb += rv[j] * rv[j];
                }
                const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
                return { chunk: rc, sim };
              });

              scored.sort((a, b) => b.sim - a.sim);
              const topK = scored.slice(0, Math.min(5, scored.length));

              // 按原始顺序重建（保持参照文件间顺序感）
              const selected = new Map<number, string>();
              for (const s of scored.slice(0, Math.min(5, scored.length))) {
                const idx = refChunks.indexOf(s.chunk);
                if (idx >= 0 && !selected.has(idx)) selected.set(idx, s.chunk);
              }
              const ordered = Array.from(selected.entries())
                .sort(([a], [b]) => a - b)
                .map(([, c]) => c);

              effectiveRefTexts = '## 参照文件（向量检索：以下为与待审内容最相关的参照段落）\n\n'
                + ordered.join('\n\n---\n\n');
              console.log(`[AiReview] 分片${chunk.chunkIndex + 1}: 向量检索 ${refChunks.length} 块→Top${topK.length}, 最佳=${topK[0]?.sim?.toFixed(3) || 'N/A'}`);
            } catch (e: any) {
              console.warn(`[AiReview] 分片${chunk.chunkIndex + 1} 向量检索失败: ${e.message}，使用截断参照`);
              effectiveRefTexts = refTextsJoined;
            }
          }

          // 组装 user prompt
          const userContentTpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'comparison',
            '## 参照文件（权威基准）\n\n${refTexts}\n\n---\n\n## 待审文件（被审查对象）\n\n${text}\n\n---\n\n请按照系统指令中的四层审查策略，逐项核对。输出 JSON 数组。',
          );
          const userContent = userContentTpl
            .replace(/\$\{refTexts\}/g, effectiveRefTexts)
            .replace(/\$\{text\}/g, chunk.text);

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt: finalSystemPrompt,
            skipUserTemplate: true,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });

          allIssues.push(...issues);
          ctx.onChunkProgress?.(chunk.text.length, issues, chunk.chunkIndex, totalChunks, 'llm-ref-compare');
        } catch (e: any) {
          failedChunks++;
          errors.push(e.message);
          console.warn(`[AiReview] 分片 ${chunk.chunkIndex + 1}/${totalChunks} 比对失败:`, e.message);
        }
      }

      if (failedChunks === totalChunks && totalChunks > 0) {
        throw new Error(`所有 ${totalChunks} 个分片比对均失败: ${errors[0]}`);
      }

      const modeLabel = useFullRefs ? '全量' : (refVectors ? '向量检索' : '截断');
      console.log(`[AiReview] 以文审文完成(${modeLabel}): ${allIssues.length} 条问题, ${refFileCount} 个参照, ${totalChunks} 个分片, ${failedChunks} 个失败`);
      return { issues: allIssues, engine: 'llm-ref-compare' };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('[AiReview] LLM 请求超时，降级到标准 AI 审查');
      } else {
        console.error('[AiReview] LLM 比对失败:', e);
      }
      return AiReviewService.runAIReview(text, ctx, 'library_review', config);
    }
  }

  // ==================== 内部辅助方法 ====================

  /**
   * 将语义规范库条目格式化为 AI 提示词上下文（从 DB 模板加载上下文模板）
   */
  static async formatSemanticItems(items: NonNullable<PipelineContext['semanticItems']>): Promise<string> {
    if (!items || items.length === 0) return '';
    const lines = items.map((item, i) => {
      const parts = [`${i + 1}. [${item.ruleCode}] ${item.ruleName}`];
      if (item.description) parts.push(`   内容: ${item.description}`);
      if (item.category) parts.push(`   分类: ${item.category}`);
      return parts.join('\n');
    });
    const itemsText = lines.join('\n');
    const tpl = await PromptTemplateService.getPromptByScene(
      'semantic_spec', 'system', 'context',
      `## 语义规范库条文（审查依据）\n以下是本次审查必须依据的规范条文，请逐条检查文件是否违反：\n\n${itemsText}\n\n输出时，每条问题的 ruleCode 必须引用上述条文编号（如 [条文编号]），description 中必须说明违反了哪条具体条文。`,
    );
    return `\n\n${tpl.replace(/\$\{items\}/g, itemsText)}`;
  }

  /**
   * 将语义规范库上下文、审查点和核心目的注入系统提示词
   */
  /**
   * 为系统提示词注入审查点与核心目的
   *
   * 平衡机制（防确认偏误）：
   * 1. TYPO_GRAMMAR / CONSISTENCY 模式不注入（前者有冲突，后者有精确定义）
   * 2. 审查点注入在系统指令之前，降低 recency bias
   * 3. 语言从"请重点关注"改为"仅供参考，不限制审查范围"
   * 4. 追加反指令强制 LLM 报告审查点之外的问题
   */
  static injectSemanticContext(systemPrompt: string, ctx: PipelineContext): string {
    // 跳过模式：TYPO_GRAMMAR（与自身指令冲突）、CONSISTENCY（有精确定义C1-C4）
    const skipModes = ['TYPO_GRAMMAR', 'CONSISTENCY'];
    const hasReviewPoints = ctx.reviewPoints && ctx.reviewPoints.length > 0;
    const hasPurposes = ctx.corePurposes && ctx.corePurposes.length > 0;

    let prefix = '';

    // 审查点作为辅助参考（非强制指令），插入到 prompt 前面降低 recency bias
    if (!skipModes.includes(ctx.reviewMode || '') && hasReviewPoints) {
      prefix += `\n【辅助参考 — 以下审查点仅供参考，不限制审查范围，请全面检查所有问题】\n参考方向：${ctx.reviewPoints!.join('；')}\n`;
    }
    if (!skipModes.includes(ctx.reviewMode || '') && hasPurposes) {
      prefix += `\n【审查背景】目标：${ctx.corePurposes!.join('；')}\n`;
    }
    // 追加防偏误提示
    if (prefix) {
      prefix += '注意：以上仅作辅助参考，你必须依据系统规则全面审查，发现审查点之外的任何问题也应如实报告。\n\n';
    }

    let enhancedPrompt = prefix + systemPrompt;

    // 注入语义规范库上下文
    if (ctx._semanticPromptContext) {
      enhancedPrompt += ctx._semanticPromptContext;
    }

    return enhancedPrompt;
  }

  /**
   * 从 PipelineContext 推断审查场景（用于 PromptTemplateService 加载提示词）
   * 对应 BasePipeline.scene getter 的逻辑
   */
  static resolveScene(ctx: PipelineContext): string {
    const modeMap: Record<string, string> = {
      LIBRARY_REVIEW: 'library_review',
      CONSISTENCY: 'consistency',
      TYPO_GRAMMAR: 'typo_grammar',
      DOC_REVIEW: 'doc_review',
      MULTIMODAL: 'multimodal',
      RULE_ONLY: 'library_review',
    };
    return modeMap[ctx.reviewMode] || 'library_review';
  }

  /**
   * 语义规范库逐条匹配审查（方案 B）
   *
   * 将语义规范库中的每条条文作为独立检查项，逐批提交给 LLM，
   * 要求 LLM 判断待审文本是否违反该条文。
   * 同时使用 RAG 检索知识库中与该条文相关的段落作为参考上下文。
   *
   * @param text 待审文本
   * @param ctx PipelineContext（含 semanticItems + knowledgeCategoryIds）
   * @param config 审查配置
   * @returns 审查问题列表
   */
  static async runSemanticSpecReview(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string }> {
    const items = ctx.semanticItems;
    if (!items || items.length === 0) {
      return { issues: [], engine: 'none' };
    }

    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const batchSize = 4; // 每批最多 4 条规则

    // 获取知识库分类 ID（用于 RAG 检索辅助上下文）
    const categoryIds: string[] = ctx.knowledgeCategoryIds && ctx.knowledgeCategoryIds.length > 0
      ? ctx.knowledgeCategoryIds
      : ctx.knowledgeCategoryId
        ? [ctx.knowledgeCategoryId]
        : [];

    const allIssues: ReviewIssue[] = [];
    const batches: typeof items[] = [];

    // 预加载用户提示词模板（所有批次共用）
    const userTpl = await PromptTemplateService.getPromptByScene(
      'semantic_spec', 'user', 'default',
      `【待审查文本】\n\${text}\n\n请逐条检查以上文本是否违反规范条文，输出 JSON 数组。`,
    );

    // 分批：每 batchSize 条规则一批
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      // 构建规则条文描述
      const rulesText = batch.map((item, idx) => {
        const parts: string[] = [];
        parts.push(`### 条文 ${idx + 1}: [${item.ruleCode || 'N/A'}] ${item.ruleName || ''}`);
        if (item.description) parts.push(`   说明: ${item.description}`);
        if (item.category) parts.push(`   分类: ${item.category}`);
        if (item.severity) parts.push(`   严重度: ${item.severity}`);
        return parts.join('\n');
      }).join('\n\n');

      // RAG 检索该批规则相关的知识库段落
      let ragContext = '';
      if (categoryIds.length > 0) {
        try {
          const query = batch.map(b => `${b.ruleName || ''} ${b.description || ''}`).join(' ').slice(0, 500);
          const results = await VectorService.hybridSearch(query, {
            limit: 6,
            categoryId: categoryIds[0],
          });
          if (results.length > 0) {
            ragContext = results.map(r => r.content).join('\n\n');
          }
        } catch (e) {
          console.warn('[SemanticSpec] RAG 检索失败，跳过辅助上下文:', e);
        }
      }

      // 构建 Prompt（从 DB 模板加载，含动态变量替换）
      const ragContextBlock = ragContext ? `## 辅助参考（知识库检索到的相关内容）\n${ragContext}` : '';
      const systemPrompt = (await PromptTemplateService.getPromptByScene(
        'semantic_spec', 'system', 'default',
        `你是文件合规审查专家。请严格根据以下规范条文，逐条检查待审文本是否存在违规。

## 必须逐条检查的规范条文
\${rulesText}

\${ragContext}

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含：
- issueType: "VIOLATION"
- severity: 使用条文定义的严重度，默认 "warning"
- ruleCode: 必须引用条文编号
- originalText: 文档中的违规原文
- suggestedText: 建议修改内容
- description: 说明违反了哪条条文及其原因
- standardRef: 引用的条文内容摘要

如果没有发现违规，输出空数组 []。不要输出任何其他文字说明。`,
      ))
        .replace(/\$\{rulesText\}/g, rulesText)
        .replace(/\$\{ragContext\}/g, ragContextBlock);

      // 分片处理长文本
      const chunks = LlmService.splitText(text, chunkSize, true);
      for (const chunk of chunks) {
        try {
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
          });
          allIssues.push(...issues);
        } catch (e) {
          console.warn('[SemanticSpec] 分片审查失败:', e instanceof Error ? e.message : e);
        }
      }
    }

    // 简单去重：按 originalText 前 60 字符去重
    const seen = new Set<string>();
    const deduped = allIssues.filter(issue => {
      const key = (issue.originalText || '').slice(0, 60).trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { issues: deduped, engine: 'semantic-spec' };
  }
}
