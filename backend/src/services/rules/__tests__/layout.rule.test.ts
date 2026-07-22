/**
 * 排版布局规则测试 (LAYOUT)
 * 测试文件: layout.rule.ts → checkLayout
 */
import { describe, it, expect } from 'vitest';
import { checkLayout } from '../layout.rule';
import { FileContext } from '../types';

function ctx(pdfPages: string[]): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    pdfPages,
  };
}

describe('Layout Rule (LAYOUT)', () => {

  /* ===== 正例 ===== */

  it('LAYOUT_001: should detect possible text break at page boundary (short fragment)', () => {
    const issues = checkLayout(ctx([
      '前面文字\n这是一个长标题',
      '继续的内容',
    ]));
    // Current page ends with short Chinese text ("长标题"), next page starts without space
    expect(issues.some(i => i.ruleCode === 'LAYOUT_001')).toBe(true);
  });

  it('LAYOUT_001: should detect short Chinese fragment at page end', () => {
    const issues = checkLayout(ctx([
      '第一行\n第二行\n标题断',
      '续页内容开始',
    ]));
    expect(issues.some(i => i.ruleCode === 'LAYOUT_001')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('should pass when pages end with punctuation', () => {
    const issues = checkLayout(ctx([
      '这是一个完整的句子。',
      '新的一页开始。',
    ]));
    expect(issues.length).toBe(0);
  });

  it('should return empty when only one page', () => {
    const issues = checkLayout(ctx(['single page content']));
    expect(issues.length).toBe(0);
  });

  it('should pass when page boundary has natural break', () => {
    const issues = checkLayout(ctx([
      '第一页完整段落结束。',
      '第二页新段落开始。',
    ]));
    expect(issues.length).toBe(0);
  });

  it('should pass when fragment ends with English (not Chinese)', () => {
    const issues = checkLayout(ctx([
      'some English text',
      'continues here',
    ]));
    expect(issues.length).toBe(0);
  });

  it('should pass when fragment is longer than threshold', () => {
    const issues = checkLayout(ctx([
      '这是一个非常长的段落内容，远远超过了短片段阈值。',
      '下一页内容',
    ]));
    expect(issues.length).toBe(0);
  });

});
