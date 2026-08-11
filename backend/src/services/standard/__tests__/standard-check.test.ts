/**
 * standard-check.service 8 级比对链单元测试
 *
 * 覆盖：L1 名称精确 / L2 编号精确 / L3-L4 去空格 / L5 标点规范化（含全角斜杠回归）/
 * L6 包含匹配（≥8 字符防误匹配）/ L7 数字段 / L8 Levenshtein（≥0.8）/
 * 完全不匹配 / 状态透传。
 */
import { describe, it, expect } from 'vitest';
import { StandardCheckService, StandardCheckItem } from '../standard-check.service';

const LIB: StandardCheckItem[] = [
  { id: 's1', standardNo: 'GB/T 19001-2016', standardName: '质量管理体系 要求', standardIdent: 'GB/T', standardStatus: 'CURRENT' },
  { id: 's2', standardNo: 'HAF 102-2016', standardName: '核动力厂设计安全规定', standardIdent: 'HAF', standardStatus: 'ABOLISHED' },
  { id: 's3', standardNo: 'EJ/T 1125-2000', standardName: '压水堆核电厂核安全级泵电机设计规范', standardIdent: 'EJ/T', standardStatus: 'CURRENT' },
  { id: 's4', standardNo: 'GB 50217-2018', standardName: '电力工程电缆设计标准', standardIdent: 'GB', standardStatus: 'CURRENT' },
];

const match = (doc: Partial<StandardCheckItem>) =>
  StandardCheckService.findBestMatch(
    { standardNo: doc.standardNo || '', standardName: doc.standardName || '', standardIdent: doc.standardIdent || '' },
    LIB,
  );

describe('StandardCheckService.findBestMatch 8 级比对链', () => {
  it('L1 名称精确匹配', () => {
    const r = match({ standardNo: '其他编号', standardName: '质量管理体系 要求' });
    expect(r.matched).toBe(true);
    expect(r.matchLevel).toBe(1);
    expect(r.isExactMatch).toBe(true);
  });

  it('L2 编号精确匹配（名称不同也命中）', () => {
    const r = match({ standardNo: 'GB/T 19001-2016', standardName: '质量管理要求' });
    expect(r.matchLevel).toBe(2);
  });

  it('L3 名称去空格匹配', () => {
    const r = match({ standardName: '质量管理体系要求' });
    expect(r.matchLevel).toBe(3);
  });

  it('L4 编号去空格匹配', () => {
    const r = match({ standardNo: 'GB/T19001-2016', standardName: 'x' });
    expect(r.matchLevel).toBe(4);
  });

  it('L5 标点规范化：全角连字符与全角斜杠（SELF_CHECK 回归）', () => {
    // 修复前：全角斜杠 ／ 未归一化 → L5 失败，只能靠 L8 模糊兜底（sim 0.93）
    const r = match({ standardNo: 'GB／T 19001－2016', standardName: 'x' });
    expect(r.matchLevel).toBe(5);
  });

  it('L6 包含匹配要求 ≥8 字符（防短编号误匹配）', () => {
    // 'GB50217' 去空格后 7 字符 < 8 → L6 跳过 → L7 数字段命中（standardIdent 需传入）
    const r = match({ standardNo: 'GB 50217', standardName: '', standardIdent: 'GB' });
    expect(r.matchLevel).toBe(7);
    // 超短编号直接不匹配
    expect(match({ standardNo: 'GB', standardName: '', standardIdent: 'GB' }).matched).toBe(false);
  });

  it('L7 数字段匹配（核心数字 + 标识符）', () => {
    // 'GB/T19001' 9 字符 ≥ 8 → L6 包含优先命中（L6 优先级高于 L7）
    const byPrefix = match({ standardNo: 'GB/T 19001', standardName: '', standardIdent: 'GB/T' });
    expect(byPrefix.matchLevel).toBe(6);
    // 数字段在库中不存在 → L7 失败、L8 相似度不足 → 不匹配
    expect(match({ standardNo: 'GB/T 50001-2017', standardName: '', standardIdent: 'GB/T' }).matched).toBe(false);
  });

  it('L8 Levenshtein：≥0.8 命中，低相似度不匹配', () => {
    // 'GB 50217-2019' 与 'GB 50217-2018' 数字段相同 → L7 优先命中
    const near = match({ standardNo: 'GB 50217-2019', standardName: '', standardIdent: 'GB' });
    expect(near.matchLevel).toBe(7);
    // 低相似度（完全不同编号）→ 不匹配
    expect(match({ standardNo: 'GB 50010-2010', standardName: '', standardIdent: 'GB' }).matched).toBe(false);
  });

  it('完全不匹配返回 matched=false', () => {
    const r = match({ standardNo: 'XYZ 99999-9999', standardName: '完全不存在' });
    expect(r.matched).toBe(false);
    expect(r.matchLevel).toBe(0);
  });

  it('命中标准的状态透传（ABOLISHED/UPCOMING 由调用方判断）', () => {
    const r = match({ standardNo: 'HAF 102-2016', standardName: '' });
    expect(r.matchedItem?.standardStatus).toBe('ABOLISHED');
  });
});
