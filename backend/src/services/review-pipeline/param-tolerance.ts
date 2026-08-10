/**
 * 参数容差工具（CONSISTENCY 容差口径统一）
 *
 * intra-file 与 cross-file 一致性检查共用同一套"按单位容差"解析，
 * 避免两处各自实现导致口径漂移（intra 曾恒 1% 而 cross 支持 byUnit 配置）。
 * 配置来源单一：mode-config.service.ts 的 ParamToleranceConfig（DB 可覆盖）。
 */
import type { ParamToleranceConfig } from './mode-config.service';

/**
 * 按单位解析容差：优先匹配 byUnit（单位规范化后比较），未匹配则返回 default。
 * @param unit 参数单位（如 'MPa'、'℃'、''）
 * @param paramTolerance 容差配置（缺省时返回 0.01 与历史默认一致）
 */
export function getToleranceForUnit(unit: string, paramTolerance?: ParamToleranceConfig): number {
  const defaultTol = paramTolerance?.default ?? 0.01;
  if (!paramTolerance?.byUnit) return defaultTol;
  const normalizedUnit = normalizeUnitKey(unit);
  for (const [key, value] of Object.entries(paramTolerance.byUnit)) {
    if (normalizeUnitKey(key) === normalizedUnit) {
      return value;
    }
  }
  return defaultTol;
}

/**
 * 规范化单位字符串，用于 byUnit 配置键匹配
 * 统一为小写、去空格、合并同义单位（℃→°c、度→°c、兆帕→mpa 等）
 */
export function normalizeUnitKey(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/℃/g, '°c')
    .replace(/℉/g, '°f')
    .replace(/度/g, '°c')
    .replace(/兆帕/g, 'mpa')
    .replace(/千帕/g, 'kpa')
    .replace(/帕/g, 'pa');
}
