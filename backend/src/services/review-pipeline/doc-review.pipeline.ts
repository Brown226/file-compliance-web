/**
 * 以文审文流水线（能力驱动重构）
 *
 * 重构说明（2026-04-19）：
 * - 继承 BasePipeline 的能力驱动编排，覆盖 runAIStrategy 实现参照文件比对
 * - 修复原 bug：两阶段编排（runFastPhase + runSlowPhase）模式下，
 *   参照文件比对逻辑仅在 execute() 中实现，runSlowPhase 未覆盖，
 *   导致两阶段流下参照比对被跳过，降级到普通 AI 审查
 * - 现在通过覆盖 runAIStrategy，两阶段流也能正确执行参照比对
 */

import { BasePipeline } from './base-pipeline';
import { PipelineContext, ReviewModeType } from './types';
import { ReviewIssue, LlmService } from '../llm.service';
import { ParserService } from '../parser.service';
import { PromptTemplateService } from '../prompt-template.service';
import { ModeCapabilities } from './mode-config';

const DEFAULT_CAPABILITIES: ModeCapabilities = {
  rules: true,
  standardRef: 'on',
  ai: true,
  aiStrategy: 'refCompare',
  crossFile: false,
  needsRefFiles: true,
};

export class DocReviewPipeline extends BasePipeline {
  readonly mode: ReviewModeType = 'DOC_REVIEW';
  readonly displayName = '以文审文';
  readonly description = '使用上游参照文件与待审文件进行比对审查';
  capabilities: ModeCapabilities;

  constructor(runtimeCapabilities?: ModeCapabilities) {
    super();
    this.capabilities = runtimeCapabilities || DEFAULT_CAPABILITIES;
  }

  /**
   * 覆盖 runAIStrategy：实现参照文件比对
   * - 有参照文件时：使用 LLM 做待审文件 vs 参照文件比对
   * - 无参照文件时：降级到标准 AI 审查（runAIReview）
   */
  protected async runAIStrategy(
    text: string,
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string; sources?: any[] }> {
    // 无参照文件时降级到标准 AI 审查
    if (!ctx.refFileGroup || ctx.refFileGroup.refFiles.length === 0) {
      console.log('[DocReview] 无参照文件，降级到标准 AI 审查');
      return this.runAIReview(text, ctx);
    }

    // 解析参照文件文本
    const refTexts: string[] = [];
    for (const refFile of ctx.refFileGroup.refFiles) {
      if (refFile.extractedText) {
        refTexts.push(refFile.extractedText);
      } else {
        try {
          const refText = await ParserService.parseFile(refFile.filePath, refFile.fileType);
          if (refText) refTexts.push(refText);
        } catch (e) {
          console.warn(`[DocReview] 参照文件解析失败: ${refFile.fileName}`, e);
        }
      }
    }

    if (refTexts.length === 0) {
      console.warn('[DocReview] 参照文件均无文本内容，降级到标准 AI 审查');
      return this.runAIReview(text, ctx);
    }

    // 使用 LLM 进行参照文件比对
    return this.runRefCompare(text, refTexts, ctx);
  }

  /**
   * 参照文件比对核心逻辑
   * 使用场景化提示词，将待审文件与参照文件进行差异比对
   */
  private async runRefCompare(
    text: string,
    refTexts: string[],
    ctx: PipelineContext,
  ): Promise<{ issues: ReviewIssue[]; engine: string }> {
    const config = this.getEffectiveConfig(ctx);
    const llmMaxTokens = config.llmMaxTokens || 4096;
    const llmTimeout = config.llmTimeout || 180;
    const chunkSize = config.chunkSize || 4000;

    try {
      const refTextsJoined = refTexts.join('\n---\n');

      // 按场景加载比对系统提示词
      const comparePromptTpl = await PromptTemplateService.getPromptByScene(
        this.scene, 'system', 'default',
        `你是核电工程文件比对专家。请比较【待审文件】与【参照文件】之间的差异，找出待审文件中可能存在的错误或不一致。

## 参照文件内容
${refTextsJoined}

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: VIOLATION/FORMAT/COMPLETENESS/CONSISTENCY
- originalText: 待审文件中的问题文本
- suggestedText: 建议修改内容（参照文件中的对应内容）
- description: 问题描述和差异说明
- ruleCode: 问题类型编码
- standardRef: 违反的具体标准规范引用，如果无法确定则写null

如果没有发现差异问题，输出空数组 []
不要输出任何其他文字说明`,
      );
      const comparePrompt = comparePromptTpl.replace(/\$\{refTexts\}/g, refTextsJoined);

      // 按分片处理，确保 textPosition 精确
      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];

      for (const chunk of chunks) {
        try {
          // 按场景加载比对用户提示词
          const userContentTpl = await PromptTemplateService.getPromptByScene(
            this.scene, 'user', 'comparison',
            `【待审文件】\n${chunk.text}\n\n请与参照文件比对，找出差异和问题。`,
          );
          const userContent = userContentTpl.replace(/\$\{text\}/g, chunk.text);

          const issues = await LlmService.reviewText(userContent, {
            maxTokens: llmMaxTokens,
            timeout: llmTimeout,
            systemPrompt: comparePrompt,
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
          console.warn(`[DocReview] 分片 ${chunk.chunkIndex + 1}/${totalChunks} 比对失败:`, e.message);
        }
      }

      return { issues: allIssues, engine: 'llm-ref-compare' };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('[DocReview] LLM 请求超时，降级到标准 AI 审查');
      } else {
        console.error('[DocReview] LLM 比对失败:', e);
      }
      return this.runAIReview(text, ctx);
    }
  }
}
