// standard-clause-check 的 LLM 调用链路测试（checkSingleClause / checkClauses）
// - mock LlmService.getLlmConfig + global fetch（OpenAI 兼容响应）
// - NON_COMPLIANT / COMPLIANT / 非 JSON / 未配置 各分支
// - checkPrompt 注入用户 prompt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StandardClauseCheckService } from '../standard-clause-check.service';

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    getLlmConfig: vi.fn(),
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

function makeFetchResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as any;
}

describe('StandardClauseCheckService LLM 链路', () => {
  let getLlmConfigMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getLlmConfigMock = vi.mocked(LlmService.getLlmConfig);
    getLlmConfigMock.mockReset().mockResolvedValue({
      apiBaseUrl: 'https://llm.example.com/v1',
      apiKey: 'test-key',
      modelName: 'test-model',
      timeout: 60,
      provider: 'openai-compatible',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('checkSingleClause 解析 NON_COMPLIANT 并注入 checkPrompt 到用户 prompt', async () => {
    fetchMock.mockResolvedValue(makeFetchResponse(
      JSON.stringify({ status: 'NON_COMPLIANT', description: '本厂房实际按 6 度抗震设防，不符合 7 度要求', suggestion: '应改为 7 度', originalText: '按 6 度抗震设防' })
    ));
    const result = await StandardClauseCheckService.checkSingleClause(
      makeClause({ checkPrompt: '重点核对抗震设防烈度' }),
      '厂房按 6 度设防',
      { temperature: 0.1, timeout: 60 },
    );
    expect(result.status).toBe('NON_COMPLIANT');
    expect(result.description).toBe('本厂房实际按 6 度抗震设防，不符合 7 度要求');
    expect(result.suggestion).toBe('应改为 7 度');

    // 断言 fetch 调用：URL、Authorization、body 含 checkPrompt
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0.1);
    expect(body.messages[1].content).toContain('审查提示：重点核对抗震设防烈度');
  });

  it('checkSingleClause 解析 COMPLIANT（符合条文不产出问题）', async () => {
    fetchMock.mockResolvedValue(makeFetchResponse(JSON.stringify({ status: 'COMPLIANT' })));
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('COMPLIANT');
    expect(result.description).toBeNull();
  });

  it('LLM 返回非 JSON 时降级为 UNVERIFIED（不崩溃）', async () => {
    fetchMock.mockResolvedValue(makeFetchResponse('抱歉，我无法输出 JSON'));
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
  });

  it('LLM 未配置时返回 UNVERIFIED 且描述含核对出错', async () => {
    getLlmConfigMock.mockResolvedValue(null);
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.description).toContain('核对出错');
  });

  it('LLM API 返回错误状态时降级为 UNVERIFIED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as any);
    const result = await StandardClauseCheckService.checkSingleClause(makeClause(), '厂房按 7 度设防');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.description).toContain('核对出错');
  });

  it('checkClauses 批量并发逐条核对并正确统计计数', async () => {
    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(JSON.stringify({ status: 'NON_COMPLIANT', description: '本条文要求 7 度设防，实际设计为 6 度，存在不满足情况', suggestion: '修改建议' })))
      .mockResolvedValueOnce(makeFetchResponse(JSON.stringify({ status: 'COMPLIANT' })));
    const { results, compliant, nonCompliant, unverified } = await StandardClauseCheckService.checkClauses(
      [makeClause(), makeClause({ id: 'c2', code: '6.1.1' })],
      '待审文本',
      { concurrency: 3 },
    );
    expect(results).toHaveLength(2);
    expect(compliant).toBe(1);
    expect(nonCompliant).toBe(1);
    expect(unverified).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('checkClauses 空条文列表返回空结果', async () => {
    const { results, compliant, nonCompliant, unverified } = await StandardClauseCheckService.checkClauses([], '文本');
    expect(results).toEqual([]);
    expect(compliant + nonCompliant + unverified).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checkClauses 并发批量（concurrency=1）串行执行且计数正确', async () => {
    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(JSON.stringify({ status: 'COMPLIANT' })))
      .mockResolvedValueOnce(makeFetchResponse(JSON.stringify({ status: 'UNVERIFIED' })));
    const { compliant, unverified } = await StandardClauseCheckService.checkClauses(
      [makeClause(), makeClause({ id: 'c2', code: '6.1.1' })],
      '待审文本',
      { concurrency: 1 },
    );
    expect(compliant).toBe(1);
    expect(unverified).toBe(1);
  });
});
