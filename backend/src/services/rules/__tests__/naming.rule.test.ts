import { describe, it, expect } from 'vitest';
import { checkNaming } from '../naming.rule';

describe('Naming Rule (NAME)', () => {
  // 正例：应检测出问题的文件名
  it('应该检测到文件名中的中文括号', () => {
    const issues = checkNaming({ fileName: '文件（2024）v2.docx' } as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleCode).toContain('NAME');
  });

  it('应该检测到文件名中的空格', () => {
    const issues = checkNaming({ fileName: '设计说明 最终版.pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('应该检测到缺少项目编码', () => {
    const issues = checkNaming({ fileName: '设计说明.pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.ruleCode?.includes('NAME'))).toBe(true);
  });

  it('应该检测到缺少版本号', () => {
    const issues = checkNaming({ fileName: 'GB50265-2024-设计说明.pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('应该检测到非法字符', () => {
    const issues = checkNaming({ fileName: '设计说明@#v2.pdf' } as any);
    expect(issues.length).toBeGreaterThan(0);
  });

  // 反例：合规文件不应检测出问题
  it('合规的标准命名不应报错', () => {
    const issues = checkNaming({ fileName: 'GB50265-2024-设计说明-v2.pdf' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的项目编码+名称+版本号命名不应报错', () => {
    const issues = checkNaming({ fileName: 'PROJ-001-结构设计说明书-RevA.docx' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的英文命名不应报错', () => {
    const issues = checkNaming({ fileName: 'Structural-Design-Report-Rev01.pdf' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的工程图纸命名不应报错', () => {
    const issues = checkNaming({ fileName: 'A101-Site-Plan-Rev02.dwg' } as any);
    expect(issues.length).toBe(0);
  });

  it('合规的简短命名不应报错', () => {
    const issues = checkNaming({ fileName: 'SP-001-电气系统图-v1.dwg' } as any);
    expect(issues.length).toBe(0);
  });
});
