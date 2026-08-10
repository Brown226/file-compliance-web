/**
 * 规则 5: 连续页码检查
 * 错误代码: PAGE_001 ~ PAGE_004
 *
 * config 参数说明:
 *   pageNumberPatterns?: string[]       — 自定义页码提取正则（默认3种格式）
 *   allowSkippedPages?: boolean         — 是否允许跳页（默认false）
 *   totalPagesTolerance?: number        — 总页数差异容差（默认0，即必须精确匹配）
 */

import { RuleIssue, FileContext } from './types';

export function checkPageNumbers(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!ctx.pdfPages || ctx.pdfPages.length < 2) return issues;

  // 从各页文本中提取页码
  const pageNumbers: number[] = [];
  const totalPages: number[] = [];

  // 页码提取正则（支持 config 覆盖）
  // 注意：裸页码（如 18/21）极易与正文中的分数/比值（1/2、3/4）或日期（2026/08/07）混淆，
  // 因此裸页码只在页首/页尾 HEADER_FOOTER_MARGIN 字符区域内匹配，并用断言排除相邻数字/点/斜杠/冒号。
  const HEADER_FOOTER_MARGIN = 80;
  interface PagePattern {
    re: RegExp;
    bare: boolean; // 裸页码：仅在页首/页尾区域查找
  }
  const defaultPatterns: PagePattern[] = [
    { re: /第\s*(\d+)\s*页[\/]?\s*共?\s*(\d+)\s*页/, bare: false },   // 格式2: "第18页 共21页"
    { re: /版次[：:]\s*\w+\s+(\d+)\s*\/\s*(\d+)/, bare: false },       // 格式3: "版次:B 18/21"
    { re: /(?<![\d./])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d./:])/, bare: true }, // 格式1: "18/21"
  ];
  const pageNumberPatterns: PagePattern[] = config?.pageNumberPatterns
    ? config.pageNumberPatterns.map((p: string) => ({ re: new RegExp(p), bare: false }))
    : defaultPatterns;

  for (let i = 0; i < ctx.pdfPages.length; i++) {
    const text = ctx.pdfPages[i];

    for (const { re, bare } of pageNumberPatterns) {
      let match: RegExpMatchArray | null;
      if (bare) {
        // 裸页码只在页首/页尾区域查找，排除正文分数/比值/日期误报
        const head = text.slice(0, HEADER_FOOTER_MARGIN).match(re);
        const tail = text.slice(-HEADER_FOOTER_MARGIN).match(re);
        match = head ?? tail;
      } else {
        match = text.match(re);
      }
      if (match) {
        pageNumbers.push(parseInt(match[1]));
        totalPages.push(parseInt(match[2]));
        break;
      }
    }
  }

  // 检查页码连续性 (PAGE_001)
  if (pageNumbers.length >= 2) {
    const allowSkippedPages: boolean = config?.allowSkippedPages ?? false;
    for (let i = 1; i < pageNumbers.length; i++) {
      if (pageNumbers[i] !== pageNumbers[i - 1] + 1) {
        if (allowSkippedPages && pageNumbers[i] > pageNumbers[i - 1]) {
          continue; // 允许跳页但要求递增
        }
        issues.push({
          issueType: 'VIOLATION', ruleCode: 'PAGE_001', severity: 'error',
          originalText: `第${i}页=${pageNumbers[i - 1]}, 第${i + 1}页=${pageNumbers[i]}`,
          description: `页码不连续: 从${pageNumbers[i - 1]}跳到${pageNumbers[i]}，缺失${pageNumbers[i - 1] + 1}`,
        });
        break; // 只报一次
      }
    }
  }

  // 检查总页数一致性 (PAGE_003)
  if (totalPages.length > 0) {
    const maxTotal = Math.max(...totalPages);
    const tolerance: number = config?.totalPagesTolerance ?? 0;
    if (Math.abs(maxTotal - ctx.pdfPages.length) > tolerance) {
      issues.push({
        issueType: 'VIOLATION', ruleCode: 'PAGE_003', severity: 'warning',
        originalText: `页眉显示总页数=${maxTotal}, 实际页数=${ctx.pdfPages.length}`,
        description: `总页数与实际页数不一致。页眉中标记共${maxTotal}页，但文件实际有${ctx.pdfPages.length}页。`,
      });
    }
  }

  return issues;
}
