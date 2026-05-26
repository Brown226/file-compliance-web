/**
 * 多模态识别流水线（能力驱动重构）
 *
 * 重构说明（2026-04-19）：
 * - 原先 execute() 和 runSlowPhase() 都有大量重复的 LLM 调用代码
 * - 重构后利用 BasePipeline 的钩子机制：
 *   - beforeFastPhase → 表格结构化提取+验证 + 公式区域检测（注入额外规则问题）
 *   - runAIStrategy → 多模态专用 LLM 审查（使用 multimodal 场景提示词）
 * - 消除 execute() 和 runSlowPhase() 之间的代码重复
 * - 不再需要自行管理 LLM 分片/超时/进度回调，统一由 BasePipeline 编排
 */

import { BasePipeline } from './base-pipeline';
import { PipelineContext, ReviewModeType } from './types';
import { PromptLoader } from '../prompts';
import { RuleIssue } from '../rules/types';
import { LlmService, ReviewIssue } from '../llm.service';
import { TableExtractionService } from '../table-extraction.service';
import { FormulaOcrService } from '../formula-ocr.service';
import prisma from '../../config/db';
import { ModeCapabilities } from './mode-config';

const DEFAULT_CAPABILITIES: ModeCapabilities = {
  rules: false,
  standardRef: false,
  ai: true,
  aiStrategy: 'multimodal',
  crossFile: false,
  needsRefFiles: false,
};

export class MultimodalPipeline extends BasePipeline {
  readonly mode: ReviewModeType = 'MULTIMODAL';
  readonly displayName = '多模态识别';
  readonly description = '表格结构化、公式识别、图纸智能分析';
  capabilities: ModeCapabilities;

  constructor(runtimeCapabilities?: ModeCapabilities) {
    super();
    this.capabilities = runtimeCapabilities || DEFAULT_CAPABILITIES;
  }

  /**
   * 阶段1 前置钩子：表格结构化提取 + 公式区域检测
   * 检测结果作为额外规则问题注入到阶段1结果中
   */
  protected async beforeFastPhase(ctx: PipelineContext): Promise<RuleIssue[]> {
    const extraIssues: RuleIssue[] = [];
    const text = ctx.extractedText || '';

    // 1. 表格结构化提取与验证
    const tables = TableExtractionService.extractTablesFromText(text);
    for (const table of tables) {
      extraIssues.push(...TableExtractionService.validateTableData(table));
    }

    // Excel 文件额外提取
    if (['xlsx', 'xls'].includes(ctx.fileType.toLowerCase())) {
      const excelTables = await TableExtractionService.extractFromExcel(ctx.filePath);
      for (const table of excelTables) {
        extraIssues.push(...TableExtractionService.validateTableData(table));
      }
    }

    // 2. 公式区域检测
    const formulaRegions = FormulaOcrService.detectFormulaRegions(text);
    for (const region of formulaRegions) {
      extraIssues.push({
        issueType: 'FORMAT',
        ruleCode: 'FORMULA_001',
        severity: 'info',
        originalText: region.text,
        description: '检测到可能的公式内容，建议人工确认公式正确性。',
      });
    }

    return extraIssues;
  }

  /**
   * 覆盖 runAIStrategy：多模态专用 LLM 审查
   * 使用 multimodal 场景的提示词，重点检查表格/数值/公式
   */
  protected async runAIStrategy(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: any[] }> {
    const config = this.getEffectiveConfig(ctx);
    const chunkSize = config.chunkSize || 4000;
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;

    try {
      // 动态加载多模态专用系统提示词（回退链：DB → Registry）
      const multimodalPrompt = await PromptLoader.loadSystemPrompt(this.scene, { hasContext: false });

      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const aiIssues: ReviewIssue[] = [];

      for (const chunk of chunks) {
        try {
          const userContent = await PromptLoader.loadUserPrompt(this.scene, 'structural', {
            chunk: chunk.text,
            text: chunk.text,
          });

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt: multimodalPrompt,
            skipUserTemplate: true,
            positionInfo: {
              chunkIndex: chunk.chunkIndex,
              chunkStartIndex: chunk.startIndex,
              totalChunks,
            },
          });

          aiIssues.push(...issues);
          ctx.onChunkProgress?.(chunk.text.length, issues, chunk.chunkIndex, totalChunks, 'llm-direct');
        } catch (e: any) {
          if (e.name === 'AbortError') {
            console.warn('[Multimodal] LLM 请求超时');
          } else {
            console.warn('[Multimodal] LLM 分片调用失败:', e.message);
          }
        }
      }

      return { issues: aiIssues, engine: 'llm-direct' };
    } catch (e) {
      console.warn('[Multimodal] LLM 调用失败:', e);
      return { issues: [], engine: 'none' };
    }
  }

  /** 从数据库获取 LLM 配置（使用统一的 LlmService） */
  private async getLlmConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
  } | null> {
    return LlmService.getLlmConfig();
  }
}
