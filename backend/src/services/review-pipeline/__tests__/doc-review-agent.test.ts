/**
 * doc-review-agent 单元测试（路线甲二期 B 以文审文条目级对齐）
 *
 * 覆盖：
 * - 条目抽取为空 → degraded 降级（不影响主流程）
 * - 正常流程：条目抽取 → 预嵌入 → 逐条对齐（matched 不报 / mismatched 报 + ruleCode 绑定）
 * - 数值/日期类条目 + 相似度低 → 触发自检 C 二次复核
 * - 预嵌入失败 → 逐条目退化仍工作
 * - issues 去重
 *
 * 通过 mock LlmService / EmbeddingService / system-config 隔离外部依赖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatMock = vi.fn();
const reviewTextMock = vi.fn();
const splitTextMock = vi.fn();
const embedTextMock = vi.fn();
const embedTextsMock = vi.fn();

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    chat: (...args: any[]) => chatMock(...args),
    reviewText: (...args: any[]) => reviewTextMock(...args),
    splitText: (...args: any[]) => splitTextMock(...args),
  },
}));

vi.mock('../../knowledge/embedding.service', () => ({
  EmbeddingService: {
    embedText: (...args: any[]) => embedTextMock(...args),
    embedTexts: (...args: any[]) => embedTextsMock(...args),
  },
}));

vi.mock('../../../utils/system-config', () => ({
  getChunkConcurrency: vi.fn().mockResolvedValue(2),
}));

import { runRefCompareAgent } from '../doc-review-agent.service';

const ctx = { fileId: 'f1', taskId: 't1', mode: 'doc_review' };
const config = {};

const ITEMS_JSON =
  '{"items":[' +
  '{"itemId":"ITEM_001","topic":"付款期限","requirement":"合同签订后 30 日内付款","refQuote":"付款期限不超过 30 日"},' +
  '{"itemId":"ITEM_002","topic":"违约责任","requirement":"违约金按日万分之五计算","refQuote":"按日万分之五"}' +
  ']}';

beforeEach(() => {
  chatMock.mockReset();
  reviewTextMock.mockReset();
  splitTextMock.mockReset();
  embedTextMock.mockReset();
  embedTextsMock.mockReset();

  // 默认：参照与待审文本各一块
  splitTextMock.mockImplementation((text: string) => ['参照内容', '待审内容']);
  chatMock.mockResolvedValue(ITEMS_JSON);
  embedTextMock.mockResolvedValue([1, 0]);
  embedTextsMock.mockResolvedValue([[1, 0], [0, 1]]);
  reviewTextMock.mockResolvedValue([
    { issueType: 'VIOLATION', originalText: '付款期限 60 日', severity: 'error', status: 'mismatched' },
  ]);
});

describe('条目抽取', () => {
  it('条目抽取为空 → degraded 降级', async () => {
    chatMock.mockResolvedValue('没有可用条目');
    const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('条目抽取为空');
    expect(result.itemCount).toBe(0);
    expect(result.issues).toEqual([]);
  });
});

describe('正常流程', () => {
  it('抽取 2 条 → 对齐产生 issue（ruleCode 绑定条目，matched 不报）', async () => {
    // ITEM_001 判定 mismatched → 报 issue；ITEM_002 判定 matched → 跳过
    reviewTextMock
      .mockResolvedValueOnce([{ issueType: 'VIOLATION', originalText: '付款期限 60 日', severity: 'error', status: 'mismatched' }])
      .mockResolvedValueOnce([{ issueType: 'CONSISTENCY', originalText: '违约金条款', severity: 'info', status: 'matched' }]);

    const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
    expect(result.engine).toBe('doc-review-agent');
    expect(result.itemCount).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].ruleCode).toBe('ITEM_001');
    expect(result.issues[0].standardRef).toContain('付款期限');
  });

  it('候选片段定位（embedding 命中 → candidateFound）', async () => {
    reviewTextMock.mockResolvedValue([{ issueType: 'VIOLATION', originalText: 'x', severity: 'error', status: 'mismatched' }]);
    const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
    expect(result.alignedCount).toBeGreaterThan(0);
  });
});

describe('自检 C（数值/日期 + 低相似度二次复核）', () => {
  it('无 issue 但相似度低且条目含数值 → 触发 recheckItem', async () => {
    // 单块文本 + 单条目，让对齐流程确定
    splitTextMock.mockReturnValue(['单一内容']);
    chatMock.mockResolvedValue(
      '{"items":[{"itemId":"ITEM_001","topic":"付款期限","requirement":"合同签订后 30 日内付款","refQuote":"30 日"}]}',
    );
    embedTextMock.mockResolvedValue([1, 0]);
    // 目标向量 [0.3, 0.9]：cosine([1,0],[0.3,0.9]) ≈ 0.316，落在 (0, 0.55) 触发自检
    embedTextsMock.mockResolvedValue([[0.3, 0.9]]);
    // 对齐判定 matched（无 issue）→ 自检 C 二次复核 → 更严格判定报 issue
    reviewTextMock.mockResolvedValueOnce([{ issueType: 'CONSISTENCY', originalText: 'x', severity: 'info', status: 'matched' }]);
    reviewTextMock.mockResolvedValueOnce([{ issueType: 'VIOLATION', originalText: '付款期限与参照不一致', severity: 'warning', status: 'mismatched' }]);

    const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
    // 1 次对齐判定 + 1 次自检复核
    expect(reviewTextMock.mock.calls.length).toBe(2);
    expect(result.issues).toHaveLength(1);
  });
});

describe('降级与去重', () => {
  it('预嵌入失败 → 逐条目退化仍工作', async () => {
    embedTextsMock.mockRejectedValueOnce(new Error('embedding down'));
    reviewTextMock.mockResolvedValue([{ issueType: 'VIOLATION', originalText: 'x', severity: 'error', status: 'mismatched' }]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
      expect(result.issues.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('重复 issue 被 dedupIssues 去重', async () => {
    // 两个条目产出同一 originalText 的 issue → 去重后只有 1 条
    reviewTextMock.mockResolvedValue([{ issueType: 'TYPO', originalText: '帐号', severity: 'warning', status: 'mismatched' }]);
    const result = await runRefCompareAgent('待审文本', [{ fileName: 'ref.md', content: '参照' }], ctx, config);
    const typoIssues = result.issues.filter((i: any) => i.originalText === '帐号');
    expect(typoIssues.length).toBeLessThanOrEqual(1);
  });
});
