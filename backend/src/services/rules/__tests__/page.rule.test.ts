/**
 * 页码规范规则测试 (PAGE)
 * 测试文件: page.rule.ts → checkPageNumbers
 */
import { describe, it, expect } from 'vitest';
import { checkPageNumbers } from '../page.rule';
import { FileContext } from '../types';

function ctx(pdfPages: string[]): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    pdfPages,
  };
}

describe('Page Number Rule (PAGE)', () => {

  /* ===== 正例 ===== */

  it('PAGE_001: should detect non-sequential page numbers', () => {
    const issues = checkPageNumbers(ctx([
      'page 1/10',
      'page 3/10',  // skip from 1 to 3
      'page 3/10',
    ]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(true);
  });

  it('PAGE_003: should detect total page count mismatch', () => {
    const issues = checkPageNumbers(ctx([
      'page 1/5',
      'page 2/5',
      'page 3/5',
    ]));
    // 3 actual pages but header says 5
    expect(issues.some(i => i.ruleCode === 'PAGE_003')).toBe(true);
  });

  it('PAGE_001: should detect backward page numbers', () => {
    const issues = checkPageNumbers(ctx([
      '第1页 共5页',
      '第2页 共5页',
      '第1页 共5页',  // goes backward
    ]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(true);
  });

  it('PAGE_001: should detect gap in page sequence', () => {
    const issues = checkPageNumbers(ctx([
      '版次：A 1/10',
      '版次：A 2/10',
      '版次：A 5/10',  // skip 3,4
    ]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass sequential page numbers', () => {
    const issues = checkPageNumbers(ctx([
      '第1页 共3页',
      '第2页 共3页',
      '第3页 共3页',
    ]));
    expect(issues.length).toBe(0);
  });

  it('should pass when page count matches actual pages', () => {
    const issues = checkPageNumbers(ctx([
      '1/3',
      '2/3',
      '3/3',
    ]));
    expect(issues.length).toBe(0);
  });

  it('should return empty when less than 2 pages', () => {
    const issues = checkPageNumbers(ctx(['only one page']));
    expect(issues.length).toBe(0);
  });

  it('should pass when total page tolerance allows mismatch', () => {
    const issues = checkPageNumbers(ctx([
      '1/6',
      '2/6',
      '3/6',
    ]), { totalPagesTolerance: 3 }); // 6 vs 3, diff=3 <= tolerance
    expect(issues.length).toBe(0);
  });

  it('should pass with allowed skipped pages', () => {
    const issues = checkPageNumbers(ctx([
      '1/10',
      '2/10',
      '5/10',  // skip but increasing
    ]), { allowSkippedPages: true });
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(false);
  });

});
