/**
 * 规则 4: 页眉内容检查
 * 错误代码: HEADER_001 ~ HEADER_003
 *
 * config 参数说明:
 *   coverNamePattern?: string | RegExp  — 封面图册名称提取正则（默认匹配"图册/文件名称"）
 *   stripSuffixes?: string[]            — 核心名称提取时移除的后缀列表
 *   maxCheckPages?: number              — 最多检查前N页页眉（默认5）
 *   headerMustMatchCover?: boolean      — 是否强制页眉必须匹配封面名称（默认true）
 */

import { RuleIssue, FileContext } from './types';

export function checkHeader(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!ctx.pdfPages || ctx.pdfPages.length < 2) return issues;

  const coverText = ctx.extractedText || '';

  // 提取封面的图册名称（支持 config 覆盖正则）
  const coverNamePattern: RegExp = config?.coverNamePattern
    ? (typeof config.coverNamePattern === 'string' ? new RegExp(config.coverNamePattern) : config.coverNamePattern)
    : /(?:图册|文件)\s*(?:名称)?[：:\s]*([^\n\r]{4,})/;
  const coverNameMatch = coverText.match(coverNamePattern);
  const coverName = coverNameMatch ? coverNameMatch[1].trim() : '';

  if (!coverName) return issues; // 封面没有名称则跳过

  // 提取名称核心关键词（去掉一个尾部常见后缀以支持部分匹配，支持 config 覆盖后缀列表）
  const stripSuffixes: string[] = config?.stripSuffixes || ['施工图设计说明', '施工图设计', '设计说明', '设计'];
  // 只剥离一个匹配的尾部后缀，且保证核心名非空（避免整名被剥空导致部分匹配失效）
  let coreNameRaw = coverName;
  for (const suffix of stripSuffixes) {
    if (coverName.endsWith(suffix) && coverName.length > suffix.length) {
      coreNameRaw = coverName.slice(0, coverName.length - suffix.length);
      break;
    }
  }
  const coreName = coreNameRaw.trim().replace(/\s+/g, '');

  // 最多检查页数（支持 config 覆盖）
  const maxCheckPages: number = config?.maxCheckPages ?? 5;

  // 替代页眉白名单：工程图纸页眉常用图号/编号/页码等替代封面名，不算错误。
  // 任一模式命中即视为"正常页眉"，跳过 HEADER_001/002。支持 config 覆盖。
  const alternativeHeaderPatterns: RegExp[] = config?.alternativeHeaderPatterns
    ? (Array.isArray(config.alternativeHeaderPatterns)
        ? config.alternativeHeaderPatterns.map((p: string | RegExp) =>
            typeof p === 'string' ? new RegExp(p) : p)
        : [config.alternativeHeaderPatterns])
    : [
        /图\s*号|图号[：:\s]|DWG[\s\-]?NO/i,            // 图号
        /DOC\.?\s*NO|FILE\s*NO|文件编号|编号[：:\s]/i,   // 文件编号
        /第\s*\d+\s*页|PAGE\s*\d+/i,                     // 页码
        /共\s*\d+\s*页|(\d+)\s*\/\s*(\d+)/,              // 共几页 / x/y
        /版\s*次|REV\s*[.\-]?\d+/i,                      // 版次/修订
      ];

  // 检查第2页起的页眉（跳过封面页）
  let reported = false;
  for (let i = 1; i < Math.min(ctx.pdfPages.length, maxCheckPages) && !reported; i++) {
    const headerText = ctx.pdfPages[i];

    if (headerText.includes(coverName)) {
      // 精确匹配，通过
      continue;
    } else if (coreName.length > 2 && headerText.includes(coreName)) {
      // 核心名称部分匹配，通过
      continue;
    } else if (headerText.trim().length === 0) {
      issues.push({
        issueType: 'VIOLATION', ruleCode: 'HEADER_002', severity: 'warning',
        originalText: `(第${i + 1}页页眉)`,
        suggestedText: coverName,
        description: `第${i + 1}页页眉内容为空，应包含图册名称"${coverName}"。`,
      });
      reported = true;
    } else if (alternativeHeaderPatterns.some(re => re.test(headerText))) {
      // 命中替代页眉白名单（图号/编号/页码/版次等）：视为正常工程页眉，不报错
      continue;
    } else {
      // 不匹配（可通过 config.headerMustMatchCover=false 跳过此检查）
      if (config?.headerMustMatchCover !== false) {
        issues.push({
          issueType: 'VIOLATION', ruleCode: 'HEADER_001', severity: 'error',
          originalText: `(第${i + 1}页页眉)`,
          suggestedText: coverName,
          description: `页眉名称与封面图册名称不一致。封面名称: "${coverName}"`,
        });
        reported = true;
      }
    }
  }

  return issues;
}
