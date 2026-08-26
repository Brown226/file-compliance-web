// DEC 分支B-2 事实维度校验服务测试
// - 按章节分块调用 LLM（CONCURRENT_LIMIT=3 分批）
// - chunk 失败容错（返回 [] 不崩溃）
// - 结果按顺序合并透传
//
// 注：
// - ChunkSplitterService.splitTextBySection 是章节感知切块（按 markdown 标题），
//   纯文本无章节标题时产出 0 个 chunk（服务零调用，见"无章节纯文本"用例）。
// - llm.service / prompt-template.service 使用 vi.mock 模块级替换。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FactCheckService } from '../fact-check.service';
import { LlmService } from '../../llm/llm.service';
import { PromptTemplateService } from '../../llm/prompt-template.service';
import type { ReviewIssue } from '../../llm/llm.service';

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    reviewText: vi.fn(),
    chat: vi.fn(),
    splitText: (text: string, maxChars: number, includePosition: boolean, _overlap?: number): any => {
      // 简化实现：与真实 splitText 同构，供 splitTextBySectionWithFallback 兜底路径使用
      if (text.length <= maxChars) {
        return includePosition ? [{ text, startIndex: 0, endIndex: text.length, chunkIndex: 0 }] : [text];
      }
      const chunks: any[] = [];
      for (let i = 0; i < text.length; i += maxChars) {
        const piece = text.slice(i, i + maxChars);
        if (includePosition) {
          chunks.push({ text: piece, startIndex: i, endIndex: i + piece.length, chunkIndex: chunks.length });
        } else {
          chunks.push(piece);
        }
      }
      return chunks;
    },
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
  return '# 第一章 设计说明\n\n本工程为某综合楼设计，主要设计参数见下文。';
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
  { id: 'cp-1', clauseCode: 'F-01', clauseText: '设计参数须与规范一致', mandatory: '1', auditDimension: 'fact', checkPrompt: null },
];

describe('FactCheckService（DEC 分支B-2）', () => {
  let reviewTextMock: ReturnType<typeof vi.fn>;
  let getPromptMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reviewTextMock = vi.mocked(LlmService.reviewText);
    getPromptMock = vi.mocked(PromptTemplateService.getPromptByScene);
    reviewTextMock.mockReset().mockResolvedValue([makeIssue()]);
    getPromptMock.mockReset().mockResolvedValue('你是事实维度校验专家');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('单章节文本调用一次 reviewText 并透传结果', async () => {
    const issues = await FactCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toHaveLength(1);
    expect(reviewTextMock).toHaveBeenCalledTimes(1);
    expect(issues[0].originalText).toBe('原文内容');
  });

  it('多章节文本每章调用一次并合并全部结果', async () => {
    reviewTextMock.mockResolvedValue([makeIssue({ originalText: '章内问题' })]);
    const issues = await FactCheckService.check(threeSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(reviewTextMock).toHaveBeenCalledTimes(3);
    expect(issues).toHaveLength(3);
  });

  it('单章内容超过 chunkSize 时按段落再切，多次调用', async () => {
    // 一章 3 段各 2000 字 → 累计 6000 > 4000 → 切成 2 个 chunk
    const longChapter = [
      '# 第一章 设计说明',
      'A'.repeat(2000),
      'B'.repeat(2000),
      'C'.repeat(2000),
    ].join('\n\n');
    await FactCheckService.check(longChapter, makeCtx(), CHECKPOINTS, makeConfig());
    expect(reviewTextMock).toHaveBeenCalledTimes(2);
  });

  it('reviewText 调用传入了审点内容、任务标识与位置信息', async () => {
    await FactCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    const [, options] = reviewTextMock.mock.calls[0];
    expect(getPromptMock).toHaveBeenCalledWith(
      'dec_review', 'system', 'fact_check',
      expect.stringContaining('事实维度校验'),
    );
    expect(options.systemPrompt).toBeTruthy();
    expect(options.documentId).toBe('file-1');
    expect(options.taskId).toBe('task-1');
    expect(options.mode).toBe('DEC_REVIEW');
    expect(options.skipUserTemplate).toBe(true);
    expect(options.positionInfo).toEqual({ chunkIndex: 0, chunkStartIndex: 0, totalChunks: 1 });
  });

  it('单个 chunk 的 LLM 调用失败时该 chunk 返回空，不崩溃且保留其他 chunk 结果', async () => {
    reviewTextMock
      .mockResolvedValueOnce([makeIssue({ originalText: 'chunk0' })])
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce([makeIssue({ originalText: 'chunk2' })]);
    const issues = await FactCheckService.check(threeSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.originalText)).toEqual(['chunk0', 'chunk2']);
  });

  it('审点为空时仍可执行（审点文本为空不影响分块调用）', async () => {
    const issues = await FactCheckService.check(singleSectionText(), makeCtx(), [], makeConfig());
    expect(issues).toHaveLength(1);
    expect(reviewTextMock).toHaveBeenCalledTimes(1);
  });

  it('LLM 全部失败时返回空数组', async () => {
    reviewTextMock.mockRejectedValue(new Error('boom'));
    const issues = await FactCheckService.check(singleSectionText(), makeCtx(), CHECKPOINTS, makeConfig());
    expect(issues).toEqual([]);
  });

  it('无章节标题的纯文本回退普通分片：仍调用 LLM 审查（P0 修复 2026-08-26，此前静默空跑）', async () => {
    const plainText = '无任何章节标题的纯文本内容'.repeat(20);
    const issues = await FactCheckService.check(plainText, makeCtx(), CHECKPOINTS, makeConfig());
    // 回退 LlmService.splitText 后得到 1 个 chunk（文本 < chunkSize），正常调 LLM
    expect(reviewTextMock).toHaveBeenCalledTimes(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].originalText).toBe('原文内容');
  });
});
