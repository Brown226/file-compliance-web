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
import { PromptLoader } from '../prompts';
import { ModeCapabilities } from './mode-config';

const DEFAULT_CAPABILITIES: ModeCapabilities = {
  rules: false,
  standardRef: false,
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
      // 截断参照文本，防止超出 LLM 上下文窗口（预留 ~12000 字符 ≈ 4000-6000 tokens）
      const MAX_REF_CHARS = 12000;
      const rawRefTextsJoined = refTexts.join('\n---\n');
      const refTextsJoined = rawRefTextsJoined.length > MAX_REF_CHARS
        ? rawRefTextsJoined.substring(0, MAX_REF_CHARS) + '\n...(参照文件内容过长，已截断)'
        : rawRefTextsJoined;
      if (rawRefTextsJoined.length > MAX_REF_CHARS) {
        console.warn(`[DocReview] 参照文本已截断至 ${MAX_REF_CHARS} 字符（原始 ${rawRefTextsJoined.length} 字符）`);
      }

      // 按场景加载比对系统提示词（回退链：DB → Registry）
      const comparePromptTpl = await PromptLoader.loadSystemPrompt(this.scene, { hasContext: true });
      const comparePrompt = PromptLoader.fillTemplate(comparePromptTpl, { refTexts: refTextsJoined });

      // 按分片处理，确保 textPosition 精确
      const chunks = LlmService.splitText(text, chunkSize, true);
      const totalChunks = chunks.length;
      const allIssues: ReviewIssue[] = [];
      let failedChunks = 0;
      const errors: string[] = [];

      for (const chunk of chunks) {
        try {
          // 按场景加载比对用户提示词
          const userContent = await PromptLoader.loadUserPrompt(this.scene, 'comparison', {
            text: chunk.text,
          });

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
          failedChunks++;
          errors.push(e.message);
          console.warn(`[DocReview] 分片 ${chunk.chunkIndex + 1}/${totalChunks} 比对失败:`, e.message);
        }
      }

      // 所有分片都失败时，抛出错误让上层降级处理
      if (failedChunks === totalChunks && totalChunks > 0) {
        throw new Error(`所有 ${totalChunks} 个分片比对均失败: ${errors[0]}`);
      }

      if (failedChunks > 0) {
        console.warn(`[DocReview] ${failedChunks}/${totalChunks} 个分片比对失败，已跳过`);
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
