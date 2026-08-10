/**
 * structured-consistency 输出解析回归测试（P1-5：schema 收口 + 逐分类隔离）
 *
 * 覆盖：
 * - parseExtractResult 单分类畸形（params 非数组）不吞整片，其余 4 类保留
 * - parseExtractResult 单个条目畸形不影响同分类其他条目
 * - parseCompareResult 单条 null/畸形条目不导致整片返回空
 * - compressSummary 保留 meta/facts（C5/C6 不再静默漏报）
 * - 无 schema 字段时的默认值兜底
 */
import { describe, it, expect } from 'vitest';
import { StructuredConsistencyService } from '../structured-consistency.service';

// private 方法经 (Class as any) 访问（测试专用，避免为测试改产品代码可见性）
const Svc = StructuredConsistencyService as any;
const chunk = { text: '内容', chunkIndex: 2, startIndex: 100 };

describe('parseExtractResult 逐分类隔离', () => {
  it('单分类畸形（params 为字符串而非数组）→ 只丢该分类，其余 4 类保留', () => {
    const raw = JSON.stringify({
      params: 'this is not an array',   // 畸形分类
      codes: [{ code: 'GB50016', context: '防火规范' }],
      refs: [{ ref: '条款 5.1' }],
      meta: [{ key: '设计温度', value: '120℃' }],
      facts: [{ subject: '管道', claim: '材质为不锈钢' }],
    });
    const result = Svc.parseExtractResult(raw, chunk);
    expect(result.params).toEqual([]);
    expect(result.codes).toHaveLength(1);
    expect(result.refs).toHaveLength(1);
    expect(result.meta).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
  });

  it('单个条目畸形（null 元素）不影响同分类其他条目', () => {
    const raw = JSON.stringify({
      params: [
        null,
        { name: '压力', value: '1.6MPa' },
        'bad item',
        { name: '温度', value: '350℃' },
      ],
    });
    const result = Svc.parseExtractResult(raw, chunk);
    expect(result.params).toHaveLength(2);
    expect(result.params.map(p => p.name)).toEqual(['压力', '温度']);
    // chunkIndex / chunkStartIndex 从 chunk 带入
    expect(result.params[0].chunkIndex).toBe(2);
    expect(result.params[0].chunkStartIndex).toBe(100);
  });

  it('缺少分类字段（undefined）→ 返回空数组不报错', () => {
    const raw = JSON.stringify({ params: [{ name: 'A', value: '1' }] });
    const result = Svc.parseExtractResult(raw, chunk);
    expect(result.params).toHaveLength(1);
    expect(result.codes).toEqual([]);
    expect(result.refs).toEqual([]);
    expect(result.meta).toEqual([]);
    expect(result.facts).toEqual([]);
  });

  it('无 JSON 对象 → 返回全部空', () => {
    const result = Svc.parseExtractResult('这不是 JSON', chunk);
    expect(result).toEqual({ params: [], codes: [], refs: [], meta: [], facts: [] });
  });

  it('过滤缺必要字段的条目（name 缺 / value 缺）', () => {
    const raw = JSON.stringify({
      params: [
        { name: '只有名字' },
        { value: '只有值' },
        { name: '完整', value: '有效' },
      ],
    });
    const result = Svc.parseExtractResult(raw, chunk);
    expect(result.params).toHaveLength(1);
    expect(result.params[0].name).toBe('完整');
  });
});

describe('parseCompareResult 逐条隔离', () => {
  it('单条 null/非对象 → 只丢该条，其余保留', () => {
    const raw = JSON.stringify([
      null,
      42,
      { issueType: 'CONSISTENCY', originalText: '温度与压力表不一致', description: 'A' },
      'bad string',
      { originalText: '无类型条目' },
    ]);
    const result = Svc.parseCompareResult(raw);
    expect(result).toHaveLength(2);
    expect(result[0].originalText).toBe('温度与压力表不一致');
    expect(result[0].issueType).toBe('CONSISTENCY');
  });

  it('无 originalText 的条目被丢弃（无定位价值）', () => {
    const raw = JSON.stringify([
      { issueType: 'CONSISTENCY', description: '没有原文' },
      { issueType: 'TYPO', originalText: '有原文的' },
    ]);
    const result = Svc.parseCompareResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('有原文的');
  });

  it('非数组结果 → 返回空', () => {
    expect(Svc.parseCompareResult('{}')).toEqual([]);
    expect(Svc.parseCompareResult('没有数组')).toEqual([]);
  });

  it('无效 issueType 归一为 CONSISTENCY', () => {
    const raw = JSON.stringify([{ issueType: 'NOT_A_TYPE', originalText: 'x' }]);
    const result = Svc.parseCompareResult(raw);
    expect(result[0].issueType).toBe('CONSISTENCY');
  });
});

describe('compressSummary 保留 meta/facts', () => {
  const merged = {
    params: [{ name: '压力', value: '1.6MPa', chunkIndex: 0, chunkStartIndex: 0 }],
    codes: [{ code: 'GB50016', chunkIndex: 0, chunkStartIndex: 0 }],
    refs: [{ ref: '第5章', chunkIndex: 0, chunkStartIndex: 0 }],
    meta: [{ key: '设计温度', value: '120℃', chunkIndex: 0, chunkStartIndex: 0 }],
    facts: [{ subject: '管道', claim: '材质不锈钢', chunkIndex: 0, chunkStartIndex: 0 }],
  };

  it('摘要包含 params/codes/refs/meta/facts 全部维度', () => {
    const summary = Svc.compressSummary(merged, 2000);
    expect(summary).toContain('压力');
    expect(summary).toContain('GB50016');
    expect(summary).toContain('第5章');
    expect(summary).toContain('设计温度');
    expect(summary).toContain('管道');
  });

  it('摘要不超预算', () => {
    const maxChars = 1200;
    const summary = Svc.compressSummary(merged, maxChars);
    expect(summary.length).toBeLessThanOrEqual(maxChars);
  });

  it('预算极小（仅能容纳 params）时 meta/facts 可被截断但不会抛错', () => {
    const summary = Svc.compressSummary(merged, 100);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeLessThanOrEqual(100);
  });
});
