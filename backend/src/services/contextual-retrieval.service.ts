/**
 * Contextual Retrieval 服务（Anthropic 方法）
 *
 * 核心思想：在分块后、embedding 前，用 LLM 为每个 chunk 生成一句上下文摘要，
 * 将摘要拼入 chunk 内容再进行向量化。这样每个 chunk 就携带了文档级别的语义信息，
 * 大幅提升检索召回率。
 *
 * 原理：
 *   原始 chunk: "排放浓度不得超过 50mg/m³"
 *   → LLM 生成上下文: "此条款出自《大气污染物排放标准》第3.2条，关于工业废气排放限值"
 *   → 增强 chunk: "[此条款出自《大气污染物排放标准》第3.2条，关于工业废气排放限值] 排放浓度不得超过 50mg/m³"
 *   → 对增强 chunk 做 embedding
 *
 * 成本：每个 chunk 仅多生成 ~100 Token 的摘要，远低于 QA 拆分模式（~800 Token/chunk）
 */

import { LlmService } from './llm.service';

export interface ContextualRetrievalOptions {
  /** 是否启用上下文检索（默认 false） */
  enabled: boolean;
  /** 并发数：同时处理多少个 chunk 的摘要生成（默认 3） */
  concurrency?: number;
  /** 单个 chunk 摘要生成的超时时间（秒，默认 30） */
  timeout?: number;
}

interface ChunkWithContext {
  /** 原始 chunk 内容 */
  originalContent: string;
  /** LLM 生成的上下文摘要 */
  contextSummary: string;
  /** 拼接后的增强内容：[上下文摘要] 原始内容 */
  enhancedContent: string;
}

const CONTEXTUAL_PROMPT = `<document>
{{WHOLE_DOCUMENT}}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{{CHUNK_CONTENT}}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;

export class ContextualRetrievalService {

  /**
   * 为一组 chunk 批量生成上下文摘要
   *
   * @param wholeDocument 完整文档文本（用于 LLM 理解全局上下文）
   * @param chunks 分块后的内容数组
   * @param options 配置选项
   * @returns 每个 chunk 的增强结果
   */
  static async enhanceChunks(
    wholeDocument: string,
    chunks: string[],
    options: ContextualRetrievalOptions
  ): Promise<ChunkWithContext[]> {
    if (!options.enabled || chunks.length === 0) {
      return chunks.map(chunk => ({
        originalContent: chunk,
        contextSummary: '',
        enhancedContent: chunk,
      }));
    }

    const concurrency = options.concurrency || 3;
    const timeout = options.timeout || 30;

    const truncatedDoc = wholeDocument.length > 8000
      ? wholeDocument.substring(0, 8000) + '\n...(文档过长，已截断)'
      : wholeDocument;

    const results: ChunkWithContext[] = new Array(chunks.length);

    const batches: number[][] = [];
    for (let i = 0; i < chunks.length; i += concurrency) {
      batches.push(
        Array.from({ length: Math.min(concurrency, chunks.length - i) }, (_, j) => i + j)
      );
    }

    for (const batch of batches) {
      const promises = batch.map(async (index) => {
        const chunk = chunks[index];
        try {
          const summary = await this.generateContextSummary(truncatedDoc, chunk, timeout);
          results[index] = {
            originalContent: chunk,
            contextSummary: summary,
            enhancedContent: summary ? `[${summary}] ${chunk}` : chunk,
          };
        } catch (err: any) {
          console.warn(`[ContextualRetrieval] chunk ${index} 摘要生成失败: ${err.message}`);
          results[index] = {
            originalContent: chunk,
            contextSummary: '',
            enhancedContent: chunk,
          };
        }
      });

      await Promise.all(promises);
    }

    return results;
  }

  /**
   * 为单个 chunk 生成上下文摘要
   */
  private static async generateContextSummary(
    wholeDocument: string,
    chunkContent: string,
    timeout: number
  ): Promise<string> {
    const prompt = CONTEXTUAL_PROMPT
      .replace('{{WHOLE_DOCUMENT}}', wholeDocument)
      .replace('{{CHUNK_CONTENT}}', chunkContent);

    const result = await LlmService.chat(prompt, {
      systemPrompt: '你是一个文档上下文分析专家。你的任务是为给定的文档片段生成简短的上下文描述，帮助在检索时更好地定位该片段。只输出上下文描述，不要输出其他内容。',
      maxTokens: 150,
      timeout,
      temperature: 0.1,
    });

    return (result || '').trim();
  }

  /**
   * 快速检查 LLM 是否可用（用于前端判断是否可以开启 Contextual Retrieval）
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const config = await LlmService.getLlmConfig();
      return config !== null;
    } catch {
      return false;
    }
  }
}
