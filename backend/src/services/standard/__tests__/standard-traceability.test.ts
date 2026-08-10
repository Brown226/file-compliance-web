/**
 * standard-traceability.service 单元测试（标准条文溯源）
 *
 * 覆盖：规则→标准条文静态映射、只补不覆盖、description 规则编号提取。
 */
import { describe, it, expect } from 'vitest';
import { StandardTraceabilityService } from '../standard-traceability.service';

const makeIssue = (overrides: any = {}) => ({
  issueType: 'VIOLATION',
  originalText: '原文',
  description: 'desc',
  severity: 'error',
  ...overrides,
});

describe('StandardTraceabilityService.lookupStandardRef', () => {
  it('已知规则编号返回映射条文', () => {
    expect(StandardTraceabilityService.lookupStandardRef('R1').length).toBeGreaterThan(0);
    expect(StandardTraceabilityService.lookupStandardRef('STD_003').join(' ')).toContain('废止');
  });

  it('未知规则编号返回空数组', () => {
    expect(StandardTraceabilityService.lookupStandardRef('NON_EXISTENT_CODE')).toEqual([]);
  });
});

describe('StandardTraceabilityService.enrichWithStandardRef', () => {
  it('有 ruleCode 且无 standardRef → 补充映射条文', () => {
    const [issue] = StandardTraceabilityService.enrichWithStandardRef([makeIssue({ ruleCode: 'R1' })]);
    expect(issue.standardRef).toContain('HAF·J0013-1991');
  });

  it('已有 standardRef 不被覆盖（RAG 真实引用优先）', () => {
    const [issue] = StandardTraceabilityService.enrichWithStandardRef([
      makeIssue({ ruleCode: 'R1', standardRef: '《真实检索到的标准》第X条' }),
    ]);
    expect(issue.standardRef).toBe('《真实检索到的标准》第X条');
  });

  it('无 ruleCode 但 description 含规则编号 → 提取并补充', () => {
    const [issue] = StandardTraceabilityService.enrichWithStandardRef([
      makeIssue({ ruleCode: undefined, description: '违反R1封面完整性要求' }),
    ]);
    expect(issue.ruleCode).toBe('R1');
    expect(issue.standardRef).toContain('HAF·J0013-1991');
  });

  it('无 ruleCode 无描述编号 → 原样返回', () => {
    const issue = makeIssue({ ruleCode: undefined, description: '没有规则编号的描述' });
    const [result] = StandardTraceabilityService.enrichWithStandardRef([issue]);
    expect(result.ruleCode).toBeUndefined();
    expect(result.standardRef).toBeUndefined();
  });
});

describe('StandardTraceabilityService.extractRuleCodes', () => {
  it('支持 R1、规则编号：R1、违反R1 等格式', () => {
    expect(StandardTraceabilityService.extractRuleCodes('R1')).toEqual(['R1']);
    expect(StandardTraceabilityService.extractRuleCodes('规则编号：R2')).toContain('R2');
    expect(StandardTraceabilityService.extractRuleCodes('违反R3的要求')).toContain('R3');
  });

  it('无规则编号返回空', () => {
    expect(StandardTraceabilityService.extractRuleCodes('普通描述')).toEqual([]);
  });
});
