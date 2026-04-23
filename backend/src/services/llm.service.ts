/**
 * LLM 工具服务 — 提供文本分片、审查结果解析和直接 LLM 调用的公共方法
 *
 * 支持 MaxKB 作为优先 AI 引擎，不可用时降级到 LLM 直接调用
 * 本文件保留 ReviewIssue 类型定义和 splitText / parseReviewResult / reviewText 工具方法
 */

import prisma from '../config/db';
import { PromptTemplateService } from './prompt-template.service';

export interface SourceReference {
  content: string;        // MaxKB 检索到的知识库片段原文
  document_name: string;  // 来源文档名称
  similarity: number;     // 相似度
}

export interface ReviewIssue {
  issueType: string;  // 扩展为 string，支持 TYPO/VIOLATION/FORMAT/COMPLETENESS/CONSISTENCY/LAYOUT/NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE
  originalText: string;
  suggestedText?: string;
  description?: string;
  cadHandleId?: string;
  ruleCode?: string;      // 标准条文编号（如 R1, STD_5.2.1）
  standardRef?: string;   // 标准规范引用（如 "GB/T 50265-2010 第5.2.1条"）
  sourceReferences?: SourceReference[];  // MaxKB RAG 溯源来源
  severity?: string;      // 问题严重程度: 'error' | 'warning' | 'info'
  diffRanges?: any;       // 字符级差异定位范围（标准引用检查使用）
  matchLevel?: number;    // 匹配等级（标准引用检查使用）
  similarity?: number;    // 相似度（标准引用检查使用）
  /** 文本位置信息 - 用于前端定位 */
  textPosition?: {
    chunkIndex: number;   // 所在分片索引
    charOffset: number;  // 在分片内的字符偏移量
    totalChunks: number; // 总分片数
  };
}

/** 分片结果 - 包含文本和位置信息 */
export interface TextChunk {
  text: string;
  startIndex: number;  // 在原文中的起始位置
  endIndex: number;    // 在原文中的结束位置
  chunkIndex: number;  // 分片索引
}

export class LlmService {

  /** 默认 LLM 审查 Prompt */
  static readonly DEFAULT_REVIEW_PROMPT = `你是核电工程文件合规审查专家（CNPE/核工业标准）。请检查文本中的合规性问题。

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: TYPO/FORMAT/COMPLETENESS/CONSISTENCY/VIOLATION
- originalText: 原始问题文本
- suggestedText: 建议修改内容
- description: 问题描述
- ruleCode: 问题类型编码(如TYPO_001/FORMAT_001/COMPLETENESS_001/CONSISTENCY_001/VIOLATION_001)
- standardRef: 违反的具体标准规范引用(如"GB/T 50265-2010 第5.2.1条")，如果无法确定则写null

如果没有发现问题，输出空数组 []
不要输出任何其他文字说明`;

  /**
   * 解析 LLM 返回的审查结果（公开方法，供 ReviewService 调用）
   */
  static parseReviewResult(content: string): ReviewIssue[] {
    const validTypes = ['TYPO', 'VIOLATION', 'FORMAT', 'COMPLETENESS', 'CONSISTENCY', 'LAYOUT', 'NAMING', 'ENCODING', 'ATTRIBUTE', 'HEADER', 'PAGE'];

    try {
      // 尝试从内容中提取 JSON 数组
      let jsonStr = content.trim();

      // 去掉 markdown 代码块标记
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // 尝试从文本中找到 JSON 数组（可能被包裹在其他文本中）
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      if (Array.isArray(parsed)) {
        return parsed
          .filter((item: any) => item.issueType && item.originalText)
          .map((item: any) => ({
            issueType: validTypes.includes(item.issueType) ? item.issueType : 'VIOLATION',
            originalText: String(item.originalText || ''),
            suggestedText: item.suggestedText ? String(item.suggestedText) : undefined,
            description: item.description ? String(item.description) : undefined,
            cadHandleId: item.cadHandleId ? String(item.cadHandleId) : undefined,
            ruleCode: item.ruleCode ? String(item.ruleCode) : undefined,
            standardRef: item.standardRef ? String(item.standardRef) : undefined,
          }));
      }

      // JSON 解析成功但不是数组
      console.warn('[LLM] 审查结果不是数组:', typeof parsed);
      return [];
    } catch (e) {
      // JSON 解析失败，尝试从 Markdown 文本中提取结构化问题
      const markdownIssues = this.parseMarkdownReviewResult(content);
      if (markdownIssues.length > 0) {
        console.log(`[LLM] 从 Markdown 格式中提取到 ${markdownIssues.length} 个审查问题`);
        return markdownIssues;
      }
      console.warn('[LLM] 解析审查结果失败:', (e as Error).message, '\n原始内容:', content.substring(0, 200));
      return [];
    }
  }

  /**
   * 从 MaxKB 返回的 Markdown 格式文本中提取结构化审查问题
   * MaxKB SIMPLE 应用返回 Markdown 格式而非 JSON，需要从中提取问题
   *
   * 支持的格式：
   * 1. Markdown 表格: | 问题类型 | 描述 | ... |
   * 2. Markdown 列表: - **问题类型**: 描述 / - 问题1: xxx
   * 3. 加粗标记的问题: **问题** 或 **缺少xxx**
   */
  private static parseMarkdownReviewResult(content: string): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    let inTable = false;
    let tableHeaderDetected = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // === Markdown 表格解析 ===
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());

        // 跳过分隔行（如 |---|---|）
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue;
        }

        // 检测是否是表头行：只看第一行表格行或明确短标签的行
        const isShortHeader = cells.every(c => c.length <= 10 && !c.includes('。') && !c.includes('，'));
        const hasHeaderKeywords = cells.some(c => /^(问题|类型|描述|编号|条文|建议|格式|违规|缺失|错误|序号|名称|类别|内容|说明|原始|修改|issueType|type|severity|ruleCode)$/i.test(c));

        if (!tableHeaderDetected && (isShortHeader || hasHeaderKeywords)) {
          inTable = true;
          tableHeaderDetected = true;
          continue;
        }

      // 表格数据行
      if (inTable && cells.length >= 2) {
        const description = cells.join('；');
        const rawOriginalText = this.extractQuotedText(cells.join(' ')) || cells[0].replace(/\*+/g, '');

        // 过滤掉分类/说明类表格行（如"技术文档"、"申报文件"等分类标签）
        // 这类表格通常是 LLM 返回的分类说明，不是实际审查问题
        if (this.isLikelyCategoryLabel(rawOriginalText, description)) {
          continue;
        }

        // 推断问题类型
        const issueType = this.inferIssueType(cells.join(' '));

        // 过滤掉过于通用或无意义的内容
        if (rawOriginalText.length < 3 || /^[一二三四五六七八九十]+$/.test(rawOriginalText)) {
          continue;
        }

        const suggestedText = cells.length > 2 ? cells[cells.length - 1] : undefined;

        issues.push({
          issueType,
          originalText: rawOriginalText,
          suggestedText,
          description,
        });
      }
        continue;
      } else {
        inTable = false;
        tableHeaderDetected = false;
      }

      // === Markdown 列表项解析 ===
      // 匹配: - **问题类型**: 描述 / - **缺少xxx**: 描述 / - 问题1: xxx
      const listMatch = line.match(/^[-*]\s+\*{1,2}([^*]+)\*{1,2}\s*[:：]\s*(.+)/);
      if (listMatch) {
        const [, label, desc] = listMatch;
        const rawOriginalText = this.extractQuotedText(desc) || label;

        // 过滤分类标签
        if (this.isLikelyCategoryLabel(rawOriginalText, `${label}：${desc}`)) {
          continue;
        }

        const issueType = this.inferIssueType(label + ' ' + desc);
        issues.push({
          issueType,
          originalText: rawOriginalText,
          description: `${label}：${desc}`,
        });
        continue;
      }

      // 匹配: 数字编号的问题 如 1. **问题** 或 1. 问题
      const numberedMatch = line.match(/^\d+[.、)]\s+\*{1,2}([^*]+)\*{1,2}\s*[:：]?\s*(.*)/);
      if (numberedMatch) {
        const [, label, desc] = numberedMatch;
        if (desc && desc.length > 3) {
          const rawOriginalText = this.extractQuotedText(desc) || label;
          // 过滤分类标签
          if (!this.isLikelyCategoryLabel(rawOriginalText, `${label}：${desc}`)) {
            const issueType = this.inferIssueType(label + ' ' + desc);
            issues.push({
              issueType,
              originalText: rawOriginalText,
              description: `${label}：${desc}`,
            });
          }
        }
        continue;
      }

      // 匹配: - **加粗问题文本** 后面可能有描述
      const boldMatch = line.match(/^[-*]\s+\*{1,2}(.+?)\*{1,2}\s*(.*)/);
      if (boldMatch) {
        const [, boldText, rest] = boldMatch;
        // 过滤掉非问题的加粗文本（如标题、分类标签等）
        if (boldText.length < 30 && /缺少|缺失|错误|不规范|不一致|违反|问题|格式|违规|不完整|缺少|未/i.test(boldText + rest)) {
          const rawOriginalText = this.extractQuotedText(rest) || boldText;
          // 过滤分类标签
          if (!this.isLikelyCategoryLabel(rawOriginalText, `${boldText}：${rest}`)) {
            const issueType = this.inferIssueType(boldText + ' ' + rest);
            issues.push({
              issueType,
              originalText: rawOriginalText,
              description: rest ? `${boldText}：${rest}` : boldText,
            });
          }
        }
      }

      // === 引用块解析（> 引用的建议修改内容）===
      const quoteMatch = line.match(/^>\s*\*{0,2}(.+?)\*{0,2}\s*[：:]\s*(.+)/);
      if (quoteMatch && issues.length > 0) {
        // 将引用内容作为上一个问题的建议文本
        const lastIssue = issues[issues.length - 1];
        if (!lastIssue.suggestedText) {
          lastIssue.suggestedText = quoteMatch[2].trim();
        }
      }
    }

    return issues;
  }

  /**
   * 从文本推断问题类型
   */
  private static inferIssueType(text: string): string {
    const t = text.toLowerCase();
    if (/错别字|错字|拼写|typo|笔误/.test(t)) return 'TYPO';
    if (/格式|排版|编号|编号格式|模板|表头/.test(t)) return 'FORMAT';
    if (/完整|缺少|缺失|遗漏|未包含|空白|留空/.test(t)) return 'COMPLETENESS';
    if (/一致|不匹配|不一致|不统一/.test(t)) return 'CONSISTENCY';
    if (/命名|编码|名称|标识/.test(t)) return 'NAMING';
    if (/封面|页眉|页脚|标题|抬头/.test(t)) return 'HEADER';
    if (/页码|分页|页数/.test(t)) return 'PAGE';
    if (/属性|字段|参数|配置/.test(t)) return 'ATTRIBUTE';
    if (/布局|版面|间距|缩进|对齐/.test(t)) return 'LAYOUT';
    if (/编码|字符|乱码|编码方式/.test(t)) return 'ENCODING';
    return 'VIOLATION';
  }

  /**
   * 从文本中提取引号或书名号内的引用文本
   */
  private static extractQuotedText(text: string): string {
    // 尝试匹配中文引号 ""、英文引号 ""、书名号 《》
    const match = text.match(/[""「]([^""」]+)[""」]|《([^》]+)》/);
    if (match) return match[1] || match[2];
    return '';
  }

  /**
   * 判断是否是分类/说明类标签（如"技术文档"、"申报文件"等）
   * 这类内容通常是 LLM 返回的分类说明，不是实际审查问题
   */
  private static isLikelyCategoryLabel(originalText: string, description: string): boolean {
    const text = originalText + ' ' + description;

    // 通用分类/说明关键词模式
    const categoryPatterns = [
      // 文件类型/分类名称
      /^(技术文档|申报文件|法律文件|管理文件|程序文件|作业文件|记录文件|报告文件|图纸文件|标准规范|合同文件|设计文件|施工文件|验收文件)$/,
      // 包含"属于"、"是"、""应该包含"等说明性描述
      /属于|是一[种个]|应该包含|应当包含|包括以下|包含(?:内容|要素|部分)|分类为|类型为/,
      // 数字序号作为主内容的（可能是分类编号）
      /^[一二三四五六七八九十]+$/,
      // 过于简短的分类标签（1-4个字符）
      /^[^\s]{1,4}$/,
      // 描述中包含"文档"、"文件"、"资料"等类型说明，但原始文本不是具体问题
      /^[^，,。；:：]{1,10}$/,
    ];

    // 检查是否匹配分类模式
    for (const pattern of categoryPatterns) {
      if (pattern.test(originalText) || pattern.test(text)) {
        return true;
      }
    }

    // 检查描述是否是说明性内容（包含"属于"、"是"等）
    const isDescriptiveDescription = /属于|是一[种个]|应该[是包含]|应当[是包含]/.test(description);
    const isShortOriginal = originalText.length <= 8;
    if (isDescriptiveDescription && isShortOriginal) {
      return true;
    }

    return false;
  }

  /**
   * 文本分片 - 按段落分割，每片不超过 maxChars（公开方法，供 ReviewService 调用）
   * @param text 原始文本
   * @param maxChars 每片最大字符数
   * @param includePosition 是否包含位置信息
   * @returns 分片数组（纯文本）或分片信息数组（带位置）
   */
  static splitText(text: string, maxChars: number, includePosition: true): TextChunk[];
  static splitText(text: string, maxChars: number, includePosition?: false): string[];
  static splitText(text: string, maxChars: number, includePosition?: boolean): string[] | TextChunk[] {
    if (text.length <= maxChars) {
      if (includePosition) {
        return [{ text, startIndex: 0, endIndex: text.length, chunkIndex: 0 }];
      }
      return [text];
    }

    const chunks: string[] = [];
    const chunkInfos: TextChunk[] = [];
    const paragraphs = text.split('\n');
    let currentChunk = '';
    let currentStartIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraStartInOriginal = text.indexOf(para, currentStartIndex);

      if (currentChunk.length + para.length + 1 > maxChars) {
        if (currentChunk) {
          const trimmed = currentChunk.trim();
          chunks.push(trimmed);
          if (includePosition) {
            chunkInfos.push({
              text: trimmed,
              startIndex: currentStartIndex,
              endIndex: currentStartIndex + trimmed.length,
              chunkIndex: chunkInfos.length,
            });
          }
          currentChunk = '';
          // 下一个 chunk 从当前位置继续
          currentStartIndex = paraStartInOriginal >= 0 ? paraStartInOriginal : currentStartIndex + (currentChunk.length > 0 ? currentChunk.length + 1 : 0);
        }
        // 如果单个段落超过 maxChars，按句子再分割
        if (para.length > maxChars) {
          const sentences = para.split(/(?<=[。！？；，、])/);
          let sentenceChunk = '';
          let sentenceStartIndex = paraStartInOriginal >= 0 ? paraStartInOriginal : currentStartIndex;

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length > maxChars) {
              if (sentenceChunk) {
                const trimmed = sentenceChunk.trim();
                chunks.push(trimmed);
                if (includePosition) {
                  chunkInfos.push({
                    text: trimmed,
                    startIndex: sentenceStartIndex,
                    endIndex: sentenceStartIndex + trimmed.length,
                    chunkIndex: chunkInfos.length,
                  });
                }
                sentenceStartIndex += sentenceChunk.length;
              }
              sentenceChunk = sentence;
            } else {
              sentenceChunk += sentence;
            }
          }
          if (sentenceChunk) {
            currentChunk = sentenceChunk;
            currentStartIndex = sentenceStartIndex;
          }
        } else {
          currentChunk = para;
          currentStartIndex = paraStartInOriginal >= 0 ? paraStartInOriginal : currentStartIndex;
        }
      } else {
        currentChunk += (currentChunk ? '\n' : '') + para;
        if (currentStartIndex === 0 && i === 0) {
          currentStartIndex = paraStartInOriginal >= 0 ? paraStartInOriginal : 0;
        }
      }
    }

    if (currentChunk.trim()) {
      const trimmed = currentChunk.trim();
      chunks.push(trimmed);
      if (includePosition) {
        chunkInfos.push({
          text: trimmed,
          startIndex: currentStartIndex,
          endIndex: currentStartIndex + trimmed.length,
          chunkIndex: chunkInfos.length,
        });
      }
    }

    // 为每个 chunk 补充缺失的 position 信息（简化处理）
    if (includePosition && chunks.length > 0 && chunkInfos.length === 0) {
      let accumulatedIndex = 0;
      for (let i = 0; i < chunks.length; i++) {
        chunkInfos.push({
          text: chunks[i],
          startIndex: accumulatedIndex,
          endIndex: accumulatedIndex + chunks[i].length,
          chunkIndex: i,
        });
        accumulatedIndex += chunks[i].length + 1; // +1 for newline
      }
    }

    return includePosition ? chunkInfos : chunks;
  }

  /**
   * 查找文本在原始文本中的位置
   * @param originalText 原始完整文本
   * @param searchText 要查找的文本
   * @returns 位置信息
   */
  static findTextPosition(originalText: string, searchText: string): { chunkIndex: number; charOffset: number; totalChunks: number } | null {
    if (!searchText || !originalText) return null;

    // 在原始文本中查找
    const index = originalText.indexOf(searchText);
    if (index === -1) {
      // 尝试模糊匹配（去掉首尾空格）
      const trimmedSearch = searchText.trim();
      const trimmedIndex = originalText.indexOf(trimmedSearch);
      if (trimmedIndex === -1) return null;
      return { chunkIndex: 0, charOffset: trimmedIndex, totalChunks: 1 };
    }

    // 使用当前分片逻辑计算 chunkIndex 和 charOffset
    const config = this.getEffectiveChunkSize();
    const chunkSize = config || 4000;
    const chunkIndex = Math.floor(index / chunkSize);
    const charOffset = index % chunkSize;
    const totalChunks = Math.ceil(originalText.length / chunkSize);

    return { chunkIndex, charOffset, totalChunks };
  }

  private static getEffectiveChunkSize(): number {
    // 尝试从系统配置获取
    try {
      // 同步获取 chunkSize（不阻塞）
      const cached = (global as any).__pipelineConfigCache;
      if (cached?.chunkSize) return cached.chunkSize;
    } catch (e) {
      // ignore
    }
    return 4000;
  }

  /**
   * 直接调用 LLM API 进行文本审查（MaxKB 降级方案）
   * @param text 要审查的文本
   * @param options 配置选项
   * @param positionInfo 位置信息（可选），用于前端定位
   */
  static async reviewText(
    text: string,
    options?: {
      maxTokens?: number;
      timeout?: number;
      standardContext?: string;
      systemPrompt?: string;
      skipUserTemplate?: boolean;
      /** 位置信息：当前 chunk 在原始文本中的起始位置 */
      positionInfo?: {
        chunkIndex: number;
        chunkStartIndex: number;
        totalChunks: number;
      };
    }
  ): Promise<ReviewIssue[]> {
    // 从数据库获取 LLM 配置
    const config = await this.getLlmConfig();
    if (!config) {
      throw new Error('LLM 未配置，请在系统配置中设置 LLM API');
    }

    // 系统提示词：优先使用调用方传入的（场景化），否则从 library_review 场景加载，最终 fallback 到默认
    let systemPrompt: string;
    if (options?.systemPrompt) {
      systemPrompt = options.systemPrompt;
    } else {
      try {
        systemPrompt = await PromptTemplateService.getPromptByScene('library_review', 'system', 'default', LlmService.DEFAULT_REVIEW_PROMPT);
      } catch (e) {
        systemPrompt = LlmService.DEFAULT_REVIEW_PROMPT;
      }
    }

    const maxTokens = options?.maxTokens || 4096;
    const timeoutMs = (options?.timeout || 180) * 1000;

    // 如果 skipUserTemplate 为 true，直接使用传入的 text 作为 userContent（调用方已自行组装）
    let userContent: string;
    if (options?.skipUserTemplate) {
      userContent = text;
    } else if (options?.standardContext) {
      const tpl = await PromptTemplateService.getPromptByScene(
        'library_review', 'user', 'with_context',
        `【审查标准】\n${options.standardContext}\n\n【待审查文本】\n${text}\n\n请根据以上审查标准，检查待审查文本的合规性问题。`
      );
      userContent = tpl
        .replace(/\$\{ragContext\}/g, options.standardContext)
        .replace(/\$\{standardContext\}/g, options.standardContext)
        .replace(/\$\{text\}/g, text);
    } else {
      const tpl = await PromptTemplateService.getPromptByScene(
        'library_review', 'user', 'no_context',
        `【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。`
      );
      userContent = tpl.replace(/\$\{text\}/g, text);
    }

    const body = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      max_tokens: maxTokens,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';
      const issues = this.parseReviewResult(content);

      // 为每个 issue 添加位置信息
      if (options?.positionInfo && issues.length > 0) {
        const { chunkIndex, chunkStartIndex, totalChunks } = options.positionInfo;
        return issues.map(issue => {
          // 计算 originalText 在当前 chunk 中的位置
          const offsetInChunk = text.indexOf(issue.originalText);
          const charOffset = offsetInChunk >= 0 ? chunkStartIndex + offsetInChunk : chunkStartIndex;

          return {
            ...issue,
            textPosition: {
              chunkIndex,
              charOffset,
              totalChunks,
            },
          };
        });
      }

      return issues;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 从数据库获取 LLM 配置
   */
  private static async getLlmConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
  } | null> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'llm_chat_model' },
      });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          return {
            apiBaseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
            apiKey: v.apiKey,
            modelName: v.modelName,
          };
        }
      }
    } catch (e) {
      console.warn('[LLM] 获取 LLM 配置失败:', e);
    }
    return null;
  }

  /**
   * 通用聊天接口 - 用于 AI 正则表达式生成等场景
   */
  static async chat(prompt: string, options?: { systemPrompt?: string; maxTokens?: number; timeout?: number }): Promise<string> {
    const config = await this.getLlmConfig();
    if (!config) {
      throw new Error('LLM 未配置，请在系统配置中设置 LLM API');
    }

    const systemPrompt = options?.systemPrompt || '你是一个正则表达式专家，擅长根据用户需求生成准确的正则表达式。请只输出正则表达式，不要输出其他解释文字。';
    const maxTokens = options?.maxTokens || 1024;
    const timeoutMs = (options?.timeout || 60) * 1000;

    const body = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      stream: false,
      max_tokens: maxTokens,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
