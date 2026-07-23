/**
 * OPT-016: output-to-source 一致性校验
 *
 * LLM 可能编造 sourceReferences（引用不存在的知识库段落）。
 * 本服务在入库前校验 issue 的 sourceReferences 是否真实存在于 RAG 检索结果中。
 *
 * 校验策略：
 * 1. 对每条 issue 的 sourceReferences.content，检查是否在 ragChunks 中存在（归一化后子串匹配）
 * 2. 不匹配的 sourceReference 标记 unverified: true
 * 3. 所有 sourceReferences 均不匹配的 issue，confidence 降级为 AI_INFERRED
 */

import { ReviewIssue, SourceReference } from '../llm/llm.service';

export interface ValidatedSourceReference extends SourceReference {
  /** 来源是否已验证（存在于 RAG 检索结果中） */
  unverified?: boolean;
}

export interface SourceValidationResult {
  issues: ReviewIssue[];
  /** 被降级的 issue 数量 */
  downgradedCount: number;
  /** 被标记为 unverified 的 source 数量 */
  unverifiedSourceCount: number;
}

/**
 * 归一化文本用于比较
 */
function normalizeForComparison(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：""''（）【】《》,.:;'"()\[\]{}<>]/g, '')
    .toLowerCase()
    .slice(0, 200); // 只取前 200 字符比较，避免过长
}

/**
 * 校验 sourceReferences 的真实性
 *
 * @param issues LLM 产出的审查问题列表
 * @param ragChunks RAG 实际检索到的知识库片段（作为"真相源"）
 * @param text 待审文本（用于校验 originalText 是否存在）
 */
export function validateSources(
  issues: ReviewIssue[],
  ragChunks: string[],
  text?: string,
): SourceValidationResult {
  if (!issues || issues.length === 0) {
    return { issues: [], downgradedCount: 0, unverifiedSourceCount: 0 };
  }

  // 预计算 RAG chunks 的归一化集合
  const normalizedChunks = ragChunks.map(c => normalizeForComparison(c));
  const normalizedText = text ? normalizeForComparison(text) : '';

  let downgradedCount = 0;
  let unverifiedSourceCount = 0;

  const validatedIssues = issues.map(issue => {
    const sources = issue.sourceReferences as ValidatedSourceReference[] | undefined;
    if (!sources || sources.length === 0) {
      return issue; // 无 sourceReferences 的 issue 不做校验
    }

    let verifiedCount = 0;

    const validatedSources = sources.map(source => {
      if (!source.content) {
        unverifiedSourceCount++;
        return { ...source, unverified: true };
      }

      const normalizedSource = normalizeForComparison(source.content);

      // 检查是否在 RAG chunks 中存在
      const foundInChunks = normalizedChunks.some(chunk =>
        chunk.includes(normalizedSource) || normalizedSource.includes(chunk.slice(0, 50))
      );

      // 也检查是否在待审文本中存在（某些 source 可能引用的是原文）
      const foundInText = normalizedText.length > 0 && normalizedText.includes(normalizedSource.slice(0, 50));

      if (foundInChunks || foundInText) {
        verifiedCount++;
        return source; // 验证通过
      }

      // 未验证
      unverifiedSourceCount++;
      return { ...source, unverified: true };
    });

    // 如果所有 source 都未验证，降级 confidence
    if (verifiedCount === 0 && sources.length > 0) {
      downgradedCount++;
      return {
        ...issue,
        sourceReferences: validatedSources,
        // 标记为需要降级（由调用方处理 confidence 字段）
        _sourceDowngraded: true,
      } as any;
    }

    return { ...issue, sourceReferences: validatedSources };
  });

  if (downgradedCount > 0 || unverifiedSourceCount > 0) {
    console.log(`[SourceValidation] 校验完成: ${downgradedCount} 条 issue 来源全未验证被降级, ${unverifiedSourceCount} 条 source 标记 unverified`);
  }

  return {
    issues: validatedIssues,
    downgradedCount,
    unverifiedSourceCount,
  };
}
