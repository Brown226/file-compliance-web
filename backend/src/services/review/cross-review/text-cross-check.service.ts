// backend/src/services/review/cross-review/text-cross-check.service.ts
/**
 * 文本交叉复核服务 — 交叉复核第三层
 *
 * 交叉核验上下文逻辑，修正片面判断。
 */

import { PipelineContext } from '../../review-pipeline/types';
import { ReviewIssue } from '../../llm/llm.service';

export class TextCrossCheckService {
  static async check(issues: ReviewIssue[], _ctx: PipelineContext): Promise<ReviewIssue[]> {
    if (issues.length === 0) return [];

    // 简化实现：去重（originalText 相同的保留第一条）
    const seen = new Set<string>();
    const deduped = issues.filter(i => {
      const key = (i.originalText || '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[TextCrossCheck] 文本复核: 输入 ${issues.length} 条，去重后 ${deduped.length} 条`);
    return deduped;
  }
}
