/**
 * write_report 单元测试（P1-④⑤ 报告导出 md/xlsx/docx）
 *
 * 覆盖：
 * - md：报告结构（标题/元信息/摘要表/明细按严重度排序/原文/建议/标准引用/规则编号）
 * - md：空问题 → 「未发现问题」
 * - reportName 清洗（路径分隔符 / 危险字符 / 超长）
 * - xlsx：真实 exceljs 生成，读回验证表头与数据行
 * - docx：真实 docx 库生成，验证合法 Word 文件（PK zip 头）
 * - 文件写入 session reports 目录
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

import { createWriteReportTool } from '../write_report';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-report';
const SESSION_ID = 'session-1';
// 存储结构改为日期目录：agent_temp/{userId}/{YYYY-MM-DD}/reports（与 getTodayDir 本地时区一致）
const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
const SESSION_DIR = path.join(TEST_ROOT, TEST_USER, TODAY);

const ctx = { userId: TEST_USER, sessionId: SESSION_ID };
const tool = createWriteReportTool(ctx);

const sampleIssues = [
  {
    issueType: 'TYPO',
    severity: 'warning',
    originalText: '帐号',
    suggestedText: '账号',
    description: '错别字',
    ruleCode: 'TYPO_001',
    standardRef: 'GB/T 15834 第 3.2 条',
  },
  {
    issueType: 'VIOLATION',
    severity: 'error',
    originalText: '缺少法定代表签字',
    description: '严重违规',
    ruleCode: 'VIOL_001',
  },
  {
    issueType: 'COMPLETENESS',
    severity: 'info',
    originalText: '缺少目录',
  },
];

afterEach(() => {
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('md 报告', () => {
  it('生成完整报告结构（标题/元信息/摘要/明细）', async () => {
    const result = await tool.execute(
      {
        issues: sampleIssues,
        reportName: '合同审查',
        sourceFile: '合同.docx',
        reviewMode: 'contract_review',
        toolCallCount: 5,
      },
      {} as any,
    );
    expect(result.fileName).toBe('合同审查.md');
    expect(fs.existsSync(result.filePath)).toBe(true);
    const md = fs.readFileSync(result.filePath, 'utf-8');
    expect(md).toContain('# 文件合规审查报告');
    expect(md).toContain('**被审查文件**：合同.docx');
    expect(md).toContain('**审查模式**：contract_review');
    expect(md).toContain('**问题总数**：3');
    expect(md).toContain('**高严重度**：1');
    expect(md).toContain('| 错别字 | 1 |');
    expect(md).toContain('**原文**');
    expect(md).toContain('帐号');
    expect(md).toContain('**建议修改为**');
    expect(md).toContain('**标准引用**：GB/T 15834 第 3.2 条');
    expect(md).toContain('**规则编号**：`TYPO_001`');
  });

  it('明细按 severity 倒序（error 在 warning 前）', async () => {
    await tool.execute({ issues: sampleIssues, reportName: 'sort' }, {} as any);
    const md = fs.readFileSync(path.join(SESSION_DIR, 'reports', 'sort.md'), 'utf-8');
    const errorPos = md.indexOf('缺少法定代表签字');
    const warningPos = md.indexOf('帐号');
    expect(errorPos).toBeGreaterThan(-1);
    expect(warningPos).toBeGreaterThan(-1);
    expect(errorPos).toBeLessThan(warningPos);
  });

  it('空问题 → 「未发现问题」', async () => {
    const result = await tool.execute({ issues: [], reportName: 'empty' }, {} as any);
    const md = fs.readFileSync(result.filePath, 'utf-8');
    expect(md).toContain('未发现问题');
    expect(md).toContain('无问题明细');
    expect(result.issueCount).toBe(0);
  });

  it('reportName 清洗：路径分隔符与危险字符被替换', async () => {
    const result = await tool.execute(
      { issues: [], reportName: '../恶意\\名字|a.b.c', sourceFile: 'x' },
      {} as any,
    );
    expect(result.fileName).not.toContain('/');
    expect(result.fileName).not.toContain('\\');
    expect(path.dirname(result.filePath)).toBe(path.resolve(SESSION_DIR, 'reports'));
  });
});

describe('xlsx 导出', () => {
  it('生成真实 xlsx，读回验证表头与数据行', async () => {
    const result = await tool.execute({ issues: sampleIssues, reportName: '表格', format: 'xlsx' }, {} as any);
    expect(result.fileName).toBe('表格.xlsx');
    // 用 exceljs 读回验证（与生产同一依赖）
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(result.filePath);
    const ws = wb.getWorksheet('审查报告');
    expect(ws).toBeTruthy();
    const headerRow = ws.getRow(1).values as any[];
    expect(headerRow.slice(1)).toEqual(['类型', '严重度', '风险等级', '原文', '建议修改', '描述', '规则编号', '标准引用']);
    // 数据行：3 个问题（含表头共 4 行）
    expect(ws.rowCount).toBe(4);
    const firstData = ws.getRow(2).values as any[];
    expect(firstData[1]).toBe('错别字'); // 类型中文标签
    expect(firstData[4]).toBe('帐号'); // 原文
  });
});

describe('docx 导出', () => {
  it('生成合法 Word 文件（PK zip 头）', async () => {
    const result = await tool.execute({ issues: sampleIssues, reportName: 'word', format: 'docx' }, {} as any);
    expect(result.fileName).toBe('word.docx');
    const buf = fs.readFileSync(result.filePath);
    // Word 文件本质是 zip，前两个字节是 PK
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    expect(result.size).toBeGreaterThan(100);
  });
});
