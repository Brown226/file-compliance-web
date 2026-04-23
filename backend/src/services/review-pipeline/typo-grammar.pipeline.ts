/**
 * 错别字/语法流水线（能力驱动重构）
 *
 * 重构说明（2026-04-19）：
 * - 原先 execute() 和 runSlowPhase() 都有大量重复逻辑
 * - 重构后利用 BasePipeline 的钩子机制：
 *   - runAIStrategy → 使用 runLLMOnlyStrategy（跳过 MaxKB/RAG）
 *   - postProcessAIResult → 术语白名单过滤
 * - 不再需要覆盖 execute / runFastPhase / runSlowPhase
 */

import { BasePipeline } from './base-pipeline';
import { PipelineContext, ReviewModeType } from './types';
import { ReviewIssue } from '../llm.service';
import { TerminologyService } from '../terminology.service';
import { ModeCapabilities } from './mode-config';

const DEFAULT_CAPABILITIES: ModeCapabilities = {
  rules: true,
  standardRef: 'config',   // 默认关闭，需配置 stages.stdRef = true 才开启
  ai: true,
  aiStrategy: 'llmOnly',   // 跳过 MaxKB/RAG，直接 LLM
  crossFile: false,
  needsRefFiles: false,
};

export class TypoGrammarPipeline extends BasePipeline {
  readonly mode: ReviewModeType = 'TYPO_GRAMMAR';
  readonly displayName = '错别字/语法';
  readonly description = '轻量级错别字和语法检查（跳过MaxKB，直接LLM）';
  capabilities: ModeCapabilities;

  constructor(runtimeCapabilities?: ModeCapabilities) {
    super();
    this.capabilities = runtimeCapabilities || DEFAULT_CAPABILITIES;
  }

  /**
   * AI 结果后处理：过滤专业术语白名单
   * 避免正确术语被 LLM 误报为错别字
   */
  protected async postProcessAIResult(
    text: string,
    aiIssues: ReviewIssue[],
  ): Promise<ReviewIssue[]> {
    return TerminologyService.filterTerminologyIssues(text, aiIssues);
  }

  /**
   * 不再需要覆盖 execute / runFastPhase / runSlowPhase
   * BasePipeline 的能力驱动编排已正确处理：
   * - runAIStrategy → 根据 capabilities.aiStrategy='llmOnly' → runLLMOnlyStrategy
   * - postProcessAIResult → 术语白名单过滤
   * - 额外标准引用检查 → capabilities.standardRef='config' 由 runSlowPhase 自动处理
   */
}
