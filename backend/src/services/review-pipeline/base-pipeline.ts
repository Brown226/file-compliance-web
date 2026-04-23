/**
 * 审查流水线基类 — 能力驱动架构
 *
 * 重构说明（2026-04-19）：
 * 原先 7 个 Pipeline 子类中有 4 个（LibraryReview / Consistency / FullReview / CustomRule）
 * 的 execute() / runFastPhase() / runSlowPhase() 逻辑几乎一模一样，
 * 仅在"是否启用 AI / 标准引用 / 跨文件检查"上有差异。
 *
 * 重构后：
 * - BasePipeline 读取子类提供的 capabilities 配置，统一编排阶段1/2流程
 * - 子类只需覆盖钩子方法处理独有逻辑（如参照文件比对、术语过滤、表格检测）
 * - 4 个重复 Pipeline 合并为 StandardPipeline，通过 capabilities 区分行为
 *
 * 编排流程：
 *   execute()
 *   ├── 阶段1 (runFastPhase): 文本提取 → beforeFastPhase钩子 → 规则+标准引用(并行) → afterFastPhase钩子
 *   ├── 阶段2 (runSlowPhase): runAIStrategy钩子 → AI审查
 *   └── 返回结果
 */

import { PipelineContext, PipelineResult, PipelineReviewConfig, ReviewModeType } from './types';
import { ModeCapabilities } from './mode-config';
import { ParserService } from '../parser.service';
import { OcrService } from '../ocr.service';
import { RuleEngineService } from '../rule-engine.service';
import { LlmService, ReviewIssue, SourceReference } from '../llm.service';
import { MaxKBService } from '../maxkb.service';
import { RAGService } from '../rag.service';
import { RuleIssue } from '../rules/types';
import { StandardTraceabilityService } from '../standard-traceability.service';
import { PromptTemplateService } from '../prompt-template.service';
import { StandardExtractorService } from '../standard-extractor.service';
import { StandardCheckService, StandardCheckItem } from '../standard-check.service';
import { CharDiffService } from '../char-diff.service';
import prisma from '../../config/db';

export abstract class BasePipeline {
  // ==================== 子类必须实现的抽象属性 ====================

  abstract readonly mode: ReviewModeType;
  abstract readonly displayName: string;
  abstract readonly description: string;

  /** 模式能力组合 — 子类通过此配置声明启用的能力 */
  abstract readonly capabilities: ModeCapabilities;

  /**
   * @deprecated 空数组表示全量规则，实际过滤由数据库 review_rules.enabled 控制。
   * 保留此字段仅为向后兼容 ReviewPipeline 接口。
   */
  readonly rulePrefixes: string[] = [];

  /** 是否需要 AI 审查 — 从 capabilities.ai 派生 */
  get needsAI(): boolean { return this.capabilities.ai; }

  /** 是否需要参照文件 — 从 capabilities.needsRefFiles 派生 */
  get needsRefFiles(): boolean { return this.capabilities.needsRefFiles; }

  // ==================== 场景映射 ====================

  /**
   * 获取当前 Pipeline 对应的审查场景（用于加载场景化提示词）
   * 默认实现：将 ReviewMode 映射到 PromptTemplate module
   * 子类可以覆盖
   */
  get scene(): string {
    const modeMap: Record<string, string> = {
      LIBRARY_REVIEW: 'library_review',
      FULL_REVIEW: 'library_review',
      CONSISTENCY: 'consistency',
      TYPO_GRAMMAR: 'typo_grammar',
      DOC_REVIEW: 'doc_review',
      MULTIMODAL: 'multimodal',
      CUSTOM_RULE: 'library_review',
    };
    return modeMap[this.mode] || 'library_review';
  }

  // ==================== 钩子方法（子类可选覆盖） ====================

  /**
   * 阶段1 前置钩子：在文本提取完成后、规则检查前执行
   * 用于子类注入独有逻辑（如 MultimodalPipeline 的表格/公式检测）
   * @returns 额外的规则问题（合并到阶段1结果中）
   */
  protected async beforeFastPhase(_ctx: PipelineContext): Promise<RuleIssue[]> {
    return [];
  }

  /**
   * 阶段1 后置钩子：在规则+标准引用检查完成后执行
   * 用于子类对阶段1结果做后处理
   */
  protected async afterFastPhase(
    _ctx: PipelineContext,
    _result: { ruleIssues: RuleIssue[]; stdRefIssues: ReviewIssue[] },
  ): Promise<void> {}

  /**
   * AI 审查策略分发：根据 capabilities.aiStrategy 决定调用路径
   * 子类可覆盖此方法实现自定义 AI 策略（如参照文件比对、多模态审查）
   */
  protected async runAIStrategy(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const strategy = this.capabilities.aiStrategy;

    switch (strategy) {
      case 'llmOnly':
        return this.runLLMOnlyStrategy(text, ctx);
      case 'refCompare':
        // 默认降级到 standard AI；DocReviewPipeline 会覆盖此分支
        return this.runAIReview(text, ctx);
      case 'multimodal':
        // 默认降级到 standard AI；MultimodalPipeline 会覆盖此分支
        return this.runAIReview(text, ctx);
      case 'standard':
      default:
        return this.runAIReview(text, ctx);
    }
  }

  /**
   * AI 结果后处理钩子：子类可对 AI 结果做过滤/增强
   * 如 TypoGrammarPipeline 的术语白名单过滤
   */
  protected async postProcessAIResult(
    _text: string,
    aiIssues: ReviewIssue[],
  ): Promise<ReviewIssue[]> {
    return aiIssues;
  }

  // ==================== 公共步骤实现 ====================

  /**
   * 公共步骤: 确保文本已提取
   * 如果 ctx.extractedText 已有内容则跳过
   */
  protected async ensureText(ctx: PipelineContext): Promise<string> {
    if (ctx.extractedText && ctx.extractedText.trim().length > 0) {
      return ctx.extractedText;
    }

    let text = '';
    try {
      text = await ParserService.parseFile(ctx.filePath, ctx.fileType);
      // 将 Python 解析结果写入 ctx
      ctx.parseResult = ParserService.getLastParseResult();
    } catch (e) {
      console.warn(`[Pipeline] 文件解析失败: ${ctx.fileName}`, e);
    }

    // OCR 降级
    if (ParserService.needsOcr(text, ctx.fileType) && OcrService.isOcrSupported(ctx.fileType)) {
      try {
        const ocrText = await OcrService.recognizeFile(ctx.filePath, ctx.fileType);
        if (ocrText) text = ocrText;
      } catch (e) {
        console.warn(`[Pipeline] OCR 处理失败: ${ctx.fileName}`, e);
      }
    }

    return text;
  }

  /**
   * 公共步骤: PDF 逐页文本提取
   */
  protected async extractPdfPages(ctx: PipelineContext): Promise<string[] | undefined> {
    if (ctx.fileType.toLowerCase() !== 'pdf') return undefined;
    try {
      return await ParserService.parsePdfPages(ctx.filePath);
    } catch (e) {
      console.warn(`[Pipeline] PDF逐页提取失败: ${ctx.fileName}`, e);
      return undefined;
    }
  }

  /**
   * 公共步骤: Word 文档结构化提取
   * 为 Word 文件提取页眉信息，模拟 pdfPages 格式供规则引擎使用
   */
  protected async ensureWordStructure(ctx: PipelineContext): Promise<void> {
    if (!['docx', 'doc'].includes(ctx.fileType.toLowerCase())) return;

    try {
      const { WordStructureService } = await import('../word-structure.service');
      const structure = await WordStructureService.extractStructure(ctx.filePath, ctx.parseResult);
      ctx.wordStructure = structure;

      // 如果有页眉数据且当前没有 pdfPages，模拟 pdfPages 格式供规则引擎使用
      if (structure.headers.length > 0 && !ctx.pdfPages) {
        ctx.pdfPages = this.simulatePagesFromWord(structure);
      }
    } catch (e) {
      console.warn('[Pipeline] Word 结构提取失败:', e);
    }
  }

  /**
   * 公共步骤: DWG 图纸结构化提取
   * 为 DWG 文件提取图层/文本/尺寸标注/标准引用数据，模拟 pdfPages 格式供规则引擎使用
   */
  protected ensureDwgStructure(ctx: PipelineContext): void {
    if (ctx.fileType.toLowerCase() !== 'dwg' && ctx.fileType.toLowerCase() !== 'dxf') return;
    if (!ctx.parseResult?.structure && !ctx.parseResult?.metadata) return;

    const metadata = ctx.parseResult.metadata as any;
    const structure = ctx.parseResult.structure as any;

    // 构建 DwgStructure
    const layers: string[] = metadata?.dwg_layers || [];
    const textEntities = (structure?.paragraphs || []).map((p: any) => ({
      text: p.text || '',
      layer: (p.style || '').replace('图层:', ''),
      // ★ 优先使用 paragraphs 中传入的 entityType（WASM 预填充路径已包含），
      //   回退到 'TEXT' 默认值（兼容旧版 Python 解析路径）
      entityType: (p.entityType || 'TEXT') as 'TEXT' | 'MTEXT',
      handle: p.handle || '',
      insert: p.insert as [number, number] | undefined,
    }));
    const dimensions = structure?.dimensions || [];
    const standardRefs = (structure?.standardRefs || []).map((r: any) => ({
      standardNo: r.standardNo || '',
      standardName: r.standardName || '',
      standardIdent: r.standardIdent || '',
      cadHandleId: r.cadHandleId || '',
    }));

    ctx.dwgStructure = { layers, textEntities, dimensions, standardRefs };

    // 模拟 pdfPages 供规则引擎使用（HEADER/PAGE 类规则需要 pdfPages 存在才能触发）
    if (!ctx.pdfPages && textEntities.length > 0) {
      ctx.pdfPages = this.simulatePagesFromDwg(ctx.dwgStructure);
    }
  }

  /**
   * 将 Word 结构化数据模拟为 PDF pages 格式
   * 使 HEADER/PAGE 规则可以正常触发
   */
  private simulatePagesFromWord(structure: NonNullable<PipelineContext['wordStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 50; // 每 50 段模拟一页

    for (let i = 0; i < structure.paragraphs.length; i += PAGE_SIZE) {
      const pageParagraphs = structure.paragraphs.slice(i, i + PAGE_SIZE);
      const headerText = structure.headers.map(h => h.text).join('\n');
      const pageText = pageParagraphs.map(p => p.text).join('\n');
      pages.push(headerText ? `[页眉] ${headerText}\n\n${pageText}` : pageText);
    }

    return pages.length > 0 ? pages : [structure.paragraphs.map(p => p.text).join('\n')];
  }

  /**
   * 将 DWG 结构化数据模拟为 PDF pages 格式
   * 使 HEADER/PAGE 规则可以正常触发
   */
  private simulatePagesFromDwg(dwg: NonNullable<PipelineContext['dwgStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 30; // 每 30 个文本实体模拟一页

    // 第一页：图层概览
    const layerOverview = `[图层概览] ${dwg.layers.length} 个图层: ${dwg.layers.slice(0, 10).join(', ')}${dwg.layers.length > 10 ? '...' : ''}`;
    pages.push(layerOverview);

    // 后续页：文本实体
    for (let i = 0; i < dwg.textEntities.length; i += PAGE_SIZE) {
      const pageEntities = dwg.textEntities.slice(i, i + PAGE_SIZE);
      const pageText = pageEntities.map(e => `[${e.layer}] ${e.text}`).join('\n');
      pages.push(pageText);
    }

    return pages.length > 0 ? pages : [dwg.textEntities.map(e => e.text).join('\n')];
  }

  /**
   * 公共步骤: 执行规则引擎检查（带前缀过滤）
   */
  protected async runRules(
    ctx: PipelineContext,
    enabledPrefixes: string[],
  ): Promise<RuleIssue[]> {
    const options = enabledPrefixes.length > 0
      ? { enabledRulePrefixes: new Set(enabledPrefixes) }
      : undefined;

    return RuleEngineService.runAllRules(
      {
        fileName: ctx.fileName,
        filePath: ctx.filePath,
        fileType: ctx.fileType,
        extractedText: ctx.extractedText,
        pdfPages: ctx.pdfPages,
        reviewMode: ctx.reviewMode,
        parseResult: ctx.parseResult,
      },
      options,
    );
  }

  // ==================== AI 审查实现 ====================

  /**
   * 自建 RAG 审查（推荐方案）
   *
   * 直接使用 MaxKB 知识库 hit_test API 进行向量检索，
   * 获取相关段落后组装 prompt，调用自有 LLM 进行审查。
   */
  protected async runRAGReview(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    // 获取知识库 ID 列表：优先使用多选 ID，回退到单个 ID
    const knowledgeIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    if (knowledgeIds.length === 0) {
      console.warn('[Pipeline] runRAGReview: 未指定知识库ID');
      return { issues: [], engine: 'none' };
    }

    const config = this.getEffectiveConfig(ctx);
    console.log(`[Pipeline] 启动自建 RAG 审查: kbs=[${knowledgeIds.join(',')}], text_len=${text.length}`);

    try {
      const result = await RAGService.reviewWithKnowledge(text, knowledgeIds, {
        chunkSize: config.chunkSize || 4000,
        topK: 5,
        llmMaxTokens: config.llmMaxTokens || 4096,
        llmTimeout: config.llmTimeout || 180,
        scene: this.scene,
      });

      // 进度回调（一次性传完所有 issues，RAG 内部已处理所有分片）
      const enriched = StandardTraceabilityService.enrichWithStandardRef(result.issues);
      ctx.onChunkProgress?.(text.length, enriched, 0, 1, 'rag-llm');
      return { issues: enriched, engine: 'rag-llm', sources: result.sourceReferences };
    } catch (e) {
      console.error('[Pipeline] 自建 RAG 审查失败:', e);
      // RAG 失败时降级到纯 LLM
      return this.fallbackToLLMWithKnowledge(text, ctx, config);
    }
  }

  /**
   * 从 MaxKB 知识库获取标准内容作为上下文，传给自有 LLM 进行审查
   */
  private async fallbackToLLMWithKnowledge(
    text: string,
    ctx: PipelineContext,
    config: ReturnType<typeof this.getEffectiveConfig>,
  ): Promise<{ issues: ReviewIssue[]; engine: string }> {
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    let knowledgeContext = '';

    // 尝试从 MaxKB 知识库获取段落内容（支持多知识库）
    const kbIds = ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0
      ? ctx.maxkbKnowledgeIds
      : ctx.maxkbKnowledgeId
        ? [ctx.maxkbKnowledgeId]
        : [];

    for (const kbId of kbIds) {
      try {
        const kbContext = await MaxKBService.getKnowledgeParagraphs(kbId, {
          maxParagraphs: Math.ceil(30 / kbIds.length),  // 多知识库时均分
          maxChars: Math.ceil(15000 / kbIds.length),
        });
        if (kbContext) {
          knowledgeContext += kbContext + '\n\n';
        }
      } catch (e) {
        console.warn(`[Pipeline] 获取知识库 ${kbId} 段落失败:`, e);
      }
    }

    if (knowledgeContext) {
      console.log(`[Pipeline] 获取到知识库段落作为上下文: ${knowledgeContext.length} 字符 (${kbIds.length} 个知识库)`);
    }

    // 使用自有 LLM 进行审查（带位置信息）
    const issues: ReviewIssue[] = [];
    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;

    // 按场景加载系统提示词
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      this.scene, 'system', 'default',
      '你是文件合规审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
    );

    for (const chunk of chunks) {
      try {
        let llmIssues: ReviewIssue[];
        if (knowledgeContext) {
          // 将知识库内容作为标准上下文传给 LLM
          const userTpl = await PromptTemplateService.getPromptByScene(
            this.scene, 'user', 'with_context',
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
            this.scene, 'user', 'no_context',
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
  protected async runAIReview(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const config = this.getEffectiveConfig(ctx);
    const aiEngine = config.aiEngine || 'auto';

    const hasKnowledgeIds = (ctx.maxkbKnowledgeIds && ctx.maxkbKnowledgeIds.length > 0) || ctx.maxkbKnowledgeId;

    // AI 引擎禁用
    if (aiEngine === 'disabled') {
      return { issues: [], engine: 'none' };
    }

    // 自建 RAG 模式（推荐：向量检索 + 自有 LLM）
    if (aiEngine === 'rag' || aiEngine === 'rag_llm') {
      if (!hasKnowledgeIds) {
        console.warn('[Pipeline] RAG 模式需要选择知识库，降级到 LLM 直接调用');
        return this.runLLMWithFallback(text, ctx, config);
      }
      return this.runRAGReview(text, ctx);
    }

    // 仅 LLM 模式
    if (aiEngine === 'llm_only') {
      return this.runLLMDirect(text, ctx, config);
    }

    // auto 模式：有知识库时使用 RAG，无知识库时使用 LLM
    if (hasKnowledgeIds) {
      console.log('[Pipeline] auto 模式: 检测到知识库选择，使用自建 RAG');
      try {
        const ragResult = await this.runRAGReview(text, ctx);
        if (ragResult.issues.length > 0 || ragResult.engine !== 'none') {
          return ragResult;
        }
        console.log('[Pipeline] 自建 RAG 无结果，降级到 LLM + 知识库段落');
      } catch (e) {
        console.warn('[Pipeline] 自建 RAG 失败，降级到 LLM + 知识库段落:', e);
      }
      // RAG 失败或无结果时，降级到 LLM + 知识库段落
      return this.runLLMWithFallback(text, ctx, config);
    } else {
      // 无知识库选择，直接使用 LLM
      console.log('[Pipeline] auto 模式: 无知识库选择，使用 LLM 直接调用');
      return this.runLLMDirect(text, ctx, config);
    }
  }

  /**
   * LLM 直接调用（无知识库上下文）
   */
  private async runLLMDirect(
    text: string,
    ctx: PipelineContext,
    config: ReturnType<typeof this.getEffectiveConfig>,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const issues: ReviewIssue[] = [];

    try {
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        this.scene, 'system', 'default',
        '你是文件审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
      );
      const userTpl = await PromptTemplateService.getPromptByScene(
        this.scene, 'user', 'no_context',
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
  private async runLLMWithFallback(
    text: string,
    ctx: PipelineContext,
    config: ReturnType<typeof this.getEffectiveConfig>,
  ) {
    const fallback = await this.fallbackToLLMWithKnowledge(text, ctx, config);
    return {
      issues: StandardTraceabilityService.enrichWithStandardRef(fallback.issues),
      engine: fallback.engine,
    };
  }

  /**
   * AI 策略: 纯 LLM 直接调用（跳过 MaxKB/RAG）
   * 用于 TYPO_GRAMMAR 等轻量模式
   */
  protected async runLLMOnlyStrategy(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    const config = this.getEffectiveConfig(ctx);
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    try {
      const systemPrompt = await PromptTemplateService.getPromptByScene(
        this.scene, 'system', 'default',
        '你是文件审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
      );

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const issues: ReviewIssue[] = [];
      for (const chunk of chunks) {
        try {
          const userTpl = await PromptTemplateService.getPromptByScene(
            this.scene, 'user', 'default',
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
   * @deprecated 使用 runLLMOnlyStrategy 替代。保留用于子类向后兼容。
   */
  protected async runLLMOnly(text: string, ctx: PipelineContext): Promise<ReviewIssue[]> {
    const result = await this.runLLMOnlyStrategy(text, ctx);
    return result.issues;
  }

  // ==================== 配置工具方法 ====================

  /**
   * 获取有效的流水线配置（带默认值回退）
   */
  protected getEffectiveConfig(ctx: PipelineContext): PipelineReviewConfig {
    const cfg = ctx.pipelineConfig;
    if (!cfg) {
      return {
        modes: {},
        aiEngine: 'auto',
        chunkSize: 4000,
        llmMaxTokens: 4096,
        llmTimeout: 180,
        maxkbTimeout: 180,
        ocrTimeout: 60,
        maxConcurrentReviews: 3,
        logLevel: 'info',
      };
    }
    return {
      modes: cfg.modes || {},
      aiEngine: cfg.aiEngine || 'auto',
      chunkSize: cfg.chunkSize || 4000,
      llmMaxTokens: cfg.llmMaxTokens || 4096,
      llmTimeout: cfg.llmTimeout || 180,
      maxkbTimeout: cfg.maxkbTimeout || 180,
      ocrTimeout: cfg.ocrTimeout || 60,
      maxConcurrentReviews: cfg.maxConcurrentReviews || 3,
      logLevel: cfg.logLevel || 'info',
    };
  }

  /**
   * 检查某阶段是否应该运行（优先读取 pipelineConfig，再回退到 capabilities）
   * @param ctx Pipeline 上下文
   * @param stageName 阶段名称：'rules' | 'ai' | 'stdRef'
   */
  protected shouldRunStage(ctx: PipelineContext, stageName: 'rules' | 'ai' | 'stdRef'): boolean {
    const config = this.getEffectiveConfig(ctx);
    const modeConfig = config.modes?.[ctx.reviewMode as ReviewModeType];
    if (!modeConfig?.stages) {
      // 无运行时配置时，回退到 capabilities 的静态声明
      if (stageName === 'rules') return this.capabilities.rules;
      if (stageName === 'ai') return this.capabilities.ai;
      if (stageName === 'stdRef') return this.capabilities.standardRef !== 'off';
      return true;
    }
    const stages = modeConfig.stages as any;
    if (stageName in stages) {
      return stages[stageName] !== false;
    }
    return true; // 未配置的阶段默认执行
  }

  /**
   * 获取当前模式的自定义规则前缀（如果配置了），否则返回默认前缀
   */
  protected getEffectiveRulePrefixes(ctx: PipelineContext, defaultPrefixes: string[]): string[] {
    const config = this.getEffectiveConfig(ctx);
    const modeConfig = config.modes?.[ctx.reviewMode as ReviewModeType];
    if (modeConfig?.rulePrefixes && modeConfig.rulePrefixes.length > 0) {
      return modeConfig.rulePrefixes;
    }
    return defaultPrefixes;
  }

  /**
   * 公共步骤: 标准引用规范性检查
   * 提取文档中的标准引用 → 8级比对 → 字符级差异定位
   */
  protected async runStandardRefCheck(
    ctx: PipelineContext,
    extractedText: string,
  ): Promise<ReviewIssue[]> {
    if (!this.shouldRunStage(ctx, 'stdRef')) {
      return [];
    }

    if (!extractedText || !extractedText.trim()) {
      return [];
    }

    // 1. 提取标准引用
    let extractedRefs = StandardExtractorService.extractFromText(extractedText, ctx.fileType);

    // Excel 文件额外固定列提取
    if (['xlsx', 'xls'].includes(ctx.fileType.toLowerCase()) && ctx.filePath) {
      try {
        const columnRefs = await StandardExtractorService.extractFromExcelByColumn(ctx.filePath);
        const existingNos = new Set(extractedRefs.map(r => r.standardNo));
        for (const ref of columnRefs) {
          if (!existingNos.has(ref.standardNo)) {
            extractedRefs.push(ref);
            existingNos.add(ref.standardNo);
          }
        }
      } catch (e) {
        console.warn('[Pipeline] Excel 固定列提取失败:', e);
      }
    }

    if (extractedRefs.length === 0) return [];

    // 2. 加载标准库
    const standards = await prisma.standard.findMany({
      where: { standardNo: { not: null } },
      select: { id: true, standardNo: true, standardName: true, standardIdent: true, standardStatus: true },
    });

    if (standards.length === 0) return [];

    const checkLibrary: StandardCheckItem[] = standards
      .filter(s => s.standardNo)
      .map(s => ({
        id: s.id,
        standardNo: s.standardNo!,
        standardName: s.standardName || '',
        standardIdent: s.standardIdent || StandardExtractorService.getIdent(s.standardNo!),
        standardStatus: s.standardStatus,
      }));

    // 3. 逐个引用进行 8 级比对 + 字符差异定位
    const issues: ReviewIssue[] = [];

    for (const ref of extractedRefs) {
      const matchResult = StandardCheckService.findBestMatch(ref, checkLibrary);

      if (!matchResult.matched) {
        issues.push({
          issueType: 'VIOLATION',
          ruleCode: 'STD_001',
          originalText: ref.fullMatch,
          description: `未找到该标准规范: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
        });
      } else if (matchResult.matchedItem) {
        const libItem = matchResult.matchedItem;

        // 标准状态检查
        if (libItem.standardStatus === 'ABOLISHED') {
          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_003',
            originalText: ref.fullMatch,
            suggestedText: libItem.standardNo,
            description: `该标准已废止: ${libItem.standardNo}`,
          });
          continue;
        }
        if (libItem.standardStatus === 'UPCOMING') {
          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_004', severity: 'info',
            originalText: ref.fullMatch,
            suggestedText: libItem.standardNo,
            description: `该标准尚未实施: ${libItem.standardNo}`,
          });
          continue;
        }

        // 字符级差异定位
        const noDiff = CharDiffService.compare(ref.standardNo, libItem.standardNo);
        const nameDiff = ref.standardName && libItem.standardName
          ? CharDiffService.compare(ref.standardName, libItem.standardName)
          : { originalRanges: [] as any[], correctRanges: [] as any[] };

        if (noDiff.originalRanges.length > 0 || nameDiff.originalRanges.length > 0) {
          const diffRanges: any = {};
          if (noDiff.originalRanges.length > 0 || noDiff.correctRanges.length > 0) {
            diffRanges.original = noDiff.originalRanges;
            diffRanges.correct = noDiff.correctRanges;
          }
          if (nameDiff.originalRanges.length > 0 || nameDiff.correctRanges.length > 0) {
            diffRanges.nameOriginal = nameDiff.originalRanges;
            diffRanges.nameCorrect = nameDiff.correctRanges;
          }

          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_002',
            originalText: ref.standardNo + (ref.standardName ? ` (${ref.standardName})` : ''),
            suggestedText: libItem.standardNo + (libItem.standardName ? ` (${libItem.standardName})` : ''),
            description: `标准引用有误: "${ref.standardNo}" 应为 "${libItem.standardNo}"${matchResult.similarity ? ` (相似度: ${(matchResult.similarity * 100).toFixed(0)}%)` : ''}`,
            diffRanges,
          });
        }
      }
    }

    return issues;
  }

  // ==================== 两阶段并行编排（能力驱动） ====================

  /**
   * 阶段1: 规则审查（快速）
   * - 文本提取 + PDF逐页解析 + Word结构化 + DWG结构化
   * - beforeFastPhase 钩子（子类注入独有逻辑）
   * - 规则引擎检查 + 标准引用检查（并行）
   * - afterFastPhase 钩子（子类后处理）
   *
   * 编排逻辑统一由 capabilities 控制：
   * - capabilities.rules === false → 跳过规则引擎
   * - capabilities.standardRef === 'off' → 跳过标准引用
   * - capabilities.standardRef === 'config' → 由 pipelineConfig 控制
   * - capabilities.standardRef === 'on' → 默认执行
   */
  async runFastPhase(ctx: PipelineContext): Promise<{ ruleIssues: RuleIssue[]; stdRefIssues: ReviewIssue[]; textLength: number }> {
    const startTime = Date.now();

    // 1. 文本提取（已有则跳过）
    const text = await this.ensureText(ctx);

    // 2. PDF 逐页解析 + Word 结构化 + DWG 结构化（用于 HEADER/PAGE/LAYOUT 等规则）
    const pdfPages = await this.extractPdfPages(ctx);
    ctx.pdfPages = pdfPages;
    await this.ensureWordStructure(ctx);
    this.ensureDwgStructure(ctx);

    // 更新上下文
    ctx.extractedText = text;

    // 3. beforeFastPhase 钩子（如 MultimodalPipeline 的表格/公式检测）
    const extraRuleIssues = await this.beforeFastPhase(ctx);

    // 4. 规则引擎 + 标准引用检查（并行）
    const [ruleIssues, stdRefIssues] = await Promise.all([
      // 规则引擎（受 capabilities.rules + stages.rules 控制）
      (async () => {
        if (!this.capabilities.rules) return [];
        if (!this.shouldRunStage(ctx, 'rules')) return [];
        const prefixes = this.getEffectiveRulePrefixes(ctx, this.rulePrefixes);
        const baseIssues = await this.runRules(ctx, prefixes);
        return [...baseIssues, ...extraRuleIssues];
      })(),
      // 标准引用检查（受 capabilities.standardRef + stages.stdRef 控制）
      (async () => {
        if (this.capabilities.standardRef === 'off') return [];
        if (!this.shouldRunStage(ctx, 'stdRef') || !text.trim()) return [];
        return this.runStandardRefCheck(ctx, text);
      })(),
    ]);

    // 5. afterFastPhase 钩子
    await this.afterFastPhase(ctx, { ruleIssues, stdRefIssues });

    console.log(`[${this.constructor.name}] 阶段1完成: 规则=${ruleIssues.length}, 标准引用=${stdRefIssues.length} (耗时 ${Date.now() - startTime}ms)`);

    return {
      ruleIssues,
      stdRefIssues,
      textLength: text.length,
    };
  }

  /**
   * 阶段2: AI 深度审查（耗时）
   * - runAIStrategy 钩子：根据 capabilities.aiStrategy 分发到不同 AI 路径
   * - postProcessAIResult 钩子：子类对 AI 结果做后处理（如术语过滤）
   * - 额外标准引用检查（capabilities.standardRef === 'config' 且配置启用时）
   *
   * 编排逻辑统一由 capabilities 控制：
   * - capabilities.ai === false → 直接跳过阶段2
   */
  async runSlowPhase(ctx: PipelineContext): Promise<{ aiIssues: ReviewIssue[]; sources?: SourceReference[]; usedEngine?: string }> {
    const text = ctx.extractedText || '';

    // 能力声明不需要 AI 时直接跳过
    if (!this.capabilities.ai) {
      return { aiIssues: [], usedEngine: 'none' };
    }

    // 运行时配置也可禁用 AI
    const config = this.getEffectiveConfig(ctx);
    const stages = config.modes?.[ctx.reviewMode as ReviewModeType]?.stages;
    if (stages?.ai === false || !text.trim()) {
      return { aiIssues: [], usedEngine: 'none' };
    }

    try {
      // 1. AI 策略分发（子类可覆盖 runAIStrategy 实现自定义路径）
      const aiResult = await this.runAIStrategy(text, ctx);

      // 2. AI 结果后处理（如术语白名单过滤）
      const processedIssues = await this.postProcessAIResult(text, aiResult.issues);

      // 3. 额外标准引用检查（config 模式下，runFastPhase 可能跳过了，这里补上）
      let stdRefIssues: ReviewIssue[] = [];
      if (this.capabilities.standardRef === 'config' && this.shouldRunStage(ctx, 'stdRef') && text.trim()) {
        stdRefIssues = await this.runStandardRefCheck(ctx, text);
      }

      const allAiIssues = [...processedIssues, ...stdRefIssues];
      const usedEngine = stdRefIssues.length > 0
        ? `${aiResult.engine}+stdRef`
        : aiResult.engine;

      console.log(`[${this.constructor.name}] 阶段2完成: AI=${processedIssues.length}, 标准引用=${stdRefIssues.length}, engine=${usedEngine}`);
      return {
        aiIssues: allAiIssues,
        sources: aiResult.sources,
        usedEngine,
      };
    } catch (e) {
      console.error(`[${this.constructor.name}] 阶段2 AI审查失败:`, e);
      return { aiIssues: [], usedEngine: 'none' };
    }
  }

  /**
   * 统一 execute() — 能力驱动编排
   * 替代原先各子类几乎相同的 execute() 实现
   */
  async execute(ctx: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();

    // 阶段1 + 阶段2（与 runFastPhase/runSlowPhase 逻辑一致，用于非两阶段编排场景）
    const fastResult = await this.runFastPhase(ctx);
    const slowResult = await this.runSlowPhase(ctx);

    // 跨文件一致性检查标记
    const crossFileRequired = this.capabilities.crossFile;

    return {
      ruleIssues: fastResult.ruleIssues,
      aiIssues: slowResult.aiIssues,
      stdRefIssues: fastResult.stdRefIssues.length > 0 ? fastResult.stdRefIssues : undefined,
      sources: slowResult.sources,
      metadata: {
        usedEngine: slowResult.usedEngine,
        processingTime: Date.now() - startTime,
        ...(crossFileRequired ? { crossFileCheckRequired: true, crossFileRuleCode: 'CROSS_CONSIST_001' } : {}),
      },
    };
  }
}
