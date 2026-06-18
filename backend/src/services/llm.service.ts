/**
 * LLM 工具服务 — 提供文本分片、审查结果解析和直接 LLM 调用的公共方法
 *
 * 支持 MaxKB 作为优先 AI 引擎，不可用时降级到 LLM 直接调用
 * 本文件保留 ReviewIssue 类型定义和 splitText / parseReviewResult / reviewText 工具方法
 */

import prisma from '../config/db';
import { PromptTemplateService } from './prompt-template.service';
import { PromptLoader } from './prompts';
import { CacheService } from './cache.service';

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
  plainLanguage?: string;  // 大白话解释（让非专业人员也能理解）
  cadHandleId?: string;
  ruleCode?: string;      // 标准条文编号（如 R1, STD_5.2.1）
  standardRef?: string;   // 标准规范引用（如 "GB/T 50265-2010 第5.2.1条"）
  sourceReferences?: SourceReference[];  // MaxKB RAG 溯源来源
  severity?: string;      // 问题严重程度: 'error' | 'warning' | 'info'
  // 合同审查专用字段
  riskLevel?: string;     // 风险等级: HIGH / MEDIUM / LOW
  clauseType?: string;    // 条款类型: payment/penalty/warranty/ip/change/claim/insurance/dispute/other
  diffRanges?: any;       // 字符级差异定位范围（标准引用检查使用）
  matchLevel?: number;    // 匹配等级（标准引用检查使用）
  similarity?: number;    // 相似度（标准引用检查使用）
  /** 文本位置信息 - 用于前端定位 */
  textPosition?: {
    chunkIndex: number;   // 所在分片索引
    charOffset: number;  // 在分片内的字符偏移量
    totalChunks: number; // 总分片数
  };
  locateMeta?: LocateMeta | null;
}

export interface LocateMeta {
  version: 2;
  mode: 'text' | 'dwg';
  confidence: 'exact' | 'trimmed' | 'normalized' | 'fallback';
  absolute?: {
    start: number;
    end: number;
  };
  quote?: {
    text: string;
    normalizedText?: string;
  };
  context?: {
    prefix: string;
    suffix: string;
  };
  chunk?: {
    index: number;
    start: number;
    end: number;
    total: number;
  };
  hint?: {
    fileId?: string;
    pageHint?: number;
    lineHint?: number;
    cadHandleId?: string;
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

  /**
   * 解析 LLM 返回的审查结果（公开方法，供 ReviewService 调用）
   */
  static parseReviewResult(content: string): ReviewIssue[] {
    const validTypes = ['TYPO', 'VIOLATION', 'FORMAT', 'COMPLETENESS', 'CONSISTENCY', 'LAYOUT', 'NAMING', 'ENCODING', 'ATTRIBUTE', 'HEADER', 'PAGE', 'FLUENCY', 'CROSS_REFERENCE'];

    try {
      // 尝试从内容中提取 JSON 数组
      let jsonStr = content.trim();

      // 去掉 markdown 代码块标记
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // 清理 LLM 输出中的控制字符：只处理字符串值内部的，保留 JSON 结构空白
      jsonStr = (() => {
        let result = '';
        let inString = false;
        let escaped = false;
        for (let i = 0; i < jsonStr.length; i++) {
          const ch = jsonStr[i];
          if (escaped) { result += ch; escaped = false; continue; }
          if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
          if (ch === '"') { inString = !inString; result += ch; continue; }
          if (inString && ch.charCodeAt(0) < 0x20) {
            // 字符串内部的控制字符：\n \r \t 保留转义形式，其余替换为空格
            if (ch === '\n') result += '\\n';
            else if (ch === '\r') result += '\\r';
            else if (ch === '\t') result += '\\t';
            else result += ' ';
          } else {
            result += ch;
          }
        }
        return result;
      })();

      // 优先直接解析；失败则提取首个完整 JSON 数组
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // 找到第一个 [ 和最后一个 ]，提取中间内容作为候选 JSON 数组
        const firstBracket = jsonStr.indexOf('[');
        const lastBracket = jsonStr.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          const candidate = jsonStr.substring(firstBracket, lastBracket + 1);
          parsed = JSON.parse(candidate);
        } else {
          throw new Error('No JSON array found');
        }
      }

      if (Array.isArray(parsed)) {
        return parsed
          .filter((item: any) => {
            // 支持两种格式：标准审查(issueType) 和 合同审查(riskLevel)
            if ((!item.issueType && !item.riskLevel) || !item.originalText) return false;
            // 过滤 originalText 与 suggestedText 完全一致的无效条目
            if (item.suggestedText && String(item.originalText).trim() === String(item.suggestedText).trim()) return false;
            // 过滤 originalText 看起来像 JSON 的条目
            if (this.isLikelyJsonText(String(item.originalText))) return false;
            return true;
          })
          .map((item: any) => {
            // 合同审查格式：riskLevel → issueType 和 severity 映射
            const riskLevelToIssueType: Record<string, string> = {
              'HIGH': 'VIOLATION',
              'MEDIUM': 'COMPLETENESS',
              'LOW': 'CONSISTENCY',
            };
            const riskLevelToSeverity: Record<string, string> = {
              'HIGH': 'error',
              'MEDIUM': 'warning',
              'LOW': 'info',
            };
            const clauseTypeLabels: Record<string, string> = {
              'payment': '付款条款',
              'penalty': '违约条款',
              'warranty': '质保条款',
              'ip': '知识产权',
              'change': '变更条款',
              'claim': '索赔条款',
              'insurance': '保险条款',
              'dispute': '争议解决',
              'other': '其他',
            };

            const isContractReview = !!item.riskLevel;
            const issueType = item.issueType || riskLevelToIssueType[item.riskLevel] || 'VIOLATION';
            const severity = isContractReview ? (riskLevelToSeverity[item.riskLevel] || 'warning') : (item.severity || 'warning');

            // 合同审查：将条款类型和风险等级信息融入描述
            let description = item.description ? String(item.description) : undefined;
            if (isContractReview && description) {
              const clauseLabel = clauseTypeLabels[item.clauseType] || item.clauseType || '';
              const riskLabel = item.riskLevel === 'HIGH' ? '🔴 高风险' : item.riskLevel === 'MEDIUM' ? '🟡 中风险' : '🔵 低风险';
              description = `[${riskLabel}${clauseLabel ? ' · ' + clauseLabel : ''}] ${description}`;
            }

            return {
              issueType: validTypes.includes(issueType) ? issueType : 'VIOLATION',
              severity,
              originalText: String(item.originalText || ''),
              suggestedText: item.suggestedText ? String(item.suggestedText) : undefined,
              description,
              plainLanguage: item.plain_language ? String(item.plain_language) : (item.recommendation ? String(item.recommendation) : undefined),
              cadHandleId: item.cadHandleId ? String(item.cadHandleId) : undefined,
              ruleCode: item.ruleCode ? String(item.ruleCode) : undefined,
              standardRef: item.standardRef ? String(item.standardRef) : (item.clauseType ? clauseTypeLabels[item.clauseType] || item.clauseType : undefined),
              riskLevel: item.riskLevel || undefined,
              clauseType: item.clauseType || undefined,
            };
          });
      }

      // JSON 解析成功但不是数组
      console.warn('[LLM] 审查结果不是数组:', typeof parsed);
      return [];
    } catch (e) {
      // JSON 解析失败，尝试从 Markdown 文本中提取结构化问题
      const markdownIssues = this.parseMarkdownReviewResult(content);
      if (markdownIssues.length > 0) {
        // 后处理：过滤掉 originalText 看起来像 JSON 的条目（LLM 误将 JSON 片段当问题输出）
        return markdownIssues.filter(item => !this.isLikelyJsonText(item.originalText));
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
   * 从文本推断问题类型（精简为 4 种核心类型）
   */
  private static inferIssueType(text: string): string {
    const t = text.toLowerCase();
    // 文本错误：错别字、拼写、语句不通顺
    if (/错别字|错字|拼写|typo|笔误|语句不通|语病|fluency/.test(t)) return 'TYPO';
    // 一致性：不一致、不匹配、命名编码问题、交叉引用
    if (/一致|不匹配|不一致|不统一|命名|编码|名称|标识|交叉引用|cross.?reference/.test(t)) return 'CONSISTENCY';
    // 完整性：缺少、缺失、遗漏
    if (/完整|缺少|缺失|遗漏|未包含|空白|留空/.test(t)) return 'COMPLETENESS';
    // 其他所有问题归为合规违规（格式、规范、标准引用等）
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
   * 判断文本是否看起来像 JSON 片段（用于过滤 LLM 误输出的 JSON）
   */
  private static isLikelyJsonText(text: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    // 以 { 或 [ 开头且包含 : 或 , 的较长文本
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.includes(':') || trimmed.includes(','))) {
      return true;
    }
    // 包含 "issueType"、"originalText" 等 JSON 字段名
    if (/"(?:issueType|originalText|suggestedText|severity|riskLevel|description)"/.test(trimmed)) {
      return true;
    }
    return false;
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

    // 预计算每个段落在原文中的起始位置（避免 indexOf 在重复段落时出错）
    const paraOffsets: number[] = [];
    let offset = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      paraOffsets.push(offset);
      offset += paragraphs[i].length + 1; // +1 for '\n'
    }

    let currentChunk = '';
    let currentStartIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraStart = paraOffsets[i];

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
        }
        // 如果单个段落超过 maxChars，按句子再分割
        if (para.length > maxChars) {
          const sentences = para.split(/(?<=[。！？；，、])/);
          let sentenceChunk = '';
          let sentenceStartIndex = paraStart;

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
          currentStartIndex = paraStart;
        }
      } else {
        if (!currentChunk) {
          currentStartIndex = paraStart;
        }
        currentChunk += (currentChunk ? '\n' : '') + para;
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

  static normalizeForLocate(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .replace(/[，。！？；：、"'`‘’“”（）()\[\]【】《》<>.,;:!?\-_/\\|]/g, '');
  }

  static findBestTextRange(
    fullText: string,
    searchText: string,
  ): { start: number; end: number; confidence: 'exact' | 'trimmed' | 'normalized' } | null {
    if (!fullText || !searchText) return null;

    const exactIdx = fullText.indexOf(searchText);
    if (exactIdx !== -1) {
      return { start: exactIdx, end: exactIdx + searchText.length, confidence: 'exact' };
    }

    const trimmed = searchText.trim();
    if (trimmed) {
      const trimmedIdx = fullText.indexOf(trimmed);
      if (trimmedIdx !== -1) {
        return { start: trimmedIdx, end: trimmedIdx + trimmed.length, confidence: 'trimmed' };
      }
    }

    const needle = this.normalizeForLocate(trimmed || searchText);
    if (!needle) return null;

    const haystack = this.normalizeForLocate(fullText);
    const normalizedIdx = haystack.indexOf(needle);
    if (normalizedIdx === -1) return null;

    let cursor = 0;
    let rawStart = -1;
    let rawEnd = -1;
    for (let i = 0; i < fullText.length; i++) {
      const normalizedChar = this.normalizeForLocate(fullText[i]);
      if (!normalizedChar) continue;
      if (cursor === normalizedIdx) rawStart = i;
      cursor += normalizedChar.length;
      if (cursor >= normalizedIdx + needle.length) {
        rawEnd = i + 1;
        break;
      }
    }

    if (rawStart === -1 || rawEnd === -1 || rawEnd <= rawStart) return null;
    return { start: rawStart, end: rawEnd, confidence: 'normalized' };
  }

  static buildLocateMeta(
    fullText: string,
    searchText: string,
    opts?: {
      chunkIndex?: number;
      chunkStartIndex?: number;
      chunkEndIndex?: number;
      totalChunks?: number;
      cadHandleId?: string;
      pageHint?: number;
      lineHint?: number;
      fileId?: string;
    },
  ): LocateMeta | null {
    const range = this.findBestTextRange(fullText, searchText);
    if (!range && !opts?.cadHandleId) return null;

    if (opts?.cadHandleId) {
      return {
        version: 2,
        mode: 'dwg',
        confidence: 'fallback',
        hint: {
          cadHandleId: opts.cadHandleId,
          fileId: opts.fileId,
          pageHint: opts.pageHint,
          lineHint: opts.lineHint,
        },
      };
    }

    const start = range!.start;
    const end = range!.end;
    return {
      version: 2,
      mode: 'text',
      confidence: range!.confidence,
      absolute: { start, end },
      quote: {
        text: fullText.slice(start, end),
        normalizedText: this.normalizeForLocate(fullText.slice(start, end)),
      },
      context: {
        prefix: fullText.slice(Math.max(0, start - 30), start),
        suffix: fullText.slice(end, Math.min(fullText.length, end + 30)),
      },
      chunk: typeof opts?.chunkIndex === 'number'
        ? {
            index: opts.chunkIndex,
            start: opts.chunkStartIndex ?? 0,
            end: opts.chunkEndIndex ?? (opts.chunkStartIndex ?? 0),
            total: opts.totalChunks ?? 1,
          }
        : undefined,
      hint: {
        fileId: opts?.fileId,
        pageHint: opts?.pageHint,
        lineHint: opts?.lineHint,
        cadHandleId: opts?.cadHandleId,
      },
    };
  }

  /**
   * 查找文本在原始文本中的位置
   * @param originalText 原始完整文本
   * @param searchText 要查找的文本
   * @returns 位置信息
   */
  static findTextPosition(originalText: string, searchText: string): { chunkIndex: number; charOffset: number; totalChunks: number } | null {
    const range = this.findBestTextRange(originalText, searchText);
    if (!range) return null;

    const config = this.getEffectiveChunkSize();
    const chunkSize = config || 4000;
    const chunkIndex = Math.floor(range.start / chunkSize);
    const totalChunks = Math.ceil(originalText.length / chunkSize);

    return { chunkIndex, charOffset: range.start, totalChunks };
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
      temperature?: number;
      standardContext?: string;
      systemPrompt?: string;
      skipUserTemplate?: boolean;
      /** 文档ID，用于构建缓存键 */
      documentId?: string;
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

    // 系统提示词：优先使用调用方传入的（场景化），否则从 library_review 场景按上下文情况加载
    let systemPrompt: string;
    if (options?.systemPrompt) {
      systemPrompt = options.systemPrompt;
    } else {
      try {
        systemPrompt = await PromptLoader.loadSystemPrompt('library_review', {
          hasContext: !!options?.standardContext,
        });
      } catch (e) {
        systemPrompt = '你是文件合规审查专家。请检查文本中的合规性问题，严格按照 JSON 数组格式输出审查结果。';
      }
    }

    const maxTokens = options?.maxTokens ?? config.maxTokens;
    const timeoutMs = (options?.timeout ?? config.timeout) * 1000;
    const temperature = options?.temperature ?? config.temperature;

    // 如果 skipUserTemplate 为 true，直接使用传入的 text 作为 userContent（调用方已自行组装）
    let userContent: string;
    if (options?.skipUserTemplate) {
      userContent = text;
    } else if (options?.standardContext) {
      const tpl = await PromptTemplateService.getPromptByScene(
        'library_review', 'user', 'with_context',
        `【知识库检索到的相关标准规范】\n${options.standardContext}\n\n【待审查文本】\n${text}\n\n请根据以上标准规范检查"待审查文本"中的合规性问题。严格按照 JSON 数组格式输出审查结果。`
      );
      userContent = tpl
        .replace(/\$\{ragContext\}/g, options.standardContext)
        .replace(/\$\{standardContext\}/g, options.standardContext)
        .replace(/\$\{text\}/g, text);
    } else {
      const tpl = await PromptTemplateService.getPromptByScene(
        'library_review', 'user', 'no_context',
        `【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。`
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
      temperature,
    };

    // ★ LLM 响应缓存：基于文档ID+chunkIndex，避免相同文档片段重复调用 API
    const chunkIdx = options?.positionInfo?.chunkIndex ?? 0;
    const docId = options?.documentId || 'unknown';
    const llmCacheKey = CacheService.generateKey('llm:review', docId, String(chunkIdx), config.modelName, String(temperature));
    const LLM_CACHE_TTL = 24 * 3600; // 24 小时
    const cachedContent = CacheService.get<string>(llmCacheKey);
    if (cachedContent !== null) {
      console.log(`[LLM] reviewText 缓存命中 (${cachedContent.length}字)`);
      const issues = this.parseReviewResult(cachedContent);
      if (options?.positionInfo && issues.length > 0) {
        const { chunkIndex, chunkStartIndex, totalChunks } = options.positionInfo;
        return issues.map(issue => {
          const offsetInChunk = text.indexOf(issue.originalText);
          const absoluteStart = offsetInChunk >= 0 ? chunkStartIndex + offsetInChunk : chunkStartIndex;
          const absoluteEnd = offsetInChunk >= 0 ? absoluteStart + issue.originalText.length : Math.min(chunkStartIndex + text.length, absoluteStart + 40);
          return {
            ...issue,
            textPosition: { chunkIndex, charOffset: absoluteStart, totalChunks },
            locateMeta: {
              version: 2, mode: 'text',
              confidence: offsetInChunk >= 0 ? 'exact' : 'fallback',
              absolute: { start: absoluteStart, end: absoluteEnd },
              quote: { text: issue.originalText || text.slice(Math.max(0, absoluteStart - chunkStartIndex), Math.max(0, absoluteEnd - chunkStartIndex)), normalizedText: this.normalizeForLocate(issue.originalText || text.slice(Math.max(0, absoluteStart - chunkStartIndex), Math.max(0, absoluteEnd - chunkStartIndex))) },
              context: { prefix: text.slice(Math.max(0, absoluteStart - chunkStartIndex - 30), Math.max(0, absoluteStart - chunkStartIndex)), suffix: text.slice(Math.max(0, absoluteEnd - chunkStartIndex), Math.min(text.length, absoluteEnd - chunkStartIndex + 30)) },
              chunk: { index: chunkIndex, start: chunkStartIndex, end: chunkStartIndex + text.length, total: totalChunks },
            },
          };
        });
      }
      return issues;
    }

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

      // ★ 缓存 LLM 原始响应（不含位置信息，位置信息每次实时计算）
      CacheService.set(llmCacheKey, content, LLM_CACHE_TTL);
      console.log(`[LLM] reviewText 已缓存响应 (${content.length}字)`);

      const issues = this.parseReviewResult(content);

      // 为每个 issue 添加位置信息
      if (options?.positionInfo && issues.length > 0) {
        const { chunkIndex, chunkStartIndex, totalChunks } = options.positionInfo;
        return issues.map(issue => {
          // 计算 originalText 在当前 chunk 中的位置
          const offsetInChunk = text.indexOf(issue.originalText);
          const absoluteStart = offsetInChunk >= 0 ? chunkStartIndex + offsetInChunk : chunkStartIndex;
          const absoluteEnd = offsetInChunk >= 0 ? absoluteStart + issue.originalText.length : Math.min(chunkStartIndex + text.length, absoluteStart + 40);

          return {
            ...issue,
            textPosition: {
              chunkIndex,
              charOffset: absoluteStart,
              totalChunks,
            },
            locateMeta: {
              version: 2,
              mode: 'text',
              confidence: offsetInChunk >= 0 ? 'exact' : 'fallback',
              absolute: { start: absoluteStart, end: absoluteEnd },
              quote: {
                text: issue.originalText || text.slice(Math.max(0, absoluteStart - chunkStartIndex), Math.max(0, absoluteEnd - chunkStartIndex)),
                normalizedText: this.normalizeForLocate(issue.originalText || text.slice(Math.max(0, absoluteStart - chunkStartIndex), Math.max(0, absoluteEnd - chunkStartIndex))),
              },
              context: {
                prefix: text.slice(Math.max(0, absoluteStart - chunkStartIndex - 30), Math.max(0, absoluteStart - chunkStartIndex)),
                suffix: text.slice(Math.max(0, absoluteEnd - chunkStartIndex), Math.min(text.length, absoluteEnd - chunkStartIndex + 30)),
              },
              chunk: {
                index: chunkIndex,
                start: chunkStartIndex,
                end: chunkStartIndex + text.length,
                total: totalChunks,
              },
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
   * 从数据库获取 LLM 配置（带缓存）
   */
  private static _llmConfigCache: { config: any; timestamp: number } | null = null;
  private static readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  static async getLlmConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
  } | null> {
    // 检查缓存
    if (this._llmConfigCache && Date.now() - this._llmConfigCache.timestamp < this.CONFIG_CACHE_TTL) {
      return this._llmConfigCache.config;
    }

    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'llm_chat_model' },
      });
      let result = null;
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          result = {
            apiBaseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
            apiKey: v.apiKey,
            modelName: v.modelName,
            maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : 8192,
            temperature: typeof v.temperature === 'number' ? v.temperature : 0.3,
            timeout: typeof v.timeout === 'number' ? v.timeout : 120,
          };
        }
      }
      this._llmConfigCache = { config: result, timestamp: Date.now() };
      return result;
    } catch (e) {
      console.warn('[LLM] 获取 LLM 配置失败:', e);
    }
    return null;
  }

  /**
   * 查询优化 — 用 LLM 重写/扩展用户查询，提升知识库检索质量
   * 适用于查询过短、模糊、或缺少领域术语的场景
   */
  static async rewriteQuery(query: string, options?: { maxTokens?: number; timeout?: number }): Promise<string> {
    const config = await this.getLlmConfig();
    if (!config) return query; // 未配置 LLM 时直接返回原始查询

    const maxTokens = options?.maxTokens ?? config.maxTokens;
    const timeoutMs = (options?.timeout ?? config.timeout) * 1000;

    const body = {
      model: config.modelName,
      messages: [
        {
          role: 'system',
          content: `你是核电工程文件检索查询优化专家。根据用户的查询意图，生成1-3个优化后的检索查询，用换行分隔。

规则：
- 保持原始查询的核心意图
- 补充核电工程领域的专业术语（如规格书、技术条件、施工方案等）
- 如果查询已经足够明确，直接返回原文即可
- 不要添加查询中没有的概念
- 只输出优化后的查询，不要解释`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature: config.temperature,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return query;

      const data = await response.json() as any;
      const content = (data.choices?.[0]?.message?.content || '').trim();
      if (!content) return query;

      // 取第一行作为优化查询（LLM可能返回多行）
      const rewritten = content.split('\n').filter((l: string) => l.trim())[0] || query;
      return rewritten;
    } catch (err: any) {
      console.warn(`[LLM] 查询优化失败，使用原始查询: ${err.message}`);
      return query;
    }
  }

  /**
   * 通用聊天接口 - 用于 AI 正则表达式生成等场景
   */
  static async chat(prompt: string, options?: { systemPrompt?: string; maxTokens?: number; timeout?: number; temperature?: number }): Promise<string> {
    const config = await this.getLlmConfig();
    if (!config) {
      throw new Error('LLM 未配置，请在系统配置中设置 LLM API');
    }

    const systemPrompt = options?.systemPrompt || '你是一个正则表达式专家，擅长根据用户需求生成准确的正则表达式。请只输出正则表达式，不要输出其他解释文字。';
    const maxTokens = options?.maxTokens ?? config.maxTokens;
    const timeoutMs = (options?.timeout ?? config.timeout) * 1000;
    const temperature = options?.temperature ?? config.temperature;

    const body = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature,
    };

    // ★ LLM chat 响应缓存
    const chatCacheKey = CacheService.generateKey('llm:chat', config.modelName, String(temperature), systemPrompt, prompt);
    const CHAT_CACHE_TTL = 24 * 3600;
    const cachedChat = CacheService.get<string>(chatCacheKey);
    if (cachedChat !== null) {
      console.log(`[LLM] chat 缓存命中 (${cachedChat.length}字)`);
      return cachedChat;
    }

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
      const result = data.choices?.[0]?.message?.content || '';

      // ★ 缓存 chat 响应
      CacheService.set(chatCacheKey, result, CHAT_CACHE_TTL);

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 为文本段落自动生成问题
   * 返回 JSON 数组格式：["问题1", "问题2", ...]
   */
  static async generateQuestions(content: string, options?: { maxTokens?: number; timeout?: number }): Promise<string[]> {
    const truncated = content.substring(0, 1500);
    const prompt = `请根据以下文本内容，生成3-5个高质量的中文问答问题。问题应该覆盖文本的核心知识点，适合用于知识库检索训练。

要求：
1. 问题要具体、明确，不要过于宽泛
2. 问题应能从给定文本中找到明确答案
3. 覆盖不同层面：定义、规则、数据、适用范围等
4. 每个问题独占一行，以问号结尾
5. 只输出问题，不要输出答案或其他文字

文本内容：
${truncated}`;

    const result = await this.chat(prompt, {
      systemPrompt: '你是核电工程文档分析专家，擅长从技术文档中提取关键知识点并生成高质量的检索问题。',
      maxTokens: options?.maxTokens || 512,
      timeout: options?.timeout || 30,
    });

    // 解析问题列表
    const questions = result
      .split('\n')
      .map(line => line.replace(/^\d+[\.\)、]\s*/, '').trim())
      .filter(q => q.endsWith('？') || q.endsWith('?'))
      .slice(0, 5);

    return questions;
  }
}

