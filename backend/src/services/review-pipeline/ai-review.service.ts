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

/**
 * Levenshtein 编辑距离（用于跨 chunk 模糊去重）
 * 仅用于短文本（≤30 字符），O(n*m) 复杂度可控
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

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
        const kbContext = await MaxKBService.getKnowledgeParagraphs(kbId, {
          maxParagraphs: 10,
          maxChars: 5000,
        });
        if (kbContext) {
          knowledgeContext += kbContext + '\n\n';
        }
      } catch (e) {
        console.warn(`[Pipeline] ��ȡ֪ʶ�� ${kbId} ����ʧ��:`, e);
      }
    }

    if (knowledgeContext) {
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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
          const { MemoryService } = await import('../system/memory.service');
          const memories = await MemoryService.recall(ctx.userId, text, 3);
          if (memories.length > 0) {
            const memoryContext = memories
              .map(m => `- ${m.content}`)
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
      const baseConcurrency = await getChunkConcurrency();
      const CONCURRENT_LIMIT = scene === 'typo_grammar'
        ? Math.max(baseConcurrency, 4)
        : baseConcurrency;
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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
      // 分片去重：基于 issueType + 归一化全文 精确去重 + 模糊去重
      // P1-S: 增加 Levenshtein 距离 ≤ 2 的模糊匹配，处理 LLM 输出 originalText 有轻微偏差的重复
      const seen: Array<{ key: string; normalized: string }> = [];
      const deduped = issues.filter(issue => {
        const normalized = (issue.originalText || '').replace(/\s+/g, '').trim();
        if (!normalized) return false;
        const key = (issue.issueType || '') + '::' + normalized;
        // 精确匹配
        if (seen.some(s => s.key === key)) return false;
        // 模糊匹配：同 issueType + 编辑距离 ≤ 2 + 长度 ≥ 4（避免短文本误去重）
        if (normalized.length >= 4) {
          const isFuzzyDup = seen.some(s => {
            if (s.key.split('::')[0] !== (issue.issueType || '')) return false;
            return levenshteinDistance(normalized, s.normalized) <= 2;
          });
          if (isFuzzyDup) return false;
        }
        seen.push({ key, normalized });
        return true;
      });

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
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    // �޲����ļ�ʱ��������׼ AI ��飨����ԭʼ scene��
    if (!ctx.refFileGroup || ctx.refFileGroup.refFiles.length === 0) {
      return AiReviewService.runAIReview(text, ctx, scene, config);
    }

    // ���������ļ��ı�������Դ��ע
    const { TextExtractionService } = await import('./text-extraction.service');
    const refTexts: string[] = [];
    const refFileNames: string[] = [];
    for (const refFile of ctx.refFileGroup.refFiles) {
      let refContent = refFile.extractedText || null;
      if (!refContent) {
        try {
          refContent = await TextExtractionService.extractFileText(refFile.filePath, refFile.fileType, refFile.fileName);
        } catch (e) {
          console.warn(`[AiReview] �����ļ�����ʧ��: ${refFile.fileName}`, e);
        }
      }
      if (refContent) {
        refTexts.push(`�������ļ�: ${refFile.fileName}��\n${refContent}`);
        refFileNames.push(refFile.fileName);
      }
    }

    if (refTexts.length === 0) {
      console.warn('[AiReview] �����ļ������ı����ݣ���������׼ AI ���');
      return AiReviewService.runAIReview(text, ctx, 'library_review', config);
    }

    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;
    const chunkOverlap = config.chunkOverlap ?? 300;

    try {
      // ��̬����������ݿ��ÿռ����ȴ� LLM ģ�����ö�ȡ�����Ĵ���
      let contextWindow = 131072; // Ĭ��ֵ���ַ�����
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
        // ���ݿⲻ�ɴʹ��Ĭ��ֵ
      }
      const outputBudget = llmMaxTokens * 3.5;             // ��� token �� �ַ�����
      const safetyMargin = 4000;                            // ��ȫԣ��
      const maxTargetChunkPerRequest = chunkSize;           // ��������Ĵ����Ƭ

      // ��֤ϵͳ��ʾ��
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        scene, 'system', 'default',
        '���Ǻ˵繤���ļ��Ϲ����ר�ҡ��밴������������˶Դ����ļ��Ƿ�������ļ���ȫһ�¡��ϸ��� JSON �����ʽ����������',
      );
      const finalSystemPrompt = AiReviewService.injectSemanticContext(systemPrompt, ctx);
      const actualSystemPromptLen = finalSystemPrompt.length;

      // ���ò��տռ� = ������ - ��� - ϵͳ��ʾ�� - �����Ƭ - ��ȫԣ�� - userPrompt ģ�忪��
      const maxRefChars = contextWindow - outputBudget - actualSystemPromptLen - maxTargetChunkPerRequest - safetyMargin;

      // ȫ�������ı�
      const rawRefTextsJoined = refTexts.join('\n\n---\n\n');

      // ��֧: �����ܷ��� �� ȫ������; �Ų��� �� ��������ȡ����ض���
      const useFullRefs = rawRefTextsJoined.length <= maxRefChars;
      let refTextsJoined: string;

      if (useFullRefs) {
        refTextsJoined = rawRefTextsJoined;
      } else {
        // fallback: �򵥽ضϵ����ޣ���������·���� per-chunk ѭ����ʵ�֣�
        refTextsJoined = rawRefTextsJoined.substring(0, Math.floor(maxRefChars));
      }

      const chunks = LlmService.splitText(text, chunkSize, true, chunkOverlap);
    LlmService.enrichChunksWithContext(chunks, text); // OPT-018: inject section context
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];
      let failedChunks = 0;
      const errors: string[] = [];

      // ������������: ֻ�ڲ��չ���ʱԤ�PropertyParams����
      let refChunks: string[] | null = null;
      let refVectors: number[][] | null = null;
      if (!useFullRefs) {
        try {
          const { EmbeddingService } = await import('../knowledge/embedding.service');
          // �������ı�������ֿ飨~1500 �ַ���
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
          }
        } catch (e: any) {
          console.warn(`[AiReview] ������������ʧ��: ${e.message}�����˵��ض�ģʽ`);
          refChunks = null;
          refVectors = null;
        }
      }

      // 以文审文不使用知识库 RAG
      // 预加载用户提示词模板（以文审文只用 comparison variant）
      const userContentTpl = await PromptTemplateService.getPromptByScene(
        scene, 'user', 'comparison',
        '## 参照文件（权威基准）\n\n${refTexts}\n\n---\n\n## 待审文件（被审查对象）\n\n${text}\n\n---\n\n请按系统指令中的审查策略，逐项比对。输出 JSON 数组。',
      );

      // �� ����ԤǶ����������Ƭ��������Ƭ���� Embedding API���� N �ν�Ϊ 1 �Σ�
      let chunkVectors: number[][] | null = null;
      if (!useFullRefs && refChunks && refVectors) {
        try {
          const allChunkTexts = chunks.map(c => c.text);
          chunkVectors = await EmbeddingService.embedTexts(allChunkTexts);
          console.log(`[AiReview] ����Ƕ�� ${chunks.length} ������Ƭ���`);
        } catch (e: any) {
          console.warn(`[AiReview] ����Ƕ��ʧ�ܣ�����Ϊ��ƬǶ��: ${e.message}`);
        }
      }

      // ���д�����Ƭ�����������������������ģ�
      const CONCURRENT_LIMIT = await getChunkConcurrency();
      const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          let effectiveRefTexts: string;

          if (useFullRefs || !refChunks || !refVectors) {
            effectiveRefTexts = refTextsJoined;
          } else {
            // ��������: ʹ��ԤǶ������� �� �����������ƶ� �� ȡ Top-5 ���ն���
            try {
              const chunkVec = chunkVectors ? chunkVectors[chunk.chunkIndex] : await EmbeddingService.embedText(chunk.text);

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
              const selected = new Map<number, string>();
              for (const s of scored.slice(0, Math.min(5, scored.length))) {
                const idx = refChunks.indexOf(s.chunk);
                if (idx >= 0 && !selected.has(idx)) selected.set(idx, s.chunk);
              }
              const ordered = Array.from(selected.entries())
                .sort(([a], [b]) => a - b)
                .map(([, c]) => c);

              effectiveRefTexts = '## �����ļ�����������������Ϊ�������������صĲ��ն���\n\n'
                + ordered.join('\n\n---\n\n');
            } catch (e: any) {
              console.warn(`[AiReview] ��Ƭ${chunk.chunkIndex + 1} ��������ʧ��: ${e.message}��ʹ�ýضϲ���`);
              effectiveRefTexts = refTextsJoined;
            }
          }

          const userContent = userContentTpl
            .replace(/\$\{refTexts\}/g, effectiveRefTexts)
            .replace(/\$\{text\}/g, chunk.text);

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt: finalSystemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId, mode: ctx.reviewMode,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });

          await ctx.onChunkProgress?.(chunk.text.length, issues, chunk.chunkIndex, totalChunks, 'llm-ref-compare');
          return { issues, failed: false };
        } catch (e: any) {
          console.warn(`[AiReview] ��Ƭ ${chunk.chunkIndex + 1}/${totalChunks} �ȶ�ʧ��:`, e.message);
          return { issues: [] as any[], failed: true, error: e.message };
        }
      });

      for (const r of chunkResults) {
        allIssues.push(...r.issues);
        if (r.failed) failedChunks++;
        if (r.error) errors.push(r.error);
      }

      if (failedChunks === totalChunks && totalChunks > 0) {
        throw new Error(`���� ${totalChunks} ����Ƭ�ȶԾ�ʧ��: ${errors[0]}`);
      }

      // ---- �������� ----
      // 1. ���� originalText === suggestedText ����Ч��Ŀ
      // 2. ���� description ����ȷ��ʾ"һ��/������"���������LLM ��ʱ�����"����������ļ�һ�£�������"������Ϊ��Ŀ���أ�
      const filtered = allIssues.filter(issue => {
        const desc = (issue.description || '').trim();
        const orig = (issue.originalText || '').trim();
        const sug = (issue.suggestedText || '').trim();
        // originalText �� suggestedText ��ȫ��ͬ �� ��Ч
        if (orig && sug && orig === sug) return false;
        // description ����"������ļ�\s*һ��\s*[��,]?\s*������".test(desc)) return false;
        if (/����\s*��.*һ��\s*[��,]?\s*������/.test(desc)) return false;
                if (/无(?:问题|争议|异议|条款)/.test(desc)) return false;
        // description �����Ұ�������"һ��"�ж����� �� ������ LLM ����˷������̶�������
        if (desc.length > 200 && /һ��/.test(desc) && !/��һ��/.test(desc)) return false;
        return true;
      });

      const removedCount = allIssues.length - filtered.length;
      if (removedCount > 0) {
      }

      return { issues: filtered, engine: 'llm-ref-compare' };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('[AiReview] LLM ����ʱ����������׼ AI ���');
      } else {
        console.error('[AiReview] LLM �ȶ�ʧ��:', e);
      }
      return AiReviewService.runAIReview(text, ctx, 'library_review', config);
    }
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
    const { parseContractClauses, getDefaultLegalBasis } = await import('../review/contract-parser.service');
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
            const legalBasis = getDefaultLegalBasis(clause.clauseNo + clause.clauseTitle);
            const userContent = `【条款】${clause.clauseNo} ${clause.clauseTitle}\n${clause.clauseContent}\n\n【法律依据】${legalBasis}`
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
                taskId: ctx.taskId, mode: ctx.reviewMode,
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

    // ---- 4. 合并结果去重 ----
    const seen = new Set<string>();
    const deduped = allIssues.filter(issue => {
      const key = (issue.issueType || '') + '::' + (issue.originalText || '').replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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
      try {
        const kbContext = await MaxKBService.getKnowledgeParagraphs(categoryIds[0], {
          maxParagraphs: 6,
          maxChars: 3000,
        });
        if (kbContext) {
          ragContext = kbContext;
        }
      } catch (e) {
        console.warn('[SemanticSpec] RAG ����ʧ�ܣ���������������:', e);
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
            taskId: ctx.taskId, mode: ctx.reviewMode,
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

    // ��ȥ�أ��� originalText ǰ 60 �ַ�ȥ��
    // 分片去重：基于 issueType + 归一化全文 去重（与其他策略保持一致）
    const seen = new Set<string>();
    const deduped = allIssues.filter(issue => {
      const normalized = (issue.originalText || '').replace(/\s+/g, '').trim();
      const key = (issue.issueType || '') + '::' + normalized;
      if (!normalized || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { issues: deduped, engine: 'semantic-spec' };
  }
}

/**
 * 计算合同合规评分
 * 借鉴 ContractReviewSystem review.py:calculate_score
 */
function calculateContractScore(issues: ReviewIssue[]): {
  riskSummary: { high: number; medium: number; low: number };
  score: number;
} {
  const riskSummary = { high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    const desc = (issue.description || '').toLowerCase();
    if (/高风险|严重|重大|high/i.test(desc)) riskSummary.high++;
    else if (/中风险|一般|medium/i.test(desc)) riskSummary.medium++;
    else if (issue.severity === 'error') riskSummary.high++;
    else if (issue.severity === 'warning') riskSummary.medium++;
    else riskSummary.low++;
  }

  const score = Math.max(0, 100 - riskSummary.high * 15 - riskSummary.medium * 8 - riskSummary.low * 3);

  return { riskSummary, score };
}