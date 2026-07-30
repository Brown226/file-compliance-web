/**
 * write_report 工具 — 生成 Markdown 审查报告
 *
 * 把 Agent 多步审查发现的结构化 ReviewIssue[] 写成 Markdown 报告，
 * 存到 uploads/agent_temp/{userId}/{sessionId}/reports/{reportName}.md
 *
 * 报告结构：
 * 1. 标题 + 元信息（生成时间 / 文件名 / 审查模式 / 工具调用数）
 * 2. 摘要（问题总数 / 按类型分组 / 高严重度数）
 * 3. 问题明细（按 severity 倒序：error > warning > info）
 *    - issueType 标签
 *    - 原文（引用块）
 *    - 建议修改（若有 suggestedText）
 *    - 描述（若有 description）
 *    - 严重度 / 风险等级 / 标准引用（若有）
 *
 * 安全约束：
 * - 报告文件只能写到当前会话目录的 reports/ 子目录下
 * - 文件名禁止包含路径分隔符（防止路径穿越）
 *
 * 参数：
 * - issues: ReviewIssue[] 结构化问题列表
 * - reportName: 报告名（不含扩展名，自动加 .md）
 * - sourceFile: 被审查的文件名（用于报告元信息）
 * - reviewMode: 审查模式（用于报告元信息）
 * - toolCallCount: 工具调用总数（用于报告元信息）
 *
 * 返回：
 * - filePath: 报告文件绝对路径
 * - fileName: 报告文件名
 * - size: 文件字节数
 * - issueCount: 问题数
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 13 种 issueType 的中文标签映射（与 llm.service.ts ReviewIssue 一致） */
const ISSUE_TYPE_LABELS: Record<string, string> = {
  TYPO: '错别字',
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
  FLUENCY: '流畅性',
  CROSS_REFERENCE: '交叉引用',
};

/** severity 优先级（用于排序） */
const SEVERITY_ORDER: Record<string, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/** riskLevel 优先级 */
const RISK_ORDER: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** 写报告结果 */
interface WriteReportResult {
  filePath: string;
  fileName: string;
  size: number;
  issueCount: number;
}

/**
 * 转义 Markdown 特殊字符（防止原文中的 `#`、`*` 等破坏格式）
 */
function escapeMarkdown(text: string): string {
  if (!text) return '';
  // 在以下字符前加反斜杠（仅行首时）
  return text.replace(/^([#>*\-+`~])/gm, '\\$1');
}

/**
 * 生成 Markdown 报告内容
 */
function buildMarkdownReport(params: {
  issues: any[];
  sourceFile?: string;
  reviewMode?: string;
  toolCallCount?: number;
}): string {
  const { issues, sourceFile, reviewMode, toolCallCount } = params;
  const now = new Date();
  const generatedAt = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 摘要统计
  const total = issues.length;
  const byType: Record<string, number> = {};
  let highSeverity = 0;

  for (const issue of issues) {
    const t = issue?.issueType || 'UNKNOWN';
    byType[t] = (byType[t] || 0) + 1;
    if (issue?.severity === 'error' || issue?.riskLevel === 'HIGH') {
      highSeverity++;
    }
  }

  // 按 severity 倒序排序（error > warning > info，无 severity 排最后）
  const sortedIssues = [...issues].sort((a, b) => {
    const aSev = SEVERITY_ORDER[a?.severity] || 0;
    const bSev = SEVERITY_ORDER[b?.severity] || 0;
    if (aSev !== bSev) return bSev - aSev;
    // severity 相同时按 riskLevel 排序
    const aRisk = RISK_ORDER[a?.riskLevel] || 0;
    const bRisk = RISK_ORDER[b?.riskLevel] || 0;
    return bRisk - aRisk;
  });

  // 拼装 Markdown
  const lines: string[] = [];

  // 1. 标题
  lines.push(`# 文件合规审查报告`);
  lines.push('');

  // 2. 元信息
  lines.push('## 元信息');
  lines.push('');
  lines.push(`- **生成时间**：${generatedAt}`);
  if (sourceFile) lines.push(`- **被审查文件**：${escapeMarkdown(sourceFile)}`);
  if (reviewMode) lines.push(`- **审查模式**：${escapeMarkdown(reviewMode)}`);
  if (toolCallCount !== undefined) lines.push(`- **工具调用数**：${toolCallCount}`);
  lines.push(`- **问题总数**：${total}`);
  lines.push(`- **高严重度**：${highSeverity}`);
  lines.push('');

  // 3. 摘要
  lines.push('## 问题摘要');
  lines.push('');
  if (total === 0) {
    lines.push('> 未发现问题。');
  } else {
    lines.push('| 问题类型 | 数量 |');
    lines.push('|----------|------|');
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      const label = ISSUE_TYPE_LABELS[type] || type;
      lines.push(`| ${label} | ${count} |`);
    }
    lines.push('');
    if (highSeverity > 0) {
      lines.push(`> 共发现 **${highSeverity}** 个高严重度问题，请优先处理。`);
      lines.push('');
    }
  }

  // 4. 问题明细
  lines.push('## 问题明细');
  lines.push('');
  if (total === 0) {
    lines.push('> 无问题明细。');
  } else {
    sortedIssues.forEach((issue, idx) => {
      const type = issue?.issueType || 'UNKNOWN';
      const typeLabel = ISSUE_TYPE_LABELS[type] || type;
      const severity = issue?.severity || '';
      const riskLevel = issue?.riskLevel || '';
      const originalText = issue?.originalText || '';
      const suggestedText = issue?.suggestedText || '';
      const description = issue?.description || '';
      const plainLanguage = issue?.plainLanguage || '';
      const recommendation = issue?.recommendation || '';
      const standardRef = issue?.standardRef || '';
      const ruleCode = issue?.ruleCode || '';

      // 问题标题
      const badge = severity ? ` [${severity.toUpperCase()}]` : (riskLevel ? ` [${riskLevel}]` : '');
      lines.push(`### ${idx + 1}. ${typeLabel}${badge}`);
      lines.push('');

      // 原文
      if (originalText) {
        lines.push('**原文**：');
        lines.push('```');
        lines.push(originalText);
        lines.push('```');
        lines.push('');
      }

      // 建议修改
      if (suggestedText) {
        lines.push('**建议修改为**：');
        lines.push('```');
        lines.push(suggestedText);
        lines.push('```');
        lines.push('');
      }

      // 描述
      if (description) {
        lines.push(`**描述**：${escapeMarkdown(description)}`);
        lines.push('');
      }

      // 大白话解释
      if (plainLanguage) {
        lines.push(`**大白话**：${escapeMarkdown(plainLanguage)}`);
        lines.push('');
      }

      // 合同审查修改建议
      if (recommendation) {
        lines.push(`**修改建议**：${escapeMarkdown(recommendation)}`);
        lines.push('');
      }

      // 标准引用
      if (standardRef) {
        lines.push(`**标准引用**：${escapeMarkdown(standardRef)}`);
        lines.push('');
      }

      // 规则编号
      if (ruleCode) {
        lines.push(`**规则编号**：\`${ruleCode}\``);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    });
  }

  // 5. 报告尾部
  lines.push('---');
  lines.push('');
  lines.push('*本报告由 Agent 审查通道自动生成，仅供参考。*');

  return lines.join('\n');
}

/**
 * 创建 write_report 工具
 */
export function createWriteReportTool(context: ToolContext) {
  return tool({
    description: '生成 Markdown 格式的审查报告并保存到服务端。报告包含元信息、问题摘要（按类型分组统计）、问题明细（按严重度排序）。返回报告文件路径，可用 download_report 工具下载。',
    inputSchema: z.object({
      issues: z.array(z.any()).describe('结构化问题列表（ReviewIssue[] 格式）'),
      reportName: z.string().describe('报告名（不含扩展名，自动加 .md，禁止包含路径分隔符）'),
      sourceFile: z.string().optional().describe('被审查的文件名（用于报告元信息）'),
      reviewMode: z.string().optional().describe('审查模式（如 contract_review / doc_review）'),
      toolCallCount: z.number().int().min(0).optional().describe('工具调用总数（用于报告元信息）'),
    }),
    execute: async ({ issues, reportName, sourceFile, reviewMode, toolCallCount }): Promise<WriteReportResult> => {
      // 报告名安全处理：移除路径分隔符，移除 .md 后缀（后面会自动加）
      const safeName = String(reportName || 'report')
        .replace(/[\\\/]/g, '_')
        .replace(/\.md$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
        .slice(0, 100) || 'report';
      const fileName = `${safeName}.md`;

      // 报告目录：uploads/agent_temp/{userId}/{sessionId}/reports/
      const sessionDir = path.join(
        __dirname,
        '../../../../../uploads/agent_temp',
        context.userId,
        context.sessionId,
      );
      const reportsDir = path.join(sessionDir, 'reports');
      const normalizedReportsDir = path.resolve(reportsDir);

      // 创建目录
      await fs.promises.mkdir(normalizedReportsDir, { recursive: true });

      // 生成报告内容
      const markdown = buildMarkdownReport({
        issues,
        sourceFile,
        reviewMode,
        toolCallCount,
      });

      // 写入文件
      const filePath = path.join(normalizedReportsDir, fileName);
      await fs.promises.writeFile(filePath, markdown, 'utf-8');

      const stat = await fs.promises.stat(filePath);

      return {
        filePath,
        fileName,
        size: stat.size,
        issueCount: issues.length,
      };
    },
  });
}
