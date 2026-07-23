/**
 * OPT-002: naming.rule 黄金测试集
 */
import { describe, it, expect } from 'vitest';
import { checkNaming } from '../naming.rule';
import { FileContext } from '../types';

function makeCtx(fileName: string, fileType?: string): FileContext {
  const ext = fileType || fileName.split('.').pop() || 'docx';
  return { fileName, filePath: `/uploads/${fileName}`, fileType: ext, extractedText: '测试内容' };
}

describe('checkNaming', () => {
  // ===== 正例：应检出 =====

  it('NAME_001: 检出中文文件名', () => {
    const issues = checkNaming(makeCtx('设计说明.docx'));
    expect(issues.some(i => i.ruleCode === 'NAME_001')).toBe(true);
  });

  it('NAME_002: 检出含空格的文件名', () => {
    const issues = checkNaming(makeCtx('design report.pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_002')).toBe(true);
  });

  it('NAME_003: 检出含非法特殊字符的文件名', () => {
    const issues = checkNaming(makeCtx('report@v2!.pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_003')).toBe(true);
  });

  it('NAME_010: 检出不支持的文件类型', () => {
    const issues = checkNaming(makeCtx('data.csv', 'csv'));
    expect(issues.some(i => i.ruleCode === 'NAME_010')).toBe(true);
  });

  it('NAME_008: 检出图纸序号格式错误', () => {
    const issues = checkNaming(makeCtx('AB01C02DE-FGH03-1(A).dwg'));
    expect(issues.some(i => i.ruleCode === 'NAME_008')).toBe(true);
  });

  // ===== 反例：不应检出 =====

  it('规范英文文件名不报错', () => {
    const issues = checkNaming(makeCtx('AB01C02DE-FGH03(A).dwg'));
    expect(issues.filter(i => i.ruleCode === 'NAME_001' || i.ruleCode === 'NAME_002' || i.ruleCode === 'NAME_003')).toHaveLength(0);
  });

  it('含连字符和括号的文件名合法', () => {
    const issues = checkNaming(makeCtx('report-v2(A).pdf'));
    expect(issues.filter(i => i.ruleCode === 'NAME_003')).toHaveLength(0);
  });

  it('纯数字文件名不报特殊字符错误', () => {
    const issues = checkNaming(makeCtx('12345.docx'));
    expect(issues.filter(i => i.ruleCode === 'NAME_003')).toHaveLength(0);
  });

  it('支持的文件类型不报 NAME_010', () => {
    const issues = checkNaming(makeCtx('report.pdf'));
    expect(issues.filter(i => i.ruleCode === 'NAME_010')).toHaveLength(0);
  });

  it('中文文件名不继续检查编码格式', () => {
    const issues = checkNaming(makeCtx('中文名称.dwg'));
    // 有 NAME_001 但不应有 NAME_008 等编码格式错误
    expect(issues.some(i => i.ruleCode === 'NAME_001')).toBe(true);
    expect(issues.filter(i => i.ruleCode === 'NAME_008')).toHaveLength(0);
  });

  // ===== NAME_004 / 005 / 006 / 007 / 009 补充（OPT-002 覆盖缺口） =====

  it('NAME_004: 项目编码格式错误应检出', () => {
    const issues = checkNaming(makeCtx('AB1A00AC-JPS02-001(A).pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_004')).toBe(true);
  });

  it('NAME_005: 系统编码格式错误应检出', () => {
    const issues = checkNaming(makeCtx('AB01C02DE-JP-001(A).pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_005')).toBe(true);
  });

  it('NAME_006: 项目与系统编码正确但整体格式不匹配应检出', () => {
    const issues = checkNaming(makeCtx('AB01C02DE-FGH03-XYZ(A).pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_006')).toBe(true);
  });

  it('NAME_007: 文档类文件命名格式不符合规范应检出', () => {
    const issues = checkNaming(makeCtx('AB01C02DE-FGH03-XYZ.docx'));
    expect(issues.some(i => i.ruleCode === 'NAME_007')).toBe(true);
  });

  it('NAME_009: 括号内版本号非单大写字母应检出', () => {
    const issues = checkNaming(makeCtx('report(1).pdf'));
    expect(issues.some(i => i.ruleCode === 'NAME_009')).toBe(true);
  });
});
import { describe, it, expect } from 'vitest';
import { checkNaming } from '../naming.rule';

describe('Naming Rule (NAME)', () => {
  // 正例：应检测出问题的文件名
  it('应该检测到文件名中的中文括号', () => {
    const issues = checkNaming({ fileName: '文件（2024）v2.docx', fileType: 'docx' } as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleCode).toContain('NAME');
  });

  it('应该检测到文件名中的空格', () => {
    const issues = checkNaming({ fileName: '设计说明 最终版.pdf', fileType: 'pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('应该检测到缺少项目编码', () => {
    const issues = checkNaming({ fileName: '设计说明.pdf', fileType: 'pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.ruleCode?.includes('NAME'))).toBe(true);
  });

  it('应该检测到缺少版本号', () => {
    const issues = checkNaming({ fileName: 'GB50265-2024-设计说明.pdf', fileType: 'pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('应该检测到非法字符', () => {
    const issues = checkNaming({ fileName: '设计说明@#v2.pdf', fileType: 'pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  // 反例：符合电力工程编码标准的命名不应报错
  // 标准格式: [项目编码 2字母+2数字+1字母+2数字+2字母]-[系统编码 3字母+2数字]-[序号3位/类型标识]([版本号单个大写字母])
  it('合规的图纸命名(项目+系统+序号+版本)不应报错', () => {
    const issues = checkNaming({ fileName: 'FJ24A00AC-JPS02-001(A).pdf', fileType: 'pdf' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的图纸命名(类型标识 CM/TM/FM/SM)不应报错', () => {
    const issues = checkNaming({ fileName: 'FJ24A00AC-JPS02-CM(A).dwg', fileType: 'dwg' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的图纸命名(dwg 序号+版本)不应报错', () => {
    const issues = checkNaming({ fileName: 'FJ24A00AC-JPS02-002(B).dwg', fileType: 'dwg' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的文档命名(项目+系统+版本)不应报错', () => {
    const issues = checkNaming({ fileName: 'FJ24A00AC-JPS02(A).docx', fileType: 'docx' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的文档命名(类型 AJK/APD + 序号)不应报错', () => {
    const issues = checkNaming({ fileName: 'FJ24A00AC-JPS01AJK001.docx', fileType: 'docx' } as any);
    expect(issues.length).toBe(0);
  });
});
