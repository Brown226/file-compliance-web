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
 *
 * 模块提取（2026-05-12）：
 * 将 BasePipeline 中的实现细节提取为 4 个独立模块，BasePipeline 仅保留编排逻辑并委托调用：
 * - text-extraction.service.ts — 文本提取（ensureText / extractPdfPages / ensureWordStructure / ensureDwgStructure）
 * - ai-review.service.ts — AI 审查（runRAGReview / runAIReview / runLLMOnlyStrategy / runLLMOnly）
 * - standard-ref-check.service.ts — 标准引用检查（runStandardRefCheck）
 * - pipeline-config.ts — 配置工具函数（getEffectiveConfig / shouldRunStage）
 */

import { PipelineContext, PipelineResult, PipelineReviewConfig, ReviewModeType } from './types';
import { ModeCapabilities } from './mode-config';
import { RuleEngineService } from '../rule-engine.service';
import { ReviewIssue, SourceReference } from '../llm.service';
import { RuleIssue } from '../rules/types';
import { TextExtractionService } from './text-extraction.service';
import { AiReviewService } from './ai-review.service';
import { StandardRefCheckService } from './standard-ref-check.service';
import { getEffectiveConfig, shouldRunStage } from './pipeline-config';

export abstract class BasePipeline {
  // ==================== 子类必须实现的抽象属性 ====================

  abstract readonly mode: ReviewModeType;
  abstract readonly displayName: string;
  abstract readonly description: string;

  /** 模式能力组合 — 子类通过此配置声明启用的能力 */
  abstract readonly capabilities: ModeCapabilities;

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
      case 'multimodal':
        // 子类必须覆盖 runAIStrategy() 实现对应策略
        throw new Error(`Pipeline ${this.constructor.name} 不支持 aiStrategy=${strategy}，需子类覆盖 runAIStrategy()`);
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
    return TextExtractionService.ensureText(ctx);
  }

  /**
   * 公共步骤: PDF 逐页文本提取
   */
  protected async extractPdfPages(ctx: PipelineContext): Promise<string[] | undefined> {
    return TextExtractionService.extractPdfPages(ctx);
  }

  /**
   * 公共步骤: Word 文档结构化提取
   * 为 Word 文件提取页眉信息，模拟 pdfPages 格式供规则引擎使用
   */
  protected async ensureWordStructure(ctx: PipelineContext): Promise<void> {
    return TextExtractionService.ensureWordStructure(ctx);
  }

  /**
   * 公共步骤: DWG 图纸结构化提取
   * 为 DWG 文件提取图层/文本/尺寸标注/标准引用数据，模拟 pdfPages 格式供规则引擎使用
   */
  protected ensureDwgStructure(ctx: PipelineContext): void {
    return TextExtractionService.ensureDwgStructure(ctx);
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

  protected decorateRuleIssues(ctx: PipelineContext, issues: RuleIssue[]): RuleIssue[] {
    if (!ctx.ruleSource?.includes('REVIEW_SPECIFICATION')) return issues;
    return issues.map((issue) => ({
      ...issue,
      ruleCode: issue.ruleCode,
    }));
  }

  // ==================== AI 审查实现 ====================

  /**
   * 自建 RAG 审查（推荐方案）
   *
   * 直接使用本地 pgvector 向量检索，
   * 获取相关段落后组装 prompt，调用自有 LLM 进行审查。
   */
  protected async runRAGReview(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    return AiReviewService.runRAGReview(text, ctx, this.scene, this.getEffectiveConfig(ctx));
  }

  /**
   * 公共步骤: AI 审查（标准路径）
   * 支持 auto/rag/rag_llm/llm_only/disabled 引擎策略
   */
  protected async runAIReview(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    return AiReviewService.runAIReview(text, ctx, this.scene, this.getEffectiveConfig(ctx));
  }

  /**
   * AI 策略: 纯 LLM 直接调用（跳过 RAG）
   * 用于 TYPO_GRAMMAR 等轻量模式
   */
  protected async runLLMOnlyStrategy(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: SourceReference[] }> {
    return AiReviewService.runLLMOnlyStrategy(text, ctx, this.scene, this.getEffectiveConfig(ctx));
  }

  /**
   * @deprecated 使用 runLLMOnlyStrategy 替代。保留用于子类向后兼容。
   */
  protected async runLLMOnly(text: string, ctx: PipelineContext): Promise<ReviewIssue[]> {
    return AiReviewService.runLLMOnly(text, ctx, this.scene, this.getEffectiveConfig(ctx));
  }

  // ==================== 配置工具方法 ====================

  /**
   * 获取有效的流水线配置（带默认值回退）
   */
  protected getEffectiveConfig(ctx: PipelineContext): PipelineReviewConfig {
    return getEffectiveConfig(ctx);
  }

  /**
   * 检查某阶段是否应该运行（优先读取 pipelineConfig，再回退到 capabilities）
   * @param ctx Pipeline 上下文
   * @param stageName 阶段名称：'rules' | 'ai' | 'stdRef'
   */
  protected shouldRunStage(ctx: PipelineContext, stageName: 'rules' | 'ai' | 'stdRef'): boolean {
    return shouldRunStage(ctx, this.capabilities, stageName);
  }

  /**
   * 公共步骤: 标准引用规范性检查
   * 提取文档中的标准引用 → 8级比对 → 字符级差异定位
   */
  protected async runStandardRefCheck(
    ctx: PipelineContext,
    extractedText: string,
  ): Promise<ReviewIssue[]> {
    return StandardRefCheckService.runStandardRefCheck(ctx, extractedText);
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
   * - capabilities.standardRef === false → 跳过标准引用
   * - capabilities.standardRef === true → 默认执行
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
        const prefixes = ctx.ruleSource?.includes('REVIEW_SPECIFICATION') && ctx.rulePlan?.enabledPrefixes?.length
          ? ctx.rulePlan.enabledPrefixes
          : [];
        const baseIssues = await this.runRules(ctx, prefixes);
        return this.decorateRuleIssues(ctx, [...baseIssues, ...extraRuleIssues]);
      })(),
      // 标准引用检查（受 capabilities.standardRef + stages.stdRef 控制）
      (async () => {
        if (ctx.ruleSource?.includes('REVIEW_SPECIFICATION')) return [];
        if (!this.capabilities.standardRef) return [];
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
   * - 额外标准引用检查（capabilities.standardRef 且配置启用时）
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
    if (stages?.ai === false) {
      console.log(`[${this.constructor.name}] 阶段2跳过: ${ctx.fileName}, 运行时配置禁用了 AI`);
      return { aiIssues: [], usedEngine: 'none' };
    }
    if (!text.trim()) {
      console.warn(`[${this.constructor.name}] 阶段2跳过: ${ctx.fileName}, 文本为空（extractedText 长度=${text.length}），无法进行 AI 审查`);
      return { aiIssues: [], usedEngine: 'none' };
    }

    try {
      // 1. AI 策略分发（子类可覆盖 runAIStrategy 实现自定义路径）
      const aiResult = await this.runAIStrategy(text, ctx);

      // 2. AI 结果后处理（如术语白名单过滤）
      const processedIssues = await this.postProcessAIResult(text, aiResult.issues);

      const allAiIssues = [...processedIssues];
      const usedEngine = aiResult.engine;

      console.log(`[${this.constructor.name}] 阶段2完成: AI=${processedIssues.length}, engine=${usedEngine}`);
      return {
        aiIssues: allAiIssues,
        sources: aiResult.sources,
        usedEngine,
      };
    } catch (e) {
      // 阶段2异常应作为真实失败处理，交由上层记录错误详情并标记文件失败
      console.error(`[${this.constructor.name}] 阶段2 AI审查失败:`, e);
      throw e;
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
