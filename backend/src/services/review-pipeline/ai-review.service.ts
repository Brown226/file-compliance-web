/**
 * AI ������ �� �� BasePipeline ��ȡ�ľ�̬��������
 *
 * ���� RAG ��顢LLM ֱ�ӵ��á��������Ե� AI �������߼���
 * ���з�����Ϊ static���� BasePipeline ί�е��á�
 */

import { PipelineContext, PipelineReviewConfig, getModeScene } from './types';
import { ReviewIssue, SourceReference, LlmService } from '../llm.service';
import { RAGService } from '../rag.service';
import { MaxKBService } from '../maxkb.service';
import { getChunkConcurrency } from '../../utils/system-config';

import { PromptTemplateService } from '../prompt-template.service';
import { PromptLoader } from '../prompts';
import { StandardTraceabilityService } from '../standard-traceability.service';
import { parallelLimit } from '../../utils/parallel';
import { EmbeddingService } from '../embedding.service';
import { TerminologyService } from '../terminology.service';

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
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
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
      });

      // ���Ȼص���һ���Դ������� issues��RAG �ڲ��Ѵ������з�Ƭ��
      const enriched = StandardTraceabilityService.enrichWithStandardRef(result.issues);
      await ctx.onChunkProgress?.(text.length, enriched, 0, 1, 'rag-llm');
      return { issues: enriched, engine: 'rag-llm', sources: result.sourceReferences };
    } catch (e) {
      console.error('[Pipeline] �Խ� RAG ���ʧ��:', e);
      // RAG ʧ��ʱ�������� LLM
      return AiReviewService.fallbackToLLMWithKnowledge(text, ctx, config);
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
    const chunks = LlmService.splitText(text, chunkSize, true);
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
    const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk, idx) => {
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
            documentId: ctx.fileId,
            taskId: ctx.taskId,
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
            documentId: ctx.fileId,
            taskId: ctx.taskId,
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

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const CONCURRENT_LIMIT = await getChunkConcurrency();
      const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);
          const llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId,
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
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    try {
      const rawSystemPrompt = await PromptLoader.loadSystemPrompt(scene, { hasContext: false });
      let systemPrompt = AiReviewService.injectSemanticContext(rawSystemPrompt, ctx);
      // 文本校对场景：将术语白名单采样注入提示词，让 LLM 预先知道正确术语，减少误报。
      // 借鉴 TextGuard proofread.py 的 _build_global_words_section（仅取前 N 条示例避免超长）。
      if (scene === 'typo_grammar') {
        const glossary = TerminologyService.getWhitelistGlossary(20);
        if (glossary) {
          systemPrompt += `\n\n## 专业术语白名单（以下均为正确写法，切勿作为错别字/语法问题报告）\n${glossary}`;
        }
      }
      // ��ͬ�������ע��
      if (scene === 'contract_review') {
        const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
        systemPrompt = systemPrompt.replace(/\$\{stance\}/g, stanceLabel);
      }

      // 注入长期记忆（如果用户有历史偏好）
      if (ctx.userId) {
        try {
          const { MemoryService } = await import('../memory.service');
          const memories = await MemoryService.recall(ctx.userId, text, 3);
          if (memories.length > 0) {
            const memoryContext = memories
              .map(m => `- ${m.content}`)
              .join('\n');
            systemPrompt += `\n\n## 用户历史偏好\n以下信息来自该用户的历史审查行为，请参考：\n${memoryContext}`;
          }
        } catch {
          // 记忆不可用时不阻塞审查
        }
      }

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const CONCURRENT_LIMIT = await getChunkConcurrency();
      const chunkResults = await parallelLimit(chunks, CONCURRENT_LIMIT, async (chunk) => {
        try {
          let userTpl = await PromptLoader.loadUserPrompt(scene, 'default');
          // ��ͬ��飺user prompt Ҳ�� ${stance}
          if (scene === 'contract_review') {
            const stanceLabel = ctx.contractStance === 'contractor' ? '�а���' : 'ҵ��/���跽';
            userTpl = userTpl.replace(/\$\{stance\}/g, stanceLabel);
          }
          const userContent = userTpl.replace(/\$\{text\}/g, chunk.text);

          const llmIssues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt,
            skipUserTemplate: true,
            documentId: ctx.fileId,
            taskId: ctx.taskId,
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
      // 分片去重：基于 issueType + 归一化全文 去重（避免"前60字相同"误删不同问题）
      const seen = new Set<string>();
      const deduped = issues.filter(issue => {
        const normalized = (issue.originalText || '').replace(/\s+/g, '').trim();
        const key = (issue.issueType || '') + '::' + normalized;
        if (!normalized || seen.has(key)) return false;
        seen.add(key);
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

    const refFileCount = refTexts.length;

    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;

    try {
      // ��̬����������ݿ��ÿռ䣺���ȴ� LLM ģ�����ö�ȡ�����Ĵ���
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

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];
      let failedChunks = 0;
      const errors: string[] = [];

      // ������������: ֻ�ڲ��չ���ʱԤ�ȹ���������������
      let refChunks: string[] | null = null;
      let refVectors: number[][] | null = null;
      if (!useFullRefs) {
        try {
          const { EmbeddingService } = await import('../embedding.service');
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
      const ragContext = '';

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
              const topK = scored.slice(0, Math.min(5, scored.length));

              const selected = new Map<number, string>();
              for (const s of scored.slice(0, Math.min(5, scored.length))) {
                const idx = refChunks.indexOf(s.chunk);
                if (idx >= 0 && !selected.has(idx)) selected.set(idx, s.chunk);
              }
              const ordered = Array.from(selected.entries())
                .sort(([a], [b]) => a - b)
                .map(([, c]) => c);

              effectiveRefTexts = '## �����ļ�����������������Ϊ�������������صĲ��ն��䣩\n\n'
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
            taskId: ctx.taskId,
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
          return { issues: [], failed: true, error: e.message };
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

      const modeLabel = useFullRefs ? 'ȫ��' : (refVectors ? '��������' : '�ض�');

      // ---- �������� ----
      // 1. ���� originalText === suggestedText ����Ч��Ŀ
      // 2. ���� description ����ȷ��ʾ"һ��/������"���������LLM ��ʱ�����"����������ļ�һ�£�������"������Ϊ��Ŀ���أ�
      const filtered = allIssues.filter(issue => {
        const desc = (issue.description || '').trim();
        const orig = (issue.originalText || '').trim();
        const sug = (issue.suggestedText || '').trim();
        // originalText �� suggestedText ��ȫ��ͬ �� ��Ч
        if (orig && sug && orig === sug) return false;
        // description ����"������"/"һ�£�������"�� �� LLM ��ȷ��ʾû��������
        if (/(?:������ļ�\s*)?һ��\s*[��,]?\s*������/.test(desc)) return false;
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
        const { MaxKBService } = await import('../maxkb.service');
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

    const userContentTpl = await PromptTemplateService.getPromptByScene(
      scene, 'user', userPromptVariant,
      hasRefFiles
        ? '## 合同模板（参照基准）\n\n${refTexts}\n\n---\n\n## 待审合同\n\n${text}\n\n---\n\n请按系统指令中的审查策略，识别风险条款。输出 JSON 数组。'
        : '## 待审合同\n\n${text}\n\n---\n\n请按系统指令中的审查策略，识别风险条款。输出 JSON 数组。',
    );

    // ---- 参照文件超长时的 Embedding 智能检索 ----
    let refChunks: string[] | null = null;
    let refVectors: number[][] | null = null;
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
          if (refChunks.length > 0) {
            refVectors = await EmbeddingService.embedTexts(refChunks);
          }
        } catch (e: any) {
          console.warn(`[ContractReview] 参照文件 Embedding 失败，降级截断: ${e.message}`);
          refChunks = null;
          refVectors = null;
          refTextsJoined = refTextsJoined.substring(0, Math.floor(maxRefChars));
        }
      }
    }

    // ---- 3. 解析条款 + 双链并行执行 ----
    const { parseContractClauses, getDefaultLegalBasis } = await import('../contract-parser.service');
    const clauses = parseContractClauses(text);
    console.log(`[ContractReview] 解析到 ${clauses.length} 个条款`);

    if (clauses.length === 0) {
      return { issues: [], engine: 'none' };
    }

    const CONCURRENT_LIMIT = Math.min(clauses.length, 5);
    const totalClauses = clauses.length;
    let clausesProcessed = 0; // 共享进度计数器（两条链合计）
    const totalSteps = totalClauses * 2; // 风险分析 + 合规检查各遍历一次

    /** 报告合同审查进度 */
    const reportProgress = async (batchIssues: ReviewIssue[], label: string) => {
      clausesProcessed += 1;
      if (ctx.onChunkProgress) {
        await ctx.onChunkProgress(
          text.length,
          batchIssues,
          clausesProcessed - 1,
          totalSteps,
          `contract-${label}`,
        );
      }
    };

    // 风险分析链：逐条款识别风险
    const riskTask = async () => {
      const riskPrompt = systemPrompt + '\n\n你的任务是：**风险分析**。识别条款中对业主/承包商不利的风险点。';
      const riskResults: ReviewIssue[] = [];

      for (let i = 0; i < clauses.length; i += CONCURRENT_LIMIT) {
        const batch = clauses.slice(i, i + CONCURRENT_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (clause) => {
            const legalBasis = getDefaultLegalBasis(clause.clauseNo + clause.clauseTitle);
            const userContent = `【条款】${clause.clauseNo} ${clause.clauseTitle}\n${clause.clauseContent}\n\n【法律依据】${legalBasis}`
              + (refTextsJoined ? `\n\n【参照文件】\n${refTextsJoined}` : '')
              + (ragContext ? `\n\n【知识库上下文】\n${ragContext}` : '')
              + `\n\n请识别该条款中的风险点，输出 JSON 数组。`;
            try {
              const issues = await LlmService.reviewText(userContent, {
                systemPrompt: riskPrompt,
                skipUserTemplate: true,
                maxTokens: llmMaxTokens,
                timeout: llmTimeout,
                documentId: ctx.fileId,
            taskId: ctx.taskId,
              });
              return issues.map(i => ({
                ...i,
                ruleCode: `CLS_RISK_${clause.clauseNo.replace(/[^\w]/g, '_')}`,
                standardRef: `[${clause.clauseNo}] ${clause.clauseTitle}`,
              }));
            } catch (e) {
              console.warn(`[ContractReview] 风险分析条款 ${clause.clauseNo} 失败:`, (e as Error).message);
              return [];
            }
          }),
        );
        for (const r of batchResults) riskResults.push(...r);
        // 报告进度（以批次为单位）
        await reportProgress(batchResults.flat(), 'risk');
      }
      return riskResults;
    };

    // 合规检查链：逐条款检查合规性
    const complianceTask = async () => {
      const compliancePrompt = systemPrompt + '\n\n你的任务是：**合规检查**。检查条款是否符合相关法律法规要求。';
      const complianceResults: ReviewIssue[] = [];

      for (let i = 0; i < clauses.length; i += CONCURRENT_LIMIT) {
        const batch = clauses.slice(i, i + CONCURRENT_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (clause) => {
            const legalBasis = getDefaultLegalBasis(clause.clauseNo + clause.clauseTitle);
            const userContent = `【条款】${clause.clauseNo} ${clause.clauseTitle}\n${clause.clauseContent}\n\n【相关法规】${legalBasis}`
              + (refTextsJoined ? `\n\n【参照文件】\n${refTextsJoined}` : '')
              + (ragContext ? `\n\n【知识库上下文】\n${ragContext}` : '')
              + `\n\n请检查该条款是否符合上述法规要求。如不符合，输出违规详情。`;
            try {
              const issues = await LlmService.reviewText(userContent, {
                systemPrompt: compliancePrompt,
                skipUserTemplate: true,
                maxTokens: llmMaxTokens,
                timeout: llmTimeout,
                documentId: ctx.fileId,
            taskId: ctx.taskId,
              });
              return issues.map(i => ({
                ...i,
                ruleCode: `CLS_COMPLIANCE_${clause.clauseNo.replace(/[^\w]/g, '_')}`,
                standardRef: `[${clause.clauseNo}] ${clause.clauseTitle}`,
              }));
            } catch (e) {
              console.warn(`[ContractReview] 合规检查条款 ${clause.clauseNo} 失败:`, (e as Error).message);
              return [];
            }
          }),
        );
        for (const r of batchResults) complianceResults.push(...r);
        // 报告进度（以批次为单位）
        await reportProgress(batchResults.flat(), 'compliance');
      }
      return complianceResults;
    };

    // 并行执行两条链
    const [riskIssues, complianceIssues] = await Promise.all([riskTask(), complianceTask()]);

    // ---- 4. 合并结果去重 ----
    const allIssues = [...riskIssues, ...complianceIssues];
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

    console.log(`[ContractReview] 完成：${riskIssues.length} 个风险点，${complianceIssues.length} 个合规问题，综合评分 ${score}/100`);

    return {
      issues: filtered,
      engine: 'contract-review',
      sources: [{
        document_name: '合同审查报告',
        content: `审查条款数: ${clauses.length} | 风险点: ${riskIssues.length} | 合规问题: ${complianceIssues.length} | 综合评分: ${score}/100`,
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

    // ������Ϊ�����ο�����ǿ��ָ������뵽 prompt ǰ�潵�� recency bias
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
   * 2. RAG ����ִֻ��һ�Σ�������湲��
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

    // RAG ����ִֻ��һ�Σ���������
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
    const chunks = LlmService.splitText(text, chunkSize, true);
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
            taskId: ctx.taskId,
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