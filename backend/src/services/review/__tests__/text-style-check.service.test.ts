// DEC 分支B-3 文本表述校验服务测试
// - 按章节分块调用 LLM（CONCURRENT_LIMIT=3 分批）
// - chunk 失败容错（返回 [] 不崩溃）
// - 结果按顺序合并透传
//
// 注：ChunkSplitterService.splitTextBySection 是章节感知切块（按 markdown 标题），
// 纯文本无章节标题时产出 0 个 chunk。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextStyleCheckService } from '../text-style-check.service';
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
    issueType: 'CONSISTENCY',
    originalText: '原文内容',
    severity: 'warning',
    ...partial,
  };
}

function makeCtx() {
  return {
    taskId: 'task-1',
    fileId: 'file-1',
    fileName: '设计说明.docx',
    filePath: '/tmp/设计说明.docx',
    fileType: 'docx',
    extractedText: '',
    reviewMode: 'DEC_REVIEW',
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

/** 单章节文本（产出 1 个 chunk） */
function singleSectionText(): string {
  return '# 第一章 设计说明\n\n本工程为某综合楼设计，行文要求统一规范。';
}

/** 三章节文本（产出 3 个 chunk） */
function threeSectionText(): string {
  return [
    '# 第一章 设计说明',
    'A'.repeat(200),
    '# 第二章 结构设计',
    'B'.repeat(200),
    '# 第三章 给排水设计',
    'C'.repeat(200),
  ].join('\n\n');
}

const CHECKPOINTS = [
  { id: 'cp-1', clauseCode: 'T-01', clauseText: '行文格式须统一', mandatory: '1', auditDimension: 'text', checkPrompt: null },
];

describe('TextStyleCheckService（DEC 分支B-3）', () => {
  let reviewTextMock: ReturnType<typeof vi.fn>;
  let getPromptMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reviewTextMock = vi.mocked(LlmService.reviewText);
    getPromptMock = vi.mocked(PromptTemplateService.getPromptByScene);
    reviewTextMock.mockReset().mockResolvedValue([makeIssue()]);
    getPromptMock.mockReset().mockResolvedValue('你是文本表述校验专家');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('单章节文本调用一次 reviewText 并透传结果', async () => {
    const issues = await TextStyleCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toHaveLength(1);
    expect(reviewTextMock).toHaveBeenCalledTimes(1);
  });

  it('多章节文本每章调用一次并合并全部结果', async () => {
    const issues = await TextStyleCheckService.check(threeSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(reviewTextMock).toHaveBeenCalledTimes(3);
    expect(issues).toHaveLength(3);
  });

  it('reviewText 调用携带文本表述场景的 systemPrompt 与审点上下文', async () => {
    await TextStyleCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    const [, options] = reviewTextMock.mock.calls[0];
    expect(getPromptMock).toHaveBeenCalledWith(
      'dec_review', 'system', 'text_style',
      expect.stringContaining('文本表述校验'),
    );
    expect(options.systemPrompt).toBeTruthy();
    expect(options.taskId).toBe('task-1');
    expect(options.positionInfo).toEqual({ chunkIndex: 0, chunkStartIndex: 0, totalChunks: 1 });
  });

  it('单个 chunk 失败时该 chunk 返回空，不崩溃且保留其他 chunk 结果', async () => {
    reviewTextMock
      .mockResolvedValueOnce([makeIssue({ originalText: 'chunk0' })])
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce([makeIssue({ originalText: 'chunk2' })]);
    const issues = await TextStyleCheckService.check(threeSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues.map(i => i.originalText)).toEqual(['chunk0', 'chunk2']);
  });

  it('LLM 全部失败时返回空数组', async () => {
    reviewTextMock.mockRejectedValue(new Error('boom'));
    const issues = await TextStyleCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toEqual([]);
  });

  it('无章节标题的纯文本产出 0 个 chunk，返回空且不调用 LLM（当前行为文档化）', async () => {
    const plainText = '无任何章节标题的纯文本内容'.repeat(20);
    const issues = await TextStyleCheckService.check(plainText, makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toEqual([]);
    expect(reviewTextMock).not.toHaveBeenCalled();
  });
});
