/**
 * 规则 7: 数据完整性检查 (COMPLETENESS 类)
 * 错误代码: COMPL_001 ~ COMPL_003
 * 对应报告: T3a必填留空, T3b路径不全, T3c变更标记缺失
 */

import { RuleIssue, FileContext } from './types';

export function checkCompleteness(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // COMPL_001: 表格数据完整性 — 检测大面积空白单元格
  issues.push(...checkTableDataCompleteness(ctx, config));

  // COMPL_002: 电缆/路径数据完整性
  issues.push(...checkCablePathData(text));

  // COMPL_003: 变更标记缺失
  issues.push(...checkChangeMarkers(text));

  return issues;
}

/**
 * COMPL_001: 检测表格中是否有大量空白/未填充的数据单元格
 */
function checkTableDataCompleteness(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // 查找数据表格区域（跳过前几行可能是标题的区域）
  const lines = text.split('\n');
  const dataLines = lines.filter((line, idx) => {
    // 跳过前10行（通常是封面/标题区域）
    if (idx < 10) return false;
    // 检测数据行: 包含至少3个制表符或竖线分隔符
    const tabs = (line.match(/\t/g) || []).length;
    const pipes = (line.match(/\|/g) || []).length;
    return tabs >= 3 || pipes >= 5;
  });

  if (dataLines.length === 0) return issues;

  // 计算空白率：统计只含空格/制表符或连续多个空单元格的行
  let emptyLineCount = 0;
  let nearEmptyLineCount = 0; // 近乎空的行（超过一半列为空）

  for (const line of dataLines) {
    // 按 \t 或 | 分割
    const cells = line.split(/[\t|]/).map(c => c.trim());
    const emptyCells = cells.filter(c => c === '' || c === '-').length;
    const emptyRatio = cells.length > 0 ? emptyCells / cells.length : 0;

    if (emptyRatio >= 0.8) emptyLineCount++;
    else if (emptyRatio >= 0.5) nearEmptyLineCount++;
  }

  const totalDataLines = dataLines.length;
  const totalEmptyRatio = (emptyLineCount + nearEmptyLineCount * 0.5) / totalDataLines;

  // 如果超过阈值的数据行为近空或全空
  const emptyThreshold = config?.emptyThreshold ?? 0.3;
  if (totalEmptyRatio > emptyThreshold && totalDataLines >= 3) {
    issues.push({
      issueType: 'COMPLETENESS', ruleCode: 'COMPL_001',
      severity: 'error',
      originalText: `${emptyLineCount}行全空, ${nearEmptyLineCount}行半空 (共${totalDataLines}行数据)`,
      description: `数据表格存在大量空白单元格(${Math.round(totalEmptyRatio * 100)}%的行不完整)。请确认所有必填字段已填写完整，不允许关键数据项留空。`,
    });
  }

  return issues;
}

/**
 * COMPL_002: 检查电缆/路径相关数据的完整性
 */
function checkCablePathData(text: string): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 判断是否为电缆/路径相关文件
  const isCableFile = /电缆|路径|敷设|Cable|Route/.test(text);
  if (!isCableFile) return issues;

  // 检查必要的路径信息字段
  const pathRequiredFields = [
    { label: '起点', patterns: [/起\s*点|起始|From|Source/] },
    { label: '终点', patterns: [/终\s*点|终止|To|Dest/] },
    { label: '电缆状态', patterns: [/电缆\s*状态|Cable\s*Status|状态\b/] },
    { label: '路径状态', patterns: [/路\s*径\s*状态|Route\s*Status/] },
  ];

  const missingPathFields: string[] = [];
  for (const field of pathRequiredFields) {
    const found = field.patterns.some(p => p.test(text));
    if (!found) {
      missingPathFields.push(field.label);
    }
  }

  // 检查是否有路径节点序列 (LVYE1L613AB → LVYE1L613AA ...)
  const hasPathSequence = /([A-Z]{2}\d[A-Z]\d{3}[A-Z]{2}\s*[-→→]\s*){2,}[A-Z]{2}\d[A-Z]\d{3}[A-Z]{2}/.test(text);

  if (missingPathFields.length >= 2 || (isCableFile && !hasPathSequence)) {
    const missingDesc = [...missingPathFields];
    if (isCableFile && !hasPathSequence) {
      missingDesc.push('路径节点序列');
    }
    issues.push({
      issueType: 'COMPLETENESS', ruleCode: 'COMPL_002',
      severity: 'warning',
      originalText: `(缺失: ${missingPathFields.join(', ')})`,
      description: `电缆/路径清单数据不完整，缺少: ${missingDesc.join('、')}。电缆敷设文件应提供完整的起终点部件信息和路径节点序列。`,
    });
  }

  return issues;
}

/**
 * COMPL_003: 变更标记检查
 * 当文件的修改范围/修改依据不为"ALL"/"初版"时，每条数据记录应有变更标记
 */
function checkChangeMarkers(text: string): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 检查修改范围/修改依据字段
  const modScopeMatch = text.match(/(?:修改\s*范\s*围|修\s*改\s*依\s*据|Modifications?)[：:\s]*([^\n\r]+)/i);

  if (!modScopeMatch) return issues; // 无修改范围字段则跳过

  const modScope = modScopeMatch[1].trim();

  // 如果是初版或全部修改，不需要变更标记
  if (/^(ALL|初版|初始|首次|全部|整体|原版)$/i.test(modScope)) return issues;

  // 有具体修改范围时，检查是否存在变更标记列
  // 变更标记取值: NA / ADD / DEL / WBC / MOD / ADDED / DELETED / MODIFIED / VALIDATED
  const changeMarkerPatterns = [
    /\b(?:NA|ADD|DEL|WBC|MOD|ADDED|DELETED|MODIFIED|VALIDATED)\b/,
    /变\s*更\s*标\s*记|Change\s*Mark|状态\s*标记/,
  ];

  const hasMarkerColumn = changeMarkerPatterns.some(p => p.test(text));

  if (!hasMarkerColumn) {
    issues.push({
      issueType: 'COMPLETENESS', ruleCode: 'COMPL_003',
      severity: 'error',
      originalText: `修改范围="${modScope}"`,
      description: `文件修改范围为"${modScope}"(非初版/ALL)，但数据记录中未发现变更标记列(NA/ADD/DEL/WBC/MOD)。修改类文件必须标注每条记录的变更性质。`,
    });
  }

  return issues;
}
