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
vi.mock('../../../../llm/llm.service', () => ({
  LlmService: {
    buildLocateMeta: (...args: any[]) => buildLocateMetaMock(...args),
    reviewText: vi.fn(),
    splitText: vi.fn(),
    chat: vi.fn(),
  },
}));

import {
  filterFalsePositives,
  enrichLocateMeta,
} from '../llm_review_chunk';
import type { ReviewIssue } from '../../../../llm/llm.service';

function mkIssue(originalText: string, extra: Partial<ReviewIssue> = {}): ReviewIssue {
  return { issueType: 'TYPO', originalText, ...extra };
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
