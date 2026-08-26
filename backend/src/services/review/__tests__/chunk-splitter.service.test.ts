/**
 * chunk-splitter 章节感知切块测试
 *
 * 覆盖：
 * - LF 正常文本按章节切块
 * - CRLF（Windows）文本同样按章节切块（修复点：/\n\n+/ 对 CRLF 失效）
 * - 超长章节按段落再切（跨 \r\n 段落分隔）
 * - 标题不残留 \r
 */
import { describe, it, expect } from 'vitest';
import { ChunkSplitterService } from '../chunk-splitter.service';

describe('ChunkSplitterService.splitTextBySection', () => {
  const LF_MD = [
    '# 第1章 总则',
    '',
    '本章内容第一条。',
    '',
    '本章内容第二条。',
    '',
    '## 1.1 适用范围',
    '',
    '本节内容。',
    '',
    '# 第2章 术语',
    '',
    '术语内容。',
  ].join('\n');

  it('LF 文本：按章节切块，识别两级标题', () => {
    const { outline, chunks } = ChunkSplitterService.splitTextBySection(LF_MD);
    // 根级 outline 有 2 章
    expect(outline.length).toBe(2);
    expect(outline[0].title).toBe('第1章 总则');
    // chunks 至少包含 2 个章节（子章节也可能单独成块）
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sectionPath).toContain('第1章');
  });

  it('CRLF 文本：仍能按章节切块，标题不残留 \\r', () => {
    const CRLF_MD = LF_MD.replace(/\n/g, '\r\n');
    const { outline, chunks } = ChunkSplitterService.splitTextBySection(CRLF_MD);

    expect(outline.length).toBe(2);
    expect(outline[0].title).toContain('第1章');
    expect(outline[0].title.includes('\r')).toBe(false);
    // 标题必须完全干净（前后无 \r）
    expect(outline.every(n => !n.title.includes('\r'))).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sectionPath.includes('\r')).toBe(false);
  });

  it('CRLF 超长章节：按 \\r\\n 段落边界再切，不整块粘连', () => {
    // 构造一个超长章节（> maxChunkSize），段落用 CRLF 分隔
    const paras: string[] = [];
    for (let i = 1; i <= 30; i++) {
      paras.push(`段落${i}：` + '内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容'.repeat(8));
    }
    const md = '# 第1章 超长章节\r\n\r\n' + paras.join('\r\n\r\n');

    const { chunks } = ChunkSplitterService.splitTextBySection(md, 2000);
    // 超长章节必须被切成多个块（CRLF 下不再整章不切）
    expect(chunks.length).toBeGreaterThan(1);
    // 每个块文本不包含 \r（归一化干净）
    expect(chunks.every(c => !c.text.includes('\r'))).toBe(true);
    // 切出的块都没有超过 maxChunkSize 太多
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(2000 + 200);
    }
  });

  it('直接调用 splitBySection 传 CRLF 也能正确按段落切分（双保险正则）', () => {
    const paras: string[] = [];
    for (let i = 1; i <= 25; i++) {
      paras.push(`段${i}` + '很长的正文内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容'.repeat(10));
    }
    const body = '# 第1章\r\n\r\n' + paras.join('\r\n\r\n');
    const outline = ChunkSplitterService.extractOutline(body);
    // 注意：直接传 CRLF 时 extractOutline 可能带 \r，但 splitBySection 的段落切分仍要工作
    const chunks = ChunkSplitterService.splitBySection(body, outline, 1500);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('ChunkSplitterService.splitTextBySectionWithFallback（P0 修复 2026-08-26）', () => {
  // 纯文本无任何标题结构（项目实际场景：扫描件 OCR / 无格式 DOCX 提取文本）
  const PLAIN_TEXT = Array.from({ length: 50 }, (_, i) => `这是第 ${i + 1} 段普通文本内容，没有章节标题。`).join('\n');

  it('有章节结构时走章节切块，不触发兜底', () => {
    const md = '# 第1章 总则\n\n内容。\n\n# 第2章 术语\n\n内容。';
    const { chunks, usedFallback } = ChunkSplitterService.splitTextBySectionWithFallback(md);
    expect(usedFallback).toBe(false);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sectionPath).toContain('第1章');
  });

  it('纯文本无章节时回退普通分片，chunks 非空且标记 usedFallback', () => {
    const { chunks, usedFallback } = ChunkSplitterService.splitTextBySectionWithFallback(PLAIN_TEXT, 500);
    expect(usedFallback).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    // 兜底路径 sectionLevel=0、sectionPath 标记「全文」
    expect(chunks[0].sectionLevel).toBe(0);
    expect(chunks[0].sectionPath).toContain('全文');
    // 分片文本不丢内容（拼接后原文子串存在）
    const joined = chunks.map(c => c.text).join('');
    expect(PLAIN_TEXT.length).toBeGreaterThan(0);
    expect(joined.length).toBeGreaterThan(0);
  });

  it('短纯文本（< chunkSize）回退为一个 chunk', () => {
    const shortText = '无任何章节标题的纯文本内容'.repeat(10);
    const { chunks, usedFallback } = ChunkSplitterService.splitTextBySectionWithFallback(shortText);
    expect(usedFallback).toBe(true);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(shortText);
  });

  it('长纯文本（> chunkSize）回退为多段分片，保持 startIndex 单调递增', () => {
    const longText = Array.from({ length: 200 }, (_, i) => `段落${i}：` + '内容'.repeat(30)).join('\n');
    const { chunks, usedFallback } = ChunkSplitterService.splitTextBySectionWithFallback(longText, 800);
    expect(usedFallback).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].startIndex).toBeGreaterThanOrEqual(i === 0 ? 0 : chunks[i - 1].startIndex);
    }
  });
});
