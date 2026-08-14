// standard-clause-check 的 LLM 调用链路测试（checkSingleClause / checkClauses）
// - mock LlmService.chat（P2-3：自建 fetch 的 callLlmRaw 已替换为 LlmService.chat 主入口）
// - NON_COMPLIANT / COMPLIANT / 非 JSON / 未配置 各分支
// - checkPrompt 注入用户 prompt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StandardClauseCheckService } from '../standard-clause-check.service';

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    chat: vi.fn(),
  },
}));

import { LlmService } from '../../llm/llm.service';

function makeClause(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: '5.2.3',
    title: '抗震设防',
    content: '核岛厂房应按 7 度抗震设防。',
    category: 'compliance',
    ...overrides,
  };
}

describe('StandardClauseCheckService LLM 链路', () => {
  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chatMock = vi.mocked(LlmService.chat);
    chatMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('checkSingleClause 解析 NON_COMPLIANT 并注入 checkPrompt 到用户 prompt', async () => {
    chatMock.mockResolvedValue(
      JSON.stringify({ status: 'NON_COMPLIANT', description: '本厂房实际按 6 度抗震设防，不符合 7 度要求', suggestion: '应改为 7 度', originalText: '按 6 度抗震设防' })
    );
    const result = await StandardClauseCheckService.checkSingleClause(
      makeClause({ checkPrompt: '重点核对抗震设防烈度' }),
      '厂房按 6 度设防',
      { temperature: 0.1, timeout: 60 },
    );
    expect(result.status).toBe('NON_COMPLIANT');
    expect(result.description).toBe('本厂房实际按 6 度抗震设防，不符合 7 度要求');
    expect(result.suggestion).toBe('应改为 7 度');

    // 断言 chat 调用：用户 prompt 含 checkPrompt、systemPrompt 与 temperature 透传
    expect(chatMock).toHaveBeenCalledTimes(1);
    const [prompt, options] = chatMock.mock.calls[0];
    expect(prompt).toContain('审查提示：重点核对抗震设防烈度');
    expect(options.systemPrompt).toContain('标准条文');
    expect(options.temperature).toBe(0.1);
    expect(options.timeout).toBe(60);
  });

  it('checkSingleClause 解析 COMPLIANT（符合条文不产出问题）', async () => {
    chatMock.mockResolvedValue(JSON.stringify({ status: 'COMPLIANT' }));
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('COMPLIANT');
    expect(result.description).toBeNull();
  });

  it('P1-5: textOverride 优先于全局 text 注入（DEC 章节块映射）', async () => {
    chatMock.mockResolvedValue(JSON.stringify({ status: 'UNVERIFIED' }));
    await StandardClauseCheckService.checkSingleClause(
      makeClause({ textOverride: '【命中章节块】5.2.3 抗震设防相关内容……' }),
      '这是全局全文，不应被注入',
    );
    const [prompt] = chatMock.mock.calls[0];
    expect(prompt).toContain('【命中章节块】5.2.3 抗震设防相关内容');
    expect(prompt).not.toContain('这是全局全文');
  });

  it('P1-5: 无 textOverride 时回退全局 text（兼容既有调用）', async () => {
    chatMock.mockResolvedValue(JSON.stringify({ status: 'UNVERIFIED' }));
    await StandardClauseCheckService.checkSingleClause(makeClause(), '全局全文兜底注入');
    const [prompt] = chatMock.mock.calls[0];
    expect(prompt).toContain('全局全文兜底注入');
  });

  it('LLM 返回非 JSON 时降级为 UNVERIFIED（不崩溃）', async () => {
    chatMock.mockResolvedValue('抱歉，我无法输出 JSON');
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
  });

  it('LLM 调用抛错时返回 UNVERIFIED 且描述含核对出错', async () => {
    chatMock.mockRejectedValue(new Error('LLM 未配置，请在系统配置中设置 LLM API'));
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.description).toContain('核对出错');
  });

  it('LLM API 返回错误状态时降级为 UNVERIFIED', async () => {
    chatMock.mockRejectedValue(new Error('LLM API 返回 500'));
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.description).toContain('核对出错');
  });

  it('checkClauses 批量并发逐条核对并正确统计计数', async () => {
    chatMock
      .mockResolvedValueOnce(JSON.stringify({ status: 'NON_COMPLIANT', description: '本条文要求 7 度设防，实际设计为 6 度，存在不满足情况', suggestion: '修改建议' }))
      .mockResolvedValueOnce(JSON.stringify({ status: 'COMPLIANT' }));
    const { results, compliant, nonCompliant, unverified } = await StandardClauseCheckService.checkClauses(
      [makeClause(), makeClause({ id: 'c2', code: '6.1.1' })],
      '待审文本',
      { concurrency: 3 },
    );
    expect(results).toHaveLength(2);
    expect(compliant).toBe(1);
    expect(nonCompliant).toBe(1);
    expect(unverified).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('checkClauses 空条文列表返回空结果', async () => {
    const { results, compliant, nonCompliant, unverified } = await StandardClauseCheckService.checkClauses([], '文本');
    expect(results).toEqual([]);
    expect(compliant + nonCompliant + unverified).toBe(0);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('checkClauses 并发批量（concurrency=1）串行执行且计数正确', async () => {
    chatMock
      .mockResolvedValueOnce(JSON.stringify({ status: 'COMPLIANT' }))
      .mockResolvedValueOnce(JSON.stringify({ status: 'UNVERIFIED' }));
    const { compliant, unverified } = await StandardClauseCheckService.checkClauses(
      [makeClause(), makeClause({ id: 'c2', code: '6.1.1' })],
      '待审文本',
      { concurrency: 1 },
    );
    expect(compliant).toBe(1);
    expect(unverified).toBe(1);
  });
});
