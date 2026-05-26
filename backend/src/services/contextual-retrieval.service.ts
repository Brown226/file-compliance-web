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
import { PromptTemplateService } from './prompt-template.service';

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

    const results: ChunkWithContext[] = new Array(chunks.length);

    const batches: number[][] = [];
    for (let i = 0; i < chunks.length; i += concurrency) {
      batches.push(
        Array.from({ length: Math.min(concurrency, chunks.length - i) }, (_, j) => i + j)
      );
    }

    // 预计算每个 chunk 在原文档中的大致位置，用于动态窗口截取
    const chunkPositions = this.estimateChunkPositions(wholeDocument, chunks);

    for (const batch of batches) {
      const promises = batch.map(async (index) => {
        const chunk = chunks[index];
        try {
          const localContext = this.extractLocalContext(wholeDocument, chunkPositions[index]);
          const summary = await this.generateContextSummary(localContext, chunk, timeout);
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
   * 估算每个 chunk 在原文档中的大致字符位置
   */
  private static estimateChunkPositions(
    wholeDocument: string,
    chunks: string[]
  ): Array<{ start: number; end: number }> {
    const positions: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;
    for (const chunk of chunks) {
      // 取 chunk 前50字符作为搜索锚点，避免因微小差异导致定位失败
      const anchor = chunk.slice(0, 50).trim();
      const idx = wholeDocument.indexOf(anchor, searchFrom);
      if (idx >= 0) {
        positions.push({ start: idx, end: idx + chunk.length });
        searchFrom = idx + chunk.length;
      } else {
        // 找不到时用上一个 chunk 结尾作为起点
        const fallback = positions.length > 0 ? positions[positions.length - 1].end : 0;
        positions.push({ start: fallback, end: fallback + chunk.length });
      }
    }
    return positions;
  }

  /**
   * 根据 chunk 位置提取局部上下文（前后各取 2000 字符）
   * 比截断前 8000 字符更精准，确保每个 chunk 获得相关上下文
   */
  private static extractLocalContext(
    wholeDocument: string,
    position: { start: number; end: number },
    contextSize: number = 2000
  ): string {
    const docLen = wholeDocument.length;
    if (docLen <= contextSize * 2.5) {
      // 文档较短，直接返回全文
      return wholeDocument;
    }

    const start = Math.max(0, position.start - contextSize);
    const end = Math.min(docLen, position.end + contextSize);

    let context = wholeDocument.slice(start, end);
    if (start > 0) context = '...(前文省略)\n' + context;
    if (end < docLen) context = context + '\n...(后文省略)';

    // 限制总长度不超过 8000
    if (context.length > 8000) {
      context = context.slice(0, 8000) + '\n...(已截断)';
    }
    return context;
  }

  /**
   * 为单个 chunk 生成上下文摘要
   */
  private static async generateContextSummary(
    wholeDocument: string,
    chunkContent: string,
    timeout: number
  ): Promise<string> {
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      'contextual_retrieval', 'system', 'default',
      '你是一个文档上下文分析专家。你的任务是为给定的文档片段生成简短的上下文描述，帮助在检索时更好地定位该片段。只输出上下文描述，不要输出其他内容。',
    );
    const userTpl = await PromptTemplateService.getPromptByScene(
      'contextual_retrieval', 'user', 'default',
      CONTEXTUAL_PROMPT,
    );
    const prompt = userTpl
      .replace(/\$\{wholeDocument\}/g, wholeDocument)
      .replace(/\$\{chunkContent\}/g, chunkContent);

    const result = await LlmService.chat(prompt, {
      systemPrompt,
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
