/**
 * 合同审查结果结构化 Schema
 *
 * 借鉴 ContractReviewSystem RiskItem Pydantic 模型，
 * 使用 zod 进行结构化输出校验。
 */

import { z } from 'zod';

// 合同风险项结构化 schema
// P2-C: 接入 parseReviewResult 做格式校验（safeParse 失败仅告警不丢弃）
export const RiskItemSchema = z.object({
  clauseNo: z.string().optional(),
  clauseTitle: z.string().optional(),
  riskType: z.enum([
    'legal_risk',       // 法律风险
    'payment_risk',     // 付款风险
    'penalty_risk',     // 违约风险
    'warranty_risk',    // 质保风险
    'ip_risk',          // 知识产权风险
    'change_risk',      // 变更风险
    'claim_risk',       // 索赔风险
    'insurance_risk',   // 保险风险
    'dispute_risk',     // 争议解决风险
    'other',            // 其他
  ]),
  riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  riskDescription: z.string().min(1, '风险描述不能为空'),
  suggestion: z.string().min(1, '修改建议不能为空'),
  legalBasis: z.string().optional(),
  originalText: z.string().optional(),
});

export type RiskItem = z.infer<typeof RiskItemSchema>;

// 合规检查结果 schema
export const ComplianceResultSchema = z.object({
  clauseNo: z.string().min(1),
  clauseTitle: z.string().optional(),
  status: z.enum(['COMPLIANT', 'NON_COMPLIANT', 'UNVERIFIED']),
  violatedLaws: z.array(z.string()).optional(),
  violationDetails: z.string().optional(),
  recommendation: z.string().optional(),
});

export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;
