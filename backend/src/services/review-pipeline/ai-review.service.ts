/**
 * AI ������ �� �� BasePipeline ��ȡ�ľ�̬��������
 *
 * ���� RAG ��顢LLM ֱ�ӵ��á��������Ե� AI �������߼���
 * ���з�����Ϊ static���� BasePipeline ί�е��á�
 */

import { PipelineContext, PipelineReviewConfig, getModeScene } from './types';
import { ReviewIssue, SourceReference, LlmService } from '../llm/llm.service';
import { RAGService } from '../knowledge/rag.service';
import { MaxKBService } from '../knowledge/maxkb.service';
import { getChunkConcurrency } from '../../utils/system-config';

import { PromptTemplateService } from '../llm/prompt-template.service';
import { PromptLoader } from '../prompts';
import { StandardTraceabilityService } from '../standard/standard-traceability.service';
import { parallelLimit } from '../../utils/parallel';
import { EmbeddingService } from '../knowledge/embedding.service';
import { TerminologyService } from '../standard/terminology.service';
import { dedupIssues } from '../../utils/issue-dedup';

export class AiReviewService {
  // ==================== AI ���ʵ�� ====================

  /**
   * �Խ� RAG ��飨�Ƽ�������
   *
   * ֱ��ʹ�ñ��� pgvector ����������
   * ��ȡ��ض������װ prompt���������� LLM ������顣
   */
  static async runRAGReview(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[]; degraded?: boolean; degradedReason?: string }> {
    // ��ȡ֪ʶ�ӿ� ID
    const knowledgeIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    if (knowledgeIds.length === 0) {
      console.warn('[Pipeline] runRAGReview: δָ��֪ʶ�ӿ�ID');
      return { issues: [], engine: 'none' };
    }

    try {
      const result = await RAGService.reviewWithKnowledge(text, knowledgeIds, {
        chunkSize: config.chunkSize || 4000,
        topK: 5,
        llmMaxTokens: config.llmMaxTokens || 4096,
        llmTimeout: config.llmTimeout || 180,
        scene,
        documentId: ctx.fileId,
        taskId: ctx.taskId, mode: ctx.reviewMode,
      });

      // ���Ȼص���һ���Դ������� issues��RAG �ڲ��Ѵ������з�Ƭ��
      const enriched = StandardTraceabilityService.enrichWithStandardRef(result.issues);
      // OPT-016: source validation
      const ragChunkTexts = (result.sourceReferences || []).map((s: any) => s.content || '');
      const { validateSources } = await import('../standard/source-validation.service');
      const validated = validateSources(enriched, ragChunkTexts, text);
      await ctx.onChunkProgress?.(text.length, enriched, 0, 1, 'rag-llm');
      return { issues: validated.issues, engine: 'rag-llm', sources: result.sourceReferences };
    } catch (e) {
      console.error('[Pipeline] RAG review failed, degrading to LLM:', e);
      // OPT-027: RAG 失败时降级到纯 LLM，并标记 degraded
      const fallback = await AiReviewService.fallbackToLLMWithKnowledge(text, ctx, config);
      return { ...fallback, degraded: true, degradedReason: `RAG 不可用，已切换为 LLM 直审: ${(e as any).message || e}` };
    }
  }

  /**
   * �ӱ��������������׼������Ϊ�����ģ��������� LLM �������
   */
  static async fallbackToLLMWithKnowledge(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string }> {
    const chunkSize = config.chunkSize || 4000;
    const chunkOverlap = config.chunkOverlap ?? 300;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    let knowledgeContext = '';

    // �� MaxKB ֪ʶ�������ض�����Ϊ������
    const knowledgeIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    for (const kbId of knowledgeIds) {
      try {
        // P1 修复：降级路径与 runLLMDirect 统一为 hitTest 语义检索（相关段落），
        // 而非整库顺序抽取前 N 段（原 getKnowledgeParagraphs 导致上下文与检索路径质量不一致）。
        // hitTest 失败（如 MaxKB 检索接口异常）再降级 getKnowledgeParagraphs 顺序抽取兜底。
        let kbContext = '';
        try {
          const workspaceId = await MaxKBService.getDefaultWorkspaceId();
          const hits = await MaxKBService.hitTest(workspaceId, kbId, text.substring(0, 1000), 5);
          if (Array.isArray(hits)) {
            for (const hit of hits) {
              const content = (hit as any).content || (hit as any).text || '';
              if (content) kbContext += content + '\n';
            }
          }
        } catch (e) {
          console.warn(`[Pipeline] 降级路径 hitTest 检索失败，改用整库段落抽取兜底: ${kbId}`, e);
          kbContext = await MaxKBService.getKnowledgeParagraphs(kbId, {
            maxParagraphs: 10,
            maxChars: 5000,
          });
        }
        if (kbContext) {
          knowledgeContext += kbContext + '\n\n';
        }
      } catch (e) {
        console.warn(`[Pipeline] ��ȡ֪ʶ�� ${kbId} ����ʧ��:`, e);
      }
    }

    // ʹ������ LLM ������飨��λ����Ϣ��
    const issues: ReviewIssue[] = [];
    const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
    LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
    const totalChunks = chunks.length;

    // ������������ʾ�ʣ�ͳһʹ�� PromptLoader����������DB �� Registry �� ���ף�
    const scene = AiReviewService.resolveScene(ctx);
    const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, {
      hasContext: !!knowledgeContext,
    });
    let systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);
    // ��ͬ�������ע��
    if (scene === 'contract_review') {
      const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
      systemPrompt = systemPrompt.replace(/\$\{stance\}/g, stanceLabel);
    }

    // ���д�����Ƭ���������������� AI ��飩
    const CONCURRENT_LIMIT = await getChunkConcurrency();
    const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk, _idx) => {
      try {
        let llmIssues: ReviewIssue[];
        if (knowledgeContext) {
          const userContent = await PromptLoader.loadUserPrompt(scene, 'with_context', {
            ragContext: knowledgeContext,
            standardContext: knowledgeContext,
            text: LlmService.buildChunkContextPrefix(chunk) + chunk.text,
          });

          llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });
        } else {
          const userContent = await PromptLoader.loadUserPrompt(scene, 'no_context', {
            text: LlmService.buildChunkContextPrefix(chunk) + chunk.text,
          });

          llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });
        }
        // ÿ�� chunk ��ɺ�ص�����
        await ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, knowledgeContext ? 'llm-with-knowledge' : 'llm-direct');
        return llmIssues;
      } catch (e: any) {
        console.warn(`[Pipeline] LLM ����Ƭ ${chunk.chunkIndex + 1}/${totalChunks} ʧ��:`, e.message);
        return [];
      }
    });
    for (const r of chunkResults) issues.push(...r);

    const engineName = knowledgeContext ? 'llm-with-knowledge' : 'llm-direct';
    return { issues, engine: engineName };
  }

  /**
   * ��������: AI ��飨��׼·����
   * ֧�� auto/rag/rag_llm/llm_only/disabled �������
   */
  static async runAIReview(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const aiEngine = config.aiEngine || 'auto';

    const hasKnowledgeIds = (ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0) || ctx.maxkbKnowledgeId;

    // AI �������
    if (aiEngine === 'disabled') {
      return { issues: [], engine: 'none' };
    }

    // �Խ� RAG ģʽ���Ƽ����������� + ���� LLM��
    if (aiEngine === 'rag' || aiEngine === 'rag_llm') {
      if (!hasKnowledgeIds) {
        console.warn('[Pipeline] RAG ģʽ��Ҫѡ��֪ʶ�⣬������ LLM ֱ�ӵ���');
        return AiReviewService.runLLMWithFallback(text, ctx, scene, config);
      }
      return AiReviewService.runRAGReview(text, ctx, scene, config);
    }

    // �� LLM ģʽ
    if (aiEngine === 'llm_only') {
      return AiReviewService.runLLMDirect(text, ctx, scene, config);
    }

    // auto ģʽ����֪ʶ��ʱʹ�� RAG����֪ʶ��ʱʹ�� LLM
    if (hasKnowledgeIds) {
      try {
        const ragResult = await AiReviewService.runRAGReview(text, ctx, scene, config);
        if (ragResult.issues.length > 0 || ragResult.engine !== 'none') {
          return ragResult;
        }
      } catch (e) {
        console.warn('[Pipeline] �Խ� RAG ʧ�ܣ������� LLM + ֪ʶ�����:', e);
      }
      // RAG ʧ�ܻ��޽��ʱ�������� LLM + ֪ʶ�����
      return AiReviewService.runLLMWithFallback(text, ctx, scene, config);
    } else {
      // ��֪ʶ��ѡ��ֱ��ʹ�� LLM
      return AiReviewService.runLLMDirect(text, ctx, scene, config);
    }
  }

  /**
   * LLM ֱ�ӵ��ã���֪ʶ�������ģ�
   */
  static async runLLMDirect(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const chunkSize = config.chunkSize || 4000;
    const chunkOverlap = config.chunkOverlap ?? 300;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const issues: ReviewIssue[] = [];

    try {
      // runLLMDirect ʼ���ޱ�׼�����ģ�ʹ�� no_context ����
      const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, {
        hasContext: false,
      });
      let systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);
      // ��ͬ�������ע��
      if (scene === 'contract_review') {
        const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
        systemPrompt = systemPrompt.replace(/\$\{stance\}/g, stanceLabel);
      }
      let userTpl = await PromptLoader.loadUserPrompt(scene, 'no_context');
      // ��ͬ��飺user prompt Ҳ�� ${stance}
      if (scene === 'contract_review') {
        const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
        userTpl = userTpl.replace(/\$\{stance\}/g, stanceLabel);
      }

      // 接入 MaxKB RAG：当用户选择了知识库时，检索相关标准参数注入 user prompt 作为对照基准
      const knowledgeIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
        ? ctx.maxkbKnowledgeIds
        : ctx.maxkbKnowledgeId
          ? [ctx.maxkbKnowledgeId]
          : [];

      let ragContext = '';
      if (knowledgeIds.length > 0) {
        try {
          const workspaceId = await MaxKBService.getDefaultWorkspaceId();
          const ragResults: string[] = [];
          // 用文档前 1000 字符作为检索 query（避免超长导致 MaxKB 检索异常）
          const query = text.substring(0, 1000);
          for (const kbId of knowledgeIds.slice(0, 3)) {
            try {
              const hits = await MaxKBService.hitTest(workspaceId, kbId, query, 5);
              if (Array.isArray(hits)) {
                for (const hit of hits) {
                  const content = (hit as any).content || (hit as any).text || '';
                  if (content) ragResults.push(content);
                }
              }
            } catch (e: any) {
              console.warn(`[Pipeline] MaxKB hit_test 知识库 ${kbId} 失败:`, e.message);
            }
          }
          if (ragResults.length > 0) {
            ragContext = ragResults.slice(0, 10).join('\n---\n');
          }
        } catch (e: any) {
          console.warn('[Pipeline] MaxKB RAG 检索失败，跳过 RAG 注入:', e.message);
        }
      }

      const ragPrefix = ragContext
        ? `参考标准参数：\n${ragContext}\n\n请对照上述标准参数检查文档一致性。\n\n`
        : '';

      const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
      LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
      const totalChunks = chunks.length;

      // 短文本单分片路径：跳过 parallelLimit 无意义开销
      let chunkResults: ReviewIssue[][];
      if (totalChunks === 1) {
        try {
          const chunk = chunks[0];
          const userContent = ragPrefix + userTpl.replace(/\$\{text\}/g, chunk.text);
          const llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });
          await ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, 'llm-direct');
          chunkResults = [llmIssues];
        } catch (e: any) {
          console.warn(`[Pipeline] LLM 单分片调用失败:`, e.message);
          chunkResults = [[]];
        }
      } else {
        const CONCURRENT_LIMIT = await getChunkConcurrency();
        chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          const userContent = ragPrefix + userTpl.replace(/\$\{text\}/g, chunk.text);
          const llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });
          await ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, 'llm-direct');
          return llmIssues;
        } catch (e: any) {
          console.warn(`[Pipeline] LLM ����Ƭ ${chunk.chunkIndex + 1}/${totalChunks} ʧ��:`, e.message);
          return [];
        }
      });
      }
      for (const r of chunkResults) issues.push(...r);
      return { issues: StandardTraceabilityService.enrichWithStandardRef(issues), engine: 'llm-direct' };
    } catch (e) {
      console.error('[Pipeline] LLM ֱ�ӵ���ʧ��:', e);
      return { issues: [], engine: 'none' };
    }
  }

  /**
   * LLM ���ã���֪ʶ����������ģ�����·����
   */
  static async runLLMWithFallback(
    text: string,
    ctx: PipelineContext,
    _scene: string,
    config: PipelineReviewConfig,
  ) {
    const fallback = await AiReviewService.fallbackToLLMWithKnowledge(text, ctx, config);
    return {
      issues: StandardTraceabilityService.enrichWithStandardRef(fallback.issues),
      engine: fallback.engine,
    };
  }

  /**
   * AI ����: �� LLM ֱ�ӵ��ã����� RAG��
   * ���� TYPO_GRAMMAR ������ģʽ
   */
  static async runLLMOnlyStrategy(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const chunkSize = config.chunkSize || 4000;
    const chunkOverlap = config.chunkOverlap ?? 300;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    try {
      const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, { hasContext: false });
      // Prompt Caching：保持 rawSystemPrompt 前缀稳定，动态内容统一追加到末尾
      let systemPrompt = rawSystemPrompt;
      // 合同立场必须替换模板内占位符（不替换会导致 LLM 收到字面量 ${stance}）
      if (scene === 'contract_review') {
        const stanceLabel = ctx.contractStance === 'contractor' ? '承包商' : '业主/建设方';
        systemPrompt = systemPrompt.replace(/\$\{stance\}/g, stanceLabel);
      }
      // 动态后缀：语义上下文 + 术语白名单 + 用户记忆
      const dynamicSuffix: string[] = [];
      const semanticContext = AiReviewService.extractSemanticContextSuffix(ctx);
      if (semanticContext) dynamicSuffix.push(semanticContext);
      if (scene === 'typo_grammar') {
        const glossary = TerminologyService.getWhitelistGlossary(20);
        if (glossary) {
          dynamicSuffix.push(`## 专业术语白名单（以下均为正确写法，切勿作为错别字/语法问题报告）\n${glossary}`);
        }
      }
      if (ctx.userId) {
        try {
          // 迁移自 OpenSpecAgentService.recallMemory（2026-08-03，统一到 Node MemoryService/agent_memories 表）
          const { MemoryService } = await import('../agent/memory/memory.service');
          const memories = await MemoryService.recallMemory({ userId: ctx.userId, query: text, topK: 3 });
          if (memories.length > 0) {
            const memoryContext = memories
              .map(m => `- ${m.value}`)
              .join('\n');
            dynamicSuffix.push(`## 用户历史偏好\n以下信息来自该用户的历史审查行为，请参考：\n${memoryContext}`);
          }
        } catch {
          // 记忆不可用时不阻塞审查
        }
      }
      if (dynamicSuffix.length > 0) {
        systemPrompt = systemPrompt + '\n\n' + dynamicSuffix.join('\n\n');
      }

      const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
    LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
      const totalChunks = chunks.length;
      // 文字校对是轻量模式（无 RAG/规则引擎开销），瓶颈仅在 LLM API 调用，
      // 用更高并发抵消 chunk 数量增多带来的轮次增加
      // C1: getChunkConcurrency(scene) 内置场景化下限保护（typo_grammar=4, doc_review=3）
      const CONCURRENT_LIMIT = await getChunkConcurrency(scene);
      const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          let userTpl = await PromptLoader.loadUserPrompt(scene, 'default');
          // ��ͬ��飺user prompt Ҳ�� ${stance}
          if (scene === 'contract_review') {
            const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
            userTpl = userTpl.replace(/\$\{stance\}/g, stanceLabel);
          }
          // P1-I: 注入章节上下文前缀，让 LLM 知道当前 chunk 所属章节和前文摘要
          const contextPrefix = LlmService.buildChunkContextPrefix(chunk);
          const userContent = contextPrefix + userTpl.replace(/\$\{text\}/g, chunk.text);

          const llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });
          await ctx.onChunkProgress?.(chunk.text.length, llmIssues, chunk.chunkIndex, totalChunks, 'llm-only');
          return llmIssues;
        } catch (e: any) {
          console.warn(`[Pipeline] LLM ����Ƭ ${chunk.chunkIndex + 1}/${totalChunks} ʧ��:`, e.message);
          return [];
        }
      });
      const issues: ReviewIssue[] = [];
      for (const r of chunkResults) issues.push(...r);

      // ���Ƭȥ�أ��� originalText ǰ 60 �ַ�ȥ�أ��� semantic-spec ��ͬ���ԣ�
      // 分片去重：精确去重 + 模糊去重（Levenshtein ≤ 2，长度 ≥ 4）
      // 统一使用 dedupIssues 工具，与 handleTypoGrammar / handleLibraryReview 保持一致
      const deduped = dedupIssues(issues);

      return { issues: StandardTraceabilityService.enrichWithStandardRef(deduped), engine: 'llm-direct' };
    } catch (e) {
      console.error('[Pipeline] LLM ����ʧ��:', e);
      return { issues: [], engine: 'none' };
    }
  }

  /**
   * @deprecated ʹ�� runLLMOnlyStrategy ������������������ݡ�
   */
  static async runLLMOnly(text: string, ctx: PipelineContext, scene: string, config: PipelineReviewConfig): Promise<ReviewIssue[]> {
    const result = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);
    return result.issues;
  }

  // ==================== �����ļ��ȶԲ��� ====================

  /**
   * �����ļ��ȶԲ��ԣ���������ģʽ��
   * �������ļ�������ļ����� LLM ���弶����ȶ�
   * �޲����ļ�ʱ��������׼ AI ���
   */
  static async runRefCompareStrategy(
    text: string,
    ctx: PipelineContext,
    scene: string,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[]; degraded?: boolean; degradedReason?: string }> {
    // 无参照文件时降级为标准 AI 审查（保留原始 scene）
    if (!ctx.refFileGroup || ctx.refFileGroup.refFiles.length === 0) {
      return AiReviewService.runAIReview(text, ctx, scene, config);
    }

    // ===== C2: 参照文件加载改并行（Promise.allSettled） + D1: 解析失败明确告知 =====
    const { TextExtractionService } = await import('./text-extraction.service');
    const refFileResults = await Promise.allSettled(
      ctx.refFileGroup.refFiles.map(async (refFile) => {
        let refContent: string | null = refFile.extractedText || null;
        if (!refContent) {
          refContent = await TextExtractionService.extractFileText(refFile.filePath, refFile.fileType, refFile.fileName);
        }
        return { fileName: refFile.fileName, content: refContent };
      }),
    );

    // 收集成功/失败列表（D1）
    const refTexts: string[] = [];
    const refFileNames: string[] = [];
    const failedFileNames: string[] = [];
    for (let i = 0; i < refFileResults.length; i++) {
      const r = refFileResults[i];
      const refFile = ctx.refFileGroup.refFiles[i];
      if (r.status === 'fulfilled' && r.value.content) {
        refTexts.push(`【参照文件: ${r.value.fileName}】\n${r.value.content}`);
        refFileNames.push(r.value.fileName);
      } else {
        const reason = r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : '内容为空';
        console.warn(`[AiReview] 参照文件解析失败: ${refFile.fileName}:`, reason);
        failedFileNames.push(refFile.fileName);
      }
    }

    // D1: 全部参照文件解析失败 → 降级到无参照审查并明确告知
    if (refTexts.length === 0) {
      const degradedReason = `所有参照文件解析失败: ${failedFileNames.join(', ')}`;
      console.warn(`[AiReview] ${degradedReason}，降级为无参照审查`);
      const fallback = await AiReviewService.runAIReview(text, ctx, 'library_review', config);
      return { ...fallback, degraded: true, degradedReason };
    }

    // D1: 部分失败 → 继续执行但记录日志
    if (failedFileNames.length > 0) {
      console.warn(`[AiReview] 部分参照文件解析失败（继续执行）: ${failedFileNames.join(', ')}`);
    }

    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;
    const chunkOverlap = config.chunkOverlap ?? 300;

    try {
      // 动态读取上下文数据库配置（优先从 LLM 模型配置读取以推导窗口）
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
      const outputBudget = llmMaxTokens * 3.5;             // 输出 token → 字符数估算
      const safetyMargin = 4000;                            // 安全余量
      const maxTargetChunkPerRequest = chunkSize;           // 单次最大待审分片

      // 验证系统提示词
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        scene, 'system', 'default',
        '你是核电工程文件合规审查专家。请按照系统指令逐项比对待审文件是否与参照文件完全一致。严格按 JSON 数组格式输出问题。',
      );
      const finalSystemPrompt = AiReviewService.injectSemanticContext(systemPrompt, ctx);
      const actualSystemPromptLen = finalSystemPrompt.length;

      // 参照可用空间 = 上下文 - 输出 - 系统提示词 - 待审分片 - 安全余量 - userPrompt 模板开销
      let maxRefChars = contextWindow - outputBudget - actualSystemPromptLen - maxTargetChunkPerRequest - safetyMargin;
      // D2: maxRefChars 兜底，防止系统提示词过长或 contextWindow 配置过小时为负导致审查跑空
      maxRefChars = Math.max(maxRefChars, 2000);

      // 全量参照文本
      const rawRefTextsJoined = refTexts.join('\n\n---\n\n');

      // 二支: 参照总长度 ≤ 全量阈值 → 全量参照; 否则 → 智能检索定向截断
      const useFullRefs = rawRefTextsJoined.length <= maxRefChars;
      let refTextsJoined: string;

      if (useFullRefs) {
        refTextsJoined = rawRefTextsJoined;
      } else {
        // fallback: 简单截断到上限（下面智能检索路径会重新填充 effectiveRefTexts）
        refTextsJoined = rawRefTextsJoined.substring(0, Math.floor(maxRefChars));
      }

      const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
      LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];
      let failedChunks = 0;
      const errors: string[] = [];

      // ===== A3 + A4: 参照块按章节边界切分 + 多文件 refSource 打标 =====
      // 结构: { fileName, sectionTitle?, content }
      interface RefChunkStructured { fileName: string; sectionTitle?: string; content: string; }
      let refChunksStructured: RefChunkStructured[] | null = null;
      let refVectors: number[][] | null = null;
      if (!useFullRefs) {
        try {
          const { EmbeddingService } = await import('../knowledge/embedding.service');
          refChunksStructured = [];
          // A3: 按章节边界切分（替代原"按行聚类 1500 字符"硬切）
          for (const refFile of ctx.refFileGroup.refFiles) {
            // 找到对应已成功解析的内容
            const refTextItem = refTexts.find(rt => rt.startsWith(`【参照文件: ${refFile.fileName}】`));
            if (!refTextItem) continue; // 解析失败的文件跳过
            const refContent = refTextItem.substring(`【参照文件: ${refFile.fileName}】\n`.length);

            // A3: 用 splitBySectionBoundaries 切分，保留 sectionTitle 元数据
            const sectionChunks = LlmService.splitBySectionBoundaries(refContent, 1500);
            for (const sc of sectionChunks) {
              refChunksStructured.push({
                fileName: refFile.fileName,
                sectionTitle: sc.sectionTitle,
                content: sc.content,
              });
            }
          }
          if (refChunksStructured.length > 0) {
            refVectors = await EmbeddingService.embedTexts(refChunksStructured.map(rc => rc.content));
          }
        } catch (e: any) {
          console.warn(`[AiReview] 参照块嵌入失败: ${e.message}，降级到截断模式`);
          // C3: 预嵌入批量失败直接走截断模式，不退化到逐片嵌入
          refChunksStructured = null;
          refVectors = null;
        }
      }

      // 以文审文不使用知识库 RAG
      // 预加载用户提示词模板（以文审文只用 comparison variant）
      const userContentTpl = await PromptTemplateService.getPromptByScene(
        scene, 'user', 'comparison',
        '## 参照文件（权威基准）\n\n${refTexts}\n\n---\n\n## 待审文件（被审查对象）\n\n${text}\n\n---\n\n请按系统指令中的审查策略，逐项比对。输出 JSON 数组。',
      );

      // 预嵌入待审分片（避免每个分片循环里调 Embedding API，N 次降为 1 次）
      let chunkVectors: number[][] | null = null;
      if (!useFullRefs && refChunksStructured && refVectors) {
        try {
          const allChunkTexts = chunks.map(c => c.text);
          chunkVectors = await EmbeddingService.embedTexts(allChunkTexts);
          console.log(`[AiReview] 预嵌入 ${chunks.length} 个待审分片完成`);
        } catch (e: any) {
          // C3: 预嵌入批量失败 → 直接走截断模式，删除逐片嵌入退化逻辑
          console.warn(`[AiReview] 预嵌入失败，走截断模式（不再逐片嵌入）: ${e.message}`);
          refChunksStructured = null;
          refVectors = null;
        }
      }

      // 并发处理待审分片（C1: DOC_REVIEW 场景化下限保护）
      const CONCURRENT_LIMIT = await getChunkConcurrency('doc_review');
      const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          let effectiveRefTexts: string;

          if (useFullRefs || !refChunksStructured || !refVectors) {
            effectiveRefTexts = refTextsJoined;
          } else {
            // A1: 智能检索 → Top-15 余弦召回 → rerankDocuments 精排 → Top-5
            try {
              const { EmbeddingService } = await import('../knowledge/embedding.service');
              const chunkVec = chunkVectors ? chunkVectors[chunk.chunkIndex] : await EmbeddingService.embedText(chunk.text);

              // Top-15 余弦召回（从 Top-5 扩到 Top-15）
              const scored = refChunksStructured.map((rc, i) => {
                const rv = refVectors![i];
                let dot = 0, na = 0, nb = 0;
                for (let j = 0; j < rv.length; j++) {
                  dot += chunkVec[j] * rv[j];
                  na += chunkVec[j] * chunkVec[j];
                  nb += rv[j] * rv[j];
                }
                const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
                return { refChunk: rc, sim };
              });

              scored.sort((a, b) => b.sim - a.sim);
              const topK = scored.slice(0, Math.min(15, scored.length)).map(s => s.refChunk);

              // A1: rerankDocuments 二次精排（失败降级到余弦 Top-5）
              let finalTop5: RefChunkStructured[];
              try {
                const rerankInput = topK.map(rc => ({
                  title: rc.sectionTitle || rc.fileName,
                  content: rc.content,
                  _original: rc, // 保留原始结构化对象
                }));
                const rerankResult = await EmbeddingService.rerankDocuments(chunk.text, rerankInput as any, 5);
                // 从 rerank 结果还原 RefChunkStructured（rerank 会保留原对象字段）
                finalTop5 = rerankResult.map((r: any) => r._original as RefChunkStructured).filter(Boolean);
                if (finalTop5.length === 0) {
                  // rerank 返回空，降级到余弦 Top-5
                  console.warn(`[AiReview] 分片${chunk.chunkIndex + 1} rerank 返回空，降级到余弦 Top-5`);
                  finalTop5 = topK.slice(0, Math.min(5, topK.length));
                }
              } catch (rerankErr: any) {
                // A1.4: rerank 抛错或超时降级到 Top-5 余弦结果，记录 warn 日志不阻塞
                console.warn(`[AiReview] 分片${chunk.chunkIndex + 1} rerank 失败: ${rerankErr.message}，降级到余弦 Top-5`);
                finalTop5 = topK.slice(0, Math.min(5, topK.length));
              }

              // A4: 拼接时保留文件边界信息 + 章节标题
              const ordered = finalTop5.map(rc => {
                const sectionLabel = rc.sectionTitle ? ` / 章节: ${rc.sectionTitle}` : '';
                return `【参照文件: ${rc.fileName}${sectionLabel}】\n${rc.content}`;
              });

              effectiveRefTexts = '## 参照文件（以下为本次检索与当前分片最相关的参照条款）\n\n'
                + ordered.join('\n\n---\n\n');
            } catch (e: any) {
              console.warn(`[AiReview] 分片${chunk.chunkIndex + 1} 检索失败: ${e.message}，使用截断参照`);
              effectiveRefTexts = refTextsJoined;
            }
          }

          // B1: 补全 buildChunkContextPrefix 注入（与 runLLMOnlyStrategy 对齐）
          const contextPrefix = LlmService.buildChunkContextPrefix(chunk);
          const userContent = contextPrefix + userContentTpl
            .replace(/\$\{refTexts\}/g, effectiveRefTexts)
            .replace(/\$\{text\}/g, chunk.text);

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt: finalSystemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });

          await ctx.onChunkProgress?.(chunk.text.length, issues, chunk.chunkIndex, totalChunks, 'llm-ref-compare');
          return { issues, failed: false };
        } catch (e: any) {
          console.warn(`[AiReview] 分片 ${chunk.chunkIndex + 1}/${totalChunks} 比对失败:`, e.message);
          return { issues: [] as any[], failed: true, error: e.message };
        }
      });

      for (const r of chunkResults) {
        allIssues.push(...r.issues);
        if (r.failed) failedChunks++;
        if (r.error) errors.push(r.error);
      }

      if (failedChunks === totalChunks && totalChunks > 0) {
        throw new Error(`全部 ${totalChunks} 个分片比对均失败: ${errors[0]}`);
      }

      // ===== A2: 反向全覆盖检查（参照块在待审向量索引检索，发现"缺失"盲区） =====
      let reverseIssues: ReviewIssue[] = [];
      if (!useFullRefs && refChunksStructured && refVectors && chunkVectors && chunks.length > 0) {
        try {
          reverseIssues = await AiReviewService.runReverseCoverageCheck(
            text, chunkVectors, refChunksStructured, refVectors,
            ctx, llmMaxTokens, llmTimeout,
          );
          console.log(`[AiReview] 反向全覆盖检查发现 ${reverseIssues.length} 个疑似缺失问题`);
        } catch (e: any) {
          console.warn(`[AiReview] 反向全覆盖检查失败（不阻塞主流程）: ${e.message}`);
        }
      }
      allIssues.push(...reverseIssues);

      // ---- D4: 后处理过滤（优先 status 字段，正则兜底） ----
      // D4.2: 优先用 LLM 输出的 status 字段（matched 不入库），正则作为兜底
      const filtered = allIssues.filter(issue => {
        // D4: status=matched 的条目不入库（与 B2 三类输出配合）
        if (issue.status === 'matched') return false;

        const desc = (issue.description || '').trim();
        const orig = (issue.originalText || '').trim();
        const sug = (issue.suggestedText || '').trim();
        // originalText 与 suggestedText 完全相同 → 无效
        if (orig && sug && orig === sug) return false;
        // D4: 正则兜底（LLM 未输出 status 时使用）— 过滤"与参照...一致...无问题"类描述
        if (/与\s*参照.*一致\s*[，,]?\s*无问题/.test(desc)) return false;
        if (/无(?:问题|争议|异议|条款)/.test(desc)) return false;
        // description 模糊包含大量"一致"字样 → 视为 LLM 输出的冗余"无问题"陈述
        if (desc.length > 200 && /一致/.test(desc) && !/不一致/.test(desc)) return false;
        return true;
      });

      const removedCount = allIssues.length - filtered.length;
      if (removedCount > 0) {
        console.log(`[AiReview] 后处理过滤 ${removedCount} 条无效/一致条目`);
      }

      // D1: 部分参照文件解析失败时，附加一条 info 级提示 issue（明确告知用户）
      let finalIssues = filtered;
      if (failedFileNames.length > 0 && failedFileNames.length < ctx.refFileGroup.refFiles.length) {
        finalIssues.push({
          issueType: 'COMPLETENESS',
          severity: 'info',
          originalText: '',
          description: `部分参照文件解析失败（已跳过）: ${failedFileNames.join(', ')}。完整比对结果可能受影响。`,
        });
      }

      return { issues: finalIssues, engine: 'llm-ref-compare' };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('[AiReview] LLM 超时，降级为标准 AI 审查');
      } else {
        console.error('[AiReview] LLM 比对失败:', e);
      }
      // D3: 失败降级明确告知
      const degradedReason = `参照比对失败，已降级为无参照审查: ${e.message || e}`;
      const fallback = await AiReviewService.runAIReview(text, ctx, 'library_review', config);
      return { ...fallback, degraded: true, degradedReason };
    }
  }

  /**
   * A2: 反向全覆盖检查 — 对每个参照块在待审文档向量索引里检索，
   * 相似度 < 阈值的参照块标记"疑似缺失"，批量送 LLM 确认，生成 COMPLETENESS issue。
   *
   * 解决"待审文档缺失参照某条款"的漏报盲区（正向 Top-K 检索查不到的）。
   */
  private static async runReverseCoverageCheck(
    fullText: string,
    chunkVectors: number[][],
    refChunksStructured: Array<{ fileName: string; sectionTitle?: string; content: string }>,
    refVectors: number[][],
    ctx: PipelineContext,
    llmMaxTokens: number,
    llmTimeout: number,
  ): Promise<ReviewIssue[]> {
    // 读取缺失阈值配置（默认 0.4）
    let missingThreshold = 0.4;
    try {
      const { default: prisma } = await import('../../config/db');
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'doc_review_missing_threshold' } });
      if (cfg?.value != null) {
        const v = cfg.value as any;
        if (typeof v === 'number' && v > 0 && v < 1) missingThreshold = v;
        else if (v && typeof v === 'object' && typeof v.value === 'number' && v.value > 0 && v.value < 1) missingThreshold = v.value;
      }
    } catch (e) { /* 用默认值 */ }

    // 对每个参照块，在待审分片向量里检索最大相似度
    const suspectedMissing: Array<{ refChunk: typeof refChunksStructured[0]; maxSim: number }> = [];
    for (let i = 0; i < refChunksStructured.length; i++) {
      const refVec = refVectors[i];
      let maxSim = 0;
      for (let j = 0; j < chunkVectors.length; j++) {
        const chunkVec = chunkVectors[j];
        let dot = 0, na = 0, nb = 0;
        for (let k = 0; k < refVec.length; k++) {
          dot += chunkVec[k] * refVec[k];
          na += chunkVec[k] * chunkVec[k];
          nb += refVec[k] * refVec[k];
        }
        const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
        if (sim > maxSim) maxSim = sim;
      }
      if (maxSim < missingThreshold) {
        suspectedMissing.push({ refChunk: refChunksStructured[i], maxSim });
      }
    }

    if (suspectedMissing.length === 0) return [];

    console.log(`[AiReview] 反向检查发现 ${suspectedMissing.length} 个疑似缺失参照块（阈值 ${missingThreshold}）`);

    // 待审文档全文摘要（前 2000 字符）
    const fullTextSummary = fullText.substring(0, 2000);

    // 分批送 LLM 确认（每批 ≤ 5 个），避免单次 prompt 过长
    const BATCH_SIZE = 5;
    const confirmedIssues: ReviewIssue[] = [];

    for (let start = 0; start < suspectedMissing.length; start += BATCH_SIZE) {
      const batch = suspectedMissing.slice(start, start + BATCH_SIZE);
      const refList = batch.map((b, idx) => {
        const sectionLabel = b.refChunk.sectionTitle ? ` / ${b.refChunk.sectionTitle}` : '';
        return `[${idx + 1}] 来源: ${b.refChunk.fileName}${sectionLabel}\n内容: ${b.refChunk.content.substring(0, 500)}`;
      }).join('\n\n');

      const userContent = `## 待审文档全文摘要（前 2000 字符）\n\n${fullTextSummary}\n\n---\n\n## 疑似缺失的参照条款（待你确认）\n\n${refList}\n\n---\n\n请逐条判断：待审文档是否真的缺失上述参照条款所要求的内容？\n\n输出 JSON 数组，每个元素：\n{\n  "index": 1,\n  "missing": true/false,\n  "description": "缺失说明（仅 missing=true 时填写）"\n}\n\n判断标准：\n- missing=true：待审文档确实缺失该条款要求的内容（即使表述不同，也应有对应内容）\n- missing=false：待审文档已有等价内容（即使表述方式不同）`;

      try {
        const result = await LlmService.reviewText(userContent, {
          maxTokens: Math.min(llmMaxTokens, 2048),
          timeout: Math.min(llmTimeout, 120),
          systemPrompt: '你是文档完整性审查专家。请严格判断待审文档是否缺失参照文件中的关键条款。仅确认真正缺失的内容，避免误报。',
          skipUserTemplate: true,
          documentId: ctx.fileId,
          taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
        });

        // 解析 LLM 确认结果并生成 COMPLETENESS issue
        for (const issue of result) {
          // LLM 应返回 index/missing 字段；但 reviewText 返回 ReviewIssue 结构
          // 这里用 description 中是否包含"缺失"来兜底判断
          // （LLM 已被要求输出 JSON 数组，但 reviewText 解析会尝试映射为 ReviewIssue）
          if (issue.description && /缺/.test(issue.description)) {
            const idx = issue.originalText ? parseInt(String(issue.originalText).replace(/[^\d]/g, ''), 10) - 1 : NaN;
            const refChunk = !isNaN(idx) && idx >= 0 && idx < batch.length
              ? batch[idx].refChunk
              : batch[0].refChunk;
            const sectionLabel = refChunk.sectionTitle ? ` / 章节: ${refChunk.sectionTitle}` : '';
            confirmedIssues.push({
              issueType: 'COMPLETENESS',
              severity: 'warning',
              status: 'missing',
              originalText: refChunk.content.substring(0, 200),
              description: `参照文件【${refChunk.fileName}${sectionLabel}】要求的内容在待审文档中未体现: ${issue.description}`,
              refSource: refChunk.fileName,
            });
          }
        }
      } catch (e: any) {
        console.warn(`[AiReview] 反向检查批次 ${start / BATCH_SIZE + 1} LLM 确认失败: ${e.message}`);
      }
    }

    return confirmedIssues;
  }

  // ==================== 合同风险审查独立策略 ====================

  /**
   * 合同风险审查策略（完全独立，不复用 runRefCompareStrategy）
   *
   * 与以文审文的核心区别：
   * 1. 立场驱动：必须注入 stance（业主/承包商），审查视角完全不同
   * 2. 可选参照文件：允许无参照文件的纯风险扫描
   * 3. 可选知识库 RAG：scene === 'contract_review' 时拉取 MaxKB 知识库
   * 4. 独立 prompt 模板：使用 contract_review 场景的 system/user prompt
   * 5. 独立结果解析：输出 riskLevel + clauseType + recommendation
   */
  static async runContractReviewStrategy(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const scene = 'contract_review';
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;

    // 立场标签（合同审查必须有立场）
    const stanceLabel = ctx.contractStance === 'contractor' ? '承包商' : '业主/建设方';

    // ---- 加载参照文件（可选） ----
    let refTextsJoined = '';
    let hasRefFiles = false;
    if (ctx.refFileGroup && ctx.refFileGroup.refFiles.length > 0) {
      const { TextExtractionService } = await import('./text-extraction.service');
      const refTexts: string[] = [];
      for (const refFile of ctx.refFileGroup.refFiles) {
        let refContent = refFile.extractedText || null;
        if (!refContent) {
          try {
            refContent = await TextExtractionService.extractFileText(refFile.filePath, refFile.fileType, refFile.fileName);
          } catch (e) {
            console.warn(`[ContractReview] 参照文件解析失败: ${refFile.fileName}`, e);
          }
        }
        if (refContent) {
          refTexts.push(`【参照文件: ${refFile.fileName}】\n${refContent}`);
        }
      }
      if (refTexts.length > 0) {
        refTextsJoined = refTexts.join('\n\n---\n\n');
        hasRefFiles = true;
      }
    }

    // ---- 知识库 RAG（可选，仅合同审查场景） ----
    let ragContext = '';
    const knowledgeIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    if (knowledgeIds.length > 0) {
      try {
        const { MaxKBService } = await import('../knowledge/maxkb.service');
        const kbContexts: string[] = [];
        for (const kbId of knowledgeIds.slice(0, 3)) {
          const kbContext = await MaxKBService.getKnowledgeParagraphs(kbId, {
            maxParagraphs: 10,
            maxChars: 5000,
          });
          if (kbContext) kbContexts.push(kbContext);
        }
        if (kbContexts.length > 0) {
          ragContext = kbContexts.join('\n\n---\n\n');
        }
      } catch (e: any) {
        console.warn(`[ContractReview] RAG 知识库拉取失败:`, e.message);
      }
    }

    // ---- 加载 prompt ----
    // 系统提示词：合同审查专家 + 立场注入
    let systemPrompt = await PromptTemplateService.getPromptByScene(
      scene, 'system', 'default',
      `你是核电工程合同审查专家，代表 \${stance} 立场。请识别合同中对该方不利的风险条款、缺失的保护条款、与模板的差异。按风险等级（HIGH/MEDIUM/LOW）输出 JSON 数组。`,
    );
    systemPrompt = AiReviewService.injectSemanticContext(systemPrompt, ctx).replace(/\$\{stance\}/g, stanceLabel);

    // 用户提示词：根据有无参照文件和知识库选择 variant
    let userPromptVariant: string;
    if (hasRefFiles && ragContext) {
      userPromptVariant = 'comparison_with_rag';
    } else if (hasRefFiles) {
      userPromptVariant = 'comparison';
    } else if (ragContext) {
      userPromptVariant = 'with_context';
    } else {
      userPromptVariant = 'no_ref';
    }

    await PromptTemplateService.getPromptByScene(
      scene, 'user', userPromptVariant,
      hasRefFiles
        ? '## 合同模板（参照基准）\n\n${refTexts}\n\n---\n\n## 待审合同\n\n${text}\n\n---\n\n请按系统指令中的审查策略，识别风险条款。输出 JSON 数组。'
        : '## 待审合同\n\n${text}\n\n---\n\n请按系统指令中的审查策略，识别风险条款。输出 JSON 数组。',
    );

    // ---- 参照文件超长时的 Embedding 智能检索 ----
    let refChunks: string[] | null = null;
    if (hasRefFiles) {
      // 动态计算上下文窗口
      let contextWindow = 131072;
      try {
        const { default: prisma } = await import('../../config/db');
        const llmCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_chat_model' } });
        if (llmCfg?.value && typeof llmCfg.value === 'object') {
          const v = llmCfg.value as any;
          if (typeof v.contextLength === 'number' && v.contextLength > 0) {
            contextWindow = v.contextLength;
          }
        }
      } catch (e) { /* 用默认值 */ }

      const outputBudget = llmMaxTokens * 3.5;
      const safetyMargin = 4000;
      const maxRefChars = contextWindow - outputBudget - systemPrompt.length - chunkSize - safetyMargin;

      if (refTextsJoined.length > maxRefChars) {
        // 参照文件超长，尝试 Embedding 智能检索
        try {
          refChunks = [];
          for (const refText of refTextsJoined.split('\n\n---\n\n')) {
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
            refChunks.push(...paras.filter((p: string) => p.length >= 50));
          }
        } catch (e: any) {
          console.warn(`[ContractReview] 参照文件 Embedding 失败，降级截断: ${e.message}`);
          refChunks = null;
          refTextsJoined = refTextsJoined.substring(0, Math.floor(maxRefChars));
        }
      }
    }

    // ---- 3. 解析条款 + 单链合并执行（风险+合规双链已合并为单次 LLM 调用）----
    const { parseContractClauses, getDefaultLegalBasis, extractClauseParameters } = await import('../review/contract-parser.service');
    const clauses = parseContractClauses(text);
    console.log(`[ContractReview] 解析到 ${clauses.length} 个条款`);

    if (clauses.length === 0) {
      return { issues: [], engine: 'none' };
    }

    const CONCURRENT_LIMIT = Math.min(clauses.length, await getChunkConcurrency());
    const totalClauses = clauses.length;
    let clausesProcessed = 0; // 进度计数器（单链）
    const totalSteps = totalClauses; // 单链：总步数 = 条款数

    /** 报告合同审查进度 */
    const reportProgress = async (batchIssues: ReviewIssue[], batchSize: number) => {
      clausesProcessed += batchSize;
      if (ctx.onChunkProgress) {
        await ctx.onChunkProgress(
          text.length,
          batchIssues,
          clausesProcessed - 1,
          totalSteps,
          'contract-unified',
        );
      }
    };

    // 加载合并版用户提示词（风险+合规双字段输出）
    const mergedUserPromptTemplate = await PromptTemplateService.getPromptByScene(
      'contract_review', 'user', 'merged',
      '请对上述条款同时完成：1) 风险分析（识别对该方不利的风险点）2) 合规检查（是否符合法规要求）。输出 {"riskIssues":[...],"complianceIssues":[...]}。',
    );

    // 单链统一执行：每条款调 1 次 LLM，同时输出风险与合规结果
    const unifiedTask = async () => {
      const results: ReviewIssue[] = [];
      for (let i = 0; i < clauses.length; i += CONCURRENT_LIMIT) {
        const batch = clauses.slice(i, i + CONCURRENT_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (clause, batchIdx) => {
            const clauseIdx = i + batchIdx;
            const legalBasis = getDefaultLegalBasis(clause.clauseType || clause.clauseNo + clause.clauseTitle);
            // P2-12: 法条由"既定事实"降级为"候选线索"——系统按条款类型推断，可能不准确，
            // 需 LLM 自行判断是否适用，避免错误法条被当作权威上下文引导结论。
            const userContent = `【条款】${clause.clauseNo} ${clause.clauseTitle}\n${clause.clauseContent}\n\n【法律依据参考，可能不准确，请勿直接引用，需自行判断该法条是否适用；不适用则不引用或标注存疑】${legalBasis}`
              + (refTextsJoined ? `\n\n【参照文件】\n${refTextsJoined}` : '')
              + (ragContext ? `\n\n【知识库上下文】\n${ragContext}` : '')
              + `\n\n${mergedUserPromptTemplate}`;
            try {
              const issues = await LlmService.reviewText(userContent, {
                systemPrompt,
                skipUserTemplate: true,
                maxTokens: llmMaxTokens,
                timeout: llmTimeout,
                documentId: ctx.fileId,
                taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
                // P2-J：传入 positionInfo 提升缓存命中率
                positionInfo: {
                  chunkIndex: clauseIdx,
                  chunkStartIndex: clause.startOffset,
                  totalChunks: totalClauses,
                },
              });
              return issues.map(iss => ({
                ...iss,
                // 若 LLM 未返回 ruleCode，根据 _chainTag 或条款编号补全
                ruleCode: iss.ruleCode || `CLS_${clause.clauseNo.replace(/[^\w]/g, '_')}`,
                standardRef: iss.standardRef || `[${clause.clauseNo}] ${clause.clauseTitle}`,
              }));
            } catch (e) {
              console.warn(`[ContractReview] 条款 ${clause.clauseNo} 审查失败:`, (e as Error).message);
              return [];
            }
          }),
        );
        for (const r of batchResults) results.push(...r);
        // 报告进度（以批次为单位）
        await reportProgress(batchResults.flat(), batch.length);
      }
      return results;
    };

    // 执行单链
    const allIssues = await unifiedTask();

    // ---- P0-1 修复：合同确定性规则并入（预付款/违约金/质保期/必需条款阈值检查）----
    // 此前 checkContractRules 只注册在 RULE_REGISTRY，而 runAllRules 的调用点
    // （阶段1 仅 RULE_ONLY/CONSISTENCY、DEC 兜底、agent 工具）在 CONTRACT_REVIEW
    // 模式下均不满足 condition，导致合同规则与 contract_rule_thresholds 配置
    // 在主流程中完全不生效。此处仅执行 CONTRACT 前缀（condition 已满足），
    // unshift 到最前，保证 dedupIssues 去重时确定性规则优先于 LLM 推断。
    try {
      const { runAllRules } = await import('../rules');
      const ruleIssues = await runAllRules(
        {
          fileName: ctx.fileName,
          filePath: ctx.filePath,
          fileType: ctx.fileType,
          extractedText: text,
          pdfPages: ctx.pdfPages,
          reviewMode: ctx.reviewMode,
          parseResult: ctx.parseResult ?? null,
        },
        { enabledRulePrefixes: new Set(['CONTRACT']) },
      );
      if (ruleIssues.length > 0) {
        allIssues.unshift(...ruleIssues.map((ri) => ({
          issueType: ri.issueType,
          originalText: ri.originalText,
          suggestedText: ri.suggestedText,
          description: ri.description,
          ruleCode: ri.ruleCode,
          severity: ri.severity,
          standardRef: ri.standardRef,
          cadHandleId: ri.cadHandleId,
        })));
        console.log(`[ContractReview] 合同规则引擎并入 ${ruleIssues.length} 条确定性结果`);
      }
    } catch (e: any) {
      console.warn('[ContractReview] 规则引擎执行失败（不影响 LLM 审查）:', e.message);
    }

    // ---- 3.5 P2-A: 跨条款一致性检查（单次 Reduce 调用）----
    // 发现"条款 A 说乙方负责保险，条款 B 说甲方承担保险费用"这类跨条款矛盾
    if (clauses.length >= 2) {
      try {
        const parameterTable = extractClauseParameters(clauses);
        // 仅当至少有 1 个参数被提取出来时才调用 LLM（避免无意义调用）
        const hasAnyParam = parameterTable.some(p => Object.keys(p.parameters).length > 0);
        if (hasAnyParam) {
          const conflictPrompt = `以下是合同各条款的关键参数提取表：\n${JSON.stringify(parameterTable, null, 2)}\n\n请检查参数间是否存在矛盾（如付款方不一致、保险责任方冲突、质保期前后不符等）。输出 JSON 数组 [{"clauseA":"第X条","clauseB":"第Y条","conflictType":"...","description":"...","recommendation":"...","originalText":"..."})]，无冲突输出 []。`;
          const conflictResult = await LlmService.reviewText(conflictPrompt, {
            systemPrompt: '你是合同一致性审查专家，专注于发现跨条款参数矛盾。',
            skipUserTemplate: true,
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode,
          });
          const crossClauseIssues: ReviewIssue[] = (Array.isArray(conflictResult) ? conflictResult : []).map((c: any) => ({
            issueType: 'CONSISTENCY' as any,
            severity: 'warning' as any,
            riskLevel: 'MEDIUM',
            originalText: c.originalText || `${c.clauseA || ''} vs ${c.clauseB || ''}`.trim() || '跨条款矛盾',
            description: `[跨条款矛盾] ${c.description || c.conflictType || ''}`.trim(),
            recommendation: c.recommendation,
            ruleCode: 'CLS_CROSS_CLAUSE',
            clauseType: 'other',
          }));
          allIssues.push(...crossClauseIssues);
          console.log(`[ContractReview] 跨条款检查发现 ${crossClauseIssues.length} 个矛盾`);
        }
      } catch (e: any) {
        console.warn('[ContractReview] 跨条款检查失败:', e.message);
      }
    }

    // ---- 4. 合并结果去重（P2-B: 启用模糊去重，Levenshtein ≤ 2 视为重复）----
    const deduped = dedupIssues(allIssues);

    // ---- 5. 过滤 + 计算合规评分 ----
    const filtered = deduped.filter(issue => {
      const desc = (issue.description || '').trim();
      const orig = (issue.originalText || '').trim();
      const sug = (issue.suggestedText || '').trim();
      if (orig && sug && orig === sug) return false;
      if (/(?:参照文件\s*)?一致\s*[，,]?\s*无问题/.test(desc)) return false;
      if (/没有\s*[发现].*一致\s*[，,]?\s*无问题/.test(desc)) return false;
      if (/无(?:问题|争议|异议|条款)/.test(desc)) return false;
      if (desc.length > 200 && /一致/.test(desc) && !/不一致/.test(desc)) return false;
      return true;
    });

    const { score } = calculateContractScore(filtered);

    // 统计风险与合规数量（按 ruleCode 前缀区分，CLS_RISK_* 为风险，CLS_COMPLIANCE_* 为合规）
    const riskCount = filtered.filter(i => (i.ruleCode || '').startsWith('CLS_RISK')).length;
    const complianceCount = filtered.filter(i => (i.ruleCode || '').startsWith('CLS_COMPLIANCE')).length;
    console.log(`[ContractReview] 完成：${riskCount} 个风险点，${complianceCount} 个合规问题，综合评分 ${score}/100`);

    return {
      issues: filtered,
      engine: 'contract-review',
      sources: [{
        document_name: '合同审查报告',
        content: `审查条款数: ${clauses.length} | 风险点: ${riskCount} | 合规问题: ${complianceCount} | 综合评分: ${score}/100`,
        similarity: 1.0,
      }],
    };
  }

  // ==================== 内部辅助方法 ====================

  /**
   * ������淶����Ŀ��ʽ��Ϊ AI ��ʾ�������ģ��� DB ģ�����������ģ�壩
   */
  static async formatSemanticItems(items: NonNullable<PipelineContext['semanticItems']>): Promise<string> {
    if (!items || items.length === 0) return '';
    const lines = items.map((item, i) => {
      const parts = [`${i + 1}. [${item.ruleCode}] ${item.ruleName}`];
      if (item.description) parts.push(`   ����: ${item.description}`);
      if (item.category) parts.push(`   ����: ${item.category}`);
      return parts.join('\n');
    });
    const itemsText = lines.join('\n');
    const tpl = await PromptTemplateService.getPromptByScene(
      'semantic_spec', 'system', 'context',
      `## ����淶�����ģ�������ݣ�\n�����Ǳ������������ݵĹ淶���ģ�����������ļ��Ƿ�Υ����\n\n${itemsText}\n\n���ʱ��ÿ������� ruleCode ���������������ı�ţ��� [���ı��]����description �б���˵��Υ���������������ġ�`,
    );
    return `\n\n${tpl.replace(/\$\{items\}/g, itemsText)}`;
  }

  /**
   * ������淶�������ġ�����ͺ���Ŀ��ע��ϵͳ��ʾ��
   */
  /**
   * Ϊϵͳ��ʾ��ע�����������Ŀ��
   *
   * ƽ����ƣ���ȷ��ƫ�󣩣�
   * 1. TYPO_GRAMMAR / CONSISTENCY ģʽ��ע�루ǰ���г�ͻ�������о�ȷ���壩
   * 2. ����ע����ϵͳָ��֮ǰ������ recency bias
   * 3. ���Դ�"���ص��ע"��Ϊ"�����ο�����������鷶Χ"
   * 4. ׷�ӷ�ָ��ǿ�� LLM ��������֮�������
   */
  static injectSemanticContext(systemPrompt: string, ctx: PipelineContext): string {
    // ����ģʽ��TYPO_GRAMMAR��������ָ���ͻ����CONSISTENCY���о�ȷ����C1-C4��
    const skipModes = ['TYPO_GRAMMAR', 'CONSISTENCY'];
    const hasReviewPoints = ctx.reviewPoints && ctx.reviewPoints.length > 0;
    const hasPurposes = ctx.corePurposes && ctx.corePurposes.length > 0;

    let prefix = '';

    // ������Ϊ�����ο�����ǿ��ָ������뵽 prompt ǰ� recency bias
    if (!skipModes.includes(ctx.reviewMode || '') && hasReviewPoints) {
      prefix += `\n�������ο� �� ������������ο�����������鷶Χ����ȫ�����������⡿\n�ο�����${ctx.reviewPoints!.join('��')}\n`;
    }
    if (!skipModes.includes(ctx.reviewMode || '') && hasPurposes) {
      prefix += `\n����鱳����Ŀ�꣺${ctx.corePurposes!.join('��')}\n`;
    }
    // ׷�ӷ�ƫ����ʾ
    if (prefix) {
      prefix += 'ע�⣺���Ͻ��������ο������������ϵͳ����ȫ����飬��������֮����κ�����ҲӦ��ʵ���档\n\n';
    }

    let enhancedPrompt = prefix + systemPrompt;

    // ע������淶��������
    if (ctx._semanticPromptContext) {
      enhancedPrompt += ctx._semanticPromptContext;
    }

    return enhancedPrompt;
  }

  /**
   * 抽取语义上下文后缀（Prompt Caching 友好版）
   *
   * 与 injectSemanticContext 的区别：
   * - injectSemanticContext 把动态内容拼到前缀，破坏缓存
   * - 本方法只返回后缀字符串，由调用方追加到 systemPrompt 末尾
   */
  static extractSemanticContextSuffix(ctx: PipelineContext): string {
    const skipModes = ['TYPO_GRAMMAR', 'CONSISTENCY'];
    const hasReviewPoints = ctx.reviewPoints && ctx.reviewPoints.length > 0;
    const hasPurposes = ctx.corePurposes && ctx.corePurposes.length > 0;

    const parts: string[] = [];
    if (!skipModes.includes(ctx.reviewMode || '') && hasReviewPoints) {
      parts.push(`审查参考（请作为审查范围参考，不要作为审查依据）\n参考要点：${ctx.reviewPoints!.join('；')}`);
    }
    if (!skipModes.includes(ctx.reviewMode || '') && hasPurposes) {
      parts.push(`审查背景与目标：${ctx.corePurposes!.join('；')}`);
    }
    if (parts.length > 0) {
      parts.push('注意：上述仅供参考以明确审查范围，不得作为审查依据。系统指令的所有审查原则仍然适用。');
    }
    if (ctx._semanticPromptContext) {
      parts.push(ctx._semanticPromptContext);
    }
    return parts.join('\n\n');
  }

  /**
   * �� PipelineContext �ƶ���鳡�������� PromptTemplateService ������ʾ�ʣ�
   * ��Ӧ BasePipeline.scene getter ���߼�
   */
  static resolveScene(ctx: PipelineContext): string {
    return getModeScene(ctx.reviewMode);
  }

  /**
   * ����淶������ƥ����飨�Ż��棩
   *
   * �Ż����ԣ�
   * 1. һ���Դ������й��򣬱�������� �� ��Ƭ����ϱ�ը
   * 2. RAG ����ִֻ��һ�Σ�������湲��
   * 3. �ı���Ƭֻ��һ�Σ����й�����
   *
   * @param text �����ı�
   * @param ctx PipelineContext���� semanticItems + maxkbKnowledgeIds��
   * @param config �������
   * @returns ��������б�
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
    const chunkOverlap = config.chunkOverlap ?? 300;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    // ��ȡ֪ʶ����� ID������ RAG �������������ģ�
    const categoryIds: string[] = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    // Ԥ�����û���ʾ��ģ�壨���з�Ƭ���ã�
    const userTpl = await PromptTemplateService.getPromptByScene(
      'semantic_spec', 'user', 'default',
      `��������ı���\n\${text}\n\n��������������ı��Ƿ�Υ���淶���ģ���� JSON ���顣`,
    );

    // һ���Թ������й����������������ٷ�����
    const rulesText = items.map((item, idx) => {
      const parts: string[] = [];
      parts.push(`### ���� ${idx + 1}: [${item.ruleCode || 'N/A'}] ${item.ruleName || ''}`);
      if (item.description) parts.push(`   ˵��: ${item.description}`);
      if (item.category) parts.push(`   ����: ${item.category}`);
      if (item.severity) parts.push(`   ���ض�: ${item.severity}`);
      return parts.join('\n');
    }).join('\n\n');

    // RAG ����ִֻ��һ�Σ���������
    let ragContext = '';
    if (categoryIds.length > 0) {
      // P2 修复：多知识库全部参与（原实现只取第一个库，用户勾选多个库时其余库被静默忽略）
      for (const kbId of categoryIds) {
        try {
          const kbContext = await MaxKBService.getKnowledgeParagraphs(kbId, {
            maxParagraphs: 6,
            maxChars: 3000,
          });
          if (kbContext) {
            ragContext += (ragContext ? '\n\n' : '') + kbContext;
          }
        } catch (e) {
          console.warn(`[SemanticSpec] 知识库 ${kbId} 段落获取失败，跳过该库:`, e);
        }
      }
    }

    // ���� Prompt���� DB ģ����أ�����̬�����滻��
    const ragContextBlock = ragContext ? `## �����ο���֪ʶ���������������ݣ�\n${ragContext}` : '';
    const systemPrompt = (await PromptTemplateService.getPromptByScene(
      'semantic_spec', 'system', 'default',
      `�����ļ��Ϲ����ר�ҡ����ϸ�������¹淶���ģ������������ı��Ƿ����Υ�档

## �����������Ĺ淶����
\${rulesText}

\${ragContext}

## ���Ҫ��
�ϸ��� JSON �����ʽ�����ÿ�����������
- issueType: "VIOLATION"
- severity: ʹ�����Ķ�������ضȣ�Ĭ�� "warning"
- ruleCode: �����������ı��
- originalText: �ĵ��е�Υ��ԭ��
- suggestedText: �����޸�����
- description: ˵��Υ�����������ļ���ԭ��
- standardRef: ���õ���������ժҪ

���û�з���Υ�棬��������� []����Ҫ����κ���������˵����`,
    ))
      .replace(/\$\{rulesText\}/g, rulesText)
      .replace(/\$\{ragContext\}/g, ragContextBlock);

    // �ı���Ƭֻ��һ�Σ����й�������
    const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
    LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
    const allIssues: ReviewIssue[] = [];

    // ��������������Ƭ
    const CONCURRENT_LIMIT = await getChunkConcurrency();
    const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
      try {
        const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);
        const issues = await LlmService.reviewText(userContent, {
          maxTokens: llmMaxTokens,
          timeout: llmTimeout,
          systemPrompt,
          skipUserTemplate: true,
          documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode, traceId: ctx.traceId,
          positionInfo: {
            chunkIndex: chunk.chunkIndex,
            chunkStartIndex: chunk.startIndex,
            totalChunks: chunks.length,
          },
        });
        return issues;
      } catch (e) {
        console.warn('[SemanticSpec] ��Ƭ���ʧ��:', e instanceof Error ? e.message : e);
        return [];
      }
    });
    for (const r of chunkResults) allIssues.push(...r);

    // 分片去重：基于 issueType + 归一化全文 精确去重（与其他策略保持一致）
    const deduped = dedupIssues(allIssues, { enableFuzzy: false });

    return { issues: deduped, engine: 'semantic-spec' };
  }
}

/**
 * 计算合同合规评分
 * P2-H: 按 clauseType 加权扣分（付款/违约风险权重高于排版问题）
 * 借鉴 ContractReviewSystem review.py:calculate_score
 */
function calculateContractScore(issues: ReviewIssue[]): {
  riskSummary: { high: number; medium: number; low: number };
  score: number;
} {
  const riskSummary = { high: 0, medium: 0, low: 0 };

  // P2-H: 按 clauseType 加权扣分
  const weights: Record<string, { high: number; medium: number; low: number }> = {
    payment: { high: 15, medium: 8, low: 3 },
    penalty: { high: 15, medium: 8, low: 3 },
    warranty: { high: 12, medium: 6, low: 2 },
    insurance: { high: 12, medium: 6, low: 2 },
    dispute: { high: 10, medium: 5, low: 2 },
    other: { high: 8, medium: 4, low: 1 },
  };

  // 解析风险等级（优先 riskLevel，fallback 到 severity）
  const resolveLevel = (issue: ReviewIssue): 'HIGH' | 'MEDIUM' | 'LOW' => {
    if (issue.riskLevel) {
      const rl = String(issue.riskLevel).toUpperCase();
      if (rl === 'HIGH' || rl === 'CRITICAL') return 'HIGH';
      if (rl === 'MEDIUM' || rl === 'MODERATE') return 'MEDIUM';
      if (rl === 'LOW' || rl === 'INFO') return 'LOW';
    }
    if (issue.severity === 'error') return 'HIGH';
    if (issue.severity === 'warning') return 'MEDIUM';
    return 'LOW';
  };

  for (const issue of issues) {
    const level = resolveLevel(issue);
    if (level === 'HIGH') riskSummary.high++;
    else if (level === 'MEDIUM') riskSummary.medium++;
    else riskSummary.low++;
  }

  // 按 clauseType 加权扣分
  let deduction = 0;
  for (const issue of issues) {
    const level = resolveLevel(issue);
    const w = weights[issue.clauseType || 'other'] || weights.other;
    deduction += level === 'HIGH' ? w.high : level === 'MEDIUM' ? w.medium : w.low;
  }

  const score = Math.max(0, 100 - deduction);

  return { riskSummary, score };
}