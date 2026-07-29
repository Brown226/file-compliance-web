/**
 * 审查结果通用去重工具
 *
 * 设计：
 * 1. 精确去重：issueType + 归一化 originalText 完全匹配
 * 2. 模糊去重：同 issueType + Levenshtein 编辑距离 ≤ 阈值 + 长度 ≥ 最小长度
 * 3. 保留先出现的问题（通常是规则引擎结果，确定性更高）
 *
 * 使用场景：
 * - handleTypoGrammar: 规则/LLM 合并去重（所有类型，非仅 TYPO）
 * - runLLMOnlyStrategy / runSemanticSpecReview: 跨 chunk 分片去重
 * - runUnifiedReview: 多链结果合并去重
 */

import { ReviewIssue } from '../services/llm/llm.service';

/**
 * Levenshtein 编辑距离（用于模糊去重）
 * 仅用于短文本（≤30 字符），O(n*m) 复杂度可控
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // 插入
        prev[j] + 1,           // 删除
        prev[j - 1] + cost,    // 替换
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export interface DedupOptions {
  /** 模糊匹配的 Levenshtein 距离阈值，默认 2（与原 runLLMOnlyStrategy 一致） */
  fuzzyThreshold?: number;
  /** 启用模糊匹配的最小 originalText 长度，默认 4（避免短文本误去重） */
  fuzzyMinLength?: number;
  /** 是否启用模糊匹配，默认 true */
  enableFuzzy?: boolean;
}

/**
 * 审查结果去重
 *
 * @param issues 待去重的问题列表（按数组顺序，先出现的保留）
 * @param options 去重选项
 * @returns 去重后的列表
 *
 * @example
 * // 规则/LLM 合并去重（所有类型）
 * const merged = dedupIssues([...ruleIssues, ...llmIssues]);
 *
 * // 仅精确去重（关闭模糊匹配）
 * const exact = dedupIssues(issues, { enableFuzzy: false });
 */
export function dedupIssues(issues: ReviewIssue[], options: DedupOptions = {}): ReviewIssue[] {
  const {
    fuzzyThreshold = 2,
    fuzzyMinLength = 4,
    enableFuzzy = true,
  } = options;

  const seen: Array<{ issueType: string; normalized: string }> = [];

  return issues.filter(issue => {
    const normalized = (issue.originalText || '').replace(/\s+/g, '').trim();
    if (!normalized) return false;

    const issueType = issue.issueType || '';

    // 精确匹配
    if (seen.some(s => s.issueType === issueType && s.normalized === normalized)) {
      return false;
    }

    // 模糊匹配：同 issueType + 编辑距离 ≤ 阈值 + 长度 ≥ 最小长度
    if (enableFuzzy && normalized.length >= fuzzyMinLength) {
      const isFuzzyDup = seen.some(s => {
        if (s.issueType !== issueType) return false;
        // 长度差异过大直接跳过（避免无谓的 Levenshtein 计算）
        if (Math.abs(s.normalized.length - normalized.length) > fuzzyThreshold) return false;
        return levenshteinDistance(normalized, s.normalized) <= fuzzyThreshold;
      });
      if (isFuzzyDup) return false;
    }

    seen.push({ issueType, normalized });
    return true;
  });
}
