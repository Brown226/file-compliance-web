// 文本交叉复核服务测试（交叉复核第三层）
// 1. 精确去重（originalText 完全相同）
// 2. 归一化去重（空白折叠、标点差异）
// 3. LLM 交叉核验（remove 索引删除）+ 失败保留原始
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextCrossCheckService } from '../text-cross-check.service';
import { LlmService } from '../../../llm/llm.service';
import type { ReviewIssue } from '../../../llm/llm.service';

vi.mock('../../../llm/llm.service', () => ({
  LlmService: {
    reviewText: vi.fn(),
    chat: vi.fn(),
  },
}));

function makeIssue(partial: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueType: 'VIOLATION',
    originalText: '参数不符合要求',
    description: '描述内容',
    severity: 'error',
    ...partial,
  };
}

describe('TextCrossCheckService（文本交叉复核）', () => {
  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chatMock = vi.mocked(LlmService.chat);
    chatMock.mockReset().mockResolvedValue(JSON.stringify({ remove: [] }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('空输入直接返回空数组，不调用 LLM', async () => {
    const result = await TextCrossCheckService.check([], {} as any);
    expect(result).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('精确去重：originalText 完全相同的多条只保留一条，去重后仅 1 条不触发 LLM', async () => {
    const issues = [
      makeIssue({ originalText: '完全相同的原文' }),
      makeIssue({ originalText: '完全相同的原文' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(chatMock).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('精确去重后仍有 2 条时触发 LLM 核验并保留结果', async () => {
    const issues = [
      makeIssue({ originalText: '完全相同的原文' }),
      makeIssue({ originalText: '完全相同的原文' }),
      makeIssue({ originalText: '不同的原文' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.map(i => i.originalText)).toEqual(['完全相同的原文', '不同的原文']);
  });

  it('归一化去重：多余空白折叠后相同视为重复', async () => {
    const issues = [
      makeIssue({ originalText: '阀门  型号为 DN50', description: '同一处' }),
      makeIssue({ originalText: '阀门 型号为 DN50', description: '同一处' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('同一处'); // 保留先出现的
  });

  it('归一化去重：全角/半角标点与大小写差异视为重复', async () => {
    const issues = [
      makeIssue({ originalText: 'ABC，你好。', description: '同一处' }),
      makeIssue({ originalText: 'abc,你好.', description: '同一处' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result).toHaveLength(1);
  });

  it('description 不同时即使 originalText 相似也不视为重复', async () => {
    const issues = [
      makeIssue({ originalText: 'ABC，你好。', description: '描述A' }),
      makeIssue({ originalText: 'abc,你好.', description: '描述B' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result).toHaveLength(2);
  });

  it('LLM 交叉核验：按 remove 索引删除对应条目', async () => {
    chatMock.mockResolvedValue(JSON.stringify({ remove: [1] }));
    const issues = [
      makeIssue({ originalText: 'A', description: '问题A' }),
      makeIssue({ originalText: 'B', description: '问题B' }),
      makeIssue({ originalText: 'C', description: '问题C' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.map(i => i.originalText)).toEqual(['A', 'C']);
  });

  it('LLM 失败时保留去重后的原始结果（不丢弃不崩溃）', async () => {
    chatMock.mockRejectedValue(new Error('LLM timeout'));
    const issues = [
      makeIssue({ originalText: 'A' }),
      makeIssue({ originalText: 'B' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result).toHaveLength(2);
  });

  it('LLM 返回非 JSON 时保留去重后的原始结果', async () => {
    chatMock.mockResolvedValue('抱歉，无法输出 JSON');
    const issues = [
      makeIssue({ originalText: 'A' }),
      makeIssue({ originalText: 'B' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result).toHaveLength(2);
  });

  it('LLM 返回 remove 中混入非法值时忽略非法项', async () => {
    chatMock.mockResolvedValue(JSON.stringify({ remove: [0, 'x', -1] }));
    const issues = [
      makeIssue({ originalText: 'A' }),
      makeIssue({ originalText: 'B' }),
    ];
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(result.map(i => i.originalText)).toEqual(['B']);
  });

  it('超过 BATCH_SIZE(15) 时按批次多次调用 LLM 并合并', async () => {
    const issues = Array.from({ length: 32 }, (_, idx) => makeIssue({ originalText: `问题${idx}`, description: `描述${idx}` }));
    const result = await TextCrossCheckService.check(issues, {} as any);
    expect(chatMock).toHaveBeenCalledTimes(3); // 15 + 15 + 2
    expect(result).toHaveLength(32);
  });
});
