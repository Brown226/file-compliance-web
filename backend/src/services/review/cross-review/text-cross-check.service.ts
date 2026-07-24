// backend/src/services/review/cross-review/text-cross-check.service.ts
/**
 * 文本交叉复核服务 — 交叉复核第三层
 *
 * 1. 精确去重（originalText 完全相同）
 * 2. 归一化去重（去除空白、标点差异后相同）
 * 3. LLM 交叉核验（检测矛盾和语义重复，修正片面判断）
 *
 * LLM 失败时保留前两步去重结果（不丢弃）。
 */

import { PipelineContext } from '../../review-pipeline/types';
import { LlmService, ReviewIssue } from '../../llm/llm.service';

const BATCH_SIZE = 15;

export class TextCrossCheckService {
  static async check(issues: ReviewIssue[], _ctx: PipelineContext): Promise<ReviewIssue[]> {
    if (issues.length === 0) return [];

    // 第一步：精确去重
    let deduped = this.deduplicateExact(issues);

    // 第二步：归一化去重
    deduped = this.deduplicateNormalized(deduped);

    // 第三步：LLM 交叉核验
    const crossChecked = await this.crossCheckWithLLM(deduped);

    console.log(`[TextCrossCheck] 文本复核: 输入 ${issues.length} 条，去重 ${deduped.length} 条，交叉核验后 ${crossChecked.length} 条`);
    return crossChecked;
  }

  /** 精确去重：originalText 完全相同 */
  private static deduplicateExact(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Set<string>();
    return issues.filter(i => {
      const key = (i.originalText || '').trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** 归一化去重：去除空白、标点差异后相同 */
  private static deduplicateNormalized(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Set<string>();
    return issues.filter(i => {
      const key = this.normalize((i.originalText || '') + '|' + (i.description || ''));
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private static normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[，。！？；：、""''（）【】《》,.!?;:"'()\[\]<>]/g, '')
      .trim();
  }

  /** LLM 交叉核验：检测矛盾和语义重复 */
  private static async crossCheckWithLLM(issues: ReviewIssue[]): Promise<ReviewIssue[]> {
    if (issues.length <= 1) return issues;

    const results: ReviewIssue[] = [];
    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
      const batch = issues.slice(i, i + BATCH_SIZE);
      try {
        const checked = await this.crossCheckBatch(batch);
        results.push(...checked);
      } catch (e) {
        // LLM 失败时保留原始结果
        console.error('[TextCrossCheck] LLM 交叉核验失败，保留原始结果:', e);
        results.push(...batch);
      }
    }
    return results;
  }

  private static async crossCheckBatch(issues: ReviewIssue[]): Promise<ReviewIssue[]> {
    const items = issues.map((i, idx) => ({
      index: idx,
      issueType: i.issueType,
      originalText: (i.originalText || '').slice(0, 200),
      description: (i.description || '').slice(0, 200),
      severity: i.severity || 'warning',
    }));

    const prompt = `你是工程文件审查的文本交叉核验专家。请检查以下审查问题是否存在矛盾或语义重复。

检查项：
1. 矛盾：两条问题对同一内容的判定相反（如一条说"缺失"，另一条说"存在"）
2. 语义重复：两条问题实质相同，只是表述不同

审查问题列表（JSON）：
${JSON.stringify(items, null, 2)}

请只输出 JSON，格式为 {"remove": [需要删除的 issue index 列表]}，不要输出其他文字。`;

    const response = await LlmService.chat(prompt, {
      systemPrompt: '你是工程文件审查的文本交叉核验专家。只输出 JSON，不要输出其他文字。',
      temperature: 0.1,
      timeout: 60,
    });

    const removeSet = this.parseCrossCheckResponse(response);

    return issues.filter((_, idx) => !removeSet.has(idx));
  }

  private static parseCrossCheckResponse(response: string): Set<number> {
    const removeSet = new Set<number>();
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return removeSet;
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.remove)) {
        for (const idx of parsed.remove) {
          if (typeof idx === 'number') removeSet.add(idx);
        }
      }
    } catch (e) {
      console.warn('[TextCrossCheck] 解析 LLM 交叉核验响应失败:', e);
    }
    return removeSet;
  }
}
