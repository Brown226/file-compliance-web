/**
 * 页眉规范规则测试 (HEADER)
 * 测试文件: header.rule.ts → checkHeader
 */
import { describe, it, expect } from 'vitest';
import { checkHeader } from '../header.rule';
import { FileContext } from '../types';

function ctx(pdfPages: string[], extractedText?: string): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    pdfPages,
    extractedText,
  };
}

describe('Header Rule (HEADER)', () => {

  /* ===== 正例 ===== */

  it('HEADER_001: should detect header name mismatch with cover name', () => {
    const issues = checkHeader(ctx([
      '封面页内容',
      '不同的页眉内容不匹配',
      '第三页内容',
    ], '图册名称：施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(true);
  });

  it('HEADER_002: should detect empty header', () => {
    const issues = checkHeader(ctx([
      '封面',
      '   ',
    ], '图册名称：施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_002')).toBe(true);
  });

  it('should return no issues when cover has no name', () => {
    const issues = checkHeader(ctx([
      '封面无名称',
      'some header',
    ], ''));
    expect(issues.length).toBe(0);
  });

  it('should return empty when less than 2 pages', () => {
    const issues = checkHeader(ctx(['only one page'], '图册名称：测试'));
    expect(issues.length).toBe(0);
  });

  it('HEADER_001: should detect mismatch even on page 3 if page 2 matches', () => {
    // Page 2 matches, page 3 doesn't — should report on first mismatch (page 3)
    const issues = checkHeader(ctx([
      '封面',
      '施工图设计说明 header content',  // matches cover name
      '完全不同不匹配的页眉',
    ], '图册名称：施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass when header matches cover name exactly', () => {
    const issues = checkHeader(ctx([
      '封面',
      '施工图设计说明相关文本',
    ], '图册名称：施工图设计说明'));
    expect(issues.length).toBe(0);
  });

  it('should pass when header contains core name without suffix', () => {
    const issues = checkHeader(ctx([
      '封面',
      '施工图设计 header content matches',
    ], '图册名称：施工图设计说明'));
    expect(issues.length).toBe(0);
  });

  it('should pass when header matches cover name (multi-page)', () => {
    const issues = checkHeader(ctx([
      '封面',
      '施工图设计说明 page2',
      '施工图设计说明 page3',
      '施工图设计说明 page4',
    ], '图册名称：施工图设计说明'));
    expect(issues.length).toBe(0);
  });

  it('should pass when config.headerMustMatchCover is false', () => {
    const issues = checkHeader(ctx([
      '封面',
      'unrelated header text',
    ], '图册名称：施工图设计说明'), { headerMustMatchCover: false });
    expect(issues.length).toBe(0);
  });

  it('should pass with core name partial match after stripping suffix', () => {
    const issues = checkHeader(ctx([
      '封面',
      '这是关于施工图设计的一些内容',
    ], '图册名称：施工图设计说明'));
    expect(issues.length).toBe(0);
  });

  /* ===== 误报回归：工程图纸替代页眉（图号/编号/页码）不应触发 HEADER_001 ===== */

  it('should pass when header uses drawing number (图号) instead of cover name', () => {
    const issues = checkHeader(ctx([
      '封面',
      '图号：HX-2026-001',
      '图号：HX-2026-002',
    ], '图册名称：某厂区总平面施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(false);
  });

  it('should pass when header uses document number (DOC.NO/文件编号)', () => {
    const issues = checkHeader(ctx([
      '封面',
      'DOC.NO: SJS-2026-0158',
    ], '图册名称：综合管网施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(false);
  });

  it('should pass when header uses page marker (第X页/共X页)', () => {
    const issues = checkHeader(ctx([
      '封面',
      '第2页 共10页',
      '第3页 共10页',
    ], '图册名称：道路排水施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(false);
  });

  it('should still report HEADER_001 when header is plain unrelated text (not whitelisted)', () => {
    const issues = checkHeader(ctx([
      '封面',
      '这是毫无关联的普通描述性文字且不含任何编号页码特征',
    ], '图册名称：某某施工图设计说明'));
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(true);
  });

  it('should respect custom alternativeHeaderPatterns config override', () => {
    const issues = checkHeader(ctx([
      '封面',
      '内部资料 请勿外传',
    ], '图册名称：某某施工图设计说明'), { alternativeHeaderPatterns: [/内部资料/] });
    expect(issues.some(i => i.ruleCode === 'HEADER_001')).toBe(false);
  });

});
