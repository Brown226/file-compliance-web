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
