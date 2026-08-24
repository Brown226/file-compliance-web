/**
 * 封面属性规则测试 (ATTR)
 * 测试文件: attribute.rule.ts → checkCoverAttributes
 */
import { describe, it, expect } from 'vitest';
import { checkCoverAttributes } from '../attribute.rule';
import { FileContext } from '../types';

function ctx(text: string): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    extractedText: text,
  };
}

describe('Attribute Rule (ATTR)', () => {

  /* ===== 正例：应检出的缺失/错误 ===== */

  it('ATTR_001 已移除：非封面文本不再报图册编号缺失（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('这是一个封面，但没有图册编号。'));
    expect(issues.some(i => i.ruleCode === 'ATTR_001')).toBe(false);
  });

  it('ATTR_002: should detect invalid version format', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：AB\n工程号：PJ001\n专业：建筑'));
    expect(issues.some(i => i.ruleCode === 'ATTR_002')).toBe(true);
  });

  it('ATTR_003: should detect non-standard status code', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：XYZ\n工程号：PJ001\n专业：建筑'));
    expect(issues.some(i => i.ruleCode === 'ATTR_003')).toBe(true);
  });

  it('ATTR_004 已移除：不再报工程号缺失（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC'));
    expect(issues.some(i => i.ruleCode === 'ATTR_004')).toBe(false);
  });

  it('ATTR_005 已移除：不再转子项号缺失（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001'));
    expect(issues.some(i => i.ruleCode === 'ATTR_005')).toBe(false);
  });

  it('ATTR_006 已移除：不再报子项名称缺失（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001\n子项号：S01'));
    expect(issues.some(i => i.ruleCode === 'ATTR_006')).toBe(false);
  });

  it('ATTR_007: should detect non-standard design stage', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001\n子项号：S01\n子项名称：厂房\n设计阶段：方案设计'));
    expect(issues.some(i => i.ruleCode === 'ATTR_007')).toBe(true);
  });

  it('ATTR_008: should detect non-standard discipline', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001\n子项号：S01\n子项名称：厂房\n专 业：园艺'));
    expect(issues.some(i => i.ruleCode === 'ATTR_008')).toBe(true);
  });

  it('ATTR_009 已移除：不再报图册名称缺失（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001'));
    expect(issues.some(i => i.ruleCode === 'ATTR_009')).toBe(false);
  });

  it('ATTR_010: should detect unreasonable volume count', () => {
    const issues = checkCoverAttributes(ctx('图册编号：FJ24A00AC-JPS02\n版次：A\n状态：CFC\n工程号：PJ001\n子项号：S01\n共 5 册 第 7 册'));
    expect(issues.some(i => i.ruleCode === 'ATTR_010')).toBe(true);
  });

  /* ===== 反例：合规封面不应报错 ===== */

  it('should pass a complete and valid cover', () => {
    const issues = checkCoverAttributes(ctx(`图册编号：FJ24A00AC-JPS02-001(A)
版次：A
状态：CFC
工程号：PJ001
子项号：S01
子项名称：反应堆厂房
设计阶段：施工图设计
专 业：建筑
图册名称：反应堆厂房施工图设计说明`));
    // Only ATTR_010 may appear if there's no volume info, but ATTR_001~009 should pass
    expect(issues.some(i => ['ATTR_001','ATTR_002','ATTR_003','ATTR_004','ATTR_005','ATTR_006','ATTR_007','ATTR_008','ATTR_009'].includes(i.ruleCode))).toBe(false);
  });

  it('should pass when all required fields are present with valid values', () => {
    const issues = checkCoverAttributes(ctx(`图册编号：FJ24A00AC-JPS02
版次：B
状态：PRE
工程号：PJ001
子项号：S02
子项名称：汽轮机厂房
设计阶段：初步设计
专 业：结构
图册名称：汽轮机厂房结构图`));
    expect(issues.some(i => i.ruleCode.startsWith('ATTR_') && i.ruleCode !== 'ATTR_010')).toBe(false);
  });

  it('should pass when status code is in the standard list (IFA)', () => {
    const issues = checkCoverAttributes(ctx(`图册编号：FJ24A00AC-JPS02
版次：A
状态：IFA
工程号：PJ001
子项号：S01
子项名称：电气厂房
图册名称：电气厂房设计`));
    expect(issues.some(i => i.ruleCode === 'ATTR_003')).toBe(false);
  });

  it('should pass when version is single uppercase letter', () => {
    const issues = checkCoverAttributes(ctx(`图册编号：FJ24A00AC-JPS02
版次：C
工程号：PJ001`));
    expect(issues.some(i => i.ruleCode === 'ATTR_002')).toBe(false);
  });

  it('ATTR_001 已移除：无匹配文本也不报（2026-08 噪音清理）', () => {
    const issues = checkCoverAttributes(ctx('版次：A\n状态：CFC\n工程号：PJ001'));
    expect(issues.some(i => i.ruleCode === 'ATTR_001')).toBe(false);
  });

});
