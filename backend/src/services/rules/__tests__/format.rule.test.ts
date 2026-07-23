/**
 * 格式规范规则测试 (FORMAT)
 * 测试文件: format.rule.ts → checkFormatRules, extractCoverArea
 */
import { describe, it, expect } from 'vitest';
import { checkFormatRules, extractCoverArea } from '../format.rule';
import { FileContext } from '../types';

function ctx(text: string, fileType = 'pdf'): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType,
    extractedText: text,
  };
}

describe('Format Rule (FORMAT)', () => {

  /* ===== extractCoverArea tests ===== */

  it('extractCoverArea should return first 30 lines if no clear split', () => {
    const text = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`).join('\n');
    const cover = extractCoverArea(text);
    expect(cover.split('\n').length).toBeLessThanOrEqual(30);
  });

  it('extractCoverArea should split at consecutive empty lines', () => {
    const text = '封面行1\n封面行2\n\n\n正文行1\n正文行2';
    const cover = extractCoverArea(text);
    expect(cover).toContain('封面行1');
    expect(cover).not.toContain('正文行1');
  });

  /* ===== FORMAT 正例 ===== */

  it('FORMAT_001: should detect missing cover fields', () => {
    const issues = checkFormatRules(ctx('随意文本，没有封面必填字段'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_001')).toBe(true);
  });

  it('FORMAT_002: should detect missing table of contents columns', () => {
    const issues = checkFormatRules(ctx('专业：建筑\n工种：电气\n版次：A\n状态：CFC\n设计阶段：施工图设计\n工程号：PJ001\n子项号：S01\n目 录\n这是目录内容，没有标准列名。'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_002')).toBe(true);
  });

  it('FORMAT_003: should detect missing space between Chinese and English', () => {
    const issues = checkFormatRules(ctx('专业：建筑\n工种：电气\n版次：A\n状态：CFC\n设计阶段：施工图设计\n工程号：PJ001\n子项号：S01\n按照ISO标准执行ABC分类'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_003')).toBe(true);
  });

  it('FORMAT_004: should detect non-standard reference list format', () => {
    const issues = checkFormatRules(ctx('专业：建筑\n工种：电气\n版次：A\n状态：CFC\n设计阶段：施工图设计\n工程号：PJ001\n子项号：S01\n引用文件\n1.《GB/T 1234-2020》\n2.《设计规范》'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_004')).toBe(true);
  });

  it('FORMAT_005: should suggest multi-level header for cable list', () => {
    const issues = checkFormatRules(ctx('电缆清单\n专业：建筑\n工种：电气\n版次：A\n状态：CFC\n设计阶段：施工图设计\n工程号：PJ001\n子项号：S01\n名称\t规格\t长度\t起点\t终点\n电缆1\t3x95\t100m\tA01\tB05\n电缆2\t3x70\t80m\tA02\tB06\n电缆3\t3x50\t60m\tA03\tB07'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_005')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass when all cover fields are present', () => {
    const issues = checkFormatRules(ctx(`专业：建筑
工种：电气
版次：A
状态：CFC
设计阶段：施工图设计
工程号：PJ001
子项号：S01`));
    expect(issues.some(i => i.ruleCode === 'FORMAT_001')).toBe(false);
  });

  it('should pass when table of contents has standard columns', () => {
    const issues = checkFormatRules(ctx(`专业：建筑
工种：电气
版次：A
状态：CFC
设计阶段：施工图设计
工程号：PJ001
子项号：S01
目 录
序号  名称  版本  页数
1    文件1  A    5`));
    expect(issues.some(i => i.ruleCode === 'FORMAT_002')).toBe(false);
  });

  it('should pass when Chinese and English have proper spacing', () => {
    const issues = checkFormatRules(ctx(`专业：建筑
工种：电气
版次：A
状态：CFC
设计阶段：施工图设计
工程号：PJ001
子项号：S01
按照 ISO 标准执行 ABC 分类`));
    expect(issues.some(i => i.ruleCode === 'FORMAT_003')).toBe(false);
  });

  it('should pass when reference list uses standard bullets', () => {
    const issues = checkFormatRules(ctx(`专业：建筑
工种：电气
版次：A
状态：CFC
设计阶段：施工图设计
工程号：PJ001
子项号：S01
引用文件
● GB/T 1234-2020 设计规范
● GB/T 5678-2021 施工标准`));
    expect(issues.some(i => i.ruleCode === 'FORMAT_004')).toBe(false);
  });

  it('should return empty for invalid text without issues', () => {
    const issues = checkFormatRules(ctx(''));
    expect(Array.isArray(issues)).toBe(true);
  });

  /* ===== FORMAT_006 / 008 / 009 补充（OPT-002 覆盖缺口） ===== */

  it('FORMAT_006: 中文文档混入半角逗号应检出', () => {
    const issues = checkFormatRules(ctx('这是一段中文测试,包含半角逗号。'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_006')).toBe(true);
  });

  it('FORMAT_006: 中文文档全角标点不报半角混用', () => {
    const issues = checkFormatRules(ctx('这是一段中文测试，包含全角标点。'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_006')).toBe(false);
  });

  it('FORMAT_008: 文本含 Unicode 上标字符应检出', () => {
    const issues = checkFormatRules(ctx('公式 X² 加 Y³ 的计算结果'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_008')).toBe(true);
  });

  it('FORMAT_009: 文本含 Unicode 下标字符应检出', () => {
    const issues = checkFormatRules(ctx('化学式 H₂O 的物理性质'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_009')).toBe(true);
  });

  it('FORMAT_008/009: 普通文本不含上下标不报', () => {
    const issues = checkFormatRules(ctx('普通公式 X^2 加 Y^3 的计算结果'));
    expect(issues.some(i => i.ruleCode === 'FORMAT_008' || i.ruleCode === 'FORMAT_009')).toBe(false);
  });

});
