/**
 * apply_rule 工具 — 应用规则到文本片段
 *
 * 工作方式：
 * 1. 构建 FileContext（文件名/路径/文件类型/文本/审查模式/PDF 页）
 * 2. 用 enabledRulePrefixes 限定只执行指定规则（传入前缀 Set 给 runAllRules）
 * 3. 调 runAllRules(ctx, options) 执行规则引擎
 * 4. 返回 RuleIssue[]
 *
 * 参数：
 * - text: 待检查的文本片段
 * - rulePrefixes: 要应用的规则前缀数组（如 ['NAME', 'FORMAT', 'COMPL']），不传则跑全部启用的规则
 * - fileName: 文件名（用于规则执行条件判断）
 * - fileType: 文件类型（如 pdf/docx/dwg，用于规则执行条件判断）
 * - reviewMode: 审查模式（如 CONTRACT_REVIEW，合同规则需此条件）
 * - pdfPages: PDF 逐页文本数组（可选，页眉/页码规则需此条件）
 */
import { z } from 'zod';
import { runAllRules, getRuleRegistryMetadata } from '../../../rules';
import type { FileContext, RuleIssue } from '../../../rules/types';
import type { ToolContext } from '../file/upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** apply_rule 结果 */
interface ApplyRuleResult {
  issues: RuleIssue[];
  total: number;
  appliedPrefixes: string[];
  skippedPrefixes: string[];
  error?: string;  // 规则引擎执行失败时填充，Agent 可据此决定是否重试
}

/**
 * 创建 apply_rule 工具
 */
export function createApplyRuleTool(_context: ToolContext) {
  return tool({
    description: '应用指定的审查规则到文本片段。可指定 rulePrefixes 数组限定只跑某几项规则（如 ["NAME","FORMAT","COMPL","CONSIST"]），不指定则跑全部启用的规则。返回符合 RuleIssue 结构的问题列表。先用 list_available_rules 查看有哪些规则。',
    inputSchema: z.object({
      text: z.string().describe('待应用规则的文本片段'),
      rulePrefixes: z.array(z.string()).optional().describe(
        '要执行的规则前缀数组，如 ["NAME","FORMAT","COMPL","CONSIST"]。不传则执行所有已启用且满足条件的规则。前缀列表可用 list_available_rules 获取。'
      ),
      fileName: z.string().optional().default('agent_review.txt').describe('文件名（用于规则条件判断，如 DWG 规则仅 DWG 文件触发）'),
      fileType: z.string().optional().default('txt').describe('文件类型（pdf/docx/dwg/txt 等，用于规则条件判断）'),
      reviewMode: z.string().optional().describe('审查模式（如 CONTRACT_REVIEW，合同规则需此条件触发）'),
      pdfPages: z.array(z.string()).optional().describe('PDF 逐页文本（页眉/页码规则需此条件，非 PDF 可不传）'),
    }),
    execute: async ({ text, rulePrefixes, fileName, fileType, reviewMode, pdfPages }): Promise<ApplyRuleResult> => {
      // 1. 构建 FileContext
      const ctx: FileContext = {
        fileName: fileName || 'agent_review.txt',
        filePath: `agent_temp/${_context.userId}/${_context.sessionId}/${fileName || 'agent_review.txt'}`,
        fileType: (fileType || 'txt').toLowerCase(),
        extractedText: text,
        reviewMode,
        pdfPages,
      };

      // 2. 校验解析前缀列表
      const allMetadata = getRuleRegistryMetadata();
      const allPrefixes = allMetadata.allPrefixes;
      const requestedPrefixes = rulePrefixes?.length
        ? rulePrefixes.map(p => p.toUpperCase()).filter(p => allPrefixes.includes(p))
        : allPrefixes;

      const skippedPrefixes = rulePrefixes?.length
        ? rulePrefixes.map(p => p.toUpperCase()).filter(p => !allPrefixes.includes(p))
        : [];

      // 3. 执行规则引擎（失败时降级返回空 issues + error 字段，不 throw 中断 Agent 流程）
      let issues: RuleIssue[] = [];
      let errorMsg: string | undefined;
      try {
        issues = await runAllRules(ctx, {
          enabledRulePrefixes: new Set(requestedPrefixes),
        });
      } catch (e) {
        console.error('[Agent:apply_rule] 规则引擎执行失败，返回空结果:', e);
        errorMsg = (e as Error).message;
      }

      return {
        issues,
        total: issues.length,
        appliedPrefixes: requestedPrefixes,
        skippedPrefixes,
        error: errorMsg,
      };
    },
  });
}
