/**
 * P2-9 / P2-12 回归测试
 *
 * P2-9 跨规则去重：FORMAT_006（半角/全角标点混用，info）与 PUNCT_001（中英文标点混用，warning）
 * 命中同一 originalText 时只保留 PUNCT_001（severity 更高）。
 *
 * P2-12 死配置接通：system_configs.contract_rule_thresholds 被 runAllRules 读取，
 * 覆盖 checkContractRules 的内置 DEFAULT_THRESHOLDS（payment_advance_ratio_max 等）。
 *
 * 全 mock 隔离：不连真实 DB。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma（config/db），避免真实 DB 连接
const mockFindMany = vi.fn();
const mockSystemConfigFindUnique = vi.fn();
vi.mock('../../../config/db', () => ({
  default: {
    reviewRule: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    systemConfig: {
      findUnique: (...args: unknown[]) => mockSystemConfigFindUnique(...args),
    },
  },
}));

import { runAllRules, dedupeCrossRuleIssues, loadContractThresholds, invalidateRuleConfigCache } from '../index';
import { RuleIssue, FileContext } from '../types';

function makeCtx(overrides: Partial<FileContext> = {}): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    extractedText: '正文',
    pdfPages: [],
    ...overrides,
  } as FileContext;
}

function issue(ruleCode: string, originalText: string, severity: RuleIssue['severity'] = 'warning'): RuleIssue {
  return { ruleCode, issueType: 'VIOLATION', severity, originalText } as RuleIssue;
}

describe('P2-9 跨规则去重（dedupeCrossRuleIssues）', () => {
  it('FORMAT_006 与 PUNCT_001 命中同一原文 → 只保留 PUNCT_001', () => {
    const input = [
      issue('FORMAT_006', '中文,中文', 'info'),
      issue('PUNCT_001', '中文,中文', 'warning'),
    ];
    const out = dedupeCrossRuleIssues(input);
    expect(out).toHaveLength(1);
    expect(out[0].ruleCode).toBe('PUNCT_001');
  });

  it('同一原文多处 FORMAT_006 但仅一处 PUNCT_001 → 只丢重叠处', () => {
    const input = [
      issue('FORMAT_006', '重叠,原文', 'info'),
      issue('FORMAT_006', '不重叠,原文', 'info'),
      issue('PUNCT_001', '重叠,原文', 'warning'),
    ];
    const out = dedupeCrossRuleIssues(input);
    expect(out).toHaveLength(2);
    expect(out.filter(i => i.ruleCode === 'FORMAT_006')).toHaveLength(1);
    expect(out.find(i => i.ruleCode === 'FORMAT_006')?.originalText).toBe('不重叠,原文');
  });

  it('不同原文 → 不去重，两条都保留', () => {
    const input = [
      issue('FORMAT_006', '中文,中文', 'info'),
      issue('PUNCT_001', '另一处,标点', 'warning'),
    ];
    expect(dedupeCrossRuleIssues(input)).toHaveLength(2);
  });

  it('只有 FORMAT_006 无 PUNCT_001 → 保留（不被误删）', () => {
    const input = [issue('FORMAT_006', '中文,中文', 'info')];
    expect(dedupeCrossRuleIssues(input)).toHaveLength(1);
  });

  it('无关规则（非映射表内）不受影响', () => {
    const input = [
      issue('NAME_001', '命名问题', 'error'),
      issue('PUNCT_001', '中文,标点', 'warning'),
    ];
    expect(dedupeCrossRuleIssues(input)).toHaveLength(2);
  });
});

describe('P2-12 contract_rule_thresholds 死配置接通', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRuleConfigCache(); // 清 60s 缓存，保证每次读 mock
    mockFindMany.mockResolvedValue([]); // 无 DB 规则配置，走内置默认
  });

  it('loadContractThresholds 读取 system_configs 并返回', async () => {
    mockSystemConfigFindUnique.mockResolvedValue({
      key: 'contract_rule_thresholds',
      value: { payment_advance_ratio_max: 0.5 },
    });
    expect(await loadContractThresholds()).toEqual({ payment_advance_ratio_max: 0.5 });
  });

  it('配置不存在 → 返回 null（回退内置默认）', async () => {
    mockSystemConfigFindUnique.mockResolvedValue(null);
    expect(await loadContractThresholds()).toBeNull();
  });

  it('读取失败 → 返回 null 不抛错', async () => {
    mockSystemConfigFindUnique.mockRejectedValue(new Error('db down'));
    expect(await loadContractThresholds()).toBeNull();
  });

  it('runAllRules：DB 阈值覆盖内置默认（预付款 50% ≤ 50% 不报 CONTRACT_PAYMENT_001）', async () => {
    mockSystemConfigFindUnique.mockResolvedValue({
      key: 'contract_rule_thresholds',
      value: { payment_advance_ratio_max: 0.5 },
    });
    const ctx = makeCtx({
      reviewMode: 'CONTRACT_REVIEW' as any,
      extractedText: '预付款比例 50%，支付方式详见付款计划。',
    });
    const issues = await runAllRules(ctx);
    expect(issues.some(i => i.ruleCode === 'CONTRACT_PAYMENT_001')).toBe(false);
  });

  it('runAllRules：无 DB 配置时内置默认生效（预付款 50% > 30% 报 CONTRACT_PAYMENT_001）', async () => {
    mockSystemConfigFindUnique.mockResolvedValue(null);
    const ctx = makeCtx({
      reviewMode: 'CONTRACT_REVIEW' as any,
      extractedText: '预付款比例 50%，支付方式详见付款计划。',
    });
    const issues = await runAllRules(ctx);
    expect(issues.some(i => i.ruleCode === 'CONTRACT_PAYMENT_001')).toBe(true);
  });
});
