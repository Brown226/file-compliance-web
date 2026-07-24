// backend/src/services/review/cross-review/smart-judge.service.ts
/**
 * 智能判标服务 — 交叉复核第一层
 *
 * 对合规/不合规结论做初次打分判定，过滤低置信度的误报。
 */

import { PipelineContext } from '../../review-pipeline/types';
import { ReviewIssue } from '../../llm/llm.service';

export class SmartJudgeService {
  static async judge(issues: ReviewIssue[], _ctx: PipelineContext): Promise<ReviewIssue[]> {
    if (issues.length === 0) return [];

    // 简化实现：过滤 confidence=LOW 的条目（视为低置信度误报）
    // 完整实现：调 LLM 对每条 issue 打分
    const filtered = issues.filter(i => {
      const confidence = (i as any).confidence;
      return confidence !== 'LOW';
    });

    console.log(`[SmartJudge] 判标: 输入 ${issues.length} 条，过滤 LOW 后 ${filtered.length} 条`);
    return filtered;
  }
}
