/**
 * parseChunkLocator 单元测试（P0-⑨ 知识引用溯源 — 定位元数据解析）
 *
 * 覆盖：
 * - 显式字段优先（raw.page / raw.page_number / metadata.page 等，数字与字符串）
 * - chunk 文本开头的页码标记（p3 / 第3页 / 【第3页】 / 3页 / page 3）
 * - 章节标记（markdown 标题 / 【标题】块）
 * - 显式元数据优先于文本标记
 * - 无任何定位信息 → 返回空对象
 *
 * 通过 mock 隔离 rag.service 的重依赖（maxkb/ragflow/llm/cache/prisma 相关），
 * 只测纯函数 parseChunkLocator。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../maxkb.service', () => ({ MaxKBService: {} }));
vi.mock('../ragflow.service', () => ({ RagflowProvider: {} }));
vi.mock('../../llm/llm.service', () => ({ LlmService: {}, ReviewIssue: {}, SourceReference: {} }));
vi.mock('../../llm/prompt-template.service', () => ({ PromptTemplateService: {} }));
vi.mock('../../system/cache.service', () => ({ CacheService: {} }));
vi.mock('../../../utils/parallel', () => ({ parallelLimit: vi.fn() }));
vi.mock('../../../utils/system-config', () => ({ getChunkConcurrency: vi.fn() }));

import { parseChunkLocator } from '../rag.service';

describe('显式字段优先', () => {
  it('raw.page 数字', () => {
    expect(parseChunkLocator({ page: 3 }, '正文')).toEqual({ page: 3 });
  });

  it('raw.page_number 字符串', () => {
    expect(parseChunkLocator({ page_number: '5' }, '正文')).toEqual({ page: 5 });
  });

  it('metadata.page', () => {
    expect(parseChunkLocator({ metadata: { page: 2 } }, '正文')).toEqual({ page: 2 });
  });

  it('section 字段', () => {
    expect(parseChunkLocator({ section: '付款条款' }, '正文')).toEqual({ section: '付款条款' });
  });

  it('meta.section_title', () => {
    expect(parseChunkLocator({ meta: { section_title: '验收标准' } }, '正文')).toEqual({ section: '验收标准' });
  });

  it('显式字段优先于文本标记（即使文本无页码标记也不覆盖）', () => {
    const r = parseChunkLocator({ page: 7, section: '第一章 总则' }, '无任何标记的正文');
    expect(r).toEqual({ page: 7, section: '第一章 总则' });
  });

  it('page 为 0 或负数视为无效', () => {
    expect(parseChunkLocator({ page: 0 }, '')).toEqual({});
    expect(parseChunkLocator({ page: -1 }, '')).toEqual({});
  });
});

describe('文本页码标记', () => {
  it('p3 开头', () => {
    expect(parseChunkLocator({}, 'p3 合同编号：xxx').page).toBe(3);
  });

  it('第3页 开头', () => {
    expect(parseChunkLocator({}, '第3页 施工方案').page).toBe(3);
  });

  it('【第3页】 开头', () => {
    expect(parseChunkLocator({}, '【第3页】\n正文内容').page).toBe(3);
  });

  it('page 12 开头', () => {
    expect(parseChunkLocator({}, 'page 12: 附件清单').page).toBe(12);
  });

  it('裸数字 页 形式（"3页"）', () => {
    expect(parseChunkLocator({}, '3页 目录').page).toBe(3);
  });

  it('正文数字不误伤（"本合同共 30 条" 不以页码开头）', () => {
    expect(parseChunkLocator({}, '本合同共 30 条').page).toBeUndefined();
  });
});

describe('文本章节标记', () => {
  it('markdown 一级标题', () => {
    expect(parseChunkLocator({}, '# 第四章 付款条款\n正文').section).toBe('第四章 付款条款');
  });

  it('【标题】块', () => {
    expect(parseChunkLocator({}, '【验收标准】\n正文').section).toBe('验收标准');
  });

  it('页标记与标题互斥：页码在前时解析 page，标题不解析为 section', () => {
    // 两个标记正则都锚定内容开头，页码在前时只解析 page（实现行为）
    const r = parseChunkLocator({}, '第5页\n# 第三章 违约责任\n正文');
    expect(r.page).toBe(5);
    expect(r.section).toBeUndefined();
  });
});

describe('无定位信息', () => {
  it('空 raw + 无标记文本 → 空对象', () => {
    expect(parseChunkLocator({}, '普通正文，没有定位标记')).toEqual({});
  });

  it('undefined raw 不抛错', () => {
    expect(parseChunkLocator(undefined as any, undefined as any)).toEqual({});
  });
});
