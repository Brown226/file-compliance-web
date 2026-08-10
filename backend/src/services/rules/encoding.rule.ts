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
    // CODE_004: 文件名中无法提取外部编码（仅当文件名看起来像编码但格式不完全匹配时报告）
    if (/^[A-Z]{2}\d{2}[A-Z]/.test(nameWithoutExt)) {
      issues.push({
        issueType: 'VIOLATION', ruleCode: 'CODE_004', severity: 'warning',
        originalText: nameWithoutExt,
        description: '无法从文件名中提取有效的外部编码，请检查文件名是否符合命名规范。',
      });
    }
    return issues;
  }
  const externalCode = externalCodeMatch[1];

  // CODE_005: PDF无法读取页眉内容
  // 可达性验证（2026-08-07 确认）：文件名匹配外部编码格式但 pdfPages 为空 的路径可达——
  // 现有测试 encoding.rule.test.ts "CODE_005: should detect when pdfPages is empty" 已证明（pdfPages: [] + 编码文件名）。
  // txt 等无 pdfPages 文件路径同样可达，但"PDF页眉不可读"对非 PDF 文件无意义：
  // 若 txt/docx/dwg 文件名恰好匹配编码格式且无 pdfPages，会误报 CODE_005。
  // 故仅 PDF 文件类型触发 CODE_005；非 PDF 文件无页眉文本可校验，直接返回（同时避免
  // 下方 headerText 从空 pdfPages 越界读取 undefined——P2-13 实测暴露的潜在崩溃点）。
  if (!ctx.pdfPages || ctx.pdfPages.length === 0) {
    if (ctx.fileType.toLowerCase() === 'pdf') {
      issues.push({
        issueType: 'VIOLATION', ruleCode: 'CODE_005', severity: 'warning',
        originalText: '(PDF页眉不可读)',
        description: '无法读取PDF页眉内容，跳过编码一致性检查。',
      });
    }
    return issues;
  }

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
        issueType: 'VIOLATION', ruleCode: 'CODE_002', severity: 'error',
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
          issueType: 'VIOLATION', ruleCode: 'CODE_003', severity: 'warning',
          originalText: '(页眉为空)',
          suggestedText: externalCode,
          description: '页眉为空或无法识别编码，应添加外部编码。',
        });
      } else {
        issues.push({
          issueType: 'VIOLATION', ruleCode: 'CODE_001', severity: 'error',
          originalText: externalCode,
          description: `页眉编码与文件名外部编码"${externalCode}"不一致。`,
        });
      }
    }
  }

  return issues;
}

/**
 * 规则 2b: 机组号一致性检查（UNIT_001 ~ UNIT_005）
 *
 * 独立函数：原先与 checkEncodingConsistency 注册为同一条 fn 执行两遍，
 * 导致 CODE 与 UNIT 两类问题全部双份重复报告（2026-08 修复）。
 */
export function checkUnitConsistency(ctx: FileContext, _config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 2.5 机组号一致性检查 (UNIT_001 ~ UNIT_005)
  const coverText = ctx.extractedText || '';

  // 提取图册(文件)编号中的机组号（第7个字符）
  const albumCodePattern = /([A-Z]{2}\d{4})([A-Z0-9])[A-Z]{2}-[A-Z]{3}\d{2}/;
  const albumCodeMatch = coverText.match(albumCodePattern);

  // 提取 DOC.NO 中的机组号（第3个字符）
  const docNoPattern = /DOC\.?\s*NO[.:：\s]*([A-Z]{2})([A-Z0-9])\d{6}/i;
  const docNoMatch = coverText.match(docNoPattern);

  // UNIT_004: 封面缺少图册编号
  const hasAlbumCode = /(?:图册|文件)\s*(?:编号|号)[：:\s]*[A-Z0-9\-]+/i.test(coverText);
  if (!hasAlbumCode) {
    issues.push({
      issueType: 'VIOLATION', ruleCode: 'UNIT_004', severity: 'warning',
      originalText: '(未检测到)',
      description: '封面未检测到图册(文件)编号，无法进行机组号一致性检查。',
    });
  }

  // UNIT_005: 封面缺少DOC.NO
  const hasDocNo = /DOC\.?\s*NO[.:：\s]*[A-Z0-9]+/i.test(coverText);
  if (!hasDocNo) {
    issues.push({
      issueType: 'VIOLATION', ruleCode: 'UNIT_005', severity: 'warning',
      originalText: '(未检测到)',
      description: '封面未检测到DOC.NO，无法进行机组号一致性检查。',
    });
  }

  // UNIT_002: 无法从图册编号提取机组号
  if (hasAlbumCode && !albumCodeMatch) {
    issues.push({
      issueType: 'VIOLATION', ruleCode: 'UNIT_002', severity: 'warning',
      originalText: '(格式不匹配)',
      description: '无法从图册编号中提取机组号，请检查编号格式是否符合规范（如 QS25160ED-JPK01）。',
    });
  }

  // UNIT_003: 无法从DOC.NO提取机组号
  if (hasDocNo && !docNoMatch) {
    issues.push({
      issueType: 'VIOLATION', ruleCode: 'UNIT_003', severity: 'warning',
      originalText: '(格式不匹配)',
      description: '无法从DOC.NO中提取机组号，请检查DOC.NO格式是否符合规范（如 QS251600001B25A44GN）。',
    });
  }

  // UNIT_001: 机组号不一致
  if (albumCodeMatch && docNoMatch) {
    const albumUnitNo = albumCodeMatch[2];  // 图册编号第7字符（即机组号位置）
    const docNoUnitNo = docNoMatch[2];      // DOC.NO第3字符（即机组号位置）

    if (albumUnitNo !== docNoUnitNo) {
      issues.push({
        issueType: 'VIOLATION', ruleCode: 'UNIT_001', severity: 'error',
        originalText: `图册编号机组号=${albumUnitNo}, DOC.NO机组号=${docNoUnitNo}`,
        suggestedText: '两个位置的机组号应保持一致',
        description: `封面机组号不一致: 图册编号"${albumCodeMatch[0]}"中机组号="${albumUnitNo}" vs DOC.NO中机组号="${docNoUnitNo}"，应保持一致。`,
      });
    }
  }

  return issues;
}
