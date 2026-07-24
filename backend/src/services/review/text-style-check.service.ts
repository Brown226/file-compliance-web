// backend/src/services/review/text-style-check.service.ts
/**
 * 文本表述校验服务 — 分支B-3
 *
 * 核查行文、格式、术语是否符合 DEC 统一规定。
 */

import { PipelineContext, PipelineReviewConfig } from '../review-pipeline/types';
import { ReviewIssue, LlmService } from '../llm/llm.service';
import { PromptTemplateService } from '../llm/prompt-template.service';
import { ChunkSplitterService } from './chunk-splitter.service';

export class TextStyleCheckService {
  static async check(
    text: string,
    ctx: PipelineContext,
    textCheckpoints: any[],
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    const { chunks } = ChunkSplitterService.splitTextBySection(text, config.chunkSize || 4000);
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      'dec_review', 'system', 'text_style',
      '你是设计文件文本表述校验专家。核查行文、格式、术语是否符合规范统一规定。',
    );

    const allIssues: ReviewIssue[] = [];
    const CONCURRENT_LIMIT = 3;

    for (let i = 0; i < chunks.length; i += CONCURRENT_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENT_LIMIT);
      const results = await Promise.all(
        batch.map(async chunk => {
          const checkpointsText = textCheckpoints
            .map(c => `- [${c.clauseCode || '无编号'}] ${c.clauseText.substring(0, 200)}`)
            .join('\n');
          const userContent = `## 设计内容（${chunk.sectionPath}）\n\n${chunk.text}\n\n## 文本表述审点\n\n${checkpointsText}\n\n请核查以上设计内容的行文、格式、术语是否符合审点要求。输出 JSON 数组。`;
          try {
            return await LlmService.reviewText(userContent, {
              systemPrompt,
              maxTokens: config.llmMaxTokens || 4096,
              timeout: config.llmTimeout || 180,
              skipUserTemplate: true,
              documentId: ctx.fileId,
              taskId: ctx.taskId,
              positionInfo: { chunkIndex: chunk.chunkIndex, chunkStartIndex: chunk.startIndex, totalChunks: chunks.length },
            });
          } catch (e) {
            console.warn(`[TextStyleCheck] chunk ${chunk.chunkIndex} 失败:`, (e as Error).message);
            return [];
          }
        }),
      );
      for (const r of results) allIssues.push(...r);
    }

    return allIssues;
  }
}
