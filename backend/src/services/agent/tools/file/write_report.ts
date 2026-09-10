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
import { getTodayDir } from './paths';
import { FileWriteQueueService } from '../../file-queue/file-write-queue.service';
import { buildReviewReportMarkdown } from '../../../review/review-report.builder';

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
 * 生成 Markdown 报告内容
 *
 * 2026-09-10：拼装逻辑已抽出为 review/review-report.builder.ts，本函数改为薄封装，
 * 使 Agent 报告通道与「审查任务报告」共用同一套排版/统计口径（避免两处样式分叉）。
 * 保留原函数签名与工具返回结构，既有单测与调用方不受影响。
 */
function buildMarkdownReport(params: {
  issues: any[];
  sourceFile?: string;
  reviewMode?: string;
  toolCallCount?: number;
}): string {
  const { issues, sourceFile, reviewMode } = params;
  return buildReviewReportMarkdown({
    issues,
    sourceFile,
    reviewMode,
    footer: '*本报告由 Agent 审查通道自动生成，仅供参考，请以人工复核结论为准。*',
  });
}

/**
 * P1-④⑤：生成 xlsx 审查报告（问题清单天然是表格）
 * 表头：类型 / 严重度 / 原文 / 建议修改 / 描述 / 规则编号 / 标准引用 / 风险等级
 */
async function writeXlsxReport(filePath: string, issues: any[]): Promise<void> {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('审查报告');

  // 表头
  const headers = ['类型', '严重度', '风险等级', '原文', '建议修改', '描述', '规则编号', '标准引用'];
  ws.addRow(headers);
  // 表头样式
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  headerRow.height = 20;

  // 数据行
  for (const it of issues || []) {
    ws.addRow([
      ISSUE_TYPE_LABELS[it.issueType] || it.issueType || '',
      it.severity || '',
      it.riskLevel || '',
      it.originalText || '',
      it.suggestedText || '',
      it.description || '',
      it.ruleCode || '',
      it.standardRef || '',
    ]);
  }

  // 列宽
  ws.columns = [
    { width: 12 }, { width: 10 }, { width: 10 },
    { width: 40 }, { width: 40 }, { width: 40 },
    { width: 18 }, { width: 30 },
  ];

  // 自动筛选 + 冻结表头
  if ((issues || []).length > 0) {
    ws.autoFilter = { from: 'A1', to: `H${issues.length + 1}` };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  await wb.xlsx.writeFile(filePath);
}

/**
 * P1-④⑤：生成 docx 审查报告（Markdown → Word）
 * 用 docx 库直接构建 Word 文档，内容与 md 报告对齐（标题 + 摘要 + 问题明细）。
 */
async function writeDocxReport(filePath: string, issues: any[]): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = require('docx');
  const total = issues.length;
  const byType: Record<string, number> = {};
  let highSeverity = 0;
  for (const it of issues) {
    const t = it?.issueType || 'UNKNOWN';
    byType[t] = (byType[t] || 0) + 1;
    if (it?.severity === 'error' || it?.riskLevel === 'HIGH') highSeverity++;
  }
  const sorted = [...issues].sort((a, b) => {
    const aSev = SEVERITY_ORDER[a?.severity] || 0;
    const bSev = SEVERITY_ORDER[b?.severity] || 0;
    if (aSev !== bSev) return bSev - aSev;
    const aRisk = RISK_ORDER[a?.riskLevel] || 0;
    const bRisk = RISK_ORDER[b?.riskLevel] || 0;
    return bRisk - aRisk;
  });

  const children: any[] = [];
  // 标题
  children.push(new Paragraph({
    text: '审查报告',
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({
    text: '生成时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({ text: '' }));

  // 摘要
  children.push(new Paragraph({ text: '一、问题摘要', heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: `问题总数：${total}  高严重度：${highSeverity}`, spacing: { after: 120 } }));
  for (const [t, cnt] of Object.entries(byType)) {
    children.push(new Paragraph({ text: `  ${ISSUE_TYPE_LABELS[t] || t}：${cnt} 项` }));
  }
  children.push(new Paragraph({ text: '' }));

  // 问题明细表
  children.push(new Paragraph({ text: '二、问题明细', heading: HeadingLevel.HEADING_1 }));
  const tableRows: any[] = [];
  tableRows.push(new TableRow({
    tableHeader: true,
    children: ['类型', '严重度', '原文', '建议修改', '描述', '规则编号', '标准引用'].map(h =>
      new TableCell({
        children: [new Paragraph({ text: h, bold: true })],
        shading: { fill: 'E0E0E0' },
      }),
    ),
  }));
  for (const it of sorted) {
    tableRows.push(new TableRow({
      children: [
        it.issueType || '', it.severity || '', it.originalText || '',
        it.suggestedText || '', it.description || '', it.ruleCode || '', it.standardRef || '',
      ].map(v => new TableCell({
        children: [new Paragraph({ text: String(v || '').slice(0, 300) })],
      })),
    }));
  }
  children.push(new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  children.push(new Paragraph({ text: '' }));
  children.push(new Paragraph({ text: '*本报告由 Agent 审查通道自动生成，仅供参考。*' }));

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  await (await import('fs')).promises.writeFile(filePath, buf);
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
      format: z.enum(['md', 'xlsx', 'docx']).optional().default('md').describe('报告格式：md（Markdown，默认）/ xlsx（Excel 表格）'),
    }),
    execute: async ({ issues, reportName, sourceFile, reviewMode, toolCallCount, format }): Promise<WriteReportResult> => {
      // 报告名安全处理：移除路径分隔符，移除 .md 后缀（后面会自动加）
      const safeName = String(reportName || 'report')
        .replace(/[\\\/]/g, '_')
        .replace(/\.md$/i, '')
        .replace(/\.xlsx$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
        .slice(0, 100) || 'report';
      const ext = format === 'xlsx' ? '.xlsx' : format === 'docx' ? '.docx' : '.md';
      const fileName = `${safeName}${ext}`;

      // 报告目录：uploads/agent_temp/{userId}/{YYYY-MM-DD}/reports/
      // 按日期划分（跨会话共享当天目录），不再按 sessionId 分区
      const dateDir = getTodayDir(context.userId);
      const reportsDir = path.join(dateDir, 'reports');
      const normalizedReportsDir = path.resolve(reportsDir);

      // 创建目录
      await fs.promises.mkdir(normalizedReportsDir, { recursive: true });

      // 生成报告内容（P1-④⑤：支持 md / xlsx 两种格式）
      const filePath = path.join(normalizedReportsDir, fileName);
      if (format === 'xlsx') {
        await FileWriteQueueService.enqueue(filePath, async () => {
          await writeXlsxReport(filePath, issues);
        });
      } else if (format === 'docx') {
        await FileWriteQueueService.enqueue(filePath, async () => {
          await writeDocxReport(filePath, issues);
        });
      } else {
        const markdown = buildMarkdownReport({
          issues,
          sourceFile,
          reviewMode,
          toolCallCount,
        });
        await FileWriteQueueService.enqueue(filePath, async () => {
          await fs.promises.writeFile(filePath, markdown, 'utf-8');
        });
      }

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
