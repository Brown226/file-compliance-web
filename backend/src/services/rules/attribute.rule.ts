/**
 * 规则 3: 封面属性检查
 * 错误代码: ATTR_001 ~ ATTR_011
 */

import { RuleIssue, FileContext } from './types';

export function checkCoverAttributes(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // 2026-08 噪音清理：移除 ATTR_001/004/005/006/009 五项「未检测到即报」的封面缺失检查。
  // 这类检查强绑定核电图册封面版式，非封面文档 100% 误报，实测为 RULE_ONLY 最大噪音源。
  // 仅保留「有值才校验格式」的条目（ATTR_002/003/007/008/010），对任意文档均无副作用。

  // ATTR_003: 状态代码检查
  const statusCodes: string[] = config?.statusCodes || ['CFC', 'PRE', 'IFA', 'IFU', 'DES'];
  const statusMatch = text.match(/状态[：:\s]*([A-Z]{2,4})/);
  if (statusMatch) {
    if (!statusCodes.includes(statusMatch[1])) {
      issues.push({
        issueType: 'COMPLETENESS', ruleCode: 'ATTR_003', severity: 'error',
        originalText: statusMatch[1],
        suggestedText: 'CFC/PRE/IFA/IFU 之一',
        description: `状态代码"${statusMatch[1]}"非标准值。标准值: CFC(正式用于施工)/PRE(初步版)/IFA(用于批准)/IFU(用于信息)`,
      });
    }
  }

  // ATTR_007: 设计阶段检查
  const designStages: string[] = config?.designStages || ['初步设计', '施工图设计', '竣工图设计', '不分设计阶段'];
  const stageMatch = text.match(/设计阶段[：:\s]*([^\n\r]{2,10})/);
  if (stageMatch) {
    const stage = stageMatch[1].trim();
    if (!designStages.some(s => stage.includes(s))) {
      issues.push({
        issueType: 'COMPLETENESS', ruleCode: 'ATTR_007', severity: 'warning',
        originalText: stage,
        description: `设计阶段"${stage}"非标准值。标准值: 初步设计/施工图设计/竣工图设计`,
      });
    }
  }

  // ATTR_008: 专业检查
  const disciplines: string[] = config?.disciplines || ['综合', '建筑', '结构', '给排水', '电气', '暖通', '消防', '工艺', '热机'];
  const discMatch = text.match(/专\s*业[：:\s]*([^\n\r]{2,6})/);
  if (discMatch) {
    const disc = discMatch[1].trim();
    if (!disciplines.some(d => disc.includes(d))) {
      issues.push({
        issueType: 'COMPLETENESS', ruleCode: 'ATTR_008', severity: 'warning',
        originalText: disc,
        description: `专业"${disc}"非标准值。标准值: 综合/建筑/结构/给排水/电气/暖通/消防/工艺`,
      });
    }
  }

  // ATTR_002: 版次格式检查
  const versionMatch = text.match(/版次[：:\s]*([A-Za-z0-9]+)/);
  if (versionMatch) {
    const ver = versionMatch[1].toUpperCase();
    if (!/^[A-Z]$/.test(ver)) {
      issues.push({
        issueType: 'COMPLETENESS', ruleCode: 'ATTR_002', severity: 'error',
        originalText: versionMatch[1],
        suggestedText: ver.charAt(0).toUpperCase(),
        description: `版次"${versionMatch[1]}"格式错误，应为单个大写字母(A/B/C...)`,
      });
    }
  }

  // ATTR_009 已移除（2026-08 噪音清理）：「未检测到图册名称即报」同属封面版式强绑定噪音

  // ATTR_010: 册数合理性检查
  const volumeMatch = text.match(/共\s*(\d+)\s*册.*?第\s*(\d+)\s*册|第\s*(\d+)\s*册.*?共\s*(\d+)\s*册/);
  if (volumeMatch) {
    const total = parseInt(volumeMatch[1] || volumeMatch[4]);
    const current = parseInt(volumeMatch[2] || volumeMatch[3]);
    if (current > total) {
      issues.push({
        issueType: 'COMPLETENESS', ruleCode: 'ATTR_010', severity: 'error',
        originalText: `第${current}册/共${total}册`,
        description: `册数不合理：第${current}册不应大于共${total}册。`,
      });
    }
  }

  return issues;
}
