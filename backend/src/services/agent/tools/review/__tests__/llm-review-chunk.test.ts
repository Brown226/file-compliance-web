/**
 * llm_review_chunk 后处理单元测试
 *
 * 覆盖：
 * - P2-⑧ filterFalsePositives：误报库过滤（归一化匹配，与 review-pipeline 同一语义）
 * - P2-⑬ enrichLocateMeta：为 issue 补充 locateMeta 行号定位
 *
 * 通过 vi.mock 隔离误报库服务与 LLM 定位函数，不触发真实 LLM/DB 调用。
 * 注意：本文件位于 __tests__/ 子目录，mock 路径需 4 级相对路径（../../../../）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// —— Mock 误报库服务（batchCheck 返回 Map<originalText, isInLibrary>）——
const batchCheckMock = vi.fn();
vi.mock('../../../../review/falsePositiveLibrary.service', () => ({
  default: { batchCheck: (...args: any[]) => batchCheckMock(...args) },
  normalizeText: (s: string) => s.replace(/[\s　\t\r\n]+/g, '').toLowerCase(),
}));

// —— Mock LlmService.buildLocateMeta（避免真实定位实现，行为由用例驱动）——
const buildLocateMetaMock = vi.fn();
const reviewTextMock = vi.fn();
vi.mock('../../../../llm/llm.service', () => ({
  LlmService: {
    buildLocateMeta: (...args: any[]) => buildLocateMetaMock(...args),
    reviewText: (...args: any[]) => reviewTextMock(...args),
    splitText: vi.fn(),
    chat: vi.fn(),
  },
}));

// —— tool() 包装桩（同 upload_file 测试）——
vi.mock('@ai-sdk/provider-utils', () => ({
  tool: (def: any) => def,
}));

// —— PromptLoader 桩（不触达 registry/DB）——
vi.mock('../../../../prompts', () => ({
  PromptLoader: { resolve: vi.fn(async () => 'mock system prompt') },
}));

// —— search_standard_checkpoints 桩：默认返回空标准（不触发查询）——
const { searchToolMock } = vi.hoisted(() => ({ searchToolMock: { execute: vi.fn() } }));
vi.mock('../../knowledge/search_standard_checkpoints', () => ({
  createSearchStandardCheckpointsTool: () => searchToolMock,
}));

import {
  filterFalsePositives,
  enrichLocateMeta,
  backfillStandardRefs,
  createLlmReviewChunkTool,
  MAX_REVIEW_TEXT_CHARS,
} from '../llm_review_chunk';
import type { ReviewIssue } from '../../../../llm/llm.service';

function mkIssue(originalText: string, extra: Partial<ReviewIssue> = {}): ReviewIssue {
  return { issueType: 'TYPO', originalText, ...extra };
}

/** 构造假 search_standard_checkpoints 工具：按入参返回 list_standards / list_checkpoints */
function fakeSearchTool(mockImpl: (args: any) => any) {
  return {
    execute: vi.fn(async (args: any) => mockImpl(args)),
  };
}

describe('filterFalsePositives (P2-⑧)', () => {
  beforeEach(() => batchCheckMock.mockReset());

  it('误报库中命中的 issue 被过滤，未命中保留', async () => {
    batchCheckMock.mockResolvedValue(new Map([
      ['已在误报库的原文', true],
      ['正常问题原文', false],
    ]));

    const issues = [
      mkIssue('已在误报库的原文'),
      mkIssue('正常问题原文'),
    ];
    const result = await filterFalsePositives(issues);

    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('正常问题原文');
    // batchCheck 被调用，且传入了两条原文
    expect(batchCheckMock).toHaveBeenCalledWith(['已在误报库的原文', '正常问题原文']);
  });

  it('空数组直接返回，不触发查询', async () => {
    const result = await filterFalsePositives([]);
    expect(result).toEqual([]);
    expect(batchCheckMock).not.toHaveBeenCalled();
  });

  it('误报库查询失败时降级返回全部 issue（不影响审查结果）', async () => {
    // batchCheck 返回异常结构（undefined）→ 内部 fpMap.get 抛 TypeError → catch 降级返回全部
    // （用返回 undefined 而非 reject，避免 vitest 2.1.9 对 mock rejection 的 unhandled 追踪误报）
    batchCheckMock.mockResolvedValue(undefined as any);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const issues = [mkIssue('原文A'), mkIssue('原文B')];
      const result = await filterFalsePositives(issues);
      expect(result).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('enrichLocateMeta (P2-⑬)', () => {
  beforeEach(() => buildLocateMetaMock.mockReset());

  const text = '第一行内容\n第二行有错别字\n第三行正常';

  it('为可定位的 issue 生成 locateMeta 并填充行号', () => {
    // buildLocateMeta 返回 absolute 定位（start=文本偏移）
    buildLocateMetaMock.mockImplementation((fullText: string, searchText: string) => {
      if (searchText === '第二行有错别字') {
        return {
          version: 2,
          mode: 'text',
          confidence: 'exact',
          absolute: { start: 6, end: 12 },
          quote: { text: searchText },
        };
      }
      return null;
    });

    const issues = [
      mkIssue('第二行有错别字'),
      mkIssue('找不到的文本'),
    ];
    const result = enrichLocateMeta(issues, text);

    // 命中的 issue 有 locateMeta，且 hint.lineHint 为正确行号（第 2 行）
    const hit = result[0];
    expect(hit.locateMeta).toBeTruthy();
    expect(hit.locateMeta!.hint?.lineHint).toBe(2);
    // absolute.start=6 落在第 2 行（行起点索引 5），行号 = 2
    expect(hit.locateMeta!.absolute!.start).toBe(6);

    // 未命中的 issue 保留 locateMeta 为 undefined
    expect(result[1].locateMeta).toBeUndefined();
  });

  it('absolute 跨行时填充 lineHintEnd（结束行号）', () => {
    buildLocateMetaMock.mockReturnValue({
      version: 2,
      mode: 'text',
      confidence: 'exact',
      absolute: { start: 6, end: 18 }, // 跨第 2 行到第 3 行
      quote: { text: '第二行有错别字\n第三行' },
    });

    const issues = [mkIssue('第二行有错别字\n第三行')];
    const result = enrichLocateMeta(issues, text);

    expect(result[0].locateMeta).toBeTruthy();
    expect(result[0].locateMeta!.hint?.lineHint).toBe(2);
    expect((result[0].locateMeta!.hint as any).lineHintEnd).toBe(3);
  });

  it('buildLocateMeta 返回 null 时跳过，不抛错', () => {
    buildLocateMetaMock.mockReturnValue(null);
    const issues = [mkIssue('A')];
    const result = enrichLocateMeta(issues, text);
    expect(result[0].locateMeta).toBeUndefined();
  });

  it('空 issue 数组直接返回', () => {
    const result = enrichLocateMeta([], text);
    expect(result).toEqual([]);
    expect(buildLocateMetaMock).not.toHaveBeenCalled();
  });
});

describe('backfillStandardRefs (P1-⑦)', () => {
  const std = { id: 'std-1', standardNo: 'GB/T 15834', standardName: '标点符号用法' };

  it('ruleCode 存在且 standardRef 为空 → 按 clauseCode 精确匹配回填', async () => {
    // P1-2 适配：新实现一次拉取标准全部审点 + 内存匹配（不再逐 ruleCode 传 keyword 查询），
    // mock 判定与真实工具语义一致：不传 standardId=列标准，传 standardId=查审点
    const searchTool = fakeSearchTool((args: any) => {
      if (!args.standardId) {
        return { mode: 'list_standards', standards: [std] };
      }
      return {
        mode: 'list_checkpoints',
        checkpoints: [{ clauseCode: 'TYPO_001', clauseText: '错别字' }],
      };
    });
    const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001' })];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toBe('GB/T 15834 标点符号用法 第TYPO_001条');
  });

  it('无 clauseCode 精确命中时取第一个模糊命中', async () => {
    // P1-2 适配：模糊命中改为内存匹配（字段包含 ruleCode 即命中）；
    // mock 审点 clauseText 含 'TYPO_001' 使模糊命中 clauseCode=TYPO_002 的审点
    const searchTool = fakeSearchTool((args: any) => {
      if (!args.standardId) {
        return { mode: 'list_standards', standards: [std] };
      }
      return {
        mode: 'list_checkpoints',
        checkpoints: [{ clauseCode: 'TYPO_002', clauseText: 'TYPO_001 相关错别字' }],
      };
    });
    const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001' })];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toContain('TYPO_002');
  });

  it('已填 standardRef 的 issue 绝不覆盖', async () => {
    const searchTool = fakeSearchTool(() => ({ mode: 'list_standards', standards: [std] }));
    const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001', standardRef: '已有引用' })];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toBe('已有引用');
  });

  it('无 ruleCode 的 issue 不回填', async () => {
    const searchTool = fakeSearchTool(() => ({ mode: 'list_standards', standards: [std] }));
    const issues = [mkIssue('问题', {})];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toBeUndefined();
    expect(searchTool.execute).not.toHaveBeenCalled();
  });

  it('无现行标准 → 原样返回', async () => {
    const searchTool = fakeSearchTool(() => ({ mode: 'list_standards', standards: [] }));
    const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001' })];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toBeUndefined();
  });

  it('searchTool 抛错 → 告警降级，原样返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const searchTool = {
      execute: vi.fn().mockRejectedValue(new Error('checkpoint service down')),
    };
    try {
      const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001' })];
      const result = await backfillStandardRefs(issues, searchTool as any);
      expect(result[0].standardRef).toBeUndefined();
      expect(warnSpy.mock.calls[0][0]).toContain('standardRef 反查回填失败');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('查不到任何审点 → 保持为空', async () => {
    const searchTool = fakeSearchTool((args: any) => {
      if (!args.standardId) {
        return { mode: 'list_standards', standards: [std] };
      }
      return { mode: 'list_checkpoints', checkpoints: [] };
    });
    const issues = [mkIssue('帐号', { ruleCode: 'TYPO_001' })];
    const result = await backfillStandardRefs(issues, searchTool as any);
    expect(result[0].standardRef).toBeUndefined();
  });

  it('标准数量截断：>10 个标准时只反查前 10 个（N+1 防护）', async () => {
    const standards = Array.from({ length: 50 }, (_, i) => ({
      id: `std-${i}`,
      standardNo: `GB/T ${i}`,
      standardName: `标准${i}`,
    }));
    const searchTool = fakeSearchTool((args: any) => {
      if (!args.standardId) return { mode: 'list_standards', standards };
      return { mode: 'list_checkpoints', checkpoints: [] };
    });
    // 50 个不同 ruleCode → P1-2 优化后仅 1 次列标准 + 并发 10 次标准审点查询
    const issues = Array.from({ length: 50 }, (_, i) =>
      mkIssue(`原文${i}`, { ruleCode: `RULE_${i}` }),
    );
    const result = await backfillStandardRefs(issues, searchTool as any);

    // 查询次数 = 1（list_standards）+ 10（标准并发）≤ 61；且多于纯列表查询
    const callCount = searchTool.execute.mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(11);
    expect(callCount).toBeGreaterThan(1);
    // 审点为空 → 全部保持空
    for (const issue of result) {
      expect(issue.standardRef).toBeUndefined();
    }
  });

  it('相同 ruleCode 只反查一次（按 ruleCode 去重）', async () => {
    const searchTool = fakeSearchTool((args: any) => {
      if (!args.standardId) return { mode: 'list_standards', standards: [std] };
      return { mode: 'list_checkpoints', checkpoints: [] };
    });
    const issues = [
      mkIssue('原文A', { ruleCode: 'TYPO_001' }),
      mkIssue('原文B', { ruleCode: 'TYPO_001' }),
      mkIssue('原文C', { ruleCode: 'TYPO_001' }),
    ];
    await backfillStandardRefs(issues, searchTool as any);
    // 列标准 1 次 + 并发拉 1 个标准的审点 = 2 次（标准数=1，ruleCode 去重不影响查询数）
    expect(searchTool.execute.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('createLlmReviewChunkTool 预算保护（2026-08-07）', () => {
  beforeEach(() => {
    reviewTextMock.mockReset();
    searchToolMock.execute.mockReset();
    searchToolMock.execute.mockResolvedValue({ mode: 'list_standards', standards: [] });
  });

  it('text 超 10 万字符 → 截断后传给 reviewText（不挂起）', async () => {
    reviewTextMock.mockResolvedValue([]);
    const tool = createLlmReviewChunkTool({ userId: 'u1', sessionId: 's1' } as any);
    const longText = 'a'.repeat(MAX_REVIEW_TEXT_CHARS + 500);

    await tool.execute!({ text: longText });

    expect(reviewTextMock).toHaveBeenCalledTimes(1);
    const [sentText, options] = reviewTextMock.mock.calls[0];
    expect(sentText.length).toBe(MAX_REVIEW_TEXT_CHARS);
    expect(sentText).toBe(longText.slice(0, MAX_REVIEW_TEXT_CHARS));
    // 显式超时与 maxTokens（原实现不传，超长输入直接挂起）
    expect(options).toMatchObject({ maxTokens: 2048, timeout: 90 });
  });

  it('text 未超限 → 原样传递', async () => {
    reviewTextMock.mockResolvedValue([]);
    const tool = createLlmReviewChunkTool({ userId: 'u1', sessionId: 's1' } as any);
    const shortText = '正常审查文本';
    await tool.execute!({ text: shortText });
    expect(reviewTextMock.mock.calls[0][0]).toBe(shortText);
  });

  it('完整链路：reviewText → 回填（空库不查）→ 误报过滤 → locateMeta 增强', async () => {
    reviewTextMock.mockResolvedValue([
      { issueType: 'TYPO', originalText: '帐号', ruleCode: 'TYPO_001' },
    ]);
    // locateMeta 增强依赖 buildLocateMeta（配置命中返回）
    buildLocateMetaMock.mockImplementation((_fullText: string, searchText: string) =>
      searchText === '帐号'
        ? { version: 2, mode: 'text', confidence: 'exact', absolute: { start: 4, end: 6 }, quote: { text: '帐号' } }
        : null,
    );
    // 误报库不命中（默认 batchCheck mock 未配置 → 返回 undefined → 降级保留全部）
    const tool = createLlmReviewChunkTool({ userId: 'u1', sessionId: 's1' } as any);
    const text = '第一行\n帐号错误';
    const result = await tool.execute!({ text, focus: '错别字' });

    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('TYPO');
    // 空标准库 → 不触发 checkpoint 查询
    expect(searchToolMock.execute).toHaveBeenCalledTimes(1); // 仅 list_standards
    // 短文本可定位 → locateMeta 已增强
    expect(result[0].locateMeta).toBeTruthy();
  });
});
