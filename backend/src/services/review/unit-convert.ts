/**
 * 共享单位换算模块（P1-5，整改报告 P1-5）
 *
 * 背景：此前 intra（7 维 UNIT_TABLE）与 cross（仅温度/压力 2 维 convertToBaseUnit）
 * 各维护一套单位换算——"5mm vs 0.5cm"在 intra 判定一致、在 cross 判定不一致；
 * 相对容差分母 intra 用 max、cross 用 avg，1% 边界值两服务判定相反。
 *
 * 本模块收敛为唯一实现（源自 intra 的 7 维完整版），intra/cross 统一复用；
 * 线性换算下比值判定（diff/denom）不受基准单位影响，temperature 仿射换算两边一致。
 */

/** 单位维度 */
export type UnitDimension = 'pressure' | 'temperature' | 'length' | 'mass' | 'time' | 'percent' | 'number';

/** 单位定义：toBase 换算到基准单位，fromBase 反向换算（用于生成"1MPa = 1000kPa"式说明） */
interface UnitDef {
  dimension: UnitDimension;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
  display: string;
}

/** 构造纯倍数换算单位（压力/长度/质量/时间/百分比） */
function multiplicativeUnit(factor: number, dimension: UnitDimension, display: string): UnitDef {
  return {
    dimension,
    display,
    toBase: v => v * factor,
    fromBase: v => v / factor,
  };
}

/**
 * 单位换算表（键为规范化单位）
 * 基准单位：压力 Pa、温度 ℃、长度 m、质量 kg、时间 s、百分比 %、纯数值 ''
 * 导出供 intra 的维度判定/换算说明（fromBase）复用
 */
export const UNIT_TABLE: Record<string, UnitDef> = {
  // 压力
  pa: multiplicativeUnit(1, 'pressure', 'Pa'),
  kpa: multiplicativeUnit(1e3, 'pressure', 'kPa'),
  mpa: multiplicativeUnit(1e6, 'pressure', 'MPa'),
  bar: multiplicativeUnit(1e5, 'pressure', 'bar'),
  atm: multiplicativeUnit(101325, 'pressure', 'atm'),
  // 温度（℃/℉/K 为仿射换算，不是纯倍数）
  '°c': { dimension: 'temperature', toBase: v => v, fromBase: v => v, display: '℃' },
  '°f': { dimension: 'temperature', toBase: v => ((v - 32) * 5) / 9, fromBase: v => (v * 9) / 5 + 32, display: '℉' },
  k: { dimension: 'temperature', toBase: v => v - 273.15, fromBase: v => v + 273.15, display: 'K' },
  // 长度
  mm: multiplicativeUnit(1e-3, 'length', 'mm'),
  cm: multiplicativeUnit(1e-2, 'length', 'cm'),
  m: multiplicativeUnit(1, 'length', 'm'),
  km: multiplicativeUnit(1e3, 'length', 'km'),
  // 质量
  g: multiplicativeUnit(1e-3, 'mass', 'g'),
  kg: multiplicativeUnit(1, 'mass', 'kg'),
  t: multiplicativeUnit(1e3, 'mass', 't'),
  // 时间
  s: multiplicativeUnit(1, 'time', 's'),
  min: multiplicativeUnit(60, 'time', 'min'),
  h: multiplicativeUnit(3600, 'time', 'h'),
  day: multiplicativeUnit(86400, 'time', 'day'),
  // 百分比
  '%': multiplicativeUnit(1, 'percent', '%'),
  '‰': multiplicativeUnit(0.1, 'percent', '‰'),
  // 纯数值（无单位）
  '': multiplicativeUnit(1, 'number', ''),
};

/** 中文单位别名 → 规范化单位（按序匹配，长别名在前） */
const UNIT_ALIASES: Array<[string, string]> = [
  ['兆帕', 'mpa'],
  ['千帕', 'kpa'],
  ['帕', 'pa'],
  ['摄氏度', '°c'],
  ['华氏度', '°f'],
  ['开尔文', 'k'],
  ['开', 'k'],
  ['度', '°c'],
  ['毫米', 'mm'],
  ['厘米', 'cm'],
  ['公里', 'km'],
  ['千米', 'km'],
  ['米', 'm'],
  ['千克', 'kg'],
  ['公斤', 'kg'],
  ['克', 'g'],
  ['吨', 't'],
  ['分钟', 'min'],
  ['分', 'min'],
  ['小时', 'h'],
  ['时', 'h'],
  ['天', 'day'],
  ['日', 'day'],
  ['秒', 's'],
];

/**
 * 规范化单位字符串：小写、去空格、统一符号与中文别名
 * 如 "MPa" → "mpa"、"℃" → "°c"、"兆帕" → "mpa"；无单位 → ""
 */
export function normalizeUnit(raw: string): string {
  let unit = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!unit) return '';
  unit = unit.replace(/℃/g, '°c').replace(/℉/g, '°f');
  for (const [alias, canonical] of UNIT_ALIASES) {
    if (unit.includes(alias)) {
      return unit.replace(alias, canonical);
    }
  }
  return unit;
}

/**
 * 解析"数值+单位"，如 "17.5MPa" → { value: 17.5, unit: 'mpa' }、"350℃" → { value: 350, unit: '°c' }
 * 非数值开头（如 "DN100"）或无法解析 → null
 */
export function normalizeNumericValue(raw: string): { value: number; unit: string } | null {
  const match = raw.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  return { value, unit: normalizeUnit(match[2].trim()) };
}

/**
 * 将带单位的数值换算到基准单位（P1-5：统一入口，替代 cross 的 2 维私有实现）
 * @returns { value: 基准单位数值, dimension: 维度 }；未知单位/纯数值返回 null（纯数值用 '' 维度由调用方决定）
 */
export function convertToBaseUnit(value: number, unit: string): { value: number; dimension: UnitDimension } | null {
  const normalizedUnit = normalizeUnit(unit);
  const def = UNIT_TABLE[normalizedUnit];
  if (!def || def.dimension === 'number') return null;
  return { value: def.toBase(value), dimension: def.dimension };
}

/** 数值格式化：整数不带小数位，否则最多保留 3 位小数（用于生成换算说明） */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

/**
 * 相对容差判定（P1-5：分母统一为 max(|a|,|b|)——此前 cross 用 avg、intra 用 max，
 * 1% 边界值两服务判定相反；按 max 口径比 avg 更保守，避免误报）
 * @returns true 表示 |a-b| / max(|a|,|b|) ≤ tolerance（或 a==b==0）
 */
export function withinTolerance(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  const maxAbs = Math.max(Math.abs(a), Math.abs(b));
  if (maxAbs === 0) return true;
  return Math.abs(a - b) / maxAbs <= tolerance;
}
