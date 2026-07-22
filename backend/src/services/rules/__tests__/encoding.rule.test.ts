/**
 * 编码一致性规则测试 (CODE / UNIT)
 * 测试文件: encoding.rule.ts → checkEncodingConsistency
 */
import { describe, it, expect } from 'vitest';
import { checkEncodingConsistency } from '../encoding.rule';
import { FileContext } from '../types';

/** 快捷创建 FileContext */
function ctx(opts: {
  fileName?: string;
  fileType?: string;
  pdfPages?: string[];
  extractedText?: string;
} = {}): FileContext {
  return {
    fileName: opts.fileName ?? 'FJ24A00AC-JPS02-001(A).pdf',
    filePath: `/test/${opts.fileName || 'FJ24A00AC-JPS02-001(A).pdf'}`,
    fileType: opts.fileType ?? 'pdf',
    pdfPages: opts.pdfPages,
    extractedText: opts.extractedText,
  };
}

describe('Encoding Consistency Rule (CODE)', () => {

  /* ===== CODE 正例 ===== */

  it('CODE_004: should detect when filename cannot extract valid external code', () => {
    const issues = checkEncodingConsistency(ctx({ fileName: 'FJ24A00AC-JPS0.pdf', pdfPages: ['page1'], extractedText: '' }));
    expect(issues.some(i => i.ruleCode === 'CODE_004')).toBe(true);
  });

  it('CODE_005: should detect when pdfPages is empty', () => {
    const issues = checkEncodingConsistency(ctx({ pdfPages: [] }));
    expect(issues.some(i => i.ruleCode === 'CODE_005')).toBe(true);
  });

  it('CODE_001: should detect when header does not contain external code', () => {
    const issues = checkEncodingConsistency(ctx({
      pdfPages: ['cover page', 'some unrelated header text here'],
      extractedText: '',
    }));
    expect(issues.some(i => i.ruleCode === 'CODE_001')).toBe(true);
  });

  it('CODE_002: should detect when header uses internal code instead of external', () => {
    // Header contains a 2-letter + 14-digit internal code but not the external code
    const issues = checkEncodingConsistency(ctx({
      fileName: 'FJ24A00AC-JPS02-001(A).pdf',
      pdfPages: ['cover', 'AB12345678901234 some text'],
      extractedText: '',
    }));
    expect(issues.some(i => i.ruleCode === 'CODE_002')).toBe(true);
  });

  it('CODE_003: should detect when header is empty', () => {
    const issues = checkEncodingConsistency(ctx({
      pdfPages: ['cover', '   '],
      extractedText: '',
    }));
    expect(issues.some(i => i.ruleCode === 'CODE_003')).toBe(true);
  });

  /* ===== UNIT 正例 ===== */

  it('UNIT_004: should detect missing album code on cover', () => {
    const issues = checkEncodingConsistency(ctx({
      pdfPages: ['page1', 'header with FJ24A00AC-JPS02'],
      extractedText: 'some random text without album code',
    }));
    expect(issues.some(i => i.ruleCode === 'UNIT_004')).toBe(true);
  });

  it('UNIT_005: should detect missing DOC.NO on cover', () => {
    const issues = checkEncodingConsistency(ctx({
      pdfPages: ['page1', 'header with FJ24A00AC-JPS02'],
      extractedText: '图册编号：FJ24A00AC-JPS02\nsome other text',
    }));
    expect(issues.some(i => i.ruleCode === 'UNIT_005')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass when header contains matching external code', () => {
    const issues = checkEncodingConsistency(ctx({
      fileName: 'FJ24A00AC-JPS02-001(A).pdf',
      pdfPages: ['cover', 'FJ24A00AC-JPS02-001(A) header text'],
      extractedText: '图册编号：FJ24A00AC-JPS02\nDOC.NO：AB25000123456',
    }));
    expect(issues.some(i => i.ruleCode === 'CODE_001' || i.ruleCode === 'CODE_002' || i.ruleCode === 'CODE_003')).toBe(false);
  });

  it('should pass when external code cannot be extracted from filename (non-encoded filename)', () => {
    const issues = checkEncodingConsistency(ctx({
      fileName: 'readme.txt',
      fileType: 'txt',
      pdfPages: ['cover', 'header'],
      extractedText: '',
    }));
    // No CODE/UNIT issues since no external code pattern matched
    expect(issues.filter(i => i.ruleCode.startsWith('CODE_') || i.ruleCode.startsWith('UNIT_')).length).toBe(0);
  });

  it('should pass when cover has both album code and DOC.NO with matching unit numbers', () => {
    const issues = checkEncodingConsistency(ctx({
      fileName: 'QS2516EED-JPK01-001(A).pdf',
      pdfPages: ['cover', 'QS2516EED-JPK01-001(A) header'],
      extractedText: '图册编号：QS2516EED-JPK01\nDOC.NO：ZGE25000001B25A44GN',
    }));
    // The album code has 'E' as unit (7th char positions: QS2516[E]ED-JPK01)
    // DOC.NO pattern: ZG[E]25000001B25A44GN → unit 'E' matches
    // Just check there's no UNIT_001 mismatch
    expect(issues.some(i => i.ruleCode === 'UNIT_001')).toBe(false);
  });

  it('should pass for txt files without pdf pages (CODE_005 skip should not appear if no code extracted)', () => {
    const issues = checkEncodingConsistency(ctx({
      fileName: 'my_notes.txt',
      fileType: 'txt',
      pdfPages: [],
      extractedText: '',
    }));
    // No code match → returns early → no CODE_005
    expect(issues.length).toBe(0);
  });

  it('should detect UNIT_001 when unit numbers mismatch', () => {
    const issues = checkEncodingConsistency(ctx({
      fileName: 'FJ24A00AC-JPS02-001(A).pdf',
      pdfPages: ['cover', 'FJ24A00AC-JPS02-001(A) 页眉内容'],
      extractedText: '图册编号：QS2516EED-JPK01\nDOC.NO：ZGA25000001B25A44GN',
    }));
    // Album unit: 'E' (7th char), DOC.NO unit: 'A' (3rd char after first 2 letters)
    expect(issues.some(i => i.ruleCode === 'UNIT_001')).toBe(true);
  });

});
