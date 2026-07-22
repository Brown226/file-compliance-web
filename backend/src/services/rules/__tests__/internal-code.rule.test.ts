/**
 * 内部编码校验规则测试 (INTERNAL_CODE)
 * 测试文件: internal-code.rule.ts → checkInternalCodes
 */
import { describe, it, expect } from 'vitest';
import { checkInternalCodes } from '../internal-code.rule';
import { FileContext } from '../types';

function ctx(fileName: string, text: string): FileContext {
  return {
    fileName,
    filePath: `/test/${fileName}`,
    fileType: 'pdf',
    extractedText: text,
  };
}

describe('Internal Code Rule (INTERNAL_CODE)', () => {

  /* ===== 正例 ===== */

  it('INTERNAL_CODE_001: should detect code in body that partially matches but differs from file project code', () => {
    // FJ24A00AC has prefix FJ24A0, body code 1EAA360CR starts with 1EAA36 (different prefix)
    // This may not trigger. Let's use a code that starts with same first 6 chars
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02-001(A).pdf',
      '正文中包含一个编码 FJ24A00XY 看起来类似但不完全相同。'
    ));
    // FJ24A00AC starts with FJ24A0, FJ24A00XY also starts with FJ24A0
    expect(issues.some(i => i.ruleCode === 'INTERNAL_CODE_001')).toBe(true);
  });

  it('INTERNAL_CODE_001: should detect suspicious code with similar prefix', () => {
    const issues = checkInternalCodes(ctx(
      'QS2516EED-JPK01.pdf',
      '参考编码 QS2516EEC 的内容需要核对。'
    ));
    // QS2516 prefix matches, QS2516EED vs QS2516EEC
    expect(issues.some(i => i.ruleCode === 'INTERNAL_CODE_001')).toBe(true);
  });

  it('should skip check when filename has no valid project code prefix', () => {
    const issues = checkInternalCodes(ctx(
      'readme.txt',
      '正文包含 1EAA360CR 编码。'
    ));
    // No project code in filename → returns early
    expect(issues.length).toBe(0);
  });

  it('should skip standard codes (GB/ISO etc.)', () => {
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02.pdf',
      '参考标准 GB/T 50265-2010。'
    ));
    // Should not flag GB standards
    expect(issues.some(i => i.ruleCode === 'INTERNAL_CODE_001')).toBe(false);
  });

  /* ===== 反例 ===== */

  it('should pass when body code matches file project code', () => {
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02-001(A).pdf',
      '正文内容 FJ24A00AC 项目编码一致。'
    ));
    // FJ24A00AC matches file project code exactly → no issue
    expect(issues.length).toBe(0);
  });

  it('should return empty when text has no codes', () => {
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02.pdf',
      '普通文本内容没有任何编码格式。'
    ));
    expect(issues.length).toBe(0);
  });

  it('should return empty when filename has no valid project code', () => {
    const issues = checkInternalCodes(ctx(
      '普通文件名.txt',
      '1EAA360CR 编码出现在正文中。'
    ));
    expect(issues.length).toBe(0);
  });

  it('should respect maxIssues config', () => {
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02.pdf',
      '编码 FJ24A00XY 和 FJ24A00XZ 和 FJ24A00XX 都需要检查。'
    ), { maxIssues: 1 });
    expect(issues.length).toBeLessThanOrEqual(1);
  });

  it('should not flag codes that are exact match of project code', () => {
    const issues = checkInternalCodes(ctx(
      'FJ24A00AC-JPS02.pdf',
      '文件编码 FJ24A00AC 完全一致。编码 FJ24A00AC-JPS02 也在正文中。'
    ));
    expect(issues.length).toBe(0);
  });

});
