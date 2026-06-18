/**
 * 结构化一致性审查服务 — Map-Reduce 架构
 *
 * 解决原 handleConsistency 中 "分片破坏跨分片一致性检测" 的致命缺陷。
 *
 * 流程:
 *   Phase A (Map):   每个文本分片 → LLM 抽取结构化摘要（参数/编码/引用）
 *                    每个条目记录 {chunkIndex, chunkStartIndex, lineHint} 用于精确定位
 *   Phase B (Merge): 合并所有分片摘要，去重、归一化、按参数名分组
 *   Phase C (Reduce): 合并后的摘要 → LLM 做 C1-C4 一致性比对
 *   Phase D (Locate): 将比对结果映射回原文 — 只在对应分片的文本范围内搜索，精度等同原文直调
 *
 * 上下文联动:
 *   - 抽取分片大小 = min(PipelineReviewConfig.chunkSize, 上下文窗口 - 1800)
 *   - 汇总容量 = 上下文窗口 - 3000 (留出 prompt + 输出空间)
 *   - 上下文窗口优先取 PipelineReviewConfig.contextWindow，否则从 llmMaxTokens 推导
 */

import { LlmService, ReviewIssue, TextChunk } from './llm.service';
import { PipelineContext, PipelineReviewConfig } from './review-pipeline/types';
import { PromptLoader } from './prompts';

// ============================================================
// 类型定义
// ============================================================

/** LLM 抽取的参数条目 */
interface ExtractedParam {
  name: string;
  value: string;
  lineHint: number;
  chunkIndex: number;
  /** 该分片在原文中的起始字符偏移（0-based） */
  chunkStartIndex: number;
}

/** LLM 抽取的编码条目 */
interface ExtractedCode {
  code: string;
  context: string;
  lineHint: number;
  chunkIndex: number;
  chunkStartIndex: number;
}

/** LLM 抽取的引用条目 */
interface ExtractedRef {
  ref: string;
  lineHint: number;
  chunkIndex: number;
  chunkStartIndex: number;
}

/** LLM 抽取的文档元信息 */
interface ExtractedMeta {
  key: string;
  value: string;
  lineHint: number;
  chunkIndex: number;
  chunkStartIndex: number;
}

/** LLM 抽取的事实断言 */
interface ExtractedFact {
  subject: string;
  claim: string;
  lineHint: number;
  chunkIndex: number;
  chunkStartIndex: number;
}

/** 单个分片的抽取结果 */
interface ChunkSummary {
  params: ExtractedParam[];
  codes: ExtractedCode[];
  refs: ExtractedRef[];
  meta: ExtractedMeta[];
  facts: ExtractedFact[];
}

/** LLM 返回的原始 JSON 结构 */
interface RawExtractResult {
  params?: Array<{ name?: string; value?: string; lineHint?: number }>;
  codes?: Array<{ code?: string; context?: string; lineHint?: number }>;
  refs?: Array<{ ref?: string; lineHint?: number }>;
  meta?: Array<{ key?: string; value?: string; lineHint?: number }>;
  facts?: Array<{ subject?: string; claim?: string; lineHint?: number }>;
}

/** 上下文预算 */
interface ContextBudget {
  contextWindow: number;
  extractChunkSize: number;
  maxSummaryChars: number;
}

/** 定位结果：在原文中找到的精确位置 */
interface LocatedMatch {
  absoluteStart: number;
  absoluteEnd: number;
  confidence: 'exact' | 'trimmed' | 'normalized' | 'fallback';
  quoteText: string;
}

// ============================================================
// 常量
// ============================================================

/** 抽取阶段固定开销（系统提示词 + 用户模板骨架 + JSON输出预留，单位：字符） */
const EXTRACT_OVERHEAD = 1800;
/** 比对阶段固定开销（系统提示词 + 用户模板骨架 + JSON输出预留，单位：字符） */
const COMPARE_OVERHEAD = 3000;
/** 抽取的最小分片大小（低于此值 LLM 抽取效率极低） */
const MIN_EXTRACT_CHUNK = 500;
/** 汇总的最小可用大小 */
const MIN_SUMMARY_CHARS = 800;

// ============================================================
// 服务实现
// ============================================================

export class StructuredConsistencyService {

  /**
   * 执行结构化一致性审查
   *
   * @param text     文件提取文本
   * @param ctx      Pipeline 上下文
   * @param config   审查配置（含 chunkSize / llmMaxTokens / contextWindow）
   * @returns        审查问题列表（含 locateMeta 用于前端定位）
   */
  static async check(
    text: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    if (!text || text.trim().length < 100) {
      console.log('[StructConsist] 文本过短，跳过结构化一致性检查');
      return [];
    }

    console.log(`[StructConsist] 开始结构化一致性检查 (${text.length} 字符)`);

    // ---- Phase 0: 计算上下文预算 ----
    const budget = await this.deriveContextBudget(config);
    console.log(
      `[StructConsist] 预算: ctxWin=${budget.contextWindow} ` +
      `extractChunk=${budget.extractChunkSize} maxSummary=${budget.maxSummaryChars}`,
    );

    // ---- Phase A: Map — 分片抽取 ----
    const chunks = LlmService.splitText(text, budget.extractChunkSize, true) as TextChunk[];
    console.log(`[StructConsist] 文本分为 ${chunks.length} 个分片`);

    const summaries: ChunkSummary[] = [];
    for (const chunk of chunks) {
      try {
        const summary = await this.extractFromChunk(chunk, chunks.length, ctx, config);
        summaries.push(summary);
        ctx.onChunkProgress?.(
          chunk.text.length, [], chunk.chunkIndex, chunks.length, 'struct-extract',
        );
      } catch (e: any) {
        console.warn(`[StructConsist] 分片 ${chunk.chunkIndex + 1} 抽取失败:`, e.message);
        summaries.push({ params: [], codes: [], refs: [], meta: [], facts: [] });
      }
    }

    // ---- Phase B: Merge — 汇总去重 ----
    const merged = this.mergeSummaries(summaries);
    const totalItems = merged.params.length + merged.codes.length + merged.refs.length + merged.meta.length + merged.facts.length;
    console.log(
      `[StructConsist] 抽取完成: params=${merged.params.length} ` +
      `codes=${merged.codes.length} refs=${merged.refs.length} ` +
      `meta=${merged.meta.length} facts=${merged.facts.length}`,
    );

    if (totalItems === 0) {
      console.log('[StructConsist] 未抽取到任何结构化数据，返回空结果');
      return [];
    }

    // ---- Phase C: Reduce — 汇总比对 ----
    let formattedSummary = this.formatSummaryForComparison(merged);

    if (formattedSummary.length > budget.maxSummaryChars) {
      console.warn(
        `[StructConsist] 摘要过长 (${formattedSummary.length} > ${budget.maxSummaryChars})，进行压缩`,
      );
      formattedSummary = this.compressSummary(merged, budget.maxSummaryChars);
    }

    const issues = await this.compareSummaries(formattedSummary, ctx, config);
    console.log(`[StructConsist] 比对完成: ${issues.length} 个一致性问题`);

    // ---- Phase D: Locate — 精确定位 ----
    const locatedIssues = this.locateIssuesInText(issues, summaries, text);

    // 统计定位精度
    const precisionStats = {
      exact: 0, trimmed: 0, normalized: 0, fallback: 0, unmatched: 0,
    };
    for (const issue of locatedIssues) {
      const conf = issue.locateMeta?.confidence || 'unmatched';
      precisionStats[conf as keyof typeof precisionStats]++;
    }
    console.log(
      `[StructConsist] 定位精度: exact=${precisionStats.exact} trimmed=${precisionStats.trimmed} ` +
      `normalized=${precisionStats.normalized} fallback=${precisionStats.fallback} unmatched=${precisionStats.unmatched}`,
    );

    return locatedIssues;
  }

  // ==========================================================
  // Phase 0: 上下文预算推导
  // ==========================================================

  private static async deriveContextBudget(config: PipelineReviewConfig): Promise<ContextBudget> {
    let contextWindow: number;

    if (config.contextWindow && config.contextWindow > 0) {
      contextWindow = config.contextWindow;
    } else {
      try {
        const llmConfig = await LlmService.getLlmConfig();
        const maxTokens = llmConfig?.maxTokens || 8192;
        contextWindow = maxTokens * 3;
      } catch {
        contextWindow = 8192 * 3;
      }
    }

    const extractChunkSize = Math.max(
      MIN_EXTRACT_CHUNK,
      Math.min(config.chunkSize || 4000, contextWindow - EXTRACT_OVERHEAD),
    );

    const maxSummaryChars = Math.max(
      MIN_SUMMARY_CHARS,
      contextWindow - COMPARE_OVERHEAD,
    );

    return { contextWindow, extractChunkSize, maxSummaryChars };
  }

  // ==========================================================
  // Phase A: Map — 单分片抽取
  // ==========================================================

  private static async extractFromChunk(
    chunk: TextChunk,
    totalChunks: number,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<ChunkSummary> {
    const systemPrompt = await PromptLoader.resolve(
      'consistency',
      'system',
      'extract',
      this.fallbackExtractSystem(),
    );

    const userTpl = await PromptLoader.resolve(
      'consistency',
      'user',
      'extract',
      '文本片段（第${chunkIndex}/${totalChunks}片）：\n${text}',
    );
    const userPrompt = userTpl
      .replace(/\$\{chunkIndex\}/g, String(chunk.chunkIndex + 1))
      .replace(/\$\{totalChunks\}/g, String(totalChunks))
      .replace(/\$\{text\}/g, chunk.text);

    const raw = await LlmService.chat(userPrompt, {
      systemPrompt,
      maxTokens: 1024,
      timeout: config.llmTimeout,
    });

    return this.parseExtractResult(raw, chunk);
  }

  /**
   * 解析 LLM 返回的 JSON 为 ChunkSummary
   * chunk 对象提供了 startIndex，用于后续精确计算原文绝对位置
   */
  private static parseExtractResult(raw: string, chunk: TextChunk): ChunkSummary {
    const empty = { params: [], codes: [], refs: [], meta: [], facts: [] };

    try {
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!objMatch) {
        console.warn('[StructConsist] 抽取结果中未找到 JSON 对象:', raw.slice(0, 200));
        return empty;
      }

      const parsed: RawExtractResult = JSON.parse(objMatch[0]);

      const params: ExtractedParam[] = (parsed.params || [])
        .filter(p => p.name && p.value)
        .map(p => ({
          name: String(p.name).trim(),
          value: String(p.value).trim(),
          lineHint: typeof p.lineHint === 'number' ? p.lineHint : 0,
          chunkIndex: chunk.chunkIndex,
          chunkStartIndex: chunk.startIndex,
        }));

      const codes: ExtractedCode[] = (parsed.codes || [])
        .filter(c => c.code)
        .map(c => ({
          code: String(c.code).trim(),
          context: String(c.context || '').trim(),
          lineHint: typeof c.lineHint === 'number' ? c.lineHint : 0,
          chunkIndex: chunk.chunkIndex,
          chunkStartIndex: chunk.startIndex,
        }));

      const refs: ExtractedRef[] = (parsed.refs || [])
        .filter(r => r.ref)
        .map(r => ({
          ref: String(r.ref).trim(),
          lineHint: typeof r.lineHint === 'number' ? r.lineHint : 0,
          chunkIndex: chunk.chunkIndex,
          chunkStartIndex: chunk.startIndex,
        }));

      const meta: ExtractedMeta[] = (parsed.meta || [])
        .filter(m => m.key && m.value)
        .map(m => ({
          key: String(m.key).trim(),
          value: String(m.value).trim(),
          lineHint: typeof m.lineHint === 'number' ? m.lineHint : 0,
          chunkIndex: chunk.chunkIndex,
          chunkStartIndex: chunk.startIndex,
        }));

      const facts: ExtractedFact[] = (parsed.facts || [])
        .filter(f => f.subject && f.claim)
        .map(f => ({
          subject: String(f.subject).trim(),
          claim: String(f.claim).trim(),
          lineHint: typeof f.lineHint === 'number' ? f.lineHint : 0,
          chunkIndex: chunk.chunkIndex,
          chunkStartIndex: chunk.startIndex,
        }));

      return { params, codes, refs, meta, facts };
    } catch (e) {
      console.warn('[StructConsist] JSON 解析失败:', e, 'raw:', raw.slice(0, 200));
      return empty;
    }
  }

  // ==========================================================
  // Phase B: Merge — 合并去重
  // ==========================================================

  private static mergeSummaries(summaries: ChunkSummary[]): {
    params: ExtractedParam[];
    codes: ExtractedCode[];
    refs: ExtractedRef[];
    meta: ExtractedMeta[];
    facts: ExtractedFact[];
  } {
    const paramMap = new Map<string, ExtractedParam[]>();
    for (const s of summaries) {
      for (const p of s.params) {
        const normName = this.normalizeName(p.name);
        if (!paramMap.has(normName)) paramMap.set(normName, []);
        const group = paramMap.get(normName)!;
        const dup = group.find(
          existing => this.normalizeName(existing.name) === normName
            && this.normalizeValue(existing.value) === this.normalizeValue(p.value),
        );
        if (!dup) group.push(p);
      }
    }
    const mergedParams: ExtractedParam[] = [];
    for (const group of paramMap.values()) mergedParams.push(...group);

    const codeMap = new Map<string, ExtractedCode>();
    for (const s of summaries) {
      for (const c of s.codes) {
        const normCode = this.normalizeCode(c.code);
        if (!codeMap.has(normCode)) codeMap.set(normCode, c);
      }
    }
    const mergedCodes = [...codeMap.values()];

    const refMap = new Map<string, ExtractedRef>();
    for (const s of summaries) {
      for (const r of s.refs) {
        const normRef = this.normalizeRef(r.ref);
        if (!refMap.has(normRef)) refMap.set(normRef, r);
      }
    }
    const mergedRefs = [...refMap.values()];

    const metaMap = new Map<string, ExtractedMeta>();
    for (const s of summaries) {
      for (const m of s.meta || []) {
        const normKey = m.key.trim().toLowerCase();
        if (!metaMap.has(normKey)) metaMap.set(normKey, m);
      }
    }
    const mergedMeta = [...metaMap.values()];

    const factMap = new Map<string, ExtractedFact>();
    for (const s of summaries) {
      for (const f of s.facts || []) {
        const normSubject = f.subject.trim().toLowerCase();
        if (!factMap.has(normSubject)) factMap.set(normSubject, f);
      }
    }
    const mergedFacts = [...factMap.values()];

    return { params: mergedParams, codes: mergedCodes, refs: mergedRefs, meta: mergedMeta, facts: mergedFacts };
  }

  // ==========================================================
  // Phase C: Reduce — 汇总比对
  // ==========================================================

  private static formatSummaryForComparison(merged: {
    params: ExtractedParam[];
    codes: ExtractedCode[];
    refs: ExtractedRef[];
    meta: ExtractedMeta[];
    facts: ExtractedFact[];
  }): string {
    const paramGroups = new Map<string, ExtractedParam[]>();
    for (const p of merged.params) {
      const key = this.normalizeName(p.name);
      if (!paramGroups.has(key)) paramGroups.set(key, []);
      paramGroups.get(key)!.push(p);
    }

    const paramsList = [...paramGroups.entries()]
      .map(([name, entries]) => {
        const valueList = entries
          .map(e => `${e.value} (分片${e.chunkIndex + 1}L${e.lineHint})`)
          .join('; ');
        return `- ${entries[0].name}: ${valueList}`;
      })
      .join('\n') || '(无)';

    const codesList = merged.codes
      .map(c => `- ${c.code} (分片${c.chunkIndex + 1}L${c.lineHint}: ${c.context})`)
      .join('\n') || '(无)';

    const refsList = merged.refs
      .map(r => `- ${r.ref} (分片${r.chunkIndex + 1}L${r.lineHint})`)
      .join('\n') || '(无)';

    const metaList = merged.meta
      .map(m => `- ${m.key}: ${m.value} (分片${m.chunkIndex + 1}L${m.lineHint})`)
      .join('\n') || '(无)';

    const factsList = merged.facts
      .map(f => `- ${f.subject}: ${f.claim} (分片${f.chunkIndex + 1}L${f.lineHint})`)
      .join('\n') || '(无)';

    return `## 参数汇总\n${paramsList}\n\n## 编码汇总\n${codesList}\n\n## 引用汇总\n${refsList}\n\n## 文档元信息\n${metaList}\n\n## 事实断言\n${factsList}`;
  }

  private static compressSummary(
    merged: {
      params: ExtractedParam[];
      codes: ExtractedCode[];
      refs: ExtractedRef[];
      meta: ExtractedMeta[];
      facts: ExtractedFact[];
    },
    maxChars: number,
  ): string {
    const paramGroups = new Map<string, ExtractedParam[]>();
    for (const p of merged.params) {
      const key = this.normalizeName(p.name);
      if (!paramGroups.has(key)) paramGroups.set(key, []);
      paramGroups.get(key)!.push(p);
    }

    const sortedParams = [...paramGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    let current = '';
    for (const [name, entries] of sortedParams) {
      const line = `- ${entries[0].name}: ${entries.map(e => `${e.value} (分片${e.chunkIndex + 1})`).join('; ')}\n`;
      if (current.length + line.length > maxChars * 0.5) break;
      current += line;
    }

    const budgetForOthers = maxChars - current.length - 100;
    const codesText = merged.codes.slice(0, 30).map(c => `- ${c.code}\n`).join('');
    current += `\n## 编码汇总\n${codesText}`.slice(0, Math.floor(budgetForOthers * 0.3));
    const refsText = merged.refs.slice(0, 20).map(r => `- ${r.ref}\n`).join('');
    current += `\n## 引用汇总\n${refsText}`.slice(0, Math.floor(budgetForOthers * 0.2));

    return current.slice(0, maxChars);
  }

  private static async compareSummaries(
    formattedSummary: string,
    ctx: PipelineContext,
    config: PipelineReviewConfig,
  ): Promise<ReviewIssue[]> {
    const systemPrompt = await PromptLoader.resolve(
      'consistency',
      'system',
      'compare',
      this.fallbackCompareSystem(),
    );

    const raw = await LlmService.chat(formattedSummary, {
      systemPrompt,
      maxTokens: 2048,
      timeout: config.llmTimeout,
    });

    return this.parseCompareResult(raw);
  }

  private static parseCompareResult(raw: string): ReviewIssue[] {
    try {
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!arrMatch) {
        console.warn('[StructConsist] 比对结果中未找到 JSON 数组:', raw.slice(0, 200));
        return [];
      }

      const parsed: any[] = JSON.parse(arrMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any) => ({
        issueType: item.issueType || 'CONSISTENCY',
        originalText: item.originalText || '',
        suggestedText: item.suggestedText || undefined,
        description: item.description || undefined,
        ruleCode: item.ruleCode || undefined,
        standardRef: item.standardRef || undefined,
        plainLanguage: item.plain_language || item.plainLanguage || undefined,
      }));
    } catch (e) {
      console.warn('[StructConsist] 比对结果 JSON 解析失败:', e, 'raw:', raw.slice(0, 200));
      return [];
    }
  }

  // ==========================================================
  // Phase D: Locate — 分片约束精确定位
  // ==========================================================
  //
  // 核心策略:
  //   1. 用 issue.originalText 匹配 summaries 中的参数名/编码/引用
  //   2. 获取匹配条目的 chunkStartIndex（该分片在原文中的绝对偏移）
  //   3. 在该分片的原文范围内精确搜索 — 等价于原 runLLMDirect 的定位精度
  //   4. 多级降级: 原文精确匹配 → 去空格匹配 → lineHint 估算 → 全文盲搜
  // ==========================================================

  /**
   * 将比对结果中的问题映射回原文位置
   */
  private static locateIssuesInText(
    issues: ReviewIssue[],
    summaries: ChunkSummary[],
    fullText: string,
  ): ReviewIssue[] {
    // 构建分片偏移索引: chunkIndex → { start, end }
    const chunkRanges = new Map<number, { start: number; end: number }>();
    for (const s of summaries) {
      const firstItem = s.params[0] || s.codes[0] || s.refs[0];
      if (firstItem && !chunkRanges.has(firstItem.chunkIndex)) {
        // 用该分片所有条目中最小的 chunkStartIndex 作为起始
        const allStarts = [
          ...s.params.map(p => p.chunkStartIndex),
          ...s.codes.map(c => c.chunkStartIndex),
          ...s.refs.map(r => r.chunkStartIndex),
        ].filter(n => n >= 0);
        if (allStarts.length > 0) {
          const minStart = Math.min(...allStarts);
          chunkRanges.set(firstItem.chunkIndex, {
            start: minStart,
            end: minStart + 5000, // 粗略上限，精确搜索时用 fullText 长度兜底
          });
        }
      }
    }

    return issues.map(issue => {
      const searchText = (issue.originalText || '').trim();
      if (!searchText) return issue;

      // ---- Step 1: 在 summaries 中找到匹配条目 ----
      const matches = this.findAllInSummaries(searchText, summaries);
      let locateMeta: ReviewIssue['locateMeta'];

      if (matches.length > 0) {
        // ---- Step 2: 在匹配条目所在分片的原文范围内精确搜索 ----
        for (const match of matches) {
          const range = chunkRanges.get(match.chunkIndex);
          if (!range) continue;

          const searchEnd = Math.min(range.end + 3000, fullText.length);
          const chunkSubstring = fullText.substring(range.start, searchEnd);

          const located = this.preciseSearch(searchText, chunkSubstring, range.start, fullText);
          if (located) {
            locateMeta = {
              version: 2,
              mode: 'text' as const,
              confidence: located.confidence,
              absolute: { start: located.absoluteStart, end: located.absoluteEnd },
              quote: { text: located.quoteText },
              chunk: {
                index: match.chunkIndex,
                start: range.start,
                end: searchEnd,
                total: chunkRanges.size,
              },
            };
            break; // 找到第一个精确匹配即停止
          }
        }

        // ---- Step 3: 分片内未找到 → lineHint 估算 ----
        if (!locateMeta) {
          const best = matches[0];
          const range = chunkRanges.get(best.chunkIndex);
          const estimatedStart = best.lineHint > 0 && range
            ? range.start + Math.min(best.lineHint * 60, (range.end || fullText.length) - range.start)
            : best.chunkStartIndex;
          locateMeta = {
            version: 2,
            mode: 'text' as const,
            confidence: 'fallback' as const,
            quote: { text: searchText },
            chunk: {
              index: best.chunkIndex,
              start: estimatedStart,
              end: Math.min(estimatedStart + 100, fullText.length),
              total: chunkRanges.size,
            },
          };
        }
      }

      // ---- Step 4: summaries 中未找到 → 全文盲搜（最后的降级） ----
      if (!locateMeta) {
        const idx = fullText.indexOf(searchText);
        if (idx >= 0) {
          locateMeta = {
            version: 2,
            mode: 'text' as const,
            confidence: 'exact' as const,
            absolute: { start: idx, end: idx + searchText.length },
            quote: { text: searchText },
          };
        } else {
          const fuzzyIdx = this.fuzzyFind(searchText, fullText);
          if (fuzzyIdx >= 0) {
            locateMeta = {
              version: 2,
              mode: 'text' as const,
              confidence: 'normalized' as const,
              absolute: { start: fuzzyIdx, end: fuzzyIdx + searchText.length },
              quote: { text: searchText, normalizedText: searchText.replace(/\s+/g, '') },
            };
          }
        }
      }

      return locateMeta ? { ...issue, locateMeta } : issue;
    });
  }

  /**
   * 在分片子串中精确搜索 originalText
   * 返回找到的绝对位置和置信度
   */
  private static preciseSearch(
    searchText: string,
    chunkSubstring: string,
    chunkAbsoluteStart: number,
    fullText: string,
  ): LocatedMatch | null {
    // Level 1: 精确匹配
    const exactIdx = chunkSubstring.indexOf(searchText);
    if (exactIdx >= 0) {
      return {
        absoluteStart: chunkAbsoluteStart + exactIdx,
        absoluteEnd: chunkAbsoluteStart + exactIdx + searchText.length,
        confidence: 'exact',
        quoteText: searchText,
      };
    }

    // Level 2: 去除首尾空白后匹配
    const trimmedSearch = searchText.trim();
    if (trimmedSearch !== searchText) {
      const trimmedIdx = chunkSubstring.indexOf(trimmedSearch);
      if (trimmedIdx >= 0) {
        return {
          absoluteStart: chunkAbsoluteStart + trimmedIdx,
          absoluteEnd: chunkAbsoluteStart + trimmedIdx + trimmedSearch.length,
          confidence: 'trimmed',
          quoteText: trimmedSearch,
        };
      }
    }

    // Level 3: 去所有空白后匹配（容错中文/英文之间的空格差异）
    const compactSearch = searchText.replace(/\s+/g, '');
    if (compactSearch.length >= 3 && compactSearch !== searchText) {
      // 在 chunk 中去空白后搜索，然后反向定位
      const compactChunk = chunkSubstring.replace(/\s+/g, '');
      const compactIdx = compactChunk.indexOf(compactSearch);
      if (compactIdx >= 0) {
        // 反向映射：compactIdx → 原文中的位置
        let charCount = 0;
        let originalIdx = 0;
        for (let i = 0; i < chunkSubstring.length && charCount < compactIdx; i++) {
          if (!/\s/.test(chunkSubstring[i])) charCount++;
          originalIdx = i + 1;
        }
        // 在原文中找到对应文本的结束位置
        let endIdx = originalIdx;
        let remaining = compactSearch.length;
        while (endIdx < chunkSubstring.length && remaining > 0) {
          if (!/\s/.test(chunkSubstring[endIdx])) remaining--;
          endIdx++;
        }
        const start = chunkAbsoluteStart + originalIdx;
        const end = chunkAbsoluteStart + endIdx;
        const quoteText = fullText.substring(start, end);
        return {
          absoluteStart: start,
          absoluteEnd: end,
          confidence: 'normalized',
          quoteText,
        };
      }
    }

    return null;
  }

  /**
   * 在 summaries 中查找所有与 searchText 匹配的条目
   * 返回匹配的 chunkIndex / lineHint / chunkStartIndex（用于后续分片约束搜索）
   */
  private static findAllInSummaries(
    searchText: string,
    summaries: ChunkSummary[],
  ): Array<{ chunkIndex: number; lineHint: number; chunkStartIndex: number }> {
    const results: Array<{ chunkIndex: number; lineHint: number; chunkStartIndex: number }> = [];
    const normalized = searchText.replace(/\s+/g, '');

    for (const s of summaries) {
      for (const p of s.params) {
        if (this.textMatches(normalized, p.name) || this.textMatches(normalized, p.value)) {
          results.push({
            chunkIndex: p.chunkIndex,
            lineHint: p.lineHint,
            chunkStartIndex: p.chunkStartIndex,
          });
        }
      }
      for (const c of s.codes) {
        if (this.textMatches(normalized, c.code)) {
          results.push({
            chunkIndex: c.chunkIndex,
            lineHint: c.lineHint,
            chunkStartIndex: c.chunkStartIndex,
          });
        }
      }
      for (const r of s.refs) {
        if (this.textMatches(normalized, r.ref)) {
          results.push({
            chunkIndex: r.chunkIndex,
            lineHint: r.lineHint,
            chunkStartIndex: r.chunkStartIndex,
          });
        }
      }
    }

    return results;
  }

  /**
   * 判断 normalized 文本是否与参数字段匹配
   */
  private static textMatches(normalized: string, field: string): boolean {
    const fieldNorm = field.replace(/\s+/g, '');
    if (!normalized || !fieldNorm) return false;
    return normalized.includes(fieldNorm) || fieldNorm.includes(normalized);
  }

  /**
   * 全文模糊查找：去除空格/换行后匹配
   */
  private static fuzzyFind(searchText: string, fullText: string): number {
    const normalizedSearch = searchText.replace(/\s+/g, '');
    if (normalizedSearch.length < 3) return -1;
    const normalizedFull = fullText.replace(/\s+/g, '');
    return normalizedFull.indexOf(normalizedSearch);
  }

  // ==========================================================
  // 规范化工具
  // ==========================================================

  private static normalizeName(name: string): string {
    return name
      .replace(/\s+/g, '')
      .replace(/[（(][^)）]*[)）]/g, '')
      .replace(/[：:=＝].*$/, '')
      .trim()
      .toLowerCase();
  }

  private static normalizeValue(value: string): string {
    return value
      .replace(/\s+/g, '')
      .replace(/℃/g, '°C')
      .replace(/℉/g, '°F')
      .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
      .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
      .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8').replace(/９/g, '9')
      .toLowerCase();
  }

  private static normalizeCode(code: string): string {
    return code.replace(/\s+/g, '').toUpperCase();
  }

  private static normalizeRef(ref: string): string {
    return ref.replace(/\s+/g, '').toUpperCase();
  }

  // ==========================================================
  // 兜底提示词
  // ==========================================================

  private static fallbackExtractSystem(): string {
    return '你是文档结构化信息抽取器。从文本中提取参数(名+值)、编码、引用三类信息。严格输出JSON: {"params":[{"name":"","value":"","lineHint":0}],"codes":[{"code":"","context":"","lineHint":0}],"refs":[{"ref":"","lineHint":0}]}。只输出JSON，不要解释。';
  }

  private static fallbackCompareSystem(): string {
    return '你是文档一致性审查专家。按C1-C4维度检查一致性问题。输出JSON数组：[{"issueType":"CONSISTENCY","originalText":"","suggestedText":"","description":"","ruleCode":"C1","standardRef":null,"plain_language":""}]。未发现问题输出[]。';
  }
}
