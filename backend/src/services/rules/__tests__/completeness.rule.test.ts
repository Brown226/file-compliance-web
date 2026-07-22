/**
 * 完整性检查规则测试 (COMPL)
 * 测试文件: completeness.rule.ts → checkCompleteness
 */
import { describe, it, expect } from 'vitest';
import { checkCompleteness } from '../completeness.rule';
import { FileContext } from '../types';

function ctx(text: string): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    extractedText: text,
  };
}

describe('Completeness Rule (COMPL)', () => {

  /* ===== 正例 ===== */

  it('COMPL_001: should detect empty table data', () => {
    const issues = checkCompleteness(ctx(Array.from({ length: 15 }, (_, i) =>
      i < 10 ? `prefix ${i}` : `\t\t\t\t\t`
    ).join('\n')));
    expect(issues.some(i => i.ruleCode === 'COMPL_001')).toBe(true);
  });

  it('COMPL_001: should detect large empty ratio in data lines', () => {
    const text = Array.from({ length: 20 }, (_, i) => {
      if (i < 10) return `header line ${i}`;
      return i % 2 === 0 ? 'a\tb\tc\td\te' : '\t\t\t\t';
    }).join('\n');
    const issues = checkCompleteness(ctx(text));
    expect(issues.some(i => i.ruleCode === 'COMPL_001')).toBe(true);
  });

  it('COMPL_002: should detect missing cable path fields', () => {
    const issues = checkCompleteness(ctx('电缆清单\n型号：3x95\n长度：100m'));
    expect(issues.some(i => i.ruleCode === 'COMPL_002')).toBe(true);
  });

  it('COMPL_002: should detect missing path node sequence', () => {
    const issues = checkCompleteness(ctx('电缆路径\n起点：A01\n终点：B05\n电缆状态：正常'));
    expect(issues.some(i => i.ruleCode === 'COMPL_002')).toBe(true);
  });

  it('COMPL_003: should detect missing change markers when mod scope is not ALL', () => {
    const issues = checkCompleteness(ctx('修改范围：局部修改\n一些数据行内容'));
    expect(issues.some(i => i.ruleCode === 'COMPL_003')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass when table data is complete', () => {
    const text = Array.from({ length: 15 }, (_, i) => {
      if (i < 10) return `prefix ${i}`;
      return `data${i}\tcol2\tcol3\tcol4\tcol5`;
    }).join('\n');
    const issues = checkCompleteness(ctx(text));
    expect(issues.some(i => i.ruleCode === 'COMPL_001')).toBe(false);
  });

  it('should pass when file has no data lines', () => {
    const issues = checkCompleteness(ctx('简短文本，无表格数据'));
    expect(issues.some(i => i.ruleCode === 'COMPL_001')).toBe(false);
  });

  it('should pass when cable file has complete path info', () => {
    const issues = checkCompleteness(ctx(`电缆敷设表
起点：A01
终点：B05
电缆状态：ACTIVE
路径状态：COMPLETED
LVYE1L613AB → LVYE1L613AA → LVYE1L613AC`));
    expect(issues.some(i => i.ruleCode === 'COMPL_002')).toBe(false);
  });

  it('should pass when mod scope is ALL/初版', () => {
    const issues = checkCompleteness(ctx('修改范围：ALL\n一些数据行'));
    expect(issues.some(i => i.ruleCode === 'COMPL_003')).toBe(false);
  });

  it('should pass when change markers exist', () => {
    const issues = checkCompleteness(ctx('修改范围：局部修改\n变更标记：ADD\n数据行内容'));
    expect(issues.some(i => i.ruleCode === 'COMPL_003')).toBe(false);
  });

});
