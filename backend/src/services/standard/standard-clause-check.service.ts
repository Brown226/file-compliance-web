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
  /**
   * P1-5：本条条文专用的待审文本（章节块映射结果）。
   * 为空/缺省时回退用 checkClauses 的全局 text（兼容既有调用与测试）。
   */
  textOverride?: string;
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
    // P1-5: 章节块映射——有 textOverride 用命中块文本，否则用全局 text（兼容）
    const reviewText = clause.textOverride || text;
    const userContent = CLAUSE_CHECK_USER_PROMPT
      .replace(/\{clauseCode\}/g, clause.code)
      .replace(/\{clauseTitle\}/g, clause.title)
      .replace(/\{clauseContent\}/g, clause.content)
      .replace(/\{checkPrompt\}/g, checkPromptSection)
      .replace(/\{text\}/g, reviewText);

    try {
      // P2-3: 改用 LlmService.chat 主入口（此前自建 fetch 调 /chat/completions，
      // 无 taskId/mode/traceId 上报、无 LlmCallLog 留痕、无限流——DEC 合规分支在 LLM 看板统计不到）
      const rawResponse = await LlmService.chat(userContent, {
        systemPrompt: CLAUSE_CHECK_SYSTEM_PROMPT,
        temperature: options?.temperature ?? 0,
        timeout: options?.timeout ?? 60,
      });
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

}
