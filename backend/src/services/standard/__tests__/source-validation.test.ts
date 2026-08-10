/**
 * source-validation.service 单元测试（OPT-016 防幻觉校验）
 *
 * 覆盖：真实来源通过、编造来源标记 unverified、全未验证降级 confidence、
 * 归一化比较（标点/空白差异）、来源在待审文本中出现也算通过。
 */
import { describe, it, expect } from 'vitest';
import { validateSources } from '../source-validation.service';

const makeIssue = (overrides: any = {}) => ({
  issueType: 'VIOLATION',
  originalText: '原文',
  description: 'desc',
  severity: 'error',
  sourceReferences: [{ content: '核岛厂房抗震设防要求 7 度。', document_name: 'HAF102', similarity: 0.85 }],
  ...overrides,
});

describe('validateSources 来源真实性校验', () => {
  it('空 issues 返回空', () => {
    expect(validateSources([], [], '')).toEqual({ issues: [], downgradedCount: 0, unverifiedSourceCount: 0 });
  });

  it('无 sourceReferences 的 issue 不做校验', () => {
    const issue = makeIssue({ sourceReferences: undefined });
    const result = validateSources([issue], ['xxx'], 'text');
    expect(result.issues[0]).toEqual(issue);
    expect(result.downgradedCount).toBe(0);
  });

  it('来源真实存在于 RAG 检索结果 → 验证通过（归一化容忍标点/空白差异）', () => {
    const issue = makeIssue({ sourceReferences: [{ content: '核岛厂房抗震设防要求 7 度。', document_name: 'HAF102', similarity: 0.85 }] });
    const result = validateSources(
      [issue],
      ['《核安全导则》核岛厂房抗震设防要求 7 度，参照执行。'],
      '',
    );
    expect(result.issues[0].sourceReferences[0].unverified).toBeUndefined();
    expect(result.downgradedCount).toBe(0);
  });

  it('来源不在检索结果也不在待审文本 → 标记 unverified:true', () => {
    const issue = makeIssue({ sourceReferences: [{ content: '这条引用是 LLM 编造的。', document_name: 'FABRICATED', similarity: 0.9 }] });
    const result = validateSources([issue], ['完全不相关的内容。'], '待审文档正文');
    expect(result.issues[0].sourceReferences[0].unverified).toBe(true);
    expect(result.unverifiedSourceCount).toBe(1);
  });

  it('全部来源未验证 → confidence 降级（_sourceDowngraded）', () => {
    const issue = makeIssue({
      sourceReferences: [
        { content: '编造引用 A。', document_name: 'A', similarity: 0.9 },
        { content: '编造引用 B。', document_name: 'B', similarity: 0.9 },
      ],
    });
    const result = validateSources([issue], ['真实片段 1。真实片段 2。'], '');
    expect(result.issues[0]._sourceDowngraded).toBe(true);
    expect(result.downgradedCount).toBe(1);
    expect(result.unverifiedSourceCount).toBe(2);
  });

  it('部分来源未验证 → 只标记未验证的，不降级', () => {
    const issue = makeIssue({
      sourceReferences: [
        { content: '真实片段 1。', document_name: 'REAL', similarity: 0.9 },
        { content: '编造引用 X。', document_name: 'FAKE', similarity: 0.9 },
      ],
    });
    const result = validateSources([issue], ['真实片段 1。真实片段 2。'], '');
    const refs = result.issues[0].sourceReferences;
    expect(refs[0].unverified).toBeUndefined();
    expect(refs[1].unverified).toBe(true);
    expect(result.downgradedCount).toBe(0);
  });

  it('来源与待审文本匹配也算验证通过（source 可能引用原文）', () => {
    const issue = makeIssue({ sourceReferences: [{ content: '本报告按 6 度抗震设防。', document_name: 'DOC', similarity: 0.8 }] });
    const result = validateSources([issue], ['不相关的检索片段。'], '第一章 本报告按 6 度抗震设防。');
    expect(result.issues[0].sourceReferences[0].unverified).toBeUndefined();
  });
});
