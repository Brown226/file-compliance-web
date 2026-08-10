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

  /* ===== 误报回归：正文中的分数/比值/日期不应被当页码 ===== */

  it('should NOT treat body-text fractions/ratios as page numbers', () => {
    // 分数/比值出现在正文中段（超过页首/页尾 80 字符区域），不应触发 PAGE_001
    const bodyText = (marker: string) =>
      `这是第${marker}页的正文开头，包含大量说明性文字用于撑满页眉检查边界，继续填充内容直至超过八十字符的门槛阈值，` +
      `此处出现比例 ${marker}/2 与比值 3/4 属于正常正文内容，后续还有更多描述文字确保整个段落长度远超页首页尾的检测范围，` +
      `结尾部分继续补充常规文档内容以便定位函数只会在页眉页脚区域寻找真实页码。`;

    const issues = checkPageNumbers(ctx([bodyText('1'), bodyText('2'), bodyText('3')]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(false);
  });

  it('should NOT treat dates (yyyy/mm/dd) as page numbers', () => {
    // 日期形态出现在页首区域也不应匹配：前有斜杠排除，且 4 位年份超出 1-3 位限制
    const issues = checkPageNumbers(ctx([
      '签署日期 2026/08/07 完成',
      '签署日期 2026/08/08 完成',
      '签署日期 2026/08/09 完成',
    ]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(false);
    expect(issues.some(i => i.ruleCode === 'PAGE_003')).toBe(false);
  });

  it('should still detect real bare page numbers in header/footer margin', () => {
    const issues = checkPageNumbers(ctx([
      '页脚页码区 1/10',
      '页脚页码区 2/10',
      '页脚页码区 3/10',
    ]));
    // 连续页码通过；但如果出现跳页（如第3页写4/10）应报 PAGE_001
    const gap = checkPageNumbers(ctx([
      '页脚 1/10',
      '页脚 3/10',
      '页脚 3/10',
    ]));
    expect(issues.some(i => i.ruleCode === 'PAGE_001')).toBe(false);
    expect(gap.some(i => i.ruleCode === 'PAGE_001')).toBe(true);
  });

});
