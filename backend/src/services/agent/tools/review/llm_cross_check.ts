/**
 * llm_cross_check 工具 — LLM 交叉验证已发现问题
 *
 * 工作方式：
 * 1. 精确去重（originalText 完全相同）
 * 2. 归一化去重（去除空白+标点后相同）
 * 3. LLM 交叉核验：检测矛盾（如"缺失"vs"存在"）和语义重复
 * 4. 返回去重+核验后的 ReviewIssue[]
 *
 * LLM 调用失败时保留前两步的去重结果，不丢弃问题。
 *
 * 参数：
 * - issues: ReviewIssue[] 数组
 * - batchSize: 每批交叉核验数量（默认 15）
 *
 * 返回：
 * - issues: 核验后的 ReviewIssue[]
 * - originalCount: 原始问题数
 * - exactDeduped: 精确去重后数量
 * - normalizedDeduped: 归一化去重后数量
 * - finalCount: 最终数量
 * - removedIndices: 被移除的索引列表
 */
import { z } from 'zod';
import { LlmService, type ReviewIssue } from '../../../llm/llm.service';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

const DEFAULT_BATCH_SIZE = 15;

/** 交叉核验结果 */
interface CrossCheckResult {
  issues: ReviewIssue[];
  originalCount: number;
  exactDeduped: number;
  normalizedDeduped: number;
  finalCount: number;
  removedIndices: number[];
}

/** 精确去重（originalText 完全相同） */
function deduplicateExact(issues: ReviewIssue[]): { deduped: ReviewIssue[]; removed: number[] } {
  const seen = new Map<string, number>(); // text → first index
  const removed: number[] = [];
  const deduped: ReviewIssue[] = [];

  for (let i = 0; i < issues.length; i++) {
    const key = (issues[i].originalText || '') + '|' + (issues[i].issueType || '');
    if (!key.trim()) {
      deduped.push(issues[i]);
      continue;
    }
    if (seen.has(key)) {
      removed.push(i);
    } else {
      seen.set(key, i);
      deduped.push(issues[i]);
    }
  }

  return { deduped, removed };
}

/** 归一化去重（去除空白+标点差异后相同） */
function deduplicateNormalized(issues: ReviewIssue[]): { deduped: ReviewIssue[]; removed: number[] } {
  const normalize = (s: string) =>
    s.toLowerCase()
     .replace(/\s+/g, '')
     .replace(/[，。！？；：、""''（）【】《》,.!?;:"'()\[\]<>]/g, '')
     .trim();

  const seen = new Map<string, number>();
  const removed: number[] = [];
  const deduped: ReviewIssue[] = [];

  for (let i = 0; i < issues.length; i++) {
    const key = normalize((issues[i].originalText || '') + '|' + (issues[i].description || ''));
    if (!key) {
      deduped.push(issues[i]);
      continue;
    }
    if (seen.has(key)) {
      removed.push(i);
    } else {
      seen.set(key, i);
      deduped.push(issues[i]);
    }
  }

  return { deduped, removed };
}

/** LLM 交叉核验：检测矛盾和语义重复 */
async function crossCheckBatch(
  issues: ReviewIssue[],
): Promise<{ issues: ReviewIssue[]; removed: number[] }> {
  if (issues.length <= 1) return { issues, removed: [] };

  const items = issues.map((i, idx) => ({
    index: idx,
    issueType: i.issueType,
    originalText: (i.originalText || '').slice(0, 200),
    description: (i.description || '').slice(0, 200),
    severity: i.severity || 'warning',
  }));

  const prompt = `你是工程文件审查的交叉核验专家。请检查以下审查问题是否存在矛盾或语义重复。

检查项：
1. 矛盾：两条问题对同一内容的判定相反（如一条说"缺失"，另一条说"存在"）
2. 语义重复：两条问题实质相同，只是表述不同

审查问题列表（JSON）：
${JSON.stringify(items, null, 2)}

请只输出 JSON，格式为 {"remove": [需要删除的 issue index 列表]}，不要输出其他文字。`;

  try {
    const response = await LlmService.chat(prompt, {
      systemPrompt: '你是工程文件审查的交叉核验专家。只输出 JSON，不要输出其他文字。',
      temperature: 0.1,
      timeout: 60,
      mode: 'agent-cross-check',
    });

    // 解析 LLM 响应
    const removeSet = new Set<number>();
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.remove)) {
        for (const idx of parsed.remove) {
          if (typeof idx === 'number' && idx >= 0 && idx < issues.length) {
            removeSet.add(idx);
          }
        }
      }
    }

    const keepIssues = issues.filter((_, idx) => !removeSet.has(idx));
    const removed = issues
      .map((_, idx) => idx)
      .filter(idx => removeSet.has(idx));

    return { issues: keepIssues, removed };
  } catch (e) {
    // LLM 失败时保留所有问题（降级策略）
    console.error('[Agent:llm_cross_check] LLM 交叉核验失败，保留原始结果:', (e as Error).message);
    return { issues, removed: [] };
  }
}

/**
 * 创建 llm_cross_check 工具
 */
export function createLlmCrossCheckTool(_context: ToolContext) {
  return tool({
    description: '对已发现的问题做交叉验证：精确去重（originalText 完全相同）→ 归一化去重（去除空白标点后相同）→ LLM 交叉核验（检测矛盾如"缺失"vs"存在"和语义重复）。LLM 核验失败时保留去重结果，不丢弃问题。返回核验后的 ReviewIssue[] 和每一步的统计数字。',
    inputSchema: z.object({
      issues: z.array(z.object({
        issueType: z.string(),
        originalText: z.string(),
        suggestedText: z.string().optional(),
        description: z.string().optional(),
        severity: z.string().optional(),
        riskLevel: z.string().optional(),
        ruleCode: z.string().optional(),
        standardRef: z.string().optional(),
      }).passthrough()).describe('待交叉核验的问题列表（ReviewIssue[] 格式，至少含 issueType + originalText）'),
      batchSize: z.number().int().min(5).max(30).optional().default(15).describe('每批 LLM 核验的问题数（默认 15）'),
    }),
    execute: async ({ issues, batchSize }): Promise<CrossCheckResult> => {
      const originalCount = issues.length;
      if (originalCount === 0) {
        return {
          issues: [],
          originalCount: 0,
          exactDeduped: 0,
          normalizedDeduped: 0,
          finalCount: 0,
          removedIndices: [],
        };
      }

      // 第一步：精确去重
      const exactResult = deduplicateExact(issues as ReviewIssue[]);
      let current = exactResult.deduped;
      const exactDeduped = current.length;

      // 第二步：归一化去重
      const normResult = deduplicateNormalized(current);
      current = normResult.deduped;
      const normalizedDeduped = current.length;

      // 第三步：LLM 交叉核验（分批）
      const allRemoved: number[] = [];
      const finalIssues: ReviewIssue[] = [];

      for (let i = 0; i < current.length; i += (batchSize || DEFAULT_BATCH_SIZE)) {
        const batch = current.slice(i, i + (batchSize || DEFAULT_BATCH_SIZE));
        const result = await crossCheckBatch(batch);

        // 偏移量调整（batch 内的索引映射回 current 索引）
        const offsetRemoved = result.removed.map(r => i + r);
        allRemoved.push(...offsetRemoved);
        finalIssues.push(...result.issues);
      }

      return {
        issues: finalIssues,
        originalCount,
        exactDeduped,
        normalizedDeduped,
        finalCount: finalIssues.length,
        removedIndices: allRemoved,
      };
    },
  });
}
