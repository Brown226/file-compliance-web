/**
 * 规则 8: 一致性检查 (CONSISTENCY 类)
 * 错误代码: CONSIST_001 ~ CONSIST_002
 * 对应报告: T1d项目名不一致, T4b目录编码与实际不一致
 */

import { RuleIssue, FileContext } from './types';

export function checkConsistency(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // CONSIST_001: 项目名称一致性（封面 vs 正式项目名）
  const projectIssue = checkProjectNameConsistency(text, config);
  if (projectIssue) issues.push(projectIssue);

  // CONSIST_002: 目录中的编码与实际文件/正文编码的一致性
  const tocIssue = checkTocCodeConsistency(text);
  if (tocIssue) issues.push(tocIssue);

  return issues;
}

/**
 * CONSIST_001: 比较封面中的项目名称与正式核准的项目名称
 * 常见问题: 写了"漳州核电1、2号机组技术改造"而非"漳州核电厂技术改造"
 */
function checkProjectNameConsistency(text: string, config?: any): RuleIssue | null {
  // 提取封面的项目名称
  const projectPatterns = [
    /项\s*目\s*名\s*称?[：:\s]*([^\n\r]{5,30})/,
    /(?:项目|工程)[^名称]{0,5}[：:\s]*([^\n\r]{5,30}?)(?:\s|$)/,
    /^(?:.{0,10})?(?:项目|工程)(?:名称)?[：:\s]*([^\n\r]{5,30})/m,
  ];

  let coverProjectName = '';
  for (const pat of projectPatterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      coverProjectName = match[1].trim();
      break;
    }
  }

  if (!coverProjectName || coverProjectName.length < 5) return null;

  // 常见的不一致模式：
  // 1. 包含了不应有的机组号（如"1、2号机组"）
  // 2. 项目名有多余修饰词
  const inconsistentPatterns: Array<{ regex: RegExp; desc: string }> = config?.inconsistentPatterns || [
    { regex: /[\d]+[、,，]\s*[\d]+\s*号\s*机组/, desc: '项目名称包含了特定机组号，可能不符合正式核准名称' },
    { regex: /(\S+)\s+(?:技术改造|工程设计|施工图)/, desc: '项目名称后缀可能与正式名称不一致' },
  ];

  for (const ip of inconsistentPatterns) {
    if (ip.regex.test(coverProjectName)) {
      return {
        issueType: 'CONSISTENCY', ruleCode: 'CONSIST_001',
        severity: 'warning',
        originalText: coverProjectName,
        description: `项目名称可能不一致: "${coverProjectName}"。${ip.desc}请核实正式项目核准名称并保持一致。`,
      };
    }
  }

  return null;
}

/**
 * CONSIST_002: 检查目录中的文件编码与实际出现的是否一致
 * 例如: 目录列出 1EAA001TB 但实际应该是 1EAE360CR
 */
function checkTocCodeConsistency(text: string): RuleIssue | null {
  // 提取目录区域的编码列表
  const tocMatch = text.match(/(?:目\s*录|图纸\s*目\s*录)[\s\S]{0,2000}/);
  if (!tocMatch) return null;

  const tocText = tocMatch[0];

  // 从目录中提取所有类似 ID-code 的编码 (如 1EAA360CR, ZG25401EA 等)
  const tocCodes = new Set<string>();
  const idCodeInToc = tocText.match(/[A-Z]{2,3}\d{2,}[A-Z]{0,2}\d*[A-Z]{0,3}/g);
  if (idCodeInToc) {
    for (const code of idCodeInToc) {
      // 过滤掉太短或太长的（ID-code 通常 8-15 字符）
      if (code.length >= 8 && code.length <= 18) {
        tocCodes.add(code.toUpperCase());
      }
    }
  }

  // 从正文中提取出现的编码
  const bodyText = text.replace(tocText, ''); // 排除目录区域本身
  const bodyCodes = new Set<string>();
  const idCodeInBody = bodyText.match(/[A-Z]{2,3}\d{2,}[A-Z]{0,2}\d*[A-Z]{0,3}/g);
  if (idCodeInBody) {
    for (const code of idCodeInBody) {
      if (code.length >= 8 && code.length <= 18) {
        bodyCodes.add(code.toUpperCase());
      }
    }
  }

  // 如果目录中有编码但正文中没有对应编码，可能不一致
  if (tocCodes.size > 0 && bodyCodes.size > 0) {
    const codesOnlyInToc = [...tocCodes].filter(c => !bodyCodes.has(c) &&
      !([...bodyCodes].some(bc => bc.startsWith(c.substring(0, 6)) || c.startsWith(bc.substring(0, 6))))
    );

    if (codesOnlyInToc.length > 0) {
      return {
        issueType: 'CONSISTENCY', ruleCode: 'CONSIST_002',
        severity: 'error',
        originalText: codesOnlyInToc.slice(0, 3).join(', '),
        description: `目录中的文件编码在正文中无法找到匹配: ${codesOnlyInToc.slice(0, 3).join(', ')}。请核对目录中的编码是否与实际文件编码一致。`,
      };
    }
  }

  return null;
}
