/**
 * 审查报告 Markdown 构建器（2026-09-10 抽出，供多链路复用）
 *
 * 背景：原先「结构化的审查问题 → Markdown 报告」这套拼装逻辑只存在于
 * Agent 的 write_report 工具内（agent_temp/reports/*.md）。
 * 而「审查摘要」页改造后需要为**每次审查任务**生成一份可展示、可导出的报告，
 * 故抽为独立模块，两条链路共用同一套排版与统计口径，避免样式/口径分叉。
 *
 * 设计要点：
 * - 纯函数、无 IO、无 DB：便于单测与复用
 * - 调用方可先用 AI 生成的 report_markdown，缺失时回落到本模块拼装（报告永不为空）
 */

/** 问题类型中文标签（与 llm.service.ts 的 ReviewIssue 口径一致） */
export const ISSUE_TYPE_LABELS: Record<string, string> = {
  TYPO: '错别字',
  FLUENCY: '语句通顺性',
  VIOLATION: '违规',
  FORMAT: '格式',
  COMPLETENESS: '完整性',
  CONSISTENCY: '一致性',
  LAYOUT: '版式',
  NAMING: '命名',
  ENCODING: '编码',
  ATTRIBUTE: '属性',
  HEADER: '页眉',
  PAGE: '页码',
  CROSS_REFERENCE: '交叉引用',
  UNKNOWN: '其他',
};

/** severity 排序权重（error 优先） */
const SEVERITY_ORDER: Record<string, number> = { error: 3, warning: 2, info: 1 };

/** riskLevel 排序权重 */
const RISK_ORDER: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** 转义 Markdown 行首特殊字符，防止原文破坏排版 */
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/^([#>*\-+`~])/gm, '\\$1');
}

/** 审查报告构建结果（含统计，供调用方复用而不必二次计算） */
export interface ReviewReportStats {
  total: number;
  highSeverity: number;
  /** issueType → 数量 */
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface BuildReviewReportOptions {
  issues: any[];
  /** 被审查文件名（单个或逗号拼接） */
  sourceFile?: string;
  /** 审查模式显示名（如「基础校对」） */
  reviewMode?: string;
  /** 任务标题 */
  taskTitle?: string;
  /** 生成时间（默认当前时间，注入便于测试） */
  generatedAt?: Date;
  /** 报告头部附加说明（如降级提示） */
  notice?: string;
  /** 报告尾部落款 */
  footer?: string;
}

/** 统计问题分布（报表头/摘要表共用） */
export function computeReportStats(issues: any[]): ReviewReportStats {
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let highSeverity = 0;
  for (const issue of issues || []) {
    const t = issue?.issueType || 'UNKNOWN';
    byType[t] = (byType[t] || 0) + 1;
    const sev = issue?.severity || 'unknown';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    if (issue?.severity === 'error' || issue?.riskLevel === 'HIGH') highSeverity++;
  }
  return { total: (issues || []).length, highSeverity, byType, bySeverity };
}

/** 按 severity 倒序（同级按 riskLevel）排序，返回新数组 */
export function sortIssuesForReport(issues: any[]): any[] {
  return [...(issues || [])].sort((a, b) => {
    const aSev = SEVERITY_ORDER[a?.severity] || 0;
    const bSev = SEVERITY_ORDER[b?.severity] || 0;
    if (aSev !== bSev) return bSev - aSev;
    return (RISK_ORDER[b?.riskLevel] || 0) - (RISK_ORDER[a?.riskLevel] || 0);
  });
}

/**
 * 把结构化问题拼装为 Markdown 审查报告。
 *
 * 报告结构：标题 → 元信息 → 问题摘要（类型分布表）→ 问题明细（按严重度排序）→ 落款
 * 空问题时不报错，输出「未发现问题」占位，保证报告文档结构完整。
 */
export function buildReviewReportMarkdown(options: BuildReviewReportOptions): string {
  const { issues, sourceFile, reviewMode, taskTitle, notice, footer } = options;
  const generatedAt = (options.generatedAt || new Date()).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
  });
  const stats = computeReportStats(issues);
  const sorted = sortIssuesForReport(issues);

  const lines: string[] = [];
  lines.push('# 文件合规审查报告');
  lines.push('');

  if (notice) {
    lines.push(`> ⚠️ ${notice}`);
    lines.push('');
  }

  // 元信息
  lines.push('## 一、元信息');
  lines.push('');
  lines.push(`- **生成时间**：${generatedAt}`);
  if (taskTitle) lines.push(`- **任务名称**：${escapeMarkdown(taskTitle)}`);
  if (sourceFile) lines.push(`- **被审查文件**：${escapeMarkdown(sourceFile)}`);
  if (reviewMode) lines.push(`- **审查模式**：${escapeMarkdown(reviewMode)}`);
  lines.push(`- **问题总数**：${stats.total}`);
  lines.push(`- **高严重度**：${stats.highSeverity}`);
  lines.push('');

  // 问题摘要
  lines.push('## 二、问题摘要');
  lines.push('');
  if (stats.total === 0) {
    lines.push('> 未发现问题。');
    lines.push('');
  } else {
    lines.push('| 问题类型 | 数量 |');
    lines.push('|----------|------|');
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${ISSUE_TYPE_LABELS[type] || type} | ${count} |`);
    }
    lines.push('');
    const sevParts: string[] = [];
    if (stats.bySeverity.error) sevParts.push(`严重 ${stats.bySeverity.error} 条`);
    if (stats.bySeverity.warning) sevParts.push(`警告 ${stats.bySeverity.warning} 条`);
    if (stats.bySeverity.info) sevParts.push(`提示 ${stats.bySeverity.info} 条`);
    if (sevParts.length > 0) {
      lines.push(`> 严重度分布：${sevParts.join('，')}。`);
      lines.push('');
    }
    if (stats.highSeverity > 0) {
      lines.push(`> 共发现 **${stats.highSeverity}** 个高严重度问题，请优先处理。`);
      lines.push('');
    }
  }

  // 问题明细
  lines.push('## 三、问题明细');
  lines.push('');
  if (stats.total === 0) {
    lines.push('> 无问题明细。');
    lines.push('');
  } else {
    sorted.forEach((issue, idx) => {
      const typeLabel = ISSUE_TYPE_LABELS[issue?.issueType || 'UNKNOWN'] || issue?.issueType || '其他';
      const severity = issue?.severity || '';
      const riskLevel = issue?.riskLevel || '';
      const badge = severity ? ` [${String(severity).toUpperCase()}]` : (riskLevel ? ` [${riskLevel}]` : '');
      lines.push(`### 3.${idx + 1} ${typeLabel}${badge}`);
      lines.push('');

      if (issue?.originalText) {
        lines.push('**原文**：');
        lines.push('');
        lines.push('```');
        lines.push(String(issue.originalText));
        lines.push('```');
        lines.push('');
      }
      if (issue?.suggestedText) {
        lines.push('**建议修改为**：');
        lines.push('');
        lines.push('```');
        lines.push(String(issue.suggestedText));
        lines.push('```');
        lines.push('');
      }
      if (issue?.description) {
        lines.push(`**描述**：${escapeMarkdown(String(issue.description))}`);
        lines.push('');
      }
      if (issue?.plainLanguage) {
        lines.push(`**大白话**：${escapeMarkdown(String(issue.plainLanguage))}`);
        lines.push('');
      }
      if (issue?.recommendation) {
        lines.push(`**修改建议**：${escapeMarkdown(String(issue.recommendation))}`);
        lines.push('');
      }
      if (issue?.standardRef) {
        lines.push(`**标准引用**：${escapeMarkdown(String(issue.standardRef))}`);
        lines.push('');
      }
      if (issue?.ruleCode) {
        lines.push(`**规则编号**：\`${issue.ruleCode}\``);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    });
  }

  lines.push(footer || '*本报告由平台自动生成，仅供参考，请以人工复核结论为准。*');
  return lines.join('\n');
}
