// DEC 分支A 完整性审核服务测试
// - 无章节结构 → 跳过（不调 LLM）
// - 无 mandatory 审点 → 跳过
// - 有章节 + 审点 → 调 LLM 并透传结果
// - LLM 失败向上抛（容错由 dec-review 的 runCompletenessBranch 兜底）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompletenessReviewService } from '../completeness-review.service';
import { LlmService } from '../../llm/llm.service';
import { PromptTemplateService } from '../../llm/prompt-template.service';
import type { ReviewIssue } from '../../llm/llm.service';

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    reviewText: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock('../../llm/prompt-template.service', () => ({
  PromptTemplateService: {
    getPromptByScene: vi.fn(),
  },
}));

function makeIssue(partial: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueType: 'COMPLETENESS',
    originalText: '缺少章节',
    severity: 'warning',
    ...partial,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    fileId: 'file-1',
    fileName: '设计说明.docx',
    filePath: '/tmp/设计说明.docx',
    fileType: 'docx',
    extractedText: '',
    reviewMode: 'DEC_REVIEW',
    ...overrides,
  } as any;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    chunkSize: 4000,
    llmMaxTokens: 4096,
    llmTimeout: 180,
    ...overrides,
  } as any;
}

/** 带章节结构 + mandatory 审点的完整上下文 */
function makeFullCtx() {
  return makeCtx({
    checkpoints: [
      { id: 'cp-1', clauseCode: 'C-01', clauseText: '须包含设计依据章节', mandatory: 'mandatory', auditDimension: 'compliance', checkPrompt: null },
    ],
  });
}

describe('CompletenessReviewService（DEC 分支A）', () => {
  let reviewTextMock: ReturnType<typeof vi.fn>;
  let getPromptMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reviewTextMock = vi.mocked(LlmService.reviewText);
    getPromptMock = vi.mocked(PromptTemplateService.getPromptByScene);
    reviewTextMock.mockReset().mockResolvedValue([makeIssue()]);
    getPromptMock.mockReset().mockResolvedValue('你是完整性审核专家');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('无章节结构的纯文本直接跳过，不调用 LLM', async () => {
    const result = await CompletenessReviewService.check('无标题纯文本'.repeat(10), makeFullCtx(), makeConfig());
    expect(result.issues).toEqual([]);
    expect(reviewTextMock).not.toHaveBeenCalled();
  });

  it('有章节结构但无 mandatory 审点时跳过，不调用 LLM', async () => {
    const ctx = makeCtx({
      checkpoints: [
        { id: 'cp-1', clauseCode: 'F-01', clauseText: '参数须一致', mandatory: 'optional', auditDimension: 'fact', checkPrompt: null },
      ],
    });
    const result = await CompletenessReviewService.check('# 第一章\n\n内容', ctx, makeConfig());
    expect(result.issues).toEqual([]);
    expect(reviewTextMock).not.toHaveBeenCalled();
  });

  it('有章节结构与 mandatory 审点时调用 reviewText 并透传结果', async () => {
    const text = '# 第一章 设计说明\n\n本工程为综合楼。';
    const result = await CompletenessReviewService.check(text, makeFullCtx(), makeConfig());
    expect(reviewTextMock).toHaveBeenCalledTimes(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].originalText).toBe('缺少章节');
  });

  it('reviewText 调用携带完整性场景 prompt 与任务标识', async () => {
    const text = '# 第一章 设计说明\n\n本工程为综合楼。';
    await CompletenessReviewService.check(text, makeFullCtx(), makeConfig());
    const [, options] = reviewTextMock.mock.calls[0];
    expect(getPromptMock).toHaveBeenCalledWith(
      'dec_review', 'system', 'completeness',
      expect.stringContaining('完整性审核'),
    );
    expect(options.systemPrompt).toBeTruthy();
    expect(options.documentId).toBe('file-1');
    expect(options.taskId).toBe('task-1');
    expect(options.mode).toBe('DEC_REVIEW');
    expect(options.skipUserTemplate).toBe(true);
    expect(options.timeout).toBe(300); // 5min 级
  });

  it('LLM 失败时向上抛错（容错由 dec-review runCompletenessBranch 兜底返回空）', async () => {
    reviewTextMock.mockRejectedValue(new Error('LLM timeout'));
    const text = '# 第一章 设计说明\n\n本工程为综合楼。';
    await expect(CompletenessReviewService.check(text, makeFullCtx(), makeConfig())).rejects.toThrow('LLM timeout');
  });
});
