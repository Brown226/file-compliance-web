/**
 * 标准逐条核对服务
 *
 * 借鉴 OpenSpec 审查模块的"条文逐条核对"方法：
 * - 拿着标准条文清单，逐条问 LLM"这条符合吗？"
 * - 只输出"不符合"的项
 * - 每个问题绑定到具体条文 ID，不可编造来源
 * - LLM 不确定时标记 UNVERIFIED
 *
 * 注意：本文件与 standard-check.service.ts（标准比对服务）是不同的服务。
 */

import { LlmService, ReviewIssue } from '../llm/llm.service';

export interface StandardClause {
  id: string;
  code: string;
  title: string;
  content: string;
  category: string;
  /** DEC-2：审点工程化判定 prompt（由 CheckpointExtractor 加工产出，注入逐条核对 prompt） */
  checkPrompt?: string;
}

export interface CheckResult {
  clauseId: string;
  clauseCode: string;
  clauseTitle: string;
  clauseContent: string;
  status: 'COMPLIANT' | 'NON_COMPLIANT' | 'UNVERIFIED';
  description: string | null;
  suggestion: string | null;
  originalText: string | null;
}

// 逐条核对使用的系统 prompt 模板
const CLAUSE_CHECK_SYSTEM_PROMPT = `你是一位专业的文件合规审查专家。你的任务是逐条核对标准条文。

## 规则
1. 你将收到一条标准条文和一段文档文本。
2. 判断文档文本是否**明确违反**了该条文。
3. 只有当你**明确确定**违反时，才输出 NON_COMPLIANT。
4. 如果你不确定、或条文在该文档中不适用，输出 UNVERIFIED。
5. 如果文档完全符合该条文，输出 COMPLIANT。
6. **不要输出任何不属于该条文的问题。**

## 输出格式
仅输出 JSON 对象，不要输出其他内容：
{
  "status": "COMPLIANT" | "NON_COMPLIANT" | "UNVERIFIED",
  "description": "仅当 NON_COMPLIANT 时，描述违反的具体内容",
  "suggestion": "仅当 NON_COMPLIANT 时，给出修改建议",
  "originalText": "仅当 NON_COMPLIANT 时，文档中违反条文的具体原文片段"
}`;

const CLAUSE_CHECK_USER_PROMPT = `## 标准条文
条文编号：{clauseCode}
条文标题：{clauseTitle}
条文内容：{clauseContent}
{checkPrompt}

## 待审查文档文本
{text}

请判断以上文档文本是否违反该条文：`;

export class StandardClauseCheckService {
  /**
   * 逐条核对：对一条标准条文执行审查
   */
  static async checkSingleClause(
    clause: StandardClause,
    text: string,
    options?: {
      temperature?: number;
      timeout?: number;
    },
  ): Promise<CheckResult> {
    // DEC-2: 审点加工出的 checkPrompt 作为审查提示注入（无则留空行，不改变原有行为）
    const checkPromptSection = clause.checkPrompt ? `审查提示：${clause.checkPrompt}` : '';
    const userContent = CLAUSE_CHECK_USER_PROMPT
      .replace(/\{clauseCode\}/g, clause.code)
      .replace(/\{clauseTitle\}/g, clause.title)
      .replace(/\{clauseContent\}/g, clause.content)
      .replace(/\{checkPrompt\}/g, checkPromptSection)
      .replace(/\{text\}/g, text);

    try {
      const rawResponse = await this.callLlmRaw(
        CLAUSE_CHECK_SYSTEM_PROMPT,
        userContent,
        options?.temperature ?? 0,
        options?.timeout ?? 60,
      );
      return this.parseRawResponse(rawResponse, clause);
    } catch (e) {
      console.warn(`[StandardClauseCheck] 条文 ${clause.code} 核对失败:`, (e as Error).message);
      return {
        clauseId: clause.id,
        clauseCode: clause.code,
        clauseTitle: clause.title,
        clauseContent: clause.content,
        status: 'UNVERIFIED',
        description: `核对出错: ${(e as Error).message}`,
        suggestion: null,
        originalText: null,
      };
    }
  }

  /**
   * 批量逐条核对：对多条标准条文执行审查
   */
  static async checkClauses(
    clauses: StandardClause[],
    text: string,
    options?: {
      temperature?: number;
      timeout?: number;
      concurrency?: number;
    },
  ): Promise<{
    results: CheckResult[];
    compliant: number;
    nonCompliant: number;
    unverified: number;
  }> {
    const concurrency = options?.concurrency ?? 3;
    const results: CheckResult[] = [];
    let compliant = 0;
    let nonCompliant = 0;
    let unverified = 0;

    for (let i = 0; i < clauses.length; i += concurrency) {
      const batch = clauses.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(clause => this.checkSingleClause(clause, text, options)),
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.status === 'COMPLIANT') compliant++;
        else if (result.status === 'NON_COMPLIANT') nonCompliant++;
        else unverified++;
      }
    }

    return { results, compliant, nonCompliant, unverified };
  }

  /**
   * 将 CheckResult 转换为 ReviewIssue（与现有审查管线兼容）
   * 注意：ReviewIssue.standardRef 是 string 类型，不是对象
   */
  static toReviewIssue(result: CheckResult): ReviewIssue | null {
    if (result.status !== 'NON_COMPLIANT' && result.status !== 'UNVERIFIED') {
      return null;
    }

    return {
      issueType: result.status === 'NON_COMPLIANT' ? 'VIOLATION' : 'COMPLETENESS',
      severity: result.status === 'NON_COMPLIANT' ? 'error' : 'warning',
      originalText: result.originalText || `[标准条文] ${result.clauseCode}`,
      suggestedText: result.suggestion || undefined,
      description: result.description
        ? `[${result.clauseCode}] ${result.description}`
        : (result.status === 'UNVERIFIED' ? `[${result.clauseCode}] 无法确定是否违反该条文` : ''),
      ruleCode: `STD_${result.clauseCode}`,
      standardRef: `[${result.clauseCode}] ${result.clauseTitle}`,
      plainLanguage: result.status === 'UNVERIFIED'
        ? '⚠️ AI 推测，无法确定是否违反该条文，请人工确认'
        : undefined,
    };
  }

  /**
   * 直接调用 LLM chat/completions API，返回原始文本
   *
   * 复用 LlmService.getLlmConfig() 解析 providerId 引用（阶段 4 改造后，
   * llm_chat_model 不再直接存 apiBaseUrl/apiKey，而是引用 LlmProfile）。
   */
  private static async callLlmRaw(
    systemPrompt: string,
    userContent: string,
    temperature: number,
    timeoutSec: number,
  ): Promise<string> {
    const config = await LlmService.getLlmConfig();
    if (!config) {
      throw new Error('LLM 未配置，请在系统配置中设置 LLM API');
    }

    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!fetchResponse.ok) {
      throw new Error(`LLM API 返回 ${fetchResponse.status}`);
    }

    const data = await fetchResponse.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * 解析 LLM 原始 JSON 响应为 CheckResult
   */
  private static parseRawResponse(
    rawContent: string,
    clause: StandardClause,
  ): CheckResult {
    let parsed: any = {};
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // JSON 解析失败，视为 UNVERIFIED
    }

    const status = parsed?.status || 'UNVERIFIED';

    if (status === 'COMPLIANT') {
      return {
        clauseId: clause.id,
        clauseCode: clause.code,
        clauseTitle: clause.title,
        clauseContent: clause.content,
        status: 'COMPLIANT',
        description: null,
        suggestion: null,
        originalText: null,
      };
    }

    if (status === 'NON_COMPLIANT' && parsed?.description && parsed.description.length > 10) {
      return {
        clauseId: clause.id,
        clauseCode: clause.code,
        clauseTitle: clause.title,
        clauseContent: clause.content,
        status: 'NON_COMPLIANT',
        description: parsed.description,
        suggestion: parsed.suggestion || null,
        originalText: parsed.originalText || null,
      };
    }

    return {
      clauseId: clause.id,
      clauseCode: clause.code,
      clauseTitle: clause.title,
      clauseContent: clause.content,
      status: 'UNVERIFIED',
      description: parsed?.description || 'LLM 无法确定是否违反该条文',
      suggestion: null,
      originalText: null,
    };
  }

  // ==================== Task 8.5: Researcher 多轮检索 ====================

  /** 检索质量评估阈值（字符数） */
  private static readonly MIN_CONTENT_THRESHOLD = parseInt(process.env.AGENT_MIN_CONTENT_THRESHOLD || '100', 10);

  /** Researcher 最大循环次数（与 OpenSpec MAX_RESEARCH_LOOPS=3 一致） */
  private static readonly MAX_RESEARCH_LOOPS = parseInt(process.env.AGENT_MAX_RESEARCH_LOOPS || '3', 10);

  /** 是否启用 Researcher 多轮检索 */
  private static readonly ENABLE_RESEARCHER = process.env.AGENT_ENABLE_RESEARCHER !== 'false';

  private static evaluateRetrievalQuality(context: string, loopCount: number): { shouldStop: boolean; reason: string } {
    if (!context || context.trim().length === 0) return { shouldStop: false, reason: '检索结果为空' };
    if (context.length >= this.MIN_CONTENT_THRESHOLD) return { shouldStop: true, reason: '检索内容充足' };
    if (loopCount >= this.MAX_RESEARCH_LOOPS) return { shouldStop: true, reason: '已达最大循环次数' };
    return { shouldStop: false, reason: `检索内容不足(${context.length}字 < ${this.MIN_CONTENT_THRESHOLD}字)` };
  }

  private static generateNextQuery(originalQuery: string, previousContext: string, loopCount: number): string {
    if (loopCount === 0) return originalQuery;
    const keywords = previousContext.split(/[\s,，。；;、\n]+/).filter(w => w.length >= 2).slice(0, 5);
    const mainKeyword = originalQuery.split(/[\s,，。；;、\n]+/)[0] || originalQuery;
    return `${mainKeyword} ${keywords.join(' ')}`.trim();
  }

  static async checkSingleClauseWithResearch(
    clause: StandardClause, text: string,
    options?: { temperature?: number; timeout?: number; retrieveFunction?: (query: string) => Promise<string> },
  ): Promise<CheckResult> {
    let context = '';
    for (let loopCount = 0; loopCount < this.MAX_RESEARCH_LOOPS; loopCount++) {
      const query = this.generateNextQuery(`${clause.code} ${clause.title} ${clause.content}`, context, loopCount);
      if (options?.retrieveFunction) {
        const newContext = await options.retrieveFunction(query);
        if (newContext && newContext.length > context.length) context = newContext;
      }
      const { shouldStop, reason } = this.evaluateRetrievalQuality(context, loopCount);
      if (shouldStop) { console.log(`[StandardClauseCheck] Researcher: ${reason}（第${loopCount + 1}轮）`); break; }
      else console.log(`[StandardClauseCheck] ${reason}（第${loopCount + 1}轮）`);
    }
    const contextSection = context ? `\n\n【相关参考信息】\n${context}` : '';
    const userContent = `## 标准条文\n${clause.code} ${clause.title}\n${clause.content}${contextSection}\n\n## 待审查文档\n${text}`;
    try {
      const rawResponse = await this.callLlmRaw(CLAUSE_CHECK_SYSTEM_PROMPT, userContent, options?.temperature ?? 0, options?.timeout ?? 60);
      return this.parseRawResponse(rawResponse, clause);
    } catch (e) {
      return {
        clauseId: clause.id, clauseCode: clause.code, clauseTitle: clause.title, clauseContent: clause.content,
        status: 'UNVERIFIED', description: `出错: ${(e as Error).message}`, suggestion: null, originalText: null,
      };
    }
  }

  // ==================== Task 8.6: Auditor 复核 ====================

  private static readonly MAX_AUDIT_LOOPS = parseInt(process.env.AGENT_MAX_AUDIT_LOOPS || '2', 10);
  private static readonly ENABLE_AUDITOR = process.env.AGENT_ENABLE_AUDITOR !== 'false';

  private static readonly AUDITOR_SYSTEM_PROMPT = '你是文件合规审查复核专家。对已审查出的问题项进行二次复核，判断是否准确。只输出 JSON：{"decision":"CONFIRMED|REJECTED|UNCERTAIN","reason":"..."}';

  static async auditCheckResult(
    result: CheckResult, text: string,
    options?: { temperature?: number; timeout?: number },
  ): Promise<{ decision: 'CONFIRMED' | 'REJECTED' | 'UNCERTAIN'; reason: string; revisedResult?: CheckResult }> {
    if (result.status === 'COMPLIANT') return { decision: 'CONFIRMED', reason: '合规项无需复核' };
    const userContent = `## 审查结论\n条文：${result.clauseCode}\n结论：${result.status}\n描述：${result.description || '无'}\n\n## 文档原文\n${text}\n\n请复核：`;
    for (let loop = 0; loop < this.MAX_AUDIT_LOOPS; loop++) {
      try {
        const rawResponse = await this.callLlmRaw(this.AUDITOR_SYSTEM_PROMPT, userContent, options?.temperature ?? 0, options?.timeout ?? 30);
        const match = rawResponse.match(/"decision"\s*:\s*"(CONFIRMED|REJECTED|UNCERTAIN)"/);
        const reasonMatch = rawResponse.match(/"reason"\s*:\s*"([^"]+)"/);
        const decision = (match?.[1] as any) || 'UNCERTAIN';
        const reason = reasonMatch?.[1] || '无法解析';
        if (decision === 'CONFIRMED') return { decision, reason, revisedResult: result };
        if (decision === 'REJECTED' && loop < this.MAX_AUDIT_LOOPS - 1) {
          result.status = 'UNVERIFIED';
          result.description = `[Auditor驳回] ${reason}`;
          continue;
        }
        return { decision, reason, revisedResult: result };
      } catch (e) {
        return { decision: 'UNCERTAIN', reason: '复核出错', revisedResult: result };
      }
    }
    return { decision: 'UNCERTAIN', reason: '已达最大复核次数', revisedResult: result };
  }

  static async checkClausesWithAudit(
    clauses: StandardClause[], text: string,
    options?: { temperature?: number; timeout?: number; concurrency?: number; retrieveFunction?: (query: string) => Promise<string> },
  ): Promise<{
    results: CheckResult[]; compliant: number; nonCompliant: number; unverified: number;
    auditorStats: { confirmed: number; rejected: number; uncertain: number };
  }> {
    const concurrency = options?.concurrency ?? 3;
    const results: CheckResult[] = [];
    let compliant = 0, nonCompliant = 0, unverified = 0;
    const auditorStats = { confirmed: 0, rejected: 0, uncertain: 0 };

    for (let i = 0; i < clauses.length; i += concurrency) {
      const batch = clauses.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(async (clause) => {
        const result = this.ENABLE_RESEARCHER
          ? await this.checkSingleClauseWithResearch(clause, text, options)
          : await this.checkSingleClause(clause, text, options);

        if (this.ENABLE_AUDITOR && (result.status === 'NON_COMPLIANT' || result.status === 'UNVERIFIED')) {
          const audit = await this.auditCheckResult(result, text, options);
          if (audit.decision === 'CONFIRMED') auditorStats.confirmed++;
          else if (audit.decision === 'REJECTED') auditorStats.rejected++;
          else auditorStats.uncertain++;
          return audit.revisedResult || result;
        }
        return result;
      }));

      for (const r of batchResults) {
        results.push(r);
        if (r.status === 'COMPLIANT') compliant++;
        else if (r.status === 'NON_COMPLIANT') nonCompliant++;
        else unverified++;
      }
    }

    console.log(`[StandardClauseCheck] 完成: ${compliant}合规, ${nonCompliant}不符合, ${unverified}不确定 | [Auditor] ${auditorStats.confirmed}确认, ${auditorStats.rejected}驳回`);
    return { results, compliant, nonCompliant, unverified, auditorStats };
  }
}
