/**
 * 规则: 标点符号规范检查
 *
 * 检测中文文档中常见的标点符号问题：
 * 1. 中英文标点混用（中文语境中使用了英文标点）
 * 2. 全半角括号/引号混用
 * 3. 连续重复标点
 * 4. 引号/括号不配对
 */

import { RuleIssue, FileContext } from './types';

/**
 * 标点符号规范性检查
 */
export function checkPunctuation(ctx: FileContext, _config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  if (!text || text.trim().length === 0) return issues;

  // 中文字符占比 < 30% 时不检查（非中文文档）
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseChars / text.length < 0.3) return issues;

  const maxPerType = 5; // 每类最多报 5 个实例

  // ===== 1. 中英文标点混用 =====
  // 中文句子中使用了英文逗号/句号/冒号/分号/问号/感叹号
  // 排除：数字中的小数点、英文缩写、URL

  // 英文逗号前后有中文字符
  let count1 = 0;
  const enCommaRegex = /([\u4e00-\u9fff]),(?=[\u4e00-\u9fff])/g;
  let m: RegExpExecArray | null;
  while ((m = enCommaRegex.exec(text)) !== null && count1 < maxPerType) {
    const idx = m.index + m[1].length;
    const context = text.slice(Math.max(0, idx - 15), Math.min(text.length, idx + 15));
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_001',
      severity: 'warning',
      originalText: m[0],
      suggestedText: m[0].replace(',', '，'),
      description: `中英文标点混用：英文逗号 ',' 应为中文逗号 '，'。上下文: ...${context}...`,
    });
    count1++;
  }

  // 英文句号前后有中文字符（排除小数点如 3.14）
  let count2 = 0;
  const enPeriodRegex = /([\u4e00-\u9fff])\.(?=[\u4e00-\u9fff])/g;
  while ((m = enPeriodRegex.exec(text)) !== null && count2 < maxPerType) {
    const idx = m.index + m[1].length;
    const context = text.slice(Math.max(0, idx - 15), Math.min(text.length, idx + 15));
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_001',
      severity: 'warning',
      originalText: m[0],
      suggestedText: m[0].replace('.', '。'),
      description: `中英文标点混用：英文句号 '.' 应为中文句号 '。'。上下文: ...${context}...`,
    });
    count2++;
  }

  // 英文冒号前后有中文字符
  let count3 = 0;
  const enColonRegex = /([\u4e00-\u9fff]):(?=[\u4e00-\u9fff])/g;
  while ((m = enColonRegex.exec(text)) !== null && count3 < maxPerType) {
    const idx = m.index + m[1].length;
    const context = text.slice(Math.max(0, idx - 15), Math.min(text.length, idx + 15));
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_001',
      severity: 'warning',
      originalText: m[0],
      suggestedText: m[0].replace(':', '：'),
      description: `中英文标点混用：英文冒号 ':' 应为中文冒号 '：'。上下文: ...${context}...`,
    });
    count3++;
  }

  // 英文分号前后有中文字符
  let count4 = 0;
  const enSemicolonRegex = /([\u4e00-\u9fff]);(?=[\u4e00-\u9fff])/g;
  while ((m = enSemicolonRegex.exec(text)) !== null && count4 < maxPerType) {
    const idx = m.index + m[1].length;
    const context = text.slice(Math.max(0, idx - 15), Math.min(text.length, idx + 15));
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_001',
      severity: 'warning',
      originalText: m[0],
      suggestedText: m[0].replace(';', '；'),
      description: `中英文标点混用：英文分号 ';' 应为中文分号 '；'。上下文: ...${context}...`,
    });
    count4++;
  }

  // ===== 2. 全半角括号混用 =====
  // 同一文档中既有全角括号（）又有半角括号()
  const hasFullWidthParen = text.includes('（') || text.includes('）');
  const hasHalfWidthParen = text.includes('(') || text.includes(')');
  if (hasFullWidthParen && hasHalfWidthParen) {
    // 报告半角括号在中文上下文中的使用
    let count5 = 0;
    const halfParenRegex = /([\u4e00-\u9fff])\(([^)]*)\)/g;
    while ((m = halfParenRegex.exec(text)) !== null && count5 < maxPerType) {
      const context = text.slice(Math.max(0, m.index - 15), Math.min(text.length, m.index + m[0].length + 15));
      issues.push({
        issueType: 'PUNCTUATION',
        ruleCode: 'PUNCT_002',
        severity: 'warning',
        originalText: m[0],
        suggestedText: m[0].replace(/\(/g, '（').replace(/\)/g, '）'),
        description: `全半角混用：文档中已使用全角括号'（）'，此处混用了半角括号'()'。上下文: ...${context}...`,
      });
      count5++;
    }
  }

  // ===== 3. 连续重复标点 =====
  let count6 = 0;
  const duplicatePunctRegex = /[。，！？；：]{2,}/g;
  while ((m = duplicatePunctRegex.exec(text)) !== null && count6 < maxPerType) {
    const context = text.slice(Math.max(0, m.index - 15), Math.min(text.length, m.index + m[0].length + 15));
    const first = m[0][0];
    // 连续句号（如"。。"）在中文排版中常是省略号的非规范写法，应建议"……"而非合并为单个句号（2026-08 修复）
    const isEllipsisLike = /^。{2,}$/.test(m[0]);
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_003',
      severity: 'info',
      originalText: m[0],
      suggestedText: isEllipsisLike ? '……' : first,
      description: isEllipsisLike
        ? `连续句号疑似省略号的非规范写法：'${m[0]}' 应为 '……'。上下文: ...${context}...`
        : `连续重复标点：'${m[0]}' 应为单个 '${first}'。上下文: ...${context}...`,
    });
    count6++;
  }

  // 省略号后接句号
  let count7 = 0;
  const ellipsisPeriodRegex = /[…。]。\./g;
  while ((m = ellipsisPeriodRegex.exec(text)) !== null && count7 < maxPerType) {
    issues.push({
      issueType: 'PUNCTUATION',
      ruleCode: 'PUNCT_003',
      severity: 'info',
      originalText: m[0],
      suggestedText: '…',
      description: `省略号后不应再接句号`,
    });
    count7++;
  }

  // PUNCT_004 已移除（2026-08 噪音清理）：引号/括号配对原为全文数量统计——
  // 只报一条且无定位信息，PDF 提取丢字符时必然误报，用户无法定位修复。
  // 如需恢复建议改为逐段扫描并报告首个失配位置。

  return issues;
}
