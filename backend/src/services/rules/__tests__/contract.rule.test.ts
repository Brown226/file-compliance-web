/**
 * checkContractRules 单元测试
 *
 * 覆盖：预付款/违约金比例阈值（含 P0-3 语序双向回归）、质保期下限、
 * 必需条款缺失检查、阈值 config 覆盖、空文本。
 */
import { describe, it, expect } from 'vitest';
import { checkContractRules } from '../contract.rule';

const makeCtx = (text: string) => ({
  extractedText: text,
  fileType: 'docx',
  reviewMode: 'CONTRACT_REVIEW',
} as any);

describe('checkContractRules 合同规则', () => {
  it('预付款比例 50% 超限（默认 ≤30%）→ CONTRACT_PAYMENT_001 error', () => {
    const issues = checkContractRules(makeCtx('合同签订后甲方支付预付款 50%，到货验收后支付余款。'));
    const payment = issues.find((i) => i.ruleCode === 'CONTRACT_PAYMENT_001');
    expect(payment).toBeDefined();
    expect(payment!.severity).toBe('error');
    expect(payment!.originalText).toContain('50%');
  });

  it('预付款反向语序"按合同价款的 50% 作为预付款"同样检出（P0-3 回归）', () => {
    const issues = checkContractRules(makeCtx('甲方应按合同价款的 50% 作为预付款支付。'));
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_PAYMENT_001')).toBe(true);
  });

  it('预付款 20% 未超限不报', () => {
    const issues = checkContractRules(makeCtx('甲方支付预付款 20%。'));
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_PAYMENT_001')).toBe(false);
  });

  it('违约金"按合同金额 30% 支付违约金"（数字在前）检出（P0-3 回归：修复前漏报）', () => {
    const issues = checkContractRules(makeCtx('乙方逾期交货的，每逾期一日按合同金额 30% 支付违约金。'));
    const penalty = issues.find((i) => i.ruleCode === 'CONTRACT_PENALTY_001');
    expect(penalty).toBeDefined();
    expect(penalty!.severity).toBe('error');
    expect(penalty!.originalText).toContain('30%');
  });

  it('违约金"违约金比例为 10%"未超限不报', () => {
    const issues = checkContractRules(makeCtx('违约金比例为 10%。'));
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_PENALTY_001')).toBe(false);
  });

  it('质保期 12 个月低于要求（默认 ≥24）→ CONTRACT_WARRANTY_001 warning', () => {
    const issues = checkContractRules(makeCtx('质保期为 12 个月，自验收合格之日起计算。'));
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_WARRANTY_001')).toBe(true);
  });

  it('缺保险条款与争议解决条款 → CONTRACT_INSURANCE_001 / CONTRACT_DISPUTE_001', () => {
    const issues = checkContractRules(makeCtx('本合同约定设备供货事宜。'));
    const codes = issues.map((i) => i.ruleCode);
    expect(codes).toContain('CONTRACT_INSURANCE_001');
    expect(codes).toContain('CONTRACT_DISPUTE_001');
  });

  it('含保险与争议解决条款时不报缺失', () => {
    const issues = checkContractRules(makeCtx('双方同意投保工程保险，争议提交仲裁解决。'));
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_INSURANCE_001')).toBe(false);
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_DISPUTE_001')).toBe(false);
  });

  it('阈值 config 覆盖生效（DB/system_configs 传入时优先于内置默认）', () => {
    const text = '甲方支付预付款 50%。质保期为 12 个月。';
    const issues = checkContractRules(makeCtx(text), {
      payment_advance_ratio_max: 0.60,
      warranty_months_min: 6,
    });
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_PAYMENT_001')).toBe(false);
    expect(issues.some((i) => i.ruleCode === 'CONTRACT_WARRANTY_001')).toBe(false);
  });

  it('空文本返回空', () => {
    expect(checkContractRules(makeCtx(''))).toEqual([]);
    expect(checkContractRules(makeCtx('   '))).toEqual([]);
  });
});
