// backend/src/services/review/cross-review/smart-judge.service.ts
/**
 * 智能判标服务 — 交叉复核第二层
 *
 * 调 LLM 对每条 issue 打分（HIGH/MEDIUM/LOW），过滤低置信度误报。
 * LLM 失败时保留原始结果（不丢弃）。
 */

import { PipelineContext } from '../../review-pipeline/types';
import { LlmService, ReviewIssue } from '../../llm/llm.service';

const BATCH_SIZE = 10;

export class SmartJudgeService {
  static async judge(issues: ReviewIssue[], _ctx: PipelineContext): Promise<ReviewIssue[]> {
    if (issues.length === 0) return [];

    // 分批调 LLM 打分
    const scored: ReviewIssue[] = [];
    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
      const batch = issues.slice(i, i + BATCH_SIZE);
      try {
        const judged = await this.judgeBatch(batch, _ctx);
        scored.push(...judged);
      } catch (e) {
        // LLM 失败时保留原始结果
        console.error('[SmartJudge] LLM 打分失败，保留原始结果:', e);
        scored.push(...batch);
      }
    }

    // 不再过滤丢弃 LOW：LOW 保留并标记置信度，由落库层转为"待人工复核"（PENDING_REVIEW），
    // 避免"疑似误报"从用户视野中直接消失（2026-08 P1-6 修复）
    console.log(`[SmartJudge] 判标: 输入 ${issues.length} 条，LOW 置信度 ${scored.filter(i => i.confidence === 'LOW').length} 条（转人工复核）`);
    return scored;
  }

  private static async judgeBatch(issues: ReviewIssue[], ctx?: PipelineContext): Promise<ReviewIssue[]> {
    const items = issues.map((i, idx) => ({
      index: idx,
      issueType: i.issueType,
      originalText: (i.originalText || '').slice(0, 200),
      description: (i.description || '').slice(0, 200),
      severity: i.severity || 'warning',
    }));

    const prompt = `你是工程文件审查的智能判标专家。请对以下审查问题逐条评估置信度（HIGH/MEDIUM/LOW）。

判定标准：
- HIGH：问题明确、证据充分、判定准确
- MEDIUM：问题存在但证据不够充分，或描述不够清晰
- LOW：疑似误报、过度解读、或问题不成立

审查问题列表（JSON）：
${JSON.stringify(items, null, 2)}

请只输出 JSON 数组，格式为 [{"index": 0, "confidence": "HIGH", "reason": "简短理由"}]，不要输出其他文字。`;

    const response = await LlmService.chat(prompt, {
      systemPrompt: '你是工程文件审查的智能判标专家。只输出 JSON，不要输出其他文字。',
      temperature: 0.1,
      timeout: 60,
      taskId: ctx?.taskId,
      mode: 'smart-judge',
    });

    // 解析 LLM 返回的置信度
    const scores = this.parseJudgeResponse(response);

    // 将置信度与理由写回 issue（类型化字段，不再用 any 硬挂）
    return issues.map((issue, idx) => {
      const score = scores.get(idx);
      if (score) {
        issue.confidence = (score.confidence === 'HIGH' || score.confidence === 'MEDIUM' || score.confidence === 'LOW')
          ? score.confidence
          : undefined;
        issue.confidenceReason = score.reason || undefined;
      }
      return issue;
    });
  }

  private static parseJudgeResponse(response: string): Map<number, { confidence: string; reason: string }> {
    const result = new Map<number, { confidence: string; reason: string }>();
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return result;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return result;
      for (const item of parsed) {
        if (typeof item.index === 'number' && typeof item.confidence === 'string') {
          result.set(item.index, {
            confidence: item.confidence.toUpperCase(),
            reason: item.reason || '',
          });
        }
      }
    } catch (e) {
      console.warn('[SmartJudge] 解析 LLM 打分响应失败:', e);
    }
    return result;
  }
}
