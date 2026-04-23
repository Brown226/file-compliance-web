/**
 * 规则 2: 编码一致性检查
 * 错误代码: CODE_001 ~ CODE_005, UNIT_001 ~ UNIT_005
 */

import { RuleIssue, FileContext } from './types';

export function checkEncodingConsistency(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const nameWithoutExt = ctx.fileName.replace(/\.[^.]+$/, '');

  // 2.1 从文件名提取外部编码
  const externalCodePattern = config?.externalCodePattern
    ? new RegExp(config.externalCodePattern)
    : /^([A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}(?:\([A-Z]\)|-\d{3}\([A-Z]\)|-(?:CM|TM|FM|SM)\([A-Z]\)))$/;
  const externalCodeMatch = nameWithoutExt.match(externalCodePattern);
  if (!externalCodeMatch) {
    // 文件名本身不符合规范，无法进行编码对比
    return issues;
  }
  const externalCode = externalCodeMatch[1];

  // 2.2 获取页眉区域文本（通常在首页或第2页的顶部区域）
  const headerText = ctx.pdfPages!.length > 1 ? ctx.pdfPages![1] : ctx.pdfPages![0];

  // 2.3 检查页眉是否包含内部编码 (CODE_002)
  const internalCodePattern: RegExp = config?.internalCodePattern
    ? new RegExp(config.internalCodePattern)
    : /[A-Z]{2}\d{14}/;
  if (internalCodePattern.test(headerText)) {
    const internalCode = headerText.match(internalCodePattern)![0];
    // 排除与外部编码前缀重合的情况
    if (!headerText.includes(externalCode)) {
      issues.push({
        issueType: 'ENCODING', ruleCode: 'CODE_002', severity: 'error',
        originalText: internalCode,
        suggestedText: externalCode,
        description: `页眉使用了内部编码"${internalCode}"，应使用外部编码"${externalCode}"。`,
      });
    }
  }

  // 2.4 检查页眉是否包含外部编码 (CODE_001 / CODE_003)
  if (!issues.some(i => i.ruleCode === 'CODE_002')) {
    // 如果已经报了 CODE_002（内部编码），不再重复报 CODE_001
    if (!headerText.includes(externalCode)) {
      if (headerText.trim().length === 0) {
        issues.push({
          issueType: 'ENCODING', ruleCode: 'CODE_003', severity: 'warning',
          originalText: '(页眉为空)',
          suggestedText: externalCode,
          description: '页眉为空或无法识别编码，应添加外部编码。',
        });
      } else {
        issues.push({
          issueType: 'ENCODING', ruleCode: 'CODE_001', severity: 'error',
          originalText: externalCode,
          description: `页眉编码与文件名外部编码"${externalCode}"不一致。`,
        });
      }
    }
  }

  // 2.5 机组号一致性检查 (UNIT_001 ~ UNIT_005)
  const coverText = ctx.extractedText || '';

  // 提取图册(文件)编号中的机组号（第7个字符）
  const albumCodePattern = /([A-Z]{2}\d{4})([A-Z0-9])[A-Z]{2}-[A-Z]{3}\d{2}/;
  const albumCodeMatch = coverText.match(albumCodePattern);

  // 提取 DOC.NO 中的机组号（第3个字符）
  const docNoPattern = /DOC\.?\s*NO[.:：\s]*([A-Z]{2})([A-Z0-9])\d{6}/i;
  const docNoMatch = coverText.match(docNoPattern);

  if (albumCodeMatch && docNoMatch) {
    const albumUnitNo = albumCodeMatch[2];  // 图册编号第7字符（即机组号位置）
    const docNoUnitNo = docNoMatch[2];      // DOC.NO第3字符（即机组号位置）

    if (albumUnitNo !== docNoUnitNo) {
      issues.push({
        issueType: 'ENCODING', ruleCode: 'UNIT_001', severity: 'error',
        originalText: `图册编号机组号=${albumUnitNo}, DOC.NO机组号=${docNoUnitNo}`,
        suggestedText: '两个位置的机组号应保持一致',
        description: `封面机组号不一致: 图册编号"${albumCodeMatch[0]}"中机组号="${albumUnitNo}" vs DOC.NO中机组号="${docNoUnitNo}"，应保持一致。`,
      });
    }
  }

  return issues;
}
