// P1-6 回归测试：判标置信度体系
// - LOW 置信度不再被丢弃（转人工复核而非消失）
// - confidence / confidenceReason 写回 issue（类型化字段）
// - LLM 打分失败时保留原始结果
// - 非法置信度值不写入
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartJudgeService } from '../smart-judge.service';
import { LlmService, ReviewIssue } from '../../../llm/llm.service';

function makeIssue(partial: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueType: 'CONSISTENCY',
    originalText: '原文内容',
    severity: 'warning',
    ...partial,
  };
}

describe('SmartJudgeService（P1-6 判标置信度）', () => {
  let chatSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chatSpy = vi.spyOn(LlmService, 'chat').mockResolvedValue(
      JSON.stringify([
        { index: 0, confidence: 'HIGH', reason: '证据充分' },
        { index: 1, confidence: 'MEDIUM', reason: '证据一般' },
        { index: 2, confidence: 'LOW', reason: '疑似误报' },
      ])
    );
  });

  afterEach(() => {
    chatSpy.mockRestore();
  });

  it('LOW 置信度条目保留，不再被过滤丢弃', async () => {
    const issues = [
      makeIssue({ issueType: 'CONSISTENCY', originalText: 'A' }),
      makeIssue({ issueType: 'CONSISTENCY', originalText: 'B' }),
      makeIssue({ issueType: 'CONSISTENCY', originalText: 'C' }),
    ];
    const result = await SmartJudgeService.judge(issues, {} as any);
    expect(result).toHaveLength(3); // 全部保留
    expect(result.some(i => i.confidence === 'LOW')).toBe(true);
  });

  it('confidence 与 confidenceReason 写回 issue', async () => {
    const issues = [
      makeIssue({ originalText: 'A' }),
      makeIssue({ originalText: 'B' }),
    ];
    const [a, b] = await SmartJudgeService.judge(issues, {} as any);
    expect(a.confidence).toBe('HIGH');
    expect(a.confidenceReason).toBe('证据充分');
    expect(b.confidence).toBe('MEDIUM');
    expect(b.confidenceReason).toBe('证据一般');
  });

  it('LLM 打分失败时保留原始结果（不丢弃不崩溃）', async () => {
    chatSpy.mockRejectedValue(new Error('LLM timeout'));
    const issues = [makeIssue({ originalText: 'A' }), makeIssue({ originalText: 'B' })];
    const result = await SmartJudgeService.judge(issues, {} as any);
    expect(result).toHaveLength(2);
    expect(result[0].confidence).toBeUndefined();
  });

  it('非法置信度值不写入，reason 仍可写入', async () => {
    chatSpy.mockResolvedValue(
      JSON.stringify([{ index: 0, confidence: 'EXTREME', reason: '奇怪的值' }])
    );
    const issues = [makeIssue({ originalText: 'A' })];
    const [issue] = await SmartJudgeService.judge(issues, {} as any);
    expect(issue.confidence).toBeUndefined();
    expect(issue.confidenceReason).toBe('奇怪的值');
  });

  it('LLM 返回非 JSON 时保留原始结果', async () => {
    chatSpy.mockResolvedValue('抱歉，我无法输出 JSON');
    const issues = [makeIssue({ originalText: 'A' })];
    const result = await SmartJudgeService.judge(issues, {} as any);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeUndefined();
  });

  it('空输入直接返回空数组（不调 LLM）', async () => {
    const result = await SmartJudgeService.judge([], {} as any);
    expect(result).toEqual([]);
    expect(chatSpy).not.toHaveBeenCalled();
  });
});
