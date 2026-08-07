/**
 * OPT-002: encoding.rule 黄金测试集
 */
import { describe, it, expect } from 'vitest';
import { checkEncodingConsistency, checkUnitConsistency } from '../encoding.rule';
import { FileContext } from '../types';

function makeCtx(fileName: string, pdfPages?: string[]): FileContext {
  return {
    fileName,
    filePath: `/uploads/${fileName}`,
    fileType: fileName.split('.').pop() || 'pdf',
    extractedText: '测试内容',
    pdfPages,
  };
}

describe('checkEncodingConsistency', () => {
  // ===== 正例：应检出 =====

  it('CODE_004: 文件名像编码但格式不完全匹配', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE.pdf'));
    expect(issues.some(i => i.ruleCode === 'CODE_004')).toBe(true);
  });

  it('CODE_005: PDF 无页眉内容', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', []));
    expect(issues.some(i => i.ruleCode === 'CODE_005')).toBe(true);
  });

  it('CODE_002: 页眉使用内部编码而非外部编码', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', [
      '第一页内容',
      'AB12345678901234 某内部编码页眉',
    ]));
    expect(issues.some(i => i.ruleCode === 'CODE_002')).toBe(true);
  });

  it('CODE_001: 页眉编码与文件名不一致', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', [
      '第一页',
      '页眉：XY99Z88WW 完全不同的编码',
    ]));
    expect(issues.some(i => i.ruleCode === 'CODE_001')).toBe(true);
  });

  it('CODE_003: 页眉为空', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', [
      '第一页',
      '   ',
    ]));
    expect(issues.some(i => i.ruleCode === 'CODE_003')).toBe(true);
  });

  // ===== 反例：不应检出 =====

  it('页眉包含正确外部编码不报错', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', [
      '第一页',
      '页眉：AB01C02DE-FGH03(A) 正确编码',
    ]));
    expect(issues.filter(i => ['CODE_001', 'CODE_002', 'CODE_003'].includes(i.ruleCode))).toHaveLength(0);
  });

  it('非编码格式文件名不检查编码一致性', () => {
    const issues = checkEncodingConsistency(makeCtx('设计说明.pdf', ['页眉内容']));
    expect(issues.filter(i => i.ruleCode.startsWith('CODE_00') && i.ruleCode !== 'CODE_004')).toHaveLength(0);
  });

  it('无 pdfPages 且文件名非编码格式时不报错', () => {
    const issues = checkEncodingConsistency(makeCtx('report.pdf'));
    expect(issues).toHaveLength(0);
  });

  // ===== UNIT_002 / UNIT_003 补充（OPT-002 覆盖缺口） =====
  // 触发 UNIT 检查需：合法外部编码文件名 + 非空 pdfPages（合法页眉避免 CODE_*）+ extractedText 含封面字段

  it('UNIT_002: 有图册编号但格式不匹配应检出', () => {
    const ctx: FileContext = {
      fileName: 'AB01C02DE-FGH03(A).pdf',
      filePath: '/uploads/AB01C02DE-FGH03(A).pdf',
      fileType: 'pdf',
      extractedText: '图册编号：INVALIDFORMAT',
      pdfPages: ['第一页', 'AB01C02DE-FGH03(A) 正确页眉'],
    };
    const issues = checkUnitConsistency(ctx);
    expect(issues.some(i => i.ruleCode === 'UNIT_002')).toBe(true);
  });

  it('UNIT_003: 有 DOC.NO 但格式不匹配应检出', () => {
    const ctx: FileContext = {
      fileName: 'AB01C02DE-FGH03(A).pdf',
      filePath: '/uploads/AB01C02DE-FGH03(A).pdf',
      fileType: 'pdf',
      extractedText: '图册编号：AB0100CDE-FGH03\nDOC.NO: INVALIDFORMAT',
      pdfPages: ['第一页', 'AB01C02DE-FGH03(A) 正确页眉'],
    };
    const issues = checkUnitConsistency(ctx);
    expect(issues.some(i => i.ruleCode === 'UNIT_003')).toBe(true);
  });

  it('UNIT_002/003: 合法图册编号与 DOC.NO 不报格式不匹配', () => {
    const ctx: FileContext = {
      fileName: 'AB01C02DE-FGH03(A).pdf',
      filePath: '/uploads/AB01C02DE-FGH03(A).pdf',
      fileType: 'pdf',
      extractedText: '图册编号：AB0100CDE-FGH03\nDOC.NO: ABC123456',
      pdfPages: ['第一页', 'AB01C02DE-FGH03(A) 正确页眉'],
    };
    const issues = checkUnitConsistency(ctx);
    expect(issues.some(i => i.ruleCode === 'UNIT_002' || i.ruleCode === 'UNIT_003')).toBe(false);
  });

  // ===== 双份报告回归（2026-08 修复：CODE/UNIT 拆分） =====

  it('checkEncodingConsistency 不再产出 UNIT_*（防双份报告回归）', () => {
    const issues = checkEncodingConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', ['第一页', '页眉：AB01C02DE-FGH03(A)']));
    expect(issues.some(i => i.ruleCode.startsWith('UNIT_'))).toBe(false);
  });

  it('checkUnitConsistency 不产出 CODE_*（防双份报告回归）', () => {
    const issues = checkUnitConsistency(makeCtx('AB01C02DE-FGH03(A).pdf', ['第一页']));
    expect(issues.some(i => i.ruleCode.startsWith('CODE_'))).toBe(false);
  });
});
/**
 * 编码一致性规则测试 (CODE / UNIT)
 * 测试文件: encoding.rule.ts → checkEncodingConsistency
 */
import { describe, it, expect } from 'vitest';
import { checkEncodingConsistency, checkUnitConsistency } from '../encoding.rule';
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
    const issues = checkUnitConsistency(ctx({
      pdfPages: ['page1', 'header with FJ24A00AC-JPS02'],
      extractedText: 'some random text without album code',
    }));
    expect(issues.some(i => i.ruleCode === 'UNIT_004')).toBe(true);
  });

  it('UNIT_005: should detect missing DOC.NO on cover', () => {
    const issues = checkUnitConsistency(ctx({
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
    const issues = checkUnitConsistency(ctx({
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
    const issues = checkUnitConsistency(ctx({
      fileName: 'FJ24A00AC-JPS02-001(A).pdf',
      pdfPages: ['cover', 'FJ24A00AC-JPS02-001(A) 页眉内容'],
      extractedText: '图册编号：QS2516EED-JPK01\nDOC.NO：ZGA25000001B25A44GN',
    }));
    // Album unit: 'E' (7th char), DOC.NO unit: 'A' (3rd char after first 2 letters)
    expect(issues.some(i => i.ruleCode === 'UNIT_001')).toBe(true);
  });

});
