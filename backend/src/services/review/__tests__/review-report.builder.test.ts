/**
 * 审查报告构建器单测（review-report.builder.ts）
 *
 * 覆盖：结构完整（标题/元信息/摘要表/明细）、严重度排序、
 * 空问题占位、Markdown 特殊字符转义、类型标签映射、统计口径。
 */
import { describe, it, expect } from 'vitest';
import {
  buildReviewReportMarkdown,
  computeReportStats,
  sortIssuesForReport,
  ISSUE_TYPE_LABELS,
} from '../review-report.builder';

const sampleIssues = [
  { issueType: 'TYPO', severity: 'warning', originalText: '帐号', suggestedText: '账号', description: '错别字', ruleCode: 'TYPO_001' },
  { issueType: 'VIOLATION', severity: 'error', originalText: '缺少签字', description: '严重违规', ruleCode: 'VIOL_001', standardRef: 'GB/T 1 第 2 条' },
  { issueType: 'COMPLETENESS', severity: 'info', originalText: '缺少目录' },
];

describe('computeReportStats', () => {
  it('统计总数/类型分布/严重度分布/高严重度', () => {
    const s = computeReportStats(sampleIssues);
    expect(s.total).toBe(3);
    expect(s.byType.TYPO).toBe(1);
    expect(s.byType.VIOLATION).toBe(1);
    expect(s.bySeverity.error).toBe(1);
    expect(s.bySeverity.warning).toBe(1);
    // error 计入高严重度
    expect(s.highSeverity).toBe(1);
  });

  it('riskLevel=HIGH 也计入高严重度', () => {
    const s = computeReportStats([{ issueType: 'VIOLATION', riskLevel: 'HIGH' }]);
    expect(s.highSeverity).toBe(1);
  });

  it('空数组不抛错', () => {
    const s = computeReportStats([]);
    expect(s.total).toBe(0);
    expect(s.highSeverity).toBe(0);
  });

  it('兼容 undefined / null 入参', () => {
    expect(computeReportStats(undefined as any).total).toBe(0);
    expect(computeReportStats(null as any).total).toBe(0);
  });
});

describe('sortIssuesForReport', () => {
  it('按 error > warning > info 排序', () => {
    const sorted = sortIssuesForReport([
      { severity: 'info', originalText: 'c' },
      { severity: 'error', originalText: 'a' },
      { severity: 'warning', originalText: 'b' },
    ]);
    expect(sorted.map(i => i.originalText)).toEqual(['a', 'b', 'c']);
  });

  it('同级按 riskLevel 倒序', () => {
    const sorted = sortIssuesForReport([
      { severity: 'warning', riskLevel: 'LOW', originalText: 'low' },
      { severity: 'warning', riskLevel: 'HIGH', originalText: 'high' },
    ]);
    expect(sorted[0].originalText).toBe('high');
  });

  it('不修改原数组（返回新数组）', () => {
    const input = [{ severity: 'info' }, { severity: 'error' }];
    const snapshot = JSON.stringify(input);
    sortIssuesForReport(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('buildReviewReportMarkdown', () => {
  it('生成完整结构（标题/元信息/摘要/明细）', () => {
    const md = buildReviewReportMarkdown({
      issues: sampleIssues,
      sourceFile: 'a.docx',
      reviewMode: '基础校对',
      taskTitle: '测试任务',
      generatedAt: new Date('2026-09-10T10:00:00+08:00'),
    });
    expect(md).toContain('# 文件合规审查报告');
    expect(md).toContain('## 一、元信息');
    expect(md).toContain('测试任务');
    expect(md).toContain('基础校对');
    expect(md).toContain('a.docx');
    expect(md).toContain('## 二、问题摘要');
    expect(md).toContain('## 三、问题明细');
    // 类型标签用中文
    expect(md).toContain(ISSUE_TYPE_LABELS.TYPO);
    // 原文与建议分别成块
    expect(md).toContain('帐号');
    expect(md).toContain('账号');
    // 标准引用与规则编号
    expect(md).toContain('GB/T 1 第 2 条');
    expect(md).toContain('VIOL_001');
  });

  it('明细顺序与严重度排序一致（error 在前）', () => {
    const md = buildReviewReportMarkdown({ issues: sampleIssues });
    const iErr = md.indexOf('缺少签字');
    const iWarn = md.indexOf('帐号');
    expect(iErr).toBeGreaterThan(-1);
    expect(iWarn).toBeGreaterThan(-1);
    expect(iErr).toBeLessThan(iWarn);
  });

  it('空问题：输出占位而非报错，结构仍完整', () => {
    const md = buildReviewReportMarkdown({ issues: [] });
    expect(md).toContain('# 文件合规审查报告');
    expect(md).toContain('未发现问题');
    expect(md).toContain('无问题明细');
  });

  it('degradedReason 作为提示出现在报告头部', () => {
    const md = buildReviewReportMarkdown({
      issues: sampleIssues,
      notice: '本次审查存在降级/未完整环节',
    });
    expect(md).toContain('本次审查存在降级/未完整环节');
  });

  it('转义行首 Markdown 特殊字符，避免破坏排版', () => {
    const md = buildReviewReportMarkdown({
      issues: [{ issueType: 'TYPO', severity: 'warning', originalText: 'x', description: '# 这是标题样式的描述' }],
    });
    // 描述中的行首 # 被转义
    expect(md).toContain('\\# 这是标题样式的描述');
  });

  it('未知 issueType 回落到原值而不丢失条目', () => {
    const md = buildReviewReportMarkdown({
      issues: [{ issueType: 'SOMETHING_NEW', severity: 'warning', originalText: 'x', description: 'd' }],
    });
    expect(md).toContain('SOMETHING_NEW');
  });

  it('自定义 footer 生效', () => {
    const md = buildReviewReportMarkdown({ issues: [], footer: '*自定义落款*' });
    expect(md).toContain('*自定义落款*');
  });
});
