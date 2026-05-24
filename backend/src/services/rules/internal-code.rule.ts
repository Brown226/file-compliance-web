/**
 * 规则 10: 正文内编码校验 (INTERNAL_CODE 类确定性规则)
 * 错误代码: INTERNAL_CODE_001
 * 对应报告: T1c 正文内编码错误 (如 1EAA001TB → 1EAE360CR)
 */

import { RuleIssue, FileContext } from './types';

// 排除标准编号、ISO标准等非工程编码
const EXCLUDED_PREFIXES = /^(GB|ISO|IEC|NB|DL|HJ|EJ|JGJ|CJJ|HAF|CECS|TJ|DB|QX|GYJ|BJG|API|ASME|ASTM|ANSI|IEEE|NFPA|IBC|IRC)/i;

export function checkInternalCodes(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';
  const fileName = ctx.fileName;
  const maxIssues: number = config?.maxIssues ?? 2;

  // 从文件名提取正确的项目编码和系统编码作为参考
  const fileProjectCode = fileName.match(/^([A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2})/)?.[1];
  const fileSystemCode = fileName.match(/-([A-Z]{3}\d{2})/)?.[1];

  // 如果文件名本身没有有效的项目编码，跳过检查（避免基于错误文件名产生连锁误报）
  if (!fileProjectCode) return issues;

  // 在正文中查找核电工程编码（更严格的模式：数字+字母+数字+字母组合）
  const allCodes = text.match(/\d[A-Z]{2}\d{2,3}[A-Z]{2}\d{2}[A-Z]{2}/g);
  if (!allCodes) return issues;

  const seenCodes = new Set<string>();

  for (const rawCode of allCodes) {
    const code = rawCode.toUpperCase();
    if (seenCodes.has(code)) continue;
    if (code.length < 8 || code.length > 15) continue;

    // 排除标准编号等非工程编码
    if (EXCLUDED_PREFIXES.test(code)) continue;

    seenCodes.add(code);

    // 如果有文件名的项目编码参考，检查正文编码前缀是否一致
    // 提高匹配门槛：要求前6字符匹配（而非仅4字符）
    if (code.startsWith(fileProjectCode.substring(0, 6))) {
      // 前缀匹配，做进一步检查
      if (code.length >= fileProjectCode.length &&
          code !== fileProjectCode &&
          !code.includes(fileProjectCode.substring(0, 8))) {
        // 前6字符相同但后续不一致，可能是编码错误
        if (issues.length < maxIssues) {
          issues.push({
            issueType: 'ENCODING', ruleCode: 'INTERNAL_CODE_001',
            severity: 'warning',
            originalText: code,
            description: `文档内发现可疑编码 "${code}"，其前缀与文件名项目编码 "${fileProjectCode}" 部分匹配但不完全一致。请核实该编码是否正确。`,
          });
        }
      }
    }
  }

  return issues;
}
