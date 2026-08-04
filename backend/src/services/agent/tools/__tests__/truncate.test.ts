/**
 * truncate 模块测试（计划任务 6）
 *
 * 验证抽出为独立模块后的截断行为：
 * - truncateTextString 超长截断 + <file_content> 包裹闭合
 * - truncateToolResult 按工具名分发（extract_text / chunk_document / read_file）
 * - truncateWrapper 不改变非截断工具的结果
 */
import { describe, it, expect } from 'vitest';
import {
  TRUNCATABLE_TOOLS,
  truncateTextString,
  truncateToolResult,
  truncateWrapper,
} from '../truncate';

describe('truncateTextString', () => {
  it('短文本原样返回', () => {
    expect(truncateTextString('hello', 10)).toBe('hello');
  });

  it('超长文本截断并标注', () => {
    const out = truncateTextString('中文字符'.repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50 + 30);
    expect(out).toContain('（已截断');
  });

  it('保持 file_content 包裹闭合', () => {
    const inner = 'x'.repeat(200);
    const wrapped = `<file_content>${inner}</file_content>`;
    const out = truncateTextString(wrapped, 50);
    expect(out.startsWith('<file_content>')).toBe(true);
    expect(out.endsWith('</file_content>')).toBe(true);
    expect(out).toContain('（已截断');
  });
});

describe('TRUNCATABLE_TOOLS', () => {
  it('包含三个可截断工具', () => {
    expect(Object.keys(TRUNCATABLE_TOOLS).sort()).toEqual(['chunk_document', 'extract_text', 'read_file']);
    expect(TRUNCATABLE_TOOLS.extract_text.maxChars).toBeGreaterThan(0);
  });
});

describe('truncateToolResult', () => {
  it('extract_text 截断 text 字段', () => {
    const result = { text: 'a'.repeat(5000), markdown: '短', structure: {} };
    const out = truncateToolResult('extract_text', result, { maxChars: 100 });
    expect(out.text).toContain('（已截断');
    expect(out.markdown).toBe('短');
  });

  it('chunk_document 保留预算内块并标记丢弃', () => {
    const result = {
      chunks: [
        { index: 0, text: 'x'.repeat(60) },
        { index: 1, text: 'y'.repeat(60) },
      ],
      total: 2,
    };
    const out = truncateToolResult('chunk_document', result, { maxChars: 80 });
    expect(out.chunks.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(out.chunks)).toContain('已截断');
  });

  it('read_file 截断 content 字段', () => {
    const result = { content: 'z'.repeat(500) };
    const out = truncateToolResult('read_file', result, { maxChars: 50 });
    expect(out.content).toContain('（已截断');
  });

  it('未知工具原样返回', () => {
    const result = { data: 'x'.repeat(1000) };
    const out = truncateToolResult('unknown_tool', result, { maxChars: 10 });
    expect(out).toBe(result);
  });
});

describe('truncateWrapper', () => {
  it('非截断工具结果不变', async () => {
    const execute = async () => ({ ok: true });
    const wrapped = truncateWrapper('some_other_tool', execute);
    const out = await wrapped({}, {});
    expect(out).toEqual({ ok: true });
  });
});
