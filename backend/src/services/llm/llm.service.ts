/**
 * LLM 工具服务 — 提供文本分片、审查结果解析和直接 LLM 调用的公共方法
 *
 * 支持 MaxKB 作为优先 AI 引擎，不可用时降级到 LLM 直接调用
 * 本文件保留 ReviewIssue 类型定义和 splitText / parseReviewResult / reviewText 工具方法
 */

import prisma from '../../config/db';
import { Prisma } from '@prisma/client';
import { PromptTemplateService } from './prompt-template.service';
import { PromptLoader } from '../prompts';
import { CacheService } from '../system/cache.service';
import { get_encoding } from 'tiktoken';
import { validateSeverity } from '../review/severity-rules';
import * as crypto from 'crypto';
import { retryWithBackoff } from '../../utils/retry';
import { acquireLlmToken } from '../../utils/llm-rate-limiter';
import { scrubSensitive } from '../agent/security/scrub-sensitive';
import { RiskItemSchema } from '../review-pipeline/contract-review.schema';
import fs from 'fs';
import path from 'path';

/** 默认编码使用 cl100k_base（GPT-4 / GPT-3.5-turbo 使用的编码） */
const DEFAULT_ENCODING = 'cl100k_base';

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
  recommendation?: string; // 合同审查修改建议（独立字段，与 plainLanguage 区分）
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
  /** DOC_REVIEW（以文审文）模式：LLM 判定的匹配状态
   *  - matched: 原文符合规范（不作为问题展示）
   *  - mismatched: 原文不符合规范（默认值，兼容旧 LLM 输出）
   *  - missing: 原文中缺失应存在的要素
   */
  status?: 'matched' | 'mismatched' | 'missing';
  /** OPT-029: originalText 保真校验结果（exact/normalized/fuzzy/not_found）
   *  用于追踪 LLM 输出的 originalText 是否忠实于原文 */
  textFidelity?: 'exact' | 'normalized' | 'fuzzy' | 'not_found';
  /** DOC_REVIEW（以文审文）：问题来源的参照文件名（多参照文件场景下精确溯源） */
  refSource?: string;
  /** 审查置信度（智能判标维度）：HIGH / MEDIUM / LOW
   *  - HIGH: 问题明确、证据充分
   *  - MEDIUM: 问题存在但证据不够充分
   *  - LOW: 疑似误报 / 过度解读 —— 不丢弃，落库标记为待人工复核（PENDING_REVIEW） */
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  /** 判标理由（智能判标 LLM 输出） */
  confidenceReason?: string;
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
  overlapStart?: number; // overlap 部分的起始位置（非 overlap 内容仍从 startIndex 开始）
  /** OPT-018: 章节级上下文 */
  context?: {
    sectionTitle?: string;   // 当前 chunk 所属章节标题
    prevChunkTail?: string;  // 前一个 chunk 末尾 200 字符
  };
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
      } else {
        // 兼容「说明文字 + 代码块」混合场景：提取首个 ```json/``` 代码块内容
        // （借鉴 TextGuard parse_proofread_result 的 markdown 代码块兜底）
        const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch && fenceMatch[1].trim().startsWith('[')) {
          jsonStr = fenceMatch[1];
        }
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

      // 合同审查双字段合并解析：{ riskIssues, complianceIssues } → 合并为单数组并打标记
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          (parsed.riskIssues || parsed.complianceIssues)) {
        const riskArr = Array.isArray(parsed.riskIssues) ? parsed.riskIssues : [];
        const compArr = Array.isArray(parsed.complianceIssues) ? parsed.complianceIssues : [];
        const merged = [
          ...riskArr.map((it: any) => ({ ...it, _chainTag: 'CLS_RISK' })),
          ...compArr.map((it: any) => ({ ...it, _chainTag: 'CLS_COMPLIANCE' })),
        ].filter(it => it && (it.issueType || it.riskLevel) && it.originalText);
        // 复用数组解析逻辑（传入已合并数组）
        parsed = merged;
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
            // P2-C: 合同审查 item 走 zod 校验（safeParse 失败仅告警不丢弃，降级保留原 item）
            if (isContractReview) {
              const zodResult = RiskItemSchema.safeParse({
                clauseNo: item.clauseNo || '',
                clauseTitle: item.clauseTitle,
                riskType: item.riskType || 'other',
                riskLevel: item.riskLevel,
                riskDescription: item.description || item.riskDescription || '',
                suggestion: item.recommendation || item.suggestion || '',
                legalBasis: item.standardRef,
                originalText: item.originalText,
              });
              if (!zodResult.success) {
                console.warn('[LLM] 合同审查 item zod 校验失败:', zodResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
                // 校验失败但保留 item（降级处理，不丢弃）
              }
              // P2-12: LLM 判定法条存疑时，给法条引用加"仅供参考"后缀，避免以权威口吻呈现
              if (item.legalBasisUncertain === true && item.standardRef) {
                item.standardRef = `${item.standardRef}（仅供参考，需人工复核）`;
              }
            }
            const issueType = item.issueType || riskLevelToIssueType[item.riskLevel] || 'VIOLATION';
            const finalIssueType = validTypes.includes(issueType) ? issueType : 'VIOLATION';
            // OPT-022: severity 合理性校验，防止 LLM 将 info 级问题标为 error
            const rawSeverity = isContractReview ? (riskLevelToSeverity[item.riskLevel] || 'warning') : item.severity;
            const severity = validateSeverity(finalIssueType, rawSeverity);

            // 合同审查：将条款类型和风险等级信息融入描述
            let description = item.description ? String(item.description) : undefined;
            if (isContractReview && description) {
              const clauseLabel = clauseTypeLabels[item.clauseType] || item.clauseType || '';
              const riskLabel = item.riskLevel === 'HIGH' ? '🔴 高风险' : item.riskLevel === 'MEDIUM' ? '🟡 中风险' : '🔵 低风险';
              description = `[${riskLabel}${clauseLabel ? ' · ' + clauseLabel : ''}] ${description}`;
            }

            // ruleCode：优先用 LLM 返回值；否则用双链合并标记（CLS_RISK/CLS_COMPLIANCE）
            const ruleCode = item.ruleCode ? String(item.ruleCode)
              : item._chainTag ? String(item._chainTag)
              : undefined;

            // DOC_REVIEW: 解析 status 字段（matched/mismatched/missing）
            // 旧 LLM 输出无 status 时默认 mismatched（向后兼容，传统输出都是问题）
            const validStatuses = ['matched', 'mismatched', 'missing'];
            const status: 'matched' | 'mismatched' | 'missing' =
              item.status && validStatuses.includes(String(item.status))
                ? String(item.status) as 'matched' | 'mismatched' | 'missing'
                : 'mismatched';

            return {
              issueType: finalIssueType,
              severity,
              status,
              originalText: String(item.originalText || ''),
              suggestedText: item.suggestedText ? String(item.suggestedText) : undefined,
              description,
              plainLanguage: item.plain_language ? String(item.plain_language) : undefined,
              recommendation: item.recommendation ? String(item.recommendation) : undefined,
              cadHandleId: item.cadHandleId ? String(item.cadHandleId) : undefined,
              ruleCode,
              standardRef: item.standardRef ? String(item.standardRef) : (item.clauseType ? clauseTypeLabels[item.clauseType] || item.clauseType : undefined),
              riskLevel: item.riskLevel || undefined,
              clauseType: item.clauseType || undefined,
              refSource: item.refSource ? String(item.refSource) : undefined,
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
   * OPT-029: 对 LLM 输出的 originalText 做保真校验
   *
   * LLM 输出的 originalText 可能改写原文（同义替换/省略/合并），导致前端高亮定位失败。
   * 本方法在 reviewText 返回前调用 TextFidelityService.validateOriginalText 做校验：
   * - exact/normalized: 保留原 originalText
   * - fuzzy: 用 correctedText 覆盖 originalText（取最接近的原文片段）
   * - not_found: 保留原 originalText（无法定位，交前端兜底）
   * 同时在 issue 上加 textFidelity 字段记录校验结果（exact/normalized/fuzzy/not_found）。
   *
   * 失败时不阻塞主流程，返回原 issue 数组。
   *
   * @param issues LLM 解析出的问题列表
   * @param sourceText 当前 chunk 的待审文本（reviewText 第一个参数 text）
   */
  private static applyTextFidelity(issues: ReviewIssue[], sourceText: string): ReviewIssue[] {
    if (!issues || issues.length === 0 || !sourceText) return issues;
    try {
      // 动态 require 避免循环依赖（text-fidelity.service 位于 knowledge 目录）
      const { validateOriginalText } = require('../knowledge/text-fidelity.service');
      return issues.map(issue => {
        if (!issue.originalText) return issue;
        try {
          const result = validateOriginalText(issue.originalText, sourceText);
          // 记录保真等级
          issue.textFidelity = result.confidence;
          // fuzzy / not_found 时若拿到 correctedText，用 correctedText 覆盖 originalText
          if ((result.confidence === 'fuzzy' || result.confidence === 'not_found')
              && result.correctedText) {
            issue.originalText = result.correctedText;
          }
          return issue;
        } catch (e) {
          console.warn('[LLM] originalText 保真校验单条失败:', (e as Error).message);
          return issue;
        }
      });
    } catch (e) {
      console.warn('[LLM] originalText 保真校验整体失败:', (e as Error).message);
      return issues;
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
  static splitText(text: string, maxChars: number, includePosition: true, overlapChars?: number): TextChunk[];
  static splitText(text: string, maxChars: number, includePosition?: false, overlapChars?: number): string[];
  static splitText(text: string, maxChars: number, includePosition?: boolean, overlapChars?: number): string[] | TextChunk[] {
    const overlap = overlapChars ?? 300;
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
          // P0-3: 记录当前 chunk 末尾 overlap 字符作为下一个 chunk 的前缀
          const nextOverlap = overlap > 0 && trimmed.length > overlap
            ? trimmed.slice(-overlap)
            : '';
          currentChunk = nextOverlap;
          if (nextOverlap) {
            // overlap 前缀不计入 startIndex（非 overlap 内容仍从新的段落开始）
            currentStartIndex = -1; // 标记后续需要重新设置
          } else {
            currentChunk = '';
          }
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
                // P0-3: 保留当前 chunk 末尾 overlap 字符作为下一个 chunk 的前缀
                const nextOverlap = overlap > 0 && trimmed.length > overlap
                  ? trimmed.slice(-overlap)
                  : '';
                sentenceChunk = nextOverlap ? nextOverlap + sentence : sentence;
                sentenceStartIndex = paraStart;
              } else {
                sentenceChunk = sentence;
                sentenceStartIndex = paraStart;
              }
            } else {
              sentenceChunk += sentence;
            }
          }
          if (sentenceChunk) {
            // 如果有之前保存的 overlap 前缀，先拼接
            if (currentChunk && currentChunk.length > 0 && sentenceChunk !== currentChunk) {
              // 如果 currentChunk 已经是 overlap，直接将句子追加
              currentChunk = sentenceChunk;
            } else {
              currentChunk = sentenceChunk;
            }
            if (currentStartIndex < 0) {
              currentStartIndex = paraStart;
            }
          }
        } else {
          if (!currentChunk) {
            currentChunk = para;
            currentStartIndex = paraStart;
          } else {
            // currentChunk 已包含 overlap 前缀
            currentChunk += '\n' + para;
            if (currentStartIndex < 0) {
              currentStartIndex = paraStart;
            }
          }
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

  /**
   * OPT-018: 为分片注入章节级上下文（章节标题 + 前 chunk 末尾摘要）
   * 在 splitText 产出 chunks 后调用，不修改 splitText 内部逻辑
   */
  static enrichChunksWithContext(chunks: TextChunk[], fullText?: string): TextChunk[] {
    if (chunks.length === 0) return chunks;

    // 章节标题检测模式
    const SECTION_PATTERNS = [
      /^#{1,4}\s+(.+)/,                    // Markdown: # 标题
      /^(第[一二三四五六七八九十百千\d]+[章节篇部])\s*(.*)/,  // 第X章/节/篇
      /^(\d+(?:\.\d+){0,3})\s+(.+)/,       // 数字编号: 1.1 标题 / 4.2.1 标题
      /^([一二三四五六七八九十]+[、.])\s*(.+)/, // 中文编号: 一、标题
      /^([\(（][一二三四五六七八九十\d]+[\)）])\s*(.+)/, // (一) 标题
    ];

    // 从 fullText 或 chunks 中检测章节标题
    const sourceText = fullText || chunks.map(c => c.text).join('\n');
    const lines = sourceText.split('\n');

    // 建立位置→章节标题映射
    const sectionMarkers: Array<{ pos: number; title: string }> = [];
    let charPos = 0;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0 && trimmedLine.length <= 80) {
        for (const pattern of SECTION_PATTERNS) {
          const match = trimmedLine.match(pattern);
          if (match) {
            const title = trimmedLine.slice(0, 60); // 截断过长标题
            sectionMarkers.push({ pos: charPos, title });
            break;
          }
        }
      }
      charPos += line.length + 1;
    }

    // 为每个 chunk 分配章节标题和 prevChunkTail
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 找到当前 chunk 所属的章节（最后一个 pos <= chunk.startIndex 的 marker）
      let sectionTitle: string | undefined;
      for (let j = sectionMarkers.length - 1; j >= 0; j--) {
        if (sectionMarkers[j].pos <= chunk.startIndex) {
          sectionTitle = sectionMarkers[j].title;
          break;
        }
      }

      // 前一个 chunk 末尾 200 字符
      const prevChunkTail = i > 0
        ? chunks[i - 1].text.slice(-200)
        : undefined;

      chunk.context = {
        sectionTitle,
        prevChunkTail,
      };
    }

    return chunks;
  }

  /**
   * 章节边界检测：从文本中识别章节标题位置，返回按位置排序的章节标记列表。
   * 供 enrichChunksWithContext 和参照块章节切分（DOC_REVIEW）共用。
   *
   * 识别模式（与 enrichChunksWithContext 保持一致）：
   *   - Markdown: # 标题
   *   - 第X章/节/篇/部
   *   - 数字编号: 1.1 标题 / 4.2.1 标题
   *   - 中文编号: 一、标题
   *   - (一) 标题
   *
   * @param text 源文本
   * @returns 按 pos 升序排列的章节标记数组
   */
  static detectSectionBoundaries(text: string): Array<{ pos: number; title: string }> {
    if (!text || text.length === 0) return [];

    const SECTION_PATTERNS = [
      /^#{1,4}\s+(.+)/,                                 // Markdown: # 标题
      /^(第[一二三四五六七八九十百千\d]+[章节篇部])\s*(.*)/, // 第X章/节/篇
      /^(\d+(?:\.\d+){0,3})\s+(.+)/,                    // 数字编号: 1.1 标题 / 4.2.1 标题
      /^([一二三四五六七八九十]+[、.])\s*(.+)/,           // 中文编号: 一、标题
      /^([\(（][一二三四五六七八九十\d]+[\)）])\s*(.+)/,   // (一) 标题
    ];

    const lines = text.split('\n');
    const markers: Array<{ pos: number; title: string }> = [];
    let charPos = 0;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0 && trimmedLine.length <= 80) {
        for (const pattern of SECTION_PATTERNS) {
          const match = trimmedLine.match(pattern);
          if (match) {
            const title = trimmedLine.slice(0, 60); // 截断过长标题
            markers.push({ pos: charPos, title });
            break;
          }
        }
      }
      charPos += line.length + 1;
    }
    return markers;
  }

  /**
   * 按章节边界切分文本（用于 DOC_REVIEW 参照文件分块）。
   * - 按章节标题切分，单章节超过 maxChunkChars 时再按句号切分
   * - 返回的块结构包含 sectionTitle 元数据，用于后续 prompt 注入
   *
   * @param text 源文本
   * @param maxChunkChars 单块最大字符数（默认 1500），超出按句号二次切分
   * @returns 块数组，每块含 { content, sectionTitle, startPos }
   */
  static splitBySectionBoundaries(
    text: string,
    maxChunkChars: number = 1500,
  ): Array<{ content: string; sectionTitle?: string; startPos: number }> {
    if (!text || text.trim().length === 0) return [];

    const markers = this.detectSectionBoundaries(text);
    const chunks: Array<{ content: string; sectionTitle?: string; startPos: number }> = [];

    // 无章节标记时，退化到按句号 + 长度切分
    if (markers.length === 0) {
      const sentences = text.split(/(?<=[。！？\n])/);
      let current = '';
      let startPos = 0;
      for (const s of sentences) {
        if (current.length + s.length > maxChunkChars && current.length > 0) {
          chunks.push({ content: current, startPos });
          startPos += current.length;
          current = s;
        } else {
          current += s;
        }
      }
      if (current.trim().length > 0) {
        chunks.push({ content: current, startPos });
      }
      return chunks.filter(c => c.content.trim().length >= 50);
    }

    // 有章节标记：按章节切分
    // 在末尾追加一个虚拟结束标记，便于处理最后一个章节
    const boundaries = [...markers, { pos: text.length, title: '__END__' }];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startMarker = boundaries[i];
      const endPos = boundaries[i + 1].pos;
      const sectionText = text.substring(startMarker.pos, endPos);
      const sectionTitle = startMarker.title;

      // 单章节内若超过 maxChunkChars，按句号二次切分
      if (sectionText.length > maxChunkChars) {
        const sentences = sectionText.split(/(?<=[。！？\n])/);
        let current = '';
        let chunkStart = startMarker.pos;
        for (const s of sentences) {
          if (current.length + s.length > maxChunkChars && current.length > 0) {
            chunks.push({ content: current, sectionTitle, startPos: chunkStart });
            chunkStart += current.length;
            current = s;
          } else {
            current += s;
          }
        }
        if (current.trim().length > 0) {
          chunks.push({ content: current, sectionTitle, startPos: chunkStart });
        }
      } else if (sectionText.trim().length >= 50) {
        chunks.push({ content: sectionText, sectionTitle, startPos: startMarker.pos });
      }
    }

    return chunks.filter(c => c.content.trim().length >= 50);
  }

  /**
   * OPT-018: 构建 chunk 的上下文前缀（注入到 prompt 中）
   */
  static buildChunkContextPrefix(chunk: TextChunk): string {
    if (!chunk.context) return '';
    const parts: string[] = [];
    if (chunk.context.sectionTitle) {
      parts.push(`当前章节：${chunk.context.sectionTitle}`);
    }
    if (chunk.context.prevChunkTail) {
      parts.push(`前文摘要：...${chunk.context.prevChunkTail}`);
    }
    if (parts.length === 0) return '';
    return `[文档上下文]\n${parts.join('\n')}\n[/文档上下文]\n\n`;
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

  /**
   * 精确计算文本的 token 数量
   * 使用 tiktoken cl100k_base 编码（与 GPT-4 / GPT-3.5-turbo 一致）
   */
  static countTokens(text: string): number {
    try {
      const enc = get_encoding(DEFAULT_ENCODING);
      const tokens = enc.encode(text);
      enc.free();
      return tokens.length;
    } catch {
      // 降级到字符估算（中英文混合近似值）
      return Math.ceil(text.length / 2);
    }
  }

  /**
   * 按 token 数精确分割文本（基于段落保持完整）
   * 比 splitText 的字符级分割更精确，适合需要精确控制 token 消耗的场景
   */
  static splitTextByTokens(text: string, maxTokens: number = 2000, overlapChars?: number): string[] {
    if (!text) return [];
    const totalTokens = this.countTokens(text);
    if (totalTokens <= maxTokens) return [text];
    const overlap = overlapChars ?? 300;

    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      const paraTokens = this.countTokens(para);
      const chunkTokens = currentChunk ? this.countTokens(currentChunk) : 0;

      if (paraTokens > maxTokens) {
        // 超长段落：按句号分割
        if (currentChunk) {
          chunks.push(currentChunk);
          // P0-3: 保留 overlap 前缀
          currentChunk = overlap > 0 && currentChunk.length > overlap
            ? currentChunk.slice(-overlap)
            : '';
        } else {
          currentChunk = '';
        }
        const sentences = para.split(/(?<=[。！？.!?])/);
        let sentenceBuf = currentChunk; // 可能包含 overlap 前缀
        for (const sent of sentences) {
          const bufTokens = sentenceBuf ? this.countTokens(sentenceBuf) : 0;
          const sentTokens = this.countTokens(sent);
          if (bufTokens + sentTokens > maxTokens) {
            if (sentenceBuf) {
              chunks.push(sentenceBuf);
              // P0-3: 保留 overlap 前缀
              const nextOverlap = overlap > 0 && sentenceBuf.length > overlap
                ? sentenceBuf.slice(-overlap)
                : '';
              sentenceBuf = nextOverlap ? nextOverlap + sent : sent;
            } else {
              // 单句就超长：强制截断
              chunks.push(sent);
              sentenceBuf = '';
            }
          } else {
            sentenceBuf += sent;
          }
        }
        if (sentenceBuf) chunks.push(sentenceBuf);
      } else if (chunkTokens + paraTokens > maxTokens) {
        chunks.push(currentChunk);
        // P0-3: 保留 overlap 前缀
        currentChunk = overlap > 0 && currentChunk.length > overlap
          ? currentChunk.slice(-overlap) + '\n\n' + para
          : para;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
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
      /** 可观测性：任务ID（用于 LlmCallLog 关联任务） */
      taskId?: string;
      /** 可观测性：审查模式 */
      mode?: string;
      /** 可观测性：RAG 检索片段（留存到 LlmCallLog 供推理回放展示） */
      ragChunks?: any;
      /** Task 14: 全链路追踪 ID（关联同一次任务处理的多次 LLM 调用） */
      traceId?: string;
    }
  ): Promise<ReviewIssue[]> {
    // 可观测性埋点（P2）：记录本次 LLM 调用的耗时/Token/状态
    const _callStart = Date.now();
    let _callError: string | null = null;
    let _usage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheRead: number; cacheWrite: number } = {
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
    };

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

    // 自动探测的模型上限优先：推理模型抬升下限、所有模型钳住真实 maxOutput
    const maxTokens = this.resolveMaxTokens(options?.maxTokens, config);
    const timeoutMs = (options?.timeout ?? config.timeout) * 1000;
    // OPT-026: 审查场景默认 temperature=0，最大化可复现性（调用方仍可显式覆盖）
    const temperature = options?.temperature ?? 0;

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

    // 阶段 3：构建 promptFull 用于推理回放（system + user 全文，截断保护 60KB）
    const promptFull = this.truncateForLog(`[system]\n${systemPrompt}\n\n[user]\n${userContent}`);

    const body = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature,
      seed: 42, // OPT-026: 固定 seed 提升可复现性（OpenAI 兼容 API 支持）
    };

    // ★ LLM 响应缓存：基于文档ID+chunkIndex+文本hash，避免相同文档片段重复调用 API
    // P0-J: 加入文本 hash，防止文档修改后同 docId+chunkIndex 命中旧缓存
    const chunkIdx = options?.positionInfo?.chunkIndex ?? 0;
    const docId = options?.documentId || 'unknown';
    const textHash = crypto.createHash('md5').update(text).digest('hex').slice(0, 8);
    const llmCacheKey = CacheService.generateKey('llm:review', docId, String(chunkIdx), textHash, config.modelName, String(temperature));
    const LLM_CACHE_TTL = 24 * 3600; // 24 小时
    const cachedContent = await CacheService.get<string>(llmCacheKey);
    if (cachedContent !== null) {
      console.log(`[LLM] reviewText 缓存命中 (${cachedContent.length}字)`);
      LlmService.recordLlmCall({
        taskId: options?.taskId, mode: options?.mode, traceId: options?.traceId, model: config.modelName,
        provider: config.provider, latencyMs: Date.now() - _callStart, status: 'cache',
        promptFull,
        completionFull: this.truncateForLog(cachedContent),
        ragChunks: options?.ragChunks,
      });
      // OPT-029: 对 LLM 输出的 originalText 做保真校验，提升前端高亮定位成功率
      const issues = this.applyTextFidelity(this.parseReviewResult(cachedContent), text);
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

    // 限流：按 model 分桶获取令牌，避免高并发打爆 LLM API
    await acquireLlmToken(config.modelName);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 推理模型（如 minimax-m3）可能把 token 预算全耗在思考（reasoning_content）上，
      // 导致 content 为空且 finish_reason=length；此时加倍 max_tokens 重试一次，避免审查空转
      let data: any;
      let content = '';
      let reasoningContent = '';
      // attempt 0: 原始请求；attempt 1-3: 429/5xx 指数退避重试（最多 3 次）
      for (let attempt = 0; attempt < 4; attempt++) {
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
          // 429/502/503：可重试错误，指数退避（1s/2s/4s），读取 Retry-After 响应头
          const isRetryable = response.status === 429 || response.status === 502 || response.status === 503;
          if (isRetryable && attempt < 3) {
            const retryAfter = response.headers.get('Retry-After');
            const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
            console.warn(`[LLM] HTTP ${response.status}，${delayMs}ms 后重试 (attempt ${attempt + 1}/3)`);
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          const errorText = await response.text();
          throw new Error(`LLM API 错误 (${response.status}): ${errorText.substring(0, 500)}`);
        }

        data = await response.json() as any;
        const message = data.choices?.[0]?.message || {};
        content = message.content || '';
        reasoningContent = message.reasoning_content || message.reasoning || '';
        const finishReason = data.choices?.[0]?.finish_reason || '';
        if (content || finishReason !== 'length' || attempt > 0) break;
        body.max_tokens = Math.min(maxTokens * 2, config.modelMaxOutput || 16384);
        console.warn(`[LLM] content 为空且 finish_reason=length（推理 token 预算耗尽），加倍 max_tokens=${body.max_tokens} 重试`);
      }

      // 解析 token 用量（可观测性 P2）
      if (data.usage) {
        _usage = {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          // 缓存统计：兼容 OpenAI prompt_tokens_details.cached_tokens / DeepSeek prompt_cache_hit_tokens
          cacheRead: data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.prompt_cache_hit_tokens ?? 0,
          cacheWrite: data.usage.prompt_tokens_details?.cache_creation ?? data.usage.prompt_cache_miss_tokens ?? 0,
        };
      }
      LlmService.recordLlmCall({
        taskId: options?.taskId, mode: options?.mode, traceId: options?.traceId, model: config.modelName,
        provider: config.provider, latencyMs: Date.now() - _callStart, status: 'success',
        usage: _usage,
        promptFull,
        // content 为空时兜底记录 reasoning_content，保证推理回放始终有内容可看
        completionFull: this.truncateForLog(
          content || (reasoningContent ? `[模型未输出正式回答，以下为 reasoning_content]\n${reasoningContent}` : '')
        ),
        ragChunks: options?.ragChunks,
      });

      // ★ 缓存 LLM 原始响应（不含位置信息，位置信息每次实时计算）；空 content 不缓存，避免 24h 内持续命中空结果
      if (content) {
        await CacheService.set(llmCacheKey, content, LLM_CACHE_TTL);
        console.log(`[LLM] reviewText 已缓存响应 (${content.length}字)`);
      }

      // OPT-029: 对 LLM 输出的 originalText 做保真校验，提升前端高亮定位成功率
      const issues = this.applyTextFidelity(this.parseReviewResult(content), text);

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
    } catch (e) {
      _callError = (e as Error).message;
      LlmService.recordLlmCall({
        taskId: options?.taskId, mode: options?.mode, traceId: options?.traceId, model: config.modelName,
        provider: config.provider, latencyMs: Date.now() - _callStart, status: 'failed',
        errorMsg: _callError,
        promptFull,
        ragChunks: options?.ragChunks,
      });
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 可观测性 P2：异步写入 LLM 调用日志（fire-and-forget，失败不影响主流程）
   *
   * 阶段 3：中间产物全留存 — promptFull/completionFull/ragChunks 记录 LLM 推理全过程，
   * 供前端推理回放抽屉展示。promptFull 超 60KB 截断（MySQL TEXT 64KB 限制留余量）。
   */
  private static recordLlmCall(params: {
    taskId?: string;
    mode?: string;
    model: string;
    provider?: string;
    latencyMs: number;
    status: 'success' | 'failed' | 'cache' | 'retry';
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cacheRead?: number; cacheWrite?: number };
    errorMsg?: string | null;
    promptFull?: string;
    completionFull?: string;
    ragChunks?: any;
    traceId?: string;
  }): void {
    try {
      // P0 #1（接通纸面能力）：写入前统一脱敏，避免敏感信息（路径/token/密钥/邮箱）落库
      prisma.llmCallLog.create({
        data: {
          taskId: params.taskId ?? null,
          mode: params.mode ?? null,
          model: params.model,
          provider: params.provider ?? 'openai-compat',
          promptTokens: params.usage?.promptTokens ?? 0,
          completionTokens: params.usage?.completionTokens ?? 0,
          totalTokens: params.usage?.totalTokens ?? 0,
          cacheReadTokens: params.usage?.cacheRead ?? 0,
          cacheWriteTokens: params.usage?.cacheWrite ?? 0,
          latencyMs: params.latencyMs,
          status: params.status,
          errorMsg: params.errorMsg ? scrubSensitive(params.errorMsg) : null,
          promptFull: params.promptFull ? scrubSensitive(params.promptFull) : null,
          completionFull: params.completionFull ? scrubSensitive(params.completionFull) : null,
          // 无检索片段时写 SQL NULL（DbNull）而非 JSON null，便于 SQL 层区分
          ragChunks: params.ragChunks ?? Prisma.DbNull,
          traceId: params.traceId ?? null,
        },
      }).catch(e => {
        console.warn('[LLM] 写入调用日志失败:', (e as Error).message);
        // Task 16: DB 写入失败时落盘到 fallback 文件，避免生产环境丢失推理回放数据
        LlmService.writeLlmCallFallback(params, e as Error);
      });
    } catch (e) {
      console.warn('[LLM] 写入调用日志异常:', (e as Error).message);
      // Task 16: 同步异常也落盘
      LlmService.writeLlmCallFallback(params, e as Error);
    }
  }

  /**
   * Task 16: LlmCallLog 写入失败时的 fallback 落盘机制
   *
   * 当 prisma.llmCallLog.create 失败（DB 不可用 / 字段超长 / 连接池耗尽等）时，
   * 将本次调用的关键信息以 JSON 行格式追加到 backend/logs/llm-call-failed.log，
   * 避免生产环境丢失推理回放数据。
   *
   * 设计权衡：
   * - 用 fs.appendFileSync 同步写入，保证 fire-and-forget 调用链中日志不丢
   * - 不做日志轮转（按 Task 要求），由运维定期清理
   * - 写入失败时只 console.warn，不再向上抛出
   */
  private static writeLlmCallFallback(params: {
    taskId?: string;
    mode?: string;
    model: string;
    provider?: string;
    status: string;
    errorMsg?: string | null;
    promptFull?: string;
    completionFull?: string;
    traceId?: string;
  }, error: Error): void {
    try {
      const logPath = path.join(__dirname, '../../logs/llm-call-failed.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        taskId: params.taskId ?? null,
        mode: params.mode ?? null,
        model: params.model,
        provider: params.provider ?? null,
        status: params.status,
        traceId: params.traceId ?? null,
        error: error.message,
        // 保留 prompt/completion 摘要用于推理回放，单条最长 60KB
        promptFull: params.promptFull?.slice(0, 60000) ?? null,
        completionFull: params.completionFull?.slice(0, 60000) ?? null,
        originalErrorMsg: params.errorMsg ?? null,
      });
      fs.appendFileSync(logPath, entry + '\n', 'utf8');
    } catch (writeErr) {
      // fallback 自身失败时只 warn，绝不影响主流程
      console.warn('[LLM] fallback 日志写入失败:', (writeErr as Error).message);
    }
  }

  /**
   * 截断超长文本用于 LlmCallLog 存储（MySQL TEXT 64KB 限制）
   */
  private static truncateForLog(text: string, maxLen: number = 60000): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + `\n...[截断，原始长度 ${text.length} 字符]`;
  }

  /**
   * 智能 endpoint 探测 — 当配置的 endpoint 不可用时，自动尝试备选列表
   * 一旦找到可用的 endpoint 就缓存到 _workingEndpointUrl
   */
  static async resolveEndpoint(failedUrl: string): Promise<string> {
    // 若已有缓存的可用 endpoint，优先使用
    if (this._workingEndpointUrl && this._workingEndpointUrl !== failedUrl) {
      return this._workingEndpointUrl;
    }

    for (const altUrl of this.ALTERNATIVE_BASE_URLS) {
      if (altUrl === failedUrl) continue;
      try {
        const probeRes = await fetch(`${altUrl}/models`, {
          signal: AbortSignal.timeout(5000),
        });
        if (probeRes.ok) {
          console.log(`[LLM] 发现可用 endpoint: ${altUrl}`);
          this._workingEndpointUrl = altUrl;
          return altUrl;
        }
      } catch {
        // 继续尝试下一个
      }
    }
    // 全部不可用 → 返回原地址，由调用方处理错误
    console.warn('[LLM] 所有备选 endpoint 均不可用');
    return failedUrl;
  }

  /**
   * 自动探测模型能力（上下文窗口/最大输出/是否推理模型）
   *
   * 从 /models 接口读取模型元数据，兼容多种网关字段：
   * - capabilities.contextWindow / maxOutput / reasoning（cbcn 内网网关）
   * - context_length（OpenRouter）、max_model_len（vLLM）
   * 探测失败返回 null，不影响主流程（降级为配置值）
   */
  private static _modelCapsCache = new Map<string, { caps: { contextWindow: number; maxOutput: number; reasoning: boolean } | null; timestamp: number }>();
  private static readonly CAPS_CACHE_TTL = 60 * 60 * 1000; // 1小时

  static async probeModelCapabilities(
    apiBaseUrl: string,
    apiKey: string,
    modelName: string,
  ): Promise<{ contextWindow: number; maxOutput: number; reasoning: boolean } | null> {
    const cacheKey = `${apiBaseUrl}::${modelName}`;
    const hit = this._modelCapsCache.get(cacheKey);
    if (hit && Date.now() - hit.timestamp < this.CAPS_CACHE_TTL) return hit.caps;

    let caps: { contextWindow: number; maxOutput: number; reasoning: boolean } | null = null;
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const list = Array.isArray(data?.data) ? data.data : [];
        const m = list.find((x: any) => x?.id === modelName);
        if (m) {
          const c = m.capabilities || {};
          const contextWindow = Number(c.contextWindow ?? m.context_length ?? m.max_model_len ?? 0) || 0;
          const maxOutput = Number(c.maxOutput ?? c.max_output_tokens ?? m.max_completion_tokens ?? 0) || 0;
          const reasoning = c.reasoning === true;
          if (contextWindow > 0 || maxOutput > 0) {
            caps = { contextWindow, maxOutput, reasoning };
            console.log(`[LLM] 模型能力探测: ${modelName} contextWindow=${contextWindow} maxOutput=${maxOutput} reasoning=${reasoning}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[LLM] 模型能力探测失败（降级为配置值）: ${(e as Error).message}`);
    }
    this._modelCapsCache.set(cacheKey, { caps, timestamp: Date.now() });
    return caps;
  }

  /**
   * 计算实际 max_tokens：自动探测的模型上限优先于写死的默认值
   * - 推理模型（reasoning=true）：抬升下限到 16384，避免思考耗尽预算导致 content 为空
   * - 始终不超过模型真实 maxOutput
   */
  private static resolveMaxTokens(requested: number | undefined, config: { maxTokens: number; modelMaxOutput?: number; modelReasoning?: boolean }): number {
    let maxTokens = requested ?? config.maxTokens;
    if (config.modelReasoning) maxTokens = Math.max(maxTokens, 16384);
    if (config.modelMaxOutput && config.modelMaxOutput > 0) {
      maxTokens = Math.min(maxTokens, config.modelMaxOutput);
    }
    return maxTokens;
  }

  /**
   * 从数据库获取 LLM 配置（带缓存）
   */
  private static _llmConfigCache: { config: any; timestamp: number } | null = null;
  private static readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  /** 已确认可用的 LLM endpoint（缓存，重启即失效） */
  private static _workingEndpointUrl: string | null = null;
  private static readonly ALTERNATIVE_BASE_URLS: string[] = [
    'https://api.siliconflow.cn/v1',
    'https://api.openai.com/v1',
    'https://api.deepseek.com/v1',
    'https://api.moonshot.cn/v1',
    'http://localhost:11434/v1',
  ];

  static async getLlmConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
    provider?: string;
    /** 自动探测：模型上下文窗口（最大输入） */
    modelContextWindow?: number;
    /** 自动探测：模型最大输出 token 数 */
    modelMaxOutput?: number;
    /** 自动探测：是否推理模型（思考占用输出预算） */
    modelReasoning?: boolean;
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

        // 新结构：providerId 引用 LlmProfile
        if (v.providerId) {
          const profilesCfg = await prisma.systemConfig.findUnique({
            where: { key: 'llm_profiles' },
          });
          if (profilesCfg?.value) {
            const profilesRaw =
              typeof profilesCfg.value === 'string'
                ? JSON.parse(profilesCfg.value)
                : profilesCfg.value;
            const profiles = Array.isArray(profilesRaw) ? profilesRaw : [];
            const profile = profiles.find((p: any) => p.id === v.providerId);
            if (profile && profile.apiKey && profile.model) {
              result = {
                apiBaseUrl: profile.apiBase || 'https://api.siliconflow.cn/v1',
                apiKey: profile.apiKey,
                modelName: profile.model,
                maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : 8192,
                temperature: typeof v.temperature === 'number' ? v.temperature : 0.1,
                timeout: typeof v.timeout === 'number' ? v.timeout : (profile.timeout || 120),
                provider: profile.provider || 'openai-compat',
              };
            }
          }
        }

        // 兜底：旧结构（未迁移或迁移失败）
        if (!result && v.apiKey && v.modelName) {
          result = {
            apiBaseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
            apiKey: v.apiKey,
            modelName: v.modelName,
            maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : 8192,
            temperature: typeof v.temperature === 'number' ? v.temperature : 0.1,
            timeout: typeof v.timeout === 'number' ? v.timeout : 120,
            provider: v.provider || 'openai-compat',
          };
        }
      }
      this._llmConfigCache = { config: result, timestamp: Date.now() };
      // 自动探测模型能力（上下文窗口/最大输出），探测失败不影响主流程
      if (result) {
        const caps = await this.probeModelCapabilities(result.apiBaseUrl, result.apiKey, result.modelName);
        if (caps) {
          (result as any).modelContextWindow = caps.contextWindow;
          (result as any).modelMaxOutput = caps.maxOutput;
          (result as any).modelReasoning = caps.reasoning;
        }
      }
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
  static async chat(prompt: string, options?: { systemPrompt?: string; maxTokens?: number; timeout?: number; temperature?: number; taskId?: string; mode?: string; traceId?: string }): Promise<string> {
    const config = await this.getLlmConfig();
    if (!config) {
      throw new Error('LLM 未配置，请在系统配置中设置 LLM API');
    }

    const systemPrompt = options?.systemPrompt || '你是一个正则表达式专家，擅长根据用户需求生成准确的正则表达式。请只输出正则表达式，不要输出其他解释文字。';
    // 自动探测的模型上限优先（推理模型抬升下限，避免思考耗尽预算）
    const maxTokens = this.resolveMaxTokens(options?.maxTokens, config);
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

    // 阶段 3：构建 promptFull 用于推理回放
    const promptFull = this.truncateForLog(`[system]\n${systemPrompt}\n\n[user]\n${prompt}`);

    // ★ LLM chat 响应缓存
    const chatCacheKey = CacheService.generateKey('llm:chat', config.modelName, String(temperature), systemPrompt, prompt);
    const CHAT_CACHE_TTL = 24 * 3600;
    const cachedChat = await CacheService.get<string>(chatCacheKey);
    if (cachedChat !== null) {
      console.log(`[LLM] chat 缓存命中 (${cachedChat.length}字)`);
      // 记录缓存命中（token=0，不消耗实际额度）
      LlmService.recordLlmCall({
        taskId: options?.taskId,
        mode: options?.mode,
        traceId: options?.traceId,
        model: config.modelName,
        provider: config.provider,
        latencyMs: 0,
        status: 'cache',
        promptFull,
        completionFull: this.truncateForLog(cachedChat),
      });
      return cachedChat;
    }

    const _callStart = Date.now();

    // ★ 单次 HTTP 请求执行器（每次重试新建 AbortController，已 abort 的 signal 不可复用）
    const executeRequest = async (): Promise<any> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // 限流：按 model 分桶获取令牌，避免高并发打爆 LLM API
        await acquireLlmToken(config.modelName);
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
          const err = new Error(`LLM API 错误 (${response.status}): ${errorText}`);
          // 附带状态码供 retryWithBackoff 判断是否重试（5xx/429 重试，4xx 不重试）
          (err as any).status = response.status;
          (err as any).statusCode = response.status;
          throw err;
        }

        return await response.json() as any;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      // ★ 包裹重试：5xx/429/超时/网络错误重试 3 次（指数退避 2s/4s/8s），4xx 不重试
      const data = await retryWithBackoff(executeRequest, {
        retries: 3,
        baseDelay: 2000,
        onRetry: (error, attempt) => {
          // 重试时记录到 LlmCallLog（status='retry'），便于观测重试频率与失败原因
          LlmService.recordLlmCall({
            taskId: options?.taskId,
            mode: options?.mode,
            traceId: options?.traceId,
            model: config.modelName,
            provider: config.provider,
            latencyMs: 0,
            status: 'retry',
            errorMsg: `[retry#${attempt}] ${(error as Error)?.message?.slice(0, 450) ?? null}`,
            promptFull,
          });
        },
      });

      const chatMessage = data.choices?.[0]?.message || {};
      const result = chatMessage.content || '';
      const chatReasoning = chatMessage.reasoning_content || chatMessage.reasoning || '';

      // 解析 token 用量并记录调用日志
      const _usage = data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cacheRead: data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.prompt_cache_hit_tokens ?? 0,
        cacheWrite: data.usage.prompt_tokens_details?.cache_creation ?? data.usage.prompt_cache_miss_tokens ?? 0,
      } : undefined;
      LlmService.recordLlmCall({
        taskId: options?.taskId,
        mode: options?.mode,
        traceId: options?.traceId,
        model: config.modelName,
        provider: config.provider,
        latencyMs: Date.now() - _callStart,
        status: 'success',
        usage: _usage,
        promptFull,
        // content 为空时兜底记录 reasoning_content，保证推理回放始终有内容可看
        completionFull: this.truncateForLog(
          result || (chatReasoning ? `[模型未输出正式回答，以下为 reasoning_content]\n${chatReasoning}` : '')
        ),
      });

      // ★ 缓存 chat 响应（空 content 不缓存）
      if (result) {
        await CacheService.set(chatCacheKey, result, CHAT_CACHE_TTL);
      }

      return result;
    } catch (e: any) {
      // 失败也记录调用日志
      LlmService.recordLlmCall({
        taskId: options?.taskId,
        mode: options?.mode,
        traceId: options?.traceId,
        model: config.modelName,
        provider: config.provider,
        latencyMs: Date.now() - _callStart,
        status: 'failed',
        errorMsg: (e as Error)?.message?.slice(0, 500) ?? null,
        promptFull,
      });
      throw e;
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

