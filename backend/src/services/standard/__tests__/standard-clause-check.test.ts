/**
 * standard-clause-check.service 单元测试
 *
 * 覆盖：toReviewIssue 状态映射（NON_COMPLIANT/UNVERIFIED/COMPLIANT）。
 * DEC-2 的 checkPrompt 透传由 runClauseCheck → checkSingleClause 链路代码审查保障。
 */
import { describe, it, expect } from 'vitest';
import { StandardClauseCheckService } from '../standard-clause-check.service';

const makeResult = (overrides: any = {}) => ({
  clauseId: 'c1',
  clauseCode: '5.2.3',
  clauseTitle: '抗震设防',
  clauseContent: '核岛厂房应按 7 度抗震设防。',
  status: 'NON_COMPLIANT',
  description: '厂房按 6 度设防',
  suggestion: '应改为 7 度',
  originalText: '按 6 度抗震设防',
  ...overrides,
});

describe('StandardClauseCheckService.toReviewIssue', () => {
  it('NON_COMPLIANT → VIOLATION/error，ruleCode 前缀 STD_，standardRef 带编号', () => {
    const issue = StandardClauseCheckService.toReviewIssue(makeResult())!;
    expect(issue.issueType).toBe('VIOLATION');
    expect(issue.severity).toBe('error');
    expect(issue.ruleCode).toBe('STD_5.2.3');
    expect(issue.standardRef).toContain('[5.2.3]');
    expect(issue.originalText).toBe('按 6 度抗震设防');
    expect(issue.suggestedText).toBe('应改为 7 度');
  });

  it('UNVERIFIED → COMPLETENESS/warning + 人工确认提示（不适用条文不静默消失）', () => {
    const issue = StandardClauseCheckService.toReviewIssue(makeResult({ status: 'UNVERIFIED', description: null, suggestion: null, originalText: null }))!;
    expect(issue.issueType).toBe('COMPLETENESS');
    expect(issue.severity).toBe('warning');
    expect(issue.originalText).toContain('[标准条文] 5.2.3');
    expect(issue.plainLanguage).toContain('人工确认');
  });

  it('COMPLIANT → null（符合条文不产出问题）', () => {
    expect(StandardClauseCheckService.toReviewIssue(makeResult({ status: 'COMPLIANT' }))).toBeNull();
  });
});
