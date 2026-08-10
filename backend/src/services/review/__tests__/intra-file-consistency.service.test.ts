/**
 * P2-10：intra-file 一致性数值判定增强回归测试
 *
 * 覆盖：
 * - 单位换算：1MPa vs 1kPa → 判不一致（修复"单位被吞导致漏报"），description 含"单位不同且数值不等（1MPa = 1000kPa）"
 * - 同单位换算后相等：1MPa vs 1000kPa → 判一致（修复误报）
 * - 相对容差（以规格公式 |a-b|/max(|a|,|b|) ≤ tol 为准）：
 *   1.0 vs 1.05（默认 1% 容差，0.05/1.05≈4.76%>1%）→ 判不一致；
 *   传 tolerance=0.05 → 判一致；1.0 vs 2.0 → 判不一致
 * - 非数值类型：DN100 vs DN150 → 保持原行为（不一致，走原文路径）
 * - position 定位字段：存在且数值正确（UTF-16 偏移）；无原文/行号越界/行内找不到 → undefined 兜底
 * - 温度换算：35℃ vs 95℉ → 一致；35℃ vs 100℉ → 不一致且描述含单位换算
 * - 不同维度（5m vs 5kg）→ 不一致
 * - 同参数名多值分组逻辑不回归
 * - normalizeNumericValue 单测
 *
 * 全 mock 隔离：仅测纯函数/静态方法，不连 DB/Redis/LLM。
 */
import { describe, it, expect } from 'vitest';
import { IntraFileConsistencyService, normalizeNumericValue } from '../intra-file-consistency.service';

// private 静态方法经 (Class as any) 访问（与同目录既有测试同风格）
const Svc = IntraFileConsistencyService as any;

/** 构造最小 ParamEntry */
function param(paramName: string, value: string, lineNumber: number, context = ''): any {
  return { paramName, value, lineNumber, context };
}

describe('normalizeNumericValue（数值+单位解析）', () => {
  it('解析压力单位', () => {
    expect(normalizeNumericValue('17.5MPa')).toEqual({ value: 17.5, unit: 'mpa' });
    expect(normalizeNumericValue('1.6 MPa')).toEqual({ value: 1.6, unit: 'mpa' });
    expect(normalizeNumericValue('1000kPa')).toEqual({ value: 1000, unit: 'kpa' });
    expect(normalizeNumericValue('0.5bar')).toEqual({ value: 0.5, unit: 'bar' });
    expect(normalizeNumericValue('2atm')).toEqual({ value: 2, unit: 'atm' });
  });

  it('解析温度单位（℃/℉/K 与中文别名）', () => {
    expect(normalizeNumericValue('350℃')).toEqual({ value: 350, unit: '°c' });
    expect(normalizeNumericValue('95℉')).toEqual({ value: 95, unit: '°f' });
    expect(normalizeNumericValue('293.15K')).toEqual({ value: 293.15, unit: 'k' });
    expect(normalizeNumericValue('-5℃')).toEqual({ value: -5, unit: '°c' });
    expect(normalizeNumericValue('95华氏度')).toEqual({ value: 95, unit: '°f' });
  });

  it('解析长度/质量/时间/百分比', () => {
    expect(normalizeNumericValue('10mm')).toEqual({ value: 10, unit: 'mm' });
    expect(normalizeNumericValue('3km')).toEqual({ value: 3, unit: 'km' });
    expect(normalizeNumericValue('5kg')).toEqual({ value: 5, unit: 'kg' });
    expect(normalizeNumericValue('2t')).toEqual({ value: 2, unit: 't' });
    expect(normalizeNumericValue('120min')).toEqual({ value: 120, unit: 'min' });
    expect(normalizeNumericValue('1.5h')).toEqual({ value: 1.5, unit: 'h' });
    expect(normalizeNumericValue('2day')).toEqual({ value: 2, unit: 'day' });
    expect(normalizeNumericValue('5%')).toEqual({ value: 5, unit: '%' });
  });

  it('非数值开头 → null', () => {
    expect(normalizeNumericValue('DN100')).toBeNull();
    expect(normalizeNumericValue('一百')).toBeNull();
    expect(normalizeNumericValue('ABC')).toBeNull();
  });
});

describe('单位换算数值比对（findInconsistencies）', () => {
  it('1MPa vs 1kPa → 判不一致（漏报修复），描述含单位换算说明', () => {
    const result = Svc.findInconsistencies([
      param('设计压力', '1MPa', 1),
      param('设计压力', '1kPa', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].paramName).toBe('设计压力');
    expect(result[0].description).toBe('单位不同且数值不等（1MPa = 1000kPa）');
    expect(result[0].description).toContain('单位不同且数值不等');
  });

  it('1MPa vs 1000kPa → 判一致（换算后相等，修复误报）', () => {
    const result = Svc.findInconsistencies([
      param('设计压力', '1MPa', 1),
      param('设计压力', '1000kPa', 2),
    ]);
    expect(result).toHaveLength(0);
  });

  it('温度换算相等：35℃ vs 95℉ → 判一致', () => {
    const result = Svc.findInconsistencies([
      param('设计温度', '35℃', 1),
      param('设计温度', '95℉', 2),
    ]);
    expect(result).toHaveLength(0);
  });

  it('温度换算不等：35℃ vs 100℉ → 判不一致，描述含单位换算', () => {
    const result = Svc.findInconsistencies([
      param('设计温度', '35℃', 1),
      param('设计温度', '100℉', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('单位不同且数值不等（35℃ = 95℉）');
  });

  it('K 换算：293.15K vs 20℃ → 判一致', () => {
    const result = Svc.findInconsistencies([
      param('设计温度', '293.15K', 1),
      param('设计温度', '20℃', 2),
    ]);
    expect(result).toHaveLength(0);
  });

  it('不同维度（5m vs 5kg）→ 判不一致', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '5m', 1),
      param('参数A', '5kg', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined(); // 维度不同不可换算 → 走默认文案
  });
});

describe('相对容差（|a-b|/max(|a|,|b|) ≤ tol，默认 1%）', () => {
  it('1.0 vs 1.05 默认 1% 容差 → 判不一致（0.05/1.05≈4.76%>1%，以公式为准）', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '1.0', 1),
      param('参数A', '1.05', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined(); // 同单位纯数值 → 默认文案
  });

  it('1.0 vs 1.05 传 tolerance=0.05 → 判一致（容差可配置）', () => {
    const result = Svc.findInconsistencies(
      [param('参数A', '1.0', 1), param('参数A', '1.05', 2)],
      { tolerance: 0.05 },
    );
    expect(result).toHaveLength(0);
  });

  it('1.0 vs 2.0 → 判不一致', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '1.0', 1),
      param('参数A', '2.0', 2),
    ]);
    expect(result).toHaveLength(1);
  });

  it('完全相同的值（含不同写法单位）→ 判一致', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '10mm', 1),
      param('参数A', '10 mm', 2),
      param('参数A', '0.01m', 3),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe('非数值类型保持原行为', () => {
  it('DN100 vs DN150 → 判不一致（走原文不一致路径）', () => {
    const result = Svc.findInconsistencies([
      param('公称直径', 'DN100', 1),
      param('公称直径', 'DN150', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].paramName).toBe('公称直径');
    expect(result[0].description).toBeUndefined();
  });
});

describe('position 定位字段', () => {
  const text = '设计压力：1MPa\n设计温度：350℃\n设计压力：1kPa\n';

  it('基于 lineNumber + 行内定位计算字符区间（UTF-16 偏移）', () => {
    const result = Svc.findInconsistencies(
      [param('设计压力', '1MPa', 1), param('设计压力', '1kPa', 3)],
      { extractedText: text },
    );
    expect(result).toHaveLength(1);
    expect(result[0].position).toEqual({ start: 5, end: 9 });
    expect(result[0].entries[0].position).toEqual({ start: 5, end: 9 });
    expect(result[0].entries[1].position).toEqual({ start: 25, end: 29 });
  });

  it('未传 extractedText → position 为 undefined（兜底）', () => {
    const result = Svc.findInconsistencies([
      param('设计压力', '1MPa', 1),
      param('设计压力', '1kPa', 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].position).toBeUndefined();
    expect(result[0].entries[0].position).toBeUndefined();
  });

  it('行号越界 → position 为 undefined，但仍判不一致', () => {
    const result = Svc.findInconsistencies(
      [param('设计压力', '1MPa', 99), param('设计压力', '1kPa', 100)],
      { extractedText: '只有一行' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].position).toBeUndefined();
    expect(result[0].entries[0].position).toBeUndefined();
  });

  it('行内找不到值 → position 为 undefined', () => {
    const result = Svc.findInconsistencies(
      [param('设计压力', '1MPa', 1), param('设计压力', '1kPa', 2)],
      { extractedText: '第一行没有值\n第二行也没有值' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].position).toBeUndefined();
    expect(result[0].entries[1].position).toBeUndefined();
  });

  it('同一行多处出现 → 各自定位到对应字符区间', () => {
    const result = Svc.findInconsistencies(
      [param('设计压力', '1MPa', 1), param('设计压力', '1kPa', 1)],
      { extractedText: '同一行两个值 1MPa 和 1kPa' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].entries[0].position).toEqual({ start: 7, end: 11 });
    expect(result[0].entries[1].position).toEqual({ start: 14, end: 18 });
  });
});

describe('同参数名多值分组逻辑不回归', () => {
  it('多值混合（含重复值）仍输出一条 Inconsistency 且保留全部 entry', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '10mm', 1),
      param('参数A', '10mm', 2),
      param('参数A', '20mm', 3),
      param('参数B', 'x', 4),
      param('参数B', 'y', 5),
    ]);
    expect(result).toHaveLength(2);
    const a = result.find((r: any) => r.paramName === '参数A');
    const b = result.find((r: any) => r.paramName === '参数B');
    expect(a.entries).toHaveLength(3);
    expect(b.entries).toHaveLength(2);
    expect(a.entries.map((e: any) => e.value)).toEqual(['10mm', '10mm', '20mm']);
  });

  it('值全部相同（单值）→ 不报告', () => {
    const result = Svc.findInconsistencies([
      param('参数A', '10mm', 1),
      param('参数A', '10mm', 2),
    ]);
    expect(result).toHaveLength(0);
  });

  it('只有一条 entry → 不报告', () => {
    const result = Svc.findInconsistencies([param('参数A', '10mm', 1)]);
    expect(result).toHaveLength(0);
  });
});
