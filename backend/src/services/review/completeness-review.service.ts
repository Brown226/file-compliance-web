// backend/src/services/review/completeness-review.service.ts
/**
 * 完整性审核服务 — 分支A
 *
 * 对照审点库中 auditDimension='compliance' 且章节结构相关的子集，
 * LLM 核查设计文档章节结构是否完整（缺章/缺节/缺必备内容）。
 * 5min 级轻量化。
 */

import { PipelineContext, PipelineReviewConfig } from '../review-pipeline/types';
import { ReviewIssue, SourceReference, LlmService } from '../llm/llm.service';
import { PromptTemplateService } from '../llm/prompt-template.service';
import { ChunkSplitterService } from './chunk-splitter.service';

export class CompletenessReviewService {
  static async check(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<{ issues: ReviewIssue[]; sources?: SourceReference[] }> {
    // 提取章节结构
    const { outline } = ChunkSplitterService.splitTextBySection(text, 4000);
    if (outline.length === 0) {
      console.log('[CompletenessReview] 无章节结构，跳过完整性审核');
      return { issues: [] };
    }

    // 筛选完整性相关审点（compliance 维度 + 与章节结构相关的）
    const completenessCheckpoints = (ctx.checkpoints || []).filter(
      c => c.auditDimension === 'compliance' && c.mandatory === 'mandatory',
    );

    if (completenessCheckpoints.length === 0) {
      console.log('[CompletenessReview] 无完整性审点，跳过');
      return { issues: [] };
    }

    const systemPrompt = await PromptTemplateService.getPromptByScene(
      'dec_review', 'system', 'completeness',
      '你是设计文件完整性审核专家。对照规范要求，核查设计文档章节结构是否完整。',
    );

    const outlineText = this.formatOutline(outline);
    const checkpointsText = completenessCheckpoints
      .map(c => `- [${c.clauseCode || '无编号'}] ${c.clauseText.substring(0, 200)}`)
      .join('\n');

    const userContent = `## 设计文档目录结构\n\n${outlineText}\n\n## 完整性要求审点\n\n${checkpointsText}\n\n请核查该设计文档是否满足完整性要求，输出缺失项的 JSON 数组。`;

    const result = await LlmService.reviewText(userContent, {
      systemPrompt,
      maxTokens: config.llmMaxTokens || 4096,
      timeout: 300, // 5min
      skipUserTemplate: true,
      documentId: ctx.fileId,
      taskId: ctx.taskId,
      mode: ctx.reviewMode,
    });

    return { issues: result };
  }

  private static formatOutline(nodes: any[], indent: number = 0): string {
    let result = '';
    for (const node of nodes) {
      result += `${'  '.repeat(indent)}- ${node.title}\n`;
      if (node.children) {
        result += this.formatOutline(node.children, indent + 1);
      }
    }
    return result;
  }
}
