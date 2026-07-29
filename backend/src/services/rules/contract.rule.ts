/**
 * 合同专用规则引擎 — 核电工程合同阈值与必需条款检查
 *
 * 为 CONTRACT_REVIEW 模式提供确定性规则兜底，覆盖可机械校验的阈值。
 * 阈值硬编码核电工程合同默认值，可通过 system_configs.contract_rule_thresholds 覆盖。
 */
import { RuleIssue, FileContext } from './types';

/** 核电工程合同默认阈值（可通过 system_configs.contract_rule_thresholds 覆盖） */
const DEFAULT_THRESHOLDS = {
  payment_advance_ratio_max: 0.30,    // 预付款比例 ≤ 30%
  penalty_ratio_max: 0.20,            // 违约金 ≤ 合同金额 20%
  warranty_months_min: 24,            // 质保期 ≥ 24 个月
  required_clauses: ['insurance', 'dispute'] as string[],  // 必须含保险、争议解决条款
};

/**
 * 检查合同规则，返回 RuleIssue[]
 * @param ctx 文件上下文（需包含 extractedText）
 * @param config 可选阈值覆盖（来自 review_rules 表 config 字段或 system_configs）
 */
export function checkContractRules(ctx: FileContext, config?: any): RuleIssue[] {
  if (!ctx.extractedText) return [];
  const text = ctx.extractedText;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(config || {}) };
  const issues: RuleIssue[] = [];

  // 1. 预付款比例检查
  const paymentMatch = text.match(/预付款[^。\n]*?(\d+(?:\.\d+)?)\s*%/);
  if (paymentMatch) {
    const ratio = parseFloat(paymentMatch[1]) / 100;
    if (ratio > thresholds.payment_advance_ratio_max) {
      issues.push({
        ruleCode: 'CONTRACT_PAYMENT_001',
        issueType: 'VIOLATION',
        severity: 'error',
        originalText: paymentMatch[0],
        suggestedText: `预付款比例应 ≤ ${thresholds.payment_advance_ratio_max * 100}%`,
        description: `预付款比例 ${paymentMatch[1]}% 超过核电工程合同默认上限 ${thresholds.payment_advance_ratio_max * 100}%`,
        standardRef: '《核电工程合同管理规范》预付款条款',
      });
    }
  }

  // 2. 违约金比例检查
  const penaltyMatch = text.match(/违约金[^。\n]*?(\d+(?:\.\d+)?)\s*%/);
  if (penaltyMatch) {
    const ratio = parseFloat(penaltyMatch[1]) / 100;
    if (ratio > thresholds.penalty_ratio_max) {
      issues.push({
        ruleCode: 'CONTRACT_PENALTY_001',
        issueType: 'VIOLATION',
        severity: 'error',
        originalText: penaltyMatch[0],
        suggestedText: `违约金比例应 ≤ ${thresholds.penalty_ratio_max * 100}%`,
        description: `违约金比例 ${penaltyMatch[1]}% 超过法定上限 ${thresholds.penalty_ratio_max * 100}%`,
        standardRef: '《民法典》合同编第八章 违约责任',
      });
    }
  }

  // 3. 质保期检查
  const warrantyMatch = text.match(/质保期[^。\n]*?(\d+)\s*个?\s*月/);
  if (warrantyMatch) {
    const months = parseInt(warrantyMatch[1]);
    if (months < thresholds.warranty_months_min) {
      issues.push({
        ruleCode: 'CONTRACT_WARRANTY_001',
        issueType: 'COMPLETENESS',
        severity: 'warning',
        originalText: warrantyMatch[0],
        suggestedText: `质保期应 ≥ ${thresholds.warranty_months_min} 个月`,
        description: `质保期 ${months} 个月低于核电工程合同要求 ${thresholds.warranty_months_min} 个月`,
        standardRef: '《建设工程质量管理条例》+《核安全法》',
      });
    }
  }

  // 4. 必需条款检查（保险、争议解决）
  if (!/保险条款|工程保险|第三方责任险/.test(text)) {
    issues.push({
      ruleCode: 'CONTRACT_INSURANCE_001',
      issueType: 'COMPLETENESS',
      severity: 'warning',
      originalText: '（缺失）',
      suggestedText: '应补充工程保险条款',
      description: '合同缺少保险条款，核电工程合同应明确工程保险、第三方责任险等',
      standardRef: '《保险法》+《建设工程施工合同司法解释》',
    });
  }
  if (!/争议解决|仲裁|诉讼管辖/.test(text)) {
    issues.push({
      ruleCode: 'CONTRACT_DISPUTE_001',
      issueType: 'COMPLETENESS',
      severity: 'warning',
      originalText: '（缺失）',
      suggestedText: '应补充争议解决条款',
      description: '合同缺少争议解决条款',
      standardRef: '《仲裁法》+《民事诉讼法》',
    });
  }

  return issues;
}
