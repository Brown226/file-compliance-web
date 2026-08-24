/**
 * 规则 1: 文件命名规范检查
 * 错误代码: NAME_001 ~ NAME_010
 */

import { RuleIssue, FileContext } from './types';

export function checkNaming(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const name = ctx.fileName;
  const nameWithoutExt = name.replace(/\.[^.]+$/, '');

  // NAME_010: 文件扩展名不支持
  const allowedExt: string[] = config?.allowedExt || ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'txt', 'ppt', 'pptx'];
  if (!allowedExt.includes(ctx.fileType.toLowerCase())) {
    issues.push({
      issueType: 'NAMING', ruleCode: 'NAME_010', severity: 'error',
      originalText: name, suggestedText: undefined,
      description: `不支持的文件类型: .${ctx.fileType}，允许: ${allowedExt.join(', ')}`,
    });
    return issues; // 扩展名不对则不再继续检查
  }

  // NAME_001 已移除（2026-08 噪音清理）：「文件名含中文字符」在国内工程场景属常态，
  // 报 error 噪音大于价值。但保留「含中文则跳过编码格式检查」的门控语义——
  // 中文文件名不可能匹配编码格式，不门控会把噪音原样转移到 NAME_004~007。
  const hasChineseError = /[\u4e00-\u9fff]/.test(nameWithoutExt);

  // NAME_002: 包含空格
  if (/\s/.test(nameWithoutExt)) {
    issues.push({
      issueType: 'NAMING', ruleCode: 'NAME_002', severity: 'error',
      originalText: name,
      suggestedText: name.replace(/\s+/g, '-'),
      description: '文件名包含空格，应使用连字符(-)替代或移除空格。',
    });
  }

  // NAME_003: 包含非法特殊字符（仅允许字母、数字、连字符、括号）
  if (/[!@#$%^&+=\[\]{}|\\:;"'<>,?/~`]/.test(nameWithoutExt)) {
    issues.push({
      issueType: 'NAMING', ruleCode: 'NAME_003', severity: 'error',
      originalText: name,
      description: '文件名包含非法特殊字符，仅保留字母、数字、连字符(-)和括号()。',
    });
  }

  if (!hasChineseError) {
    // 根据文件类型选择正则检查
    if (['dwg', 'pdf'].includes(ctx.fileType.toLowerCase())) {
      // 图纸类文件: 检查图纸命名格式
      const drawingPatterns = [
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}\([A-Z]\)$/,                    // 图册/总目录
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}-\d{3}\([A-Z]\)$/,              // 具体图纸(序号)
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}-(CM|TM|FM|SM)\([A-Z]\)$/,     // 类型图纸
      ];

      const matchesAny = drawingPatterns.some(p => p.test(nameWithoutExt));
      if (!matchesAny) {
        // 尝试细分错误类型
        const projectCodeMatch = nameWithoutExt.match(/^([A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2})/);
        const systemCodeMatch = nameWithoutExt.match(/^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-([A-Z]{3}\d{2})/);

        // NAME_008: 序号格式检查（有连字符+数字但不是3位）
        // 修复（2026-08）：原条件 `seqMatch[1] !== '001'` 会把任何合法 3 位序号(002~999)误报，
        // 正确语义是仅当序号不是 3 位数字时报告。
        const seqMatch = nameWithoutExt.match(/^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}-(\d+)\(/);
        if (seqMatch && !/^\d{3}$/.test(seqMatch[1])) {
          issues.push({
            issueType: 'NAMING', ruleCode: 'NAME_008', severity: 'warning',
            originalText: seqMatch[1],
            suggestedText: seqMatch[1].padStart(3, '0'),
            description: `序号"${seqMatch[1]}"格式错误，应为3位数字(001-999)。`,
          });
        } else if (!projectCodeMatch) {
          issues.push({
            issueType: 'NAMING', ruleCode: 'NAME_004', severity: 'warning',
            originalText: name,
            description: '项目编码格式错误。标准: 2字母+2数字+1字母+2数字+2字母，如 FJ24A00AC',
          });
        } else if (!systemCodeMatch) {
          issues.push({
            issueType: 'NAMING', ruleCode: 'NAME_005', severity: 'warning',
            originalText: name,
            description: '系统编码格式错误。标准: 3字母+2数字，如 JPS02',
          });
        } else {
          // 项目编码和系统编码都对，但整体格式不匹配
          issues.push({
            issueType: 'NAMING', ruleCode: 'NAME_006', severity: 'warning',
            originalText: name,
            description: '图纸类型标识或版本号格式不符合规范。标准格式: [项目编码]-[系统编码]-[类型标识]([版本号])，如 FJ24A00AC-JPS02-001(A)',
          });
        }
      }
    }

    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ctx.fileType.toLowerCase())) {
      // 文档类文件: 检查文档命名格式
      const docPatterns = [
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}\([A-Z]\)$/,                    // 带版本号
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}(AJK|APD)\d{3}$/,               // 带类型和序号
        /^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}-[A-Z]{3}\d{2}$/,                              // 仅项目编码+系统编码
      ];

      const matchesAny = docPatterns.some(p => p.test(nameWithoutExt));
      if (!matchesAny) {
        issues.push({
          issueType: 'NAMING', ruleCode: 'NAME_007', severity: 'warning',
          originalText: name,
          description: '文档文件命名格式不符合规范。标准格式: [项目编码]-[系统编码][文件类型][序号]，如 FJ24A00AC-JPS01AJK001',
        });
      }
    }
  }

  // NAME_009: 版本号格式检查（针对含括号的文件名）
  const versionMatch = nameWithoutExt.match(/\(([^)]+)\)/);
  if (versionMatch && !/^[A-Z]$/.test(versionMatch[1])) {
    issues.push({
      issueType: 'NAMING', ruleCode: 'NAME_009', severity: 'warning',
      originalText: versionMatch[0],
      suggestedText: `(${versionMatch[1].toUpperCase().charAt(0)})`,
      description: `版本号"${versionMatch[1]}"格式错误，应为括号内单个大写字母，如(A)、(B)`,
    });
  }

  return issues;
}
