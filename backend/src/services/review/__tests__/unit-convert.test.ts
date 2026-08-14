/**
 * 共享单位换算模块（unit-convert.ts）回归测试（P1-5）
 *
 * 覆盖：
 * - normalizeNumericValue / normalizeUnit 别名解析（继承 intra 原有断言语义）
 * - convertToBaseUnit：7 维换算（此前 cross 私有实现仅温压 2 维）
 * - withinTolerance：max 分母口径（此前 cross 用 avg、intra 用 max，边界值判定相反）
 * - 核心回归场景："5mm vs 0.5cm" 换算后一致（此前 cross 不换算直接 5 vs 0.5 判不一致）
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeNumericValue, normalizeUnit, convertToBaseUnit, withinTolerance, formatNumber,
} from '../unit-convert';

describe('normalizeNumericValue（数值+单位解析）', () => {
  it('压力：MPa/kPa/Pa/bar/atm 别名归一', () => {
    expect(normalizeNumericValue('17.5MPa')).toEqual({ value: 17.5, unit: 'mpa' });
    expect(normalizeNumericValue('1000kPa')).toEqual({ value: 1000, unit: 'kpa' });
    expect(normalizeNumericValue('0.5bar')).toEqual({ value: 0.5, unit: 'bar' });
    expect(normalizeNumericValue('2atm')).toEqual({ value: 2, unit: 'atm' });
  });

  it('温度：℃/℉/K 与中文别名', () => {
    expect(normalizeNumericValue('350℃')).toEqual({ value: 350, unit: '°c' });
    expect(normalizeNumericValue('95℉')).toEqual({ value: 95, unit: '°f' });
    expect(normalizeNumericValue('293.15K')).toEqual({ value: 293.15, unit: 'k' });
    expect(normalizeNumericValue('95华氏度')).toEqual({ value: 95, unit: '°f' });
  });

  it('长度/质量/时间/百分比', () => {
    expect(normalizeNumericValue('10mm')).toEqual({ value: 10, unit: 'mm' });
    expect(normalizeNumericValue('3km')).toEqual({ value: 3, unit: 'km' });
    expect(normalizeNumericValue('5kg')).toEqual({ value: 5, unit: 'kg' });
    expect(normalizeNumericValue('2t')).toEqual({ value: 2, unit: 't' });
    expect(normalizeNumericValue('120min')).toEqual({ value: 120, unit: 'min' });
    expect(normalizeNumericValue('2day')).toEqual({ value: 2, unit: 'day' });
    expect(normalizeNumericValue('5%')).toEqual({ value: 5, unit: '%' });
  });

  it('非数值开头无法解析', () => {
    expect(normalizeNumericValue('DN100')).toBeNull();
    expect(normalizeNumericValue('一百')).toBeNull();
  });
});

describe('normalizeUnit（规范化）', () => {
  it('小写/去空格/符号统一', () => {
    expect(normalizeUnit(' MPa ')).toBe('mpa');
    expect(normalizeUnit('℃')).toBe('°c');
    expect(normalizeUnit('兆帕')).toBe('mpa');
    expect(normalizeUnit('')).toBe('');
  });
});

describe('convertToBaseUnit（7 维统一换算，P1-5）', () => {
  it('长度：5mm 与 0.5cm 换算到同一基准（此前 cross 私有实现不支持长度）', () => {
    const a = convertToBaseUnit(5, 'mm');
    const b = convertToBaseUnit(0.5, 'cm');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.dimension).toBe(b!.dimension);
    expect(Math.abs(a!.value - b!.value)).toBeLessThan(1e-9); // 5mm = 0.005m = 0.5cm
  });

  it('压力：1MPa 与 1000kPa 同基准', () => {
    const a = convertToBaseUnit(1, 'MPa');
    const b = convertToBaseUnit(1000, 'kPa');
    expect(Math.abs(a!.value - b!.value)).toBeLessThan(1e-9);
  });

  it('温度：350℃ 与 623.15K 同基准（仿射换算）', () => {
    const a = convertToBaseUnit(350, '°c');
    const b = convertToBaseUnit(623.15, 'K');
    expect(Math.abs(a!.value - b!.value)).toBeLessThan(1e-9);
  });

  it('未知单位返回 null', () => {
    expect(convertToBaseUnit(5, 'm³')).toBeNull();
    expect(convertToBaseUnit(5, '')).toBeNull(); // 纯数值由调用方处理
  });
});

describe('withinTolerance（max 分母口径，P1-5）', () => {
  it('相等值 → true', () => {
    expect(withinTolerance(100, 100, 0.01)).toBe(true);
  });

  it('1% 边界：100 vs 99 按 max 口径不超差（|100-99|/100 = 1% ≤ 1%）', () => {
    expect(withinTolerance(100, 99, 0.01)).toBe(true);
  });

  it('1% 边界：50 vs 49.5 按 max 口径超差（0.5/50 = 1% = 边界内）', () => {
    expect(withinTolerance(50, 49.5, 0.01)).toBe(true);
  });

  it('0 与 0 → true；0 与 1 → false', () => {
    expect(withinTolerance(0, 0, 0.01)).toBe(true);
    expect(withinTolerance(0, 1, 0.01)).toBe(false);
  });
});

describe('formatNumber', () => {
  it('整数不带小数位，否则保留 3 位', () => {
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(0.005)).toBe('0.005');
    expect(formatNumber(1.23456)).toBe('1.235');
  });
});
