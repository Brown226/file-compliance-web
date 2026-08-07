/**
 * punctuation.rule 测试集
 *
 * 覆盖 PUNCT_004 引号配对（2026-08 修复：原左右引号共用同一正则，永不触发）
 * 与 PUNCT_003 连续句号省略号建议（2026-08 修复：原建议合并为单个句号）。
 */

import { describe, it, expect } from 'vitest';
import { checkPunctuation } from '../punctuation.rule';
import { FileContext } from '../types';

function makeCtx(text: string): FileContext {
  return {
    fileName: 'test.docx',
    filePath: '/uploads/test.docx',
    fileType: 'docx',
    extractedText: text,
  };
}

describe('checkPunctuation', () => {
  // ===== PUNCT_004 引号/括号配对 =====

  it('PUNCT_004: 左引号多于右引号应检出（修复前永不触发）', () => {
    const issues = checkPunctuation(makeCtx('他说：“今天天气很好。明天也要出门。'));
    expect(issues.some(i => i.ruleCode === 'PUNCT_004')).toBe(true);
  });

  it('PUNCT_004: 右引号多于左引号应检出', () => {
    const issues = checkPunctuation(makeCtx('他今天出门了。”这句话有点奇怪。'));
    expect(issues.some(i => i.ruleCode === 'PUNCT_004')).toBe(true);
  });

  it('PUNCT_004: 引号配对不报错', () => {
    const issues = checkPunctuation(makeCtx('他说：“今天天气很好。”大家都很高兴。'));
    expect(issues.some(i => i.ruleCode === 'PUNCT_004')).toBe(false);
  });

  it('PUNCT_004: 中文括号不配对应检出', () => {
    const issues = checkPunctuation(makeCtx('这是（一个未闭合的括号。'));
    expect(issues.some(i => i.ruleCode === 'PUNCT_004')).toBe(true);
  });

  // ===== PUNCT_003 连续重复标点 / 省略号 =====

  it('PUNCT_003: 连续句号"。。"应建议省略号"……"（2026-08 修复）', () => {
    const issues = checkPunctuation(makeCtx('这里省略了一些内容。。后面的文字继续。'));
    const hit = issues.find(i => i.ruleCode === 'PUNCT_003' && i.originalText === '。。');
    expect(hit).toBeDefined();
    expect(hit!.suggestedText).toBe('……');
  });

  it('PUNCT_003: 连续逗号仍建议单个逗号', () => {
    const issues = checkPunctuation(makeCtx('我们讨论了，，方案细节。'));
    const hit = issues.find(i => i.ruleCode === 'PUNCT_003');
    expect(hit).toBeDefined();
    expect(hit!.suggestedText).toBe('，');
  });

  // ===== PUNCT_001 中英文标点混用 =====

  it('PUNCT_001: 中文语境半角逗号应检出', () => {
    const issues = checkPunctuation(makeCtx('今天天气很好,我们出去走走。'));
    expect(issues.some(i => i.ruleCode === 'PUNCT_001')).toBe(true);
  });

  // ===== 反例：不应误报 =====

  it('规范中文标点不报错', () => {
    const issues = checkPunctuation(makeCtx('今天天气很好，我们出去走走。他说：“好的。”'));
    expect(issues.filter(i => i.ruleCode.startsWith('PUNCT_'))).toHaveLength(0);
  });

  it('非中文文档（中文占比<30%）不检查', () => {
    const issues = checkPunctuation(makeCtx('Hello world, this is English text with punctuation!'));
    expect(issues).toHaveLength(0);
  });
});
