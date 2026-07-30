/**
 * llm_review_chunk 工具 — 对文本片段执行 LLM 审查
 *
 * 工作流：
 * 1. 确定 module：mode || 'doc_review'（默认用 doc_review 模板）
 * 2. 通过 PromptLoader.resolve 加载 system 模板（DB → Registry → 兜底）
 * 3. 如果有 focus，在 systemPrompt 末尾追加「当前审查关注点」段
 * 4. 如果有 context（如 RAG 检索结果），在 systemPrompt 末尾追加「参考知识」段
 * 5. 调 LlmService.reviewText(text, { systemPrompt, mode, skipUserTemplate: true })
 *    skipUserTemplate=true 表示调用方已自行组装 user 内容（直接用 text）
 * 6. 返回 ReviewIssue[]
 *
 * 注意：工具场景下没有完整 PipelineContext，不能用 AiReviewService.injectSemanticContext
 * （它需要 taskId/fileId/extractedText 等完整字段），改为直接拼接 focus 到 systemPrompt。
 */

import { z } from 'zod';
import { PromptLoader } from '../../../prompts';
import { LlmService, type ReviewIssue } from '../../../llm/llm.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 系统提示词最终兜底（PromptLoader.resolve 的 fallback 参数） */
const SYSTEM_PROMPT_FALLBACK =
  '你是文件审查专家，请按规范输出问题列表。每个问题必须包含 issueType 和 originalText 字段，严格按照 JSON 数组格式输出。';

/**
 * 创建 llm_review_chunk 工具
 *
 * 参数：
 * - text: 待审查文本
 * - focus: 审查关注点（如"条款一致性"、"金额规范"、"签字栏"）
 * - mode: 审查模式（如 contract_review / doc_review / consistency）
 * - context: 额外上下文（如知识库检索结果）
 */
export function createLlmReviewChunkTool(_context: ToolContext) {
  return tool({
    description: '对文本片段执行 LLM 审查。可指定 focus 聚焦特定维度（如条款一致性、金额规范、签字栏），可传入 context 作为参考知识。返回结构化的 ReviewIssue[] 数组。',
    inputSchema: z.object({
      text: z.string().describe('待审查的文本片段'),
      focus: z.string().optional().describe('审查关注点，如"条款一致性"、"金额规范"、"签字栏"'),
      mode: z.string().optional().describe('审查模式，如 contract_review / doc_review / consistency'),
      context: z.string().optional().describe('额外上下文，如相关知识库检索结果'),
    }),
    execute: async ({ text, focus, mode, context }): Promise<ReviewIssue[]> => {
      // 1. 确定 module（默认 doc_review）
      const module = mode || 'doc_review';

      // 2. 加载 system 模板（DB → Registry → 兜底）
      let systemPrompt = await PromptLoader.resolve(
        module,
        'system',
        'default',
        SYSTEM_PROMPT_FALLBACK,
      );

      // 3. 追加审查关注点（直接拼接到末尾，不用 injectSemanticContext）
      if (focus) {
        systemPrompt += `\n\n## 当前审查关注点\n请重点关注：${focus}`;
      }

      // 4. 追加参考知识（如 RAG 检索结果）
      if (context) {
        systemPrompt += `\n\n## 参考知识\n${context}`;
      }

      // 5. 调 LlmService.reviewText
      //    skipUserTemplate=true：直接用 text 作为 user content（调用方已自行组装）
      //    mode=module：用于 LlmCallLog 可观测性关联
      const issues = await LlmService.reviewText(text, {
        systemPrompt,
        mode: module,
        skipUserTemplate: true,
      });

      return issues;
    },
  });
}
