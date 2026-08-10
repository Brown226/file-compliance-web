/**
 * 文件内一致性检查服务
 * 检测单个文件内部的参数值、语义描述前后不一致问题
 *
 * 检查维度：
 * 1. 数值一致性：同一参数在不同位置出现时值是否一致
 * 2. 引用一致性：引用的条款号、标准号是否前后一致
 * 3. 术语一致性：同一概念是否使用了统一的术语
 *
 * 规则代码: INTRA_CONSIST_001（文件内参数值不一致）
 *
 * Task 10: 新增从 markdown 表格中抽取键值对，与正则抽取的参数合并后参与一致性比对。
 */

import prisma from '../../config/db';
import { getToleranceForUnit } from '../review-pipeline/param-tolerance';
import type { ParamToleranceConfig } from '../review-pipeline/mode-config.service';

/** 参数抽取结果 */
interface ParamEntry {
  paramName: string;
  value: string;
  lineNumber: number;
  context: string;  // 参数出现的上下文（前后各30字）
}

/** 不一致项 */
interface Inconsistency {
  paramName: string;
  entries: Array<{
    value: string;
    lineNumber: number;
    context: string;
    /** 该条 entry 在原文中的字符区间 [start, end)（UTF-16 偏移，基于 lineNumber+行内定位，尽力而为，算不准为 undefined） */
    position?: { start: number; end: number };
  }>;
  /** 不一致的首个定位点（取 entries[0].position，尽力而为，算不准为 undefined） */
  position?: { start: number; end: number };
  /** 数值不一致的补充描述（如"单位不同且数值不等（1MPa = 1000kPa）"），缺省时由调用方使用默认文案 */
  description?: string;
}

/**
 * Task 10: 从 markdown 文本中抽取表格键值对（参数名=值）。
 * 仅处理 markdown 表格语法 `| key | value |`，二列表格第一列为键、第二列为值；
 * 多列表格第一列为键、其余列用空格拼接为值。
 *
 * 与 doc-parser 侧的 _parse_markdown_table_kv_pairs 等价，用于在不修改对外接口签名的前提下
 * 让一致性服务能消费表格中的参数（extractedText 已包含 markdown 表格语法）。
 */
function extractTableKvPairsFromMarkdown(text: string): Array<{ key: string; value: string; line: number }> {
  if (!text) return [];
  const pairs: Array<{ key: string; value: string; line: number }> = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.indexOf('|', 1) === -1) {
      i++;
      continue;
    }
    const startLine = i + 1;
    const tableLines: string[] = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      tableLines.push(lines[i].trim());
      i++;
    }
    if (tableLines.length < 2) continue;

    const parseRow = (rowLine: string): string[] => {
      let inner = rowLine.trim();
      if (inner.startsWith('|')) inner = inner.slice(1);
      if (inner.endsWith('|')) inner = inner.slice(0, -1);
      return inner.split('|').map(c => c.trim());
    };

    const rows = tableLines.map(parseRow);
    // 跳过分隔符行（|---|---|）
    if (rows.length >= 2 && rows[1].every(c => /^:?-{2,}:?$/.test(c || ''))) {
      rows.splice(1, 1);
    }

    for (const row of rows) {
      if (!row || row.length < 2) continue;
      const key = (row[0] || '').trim();
      if (!key) continue;
      const value = row.length === 2
        ? (row[1] || '').trim()
        : row.slice(1).map(c => (c || '').trim()).filter(Boolean).join(' ');
      if (!value) continue;
      pairs.push({ key, value, line: startLine });
    }
  }
  return pairs;
}

/** 单位维度 */
type UnitDimension = 'pressure' | 'temperature' | 'length' | 'mass' | 'time' | 'percent' | 'number';

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
 */
const UNIT_TABLE: Record<string, UnitDef> = {
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
function normalizeUnit(raw: string): string {
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

/** 数值格式化：整数不带小数位，否则最多保留 3 位小数（用于生成换算说明） */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

export class IntraFileConsistencyService {
  /**
   * 执行文件内一致性检查
   * @param taskId 任务 ID
   * @param fileId 文件 ID
   * @param fileName 文件名
   * @param extractedText 已提取的文本
   */
  static async check(
    taskId: string,
    fileId: string,
    fileName: string,
    extractedText: string,
    paramTolerance?: ParamToleranceConfig,
  ): Promise<number> {
    if (!extractedText || extractedText.trim().length < 100) {
      console.log(`[IntraConsist] ${fileName}: 文本过短，跳过检查`);
      return 0;
    }

    console.log(`[IntraConsist] ${fileName}: 开始文件内一致性检查 (${extractedText.length} 字符)`);

    // 1. 按段落/章节分割文本
    const sections = this.splitIntoSections(extractedText);
    if (sections.length < 2) {
      console.log(`[IntraConsist] ${fileName}: 段落数不足2，跳过`);
      return 0;
    }

    // 2. 从各段落抽取参数
    const allParams = this.extractParametersFromSections(sections);

    // Task 10: 从 markdown 表格中抽取键值对，合并到参数列表
    const tableKvPairs = extractTableKvPairsFromMarkdown(extractedText);
    for (const kv of tableKvPairs) {
      allParams.push({
        paramName: kv.key,
        value: kv.value,
        lineNumber: kv.line,
        context: `| ${kv.key} | ${kv.value} |`,
      });
    }
    if (tableKvPairs.length > 0) {
      console.log(`[IntraConsist] ${fileName}: 表格 KV 抽取到 ${tableKvPairs.length} 对`);
    }

    if (allParams.length === 0) {
      console.log(`[IntraConsist] ${fileName}: 未抽取到参数`);
      return 0;
    }

    // 3. 检测不一致
    const inconsistencies = this.findInconsistencies(allParams, { extractedText, paramTolerance });
    if (inconsistencies.length === 0) {
      console.log(`[IntraConsist] ${fileName}: 未发现文件内不一致`);
      return 0;
    }

    console.log(`[IntraConsist] ${fileName}: 发现 ${inconsistencies.length} 个文件内不一致`);

    // 4. 写入 task_details
    const issues = inconsistencies.map(inc => {
      const values = inc.entries.map(e => `"${e.value}" (行${e.lineNumber})`).join(' vs ');
      const context = inc.entries[0].context;
      return {
        taskId,
        fileId,
        issueType: 'CONSISTENCY',
        severity: 'warning' as const,
        ruleCode: 'INTRA_CONSIST_001',
        reviewSource: 'RULE_ENGINE' as const,
        originalText: context,
        suggestedText: `参数"${inc.paramName}"存在多个不同值: ${values}，请核实并统一`,
        description: inc.description || `文件内"${inc.paramName}"在不同位置出现了不一致的值`,
        // P2-10: 落库 locateMeta（position 为 UTF-16 半开区间 [start,end)，对 extractedText 切片用；
        // 与 review.service.ts buildLegacyTextPosition 的 locateMeta.absolute.start 结构兼容）
        locateMeta: inc.position
          ? { absolute: { start: inc.position.start, end: inc.position.end } }
          : undefined,
      };
    });

    if (issues.length > 0) {
      await prisma.taskDetail.createMany({ data: issues });
    }

    return issues.length;
  }

  /**
   * 将文本按段落/章节分割
   */
  private static splitIntoSections(text: string): Array<{ index: number; text: string; startLine: number }> {
    const sections: Array<{ index: number; text: string; startLine: number }> = [];

    // 按换行符分割为段落，合并过短的段落
    const lines = text.split('\n');
    let currentSection = '';
    let sectionStartLine = 1;
    let sectionIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 空行或章节标题作为分隔
      const isSectionBreak = line === '' || /^[一二三四五六七八九十]+[、.．]/.test(line) || /^第[一二三四五六七八九十百千\d]+[章节条款]/.test(line) || /^\d+[.．、]\d*/.test(line);

      if (isSectionBreak && currentSection.trim().length > 50) {
        sections.push({
          index: sectionIndex++,
          text: currentSection.trim(),
          startLine: sectionStartLine,
        });
        currentSection = '';
        sectionStartLine = i + 2; // 1-indexed
      } else {
        currentSection += (currentSection ? '\n' : '') + lines[i];
      }
    }

    // 最后一个段落
    if (currentSection.trim().length > 50) {
      sections.push({
        index: sectionIndex,
        text: currentSection.trim(),
        startLine: sectionStartLine,
      });
    }

    return sections;
  }

  /**
   * 从各段落抽取参数（键值对形式）
   * 匹配模式：
   * - "参数名：值" 或 "参数名: 值"
   * - "参数名为XXX" 或 "参数名是XXX"
   * - "参数名 值"（表格行格式，用制表符或多空格分隔）
   */
  private static extractParametersFromSections(
    sections: Array<{ index: number; text: string; startLine: number }>,
  ): ParamEntry[] {
    const params: ParamEntry[] = [];

    // 参数名模式：中文词、英文词、带数字的编号
    const paramNamePattern = '[\\u4e00-\\u9fa5a-zA-Z][\\u4e00-\\u9fa5a-zA-Z0-9_/（）()]{1,20}';

    for (const section of sections) {
      const lines = section.text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 模式1: "参数名：值" 或 "参数名: 值" 或 "参数名＝值"
        const kvMatch = line.match(new RegExp(`^(${paramNamePattern})[：:=＝]\\s*(.+)$`));
        if (kvMatch) {
          const paramName = kvMatch[1].trim();
          const value = kvMatch[2].trim();
          if (value.length > 0 && value.length < 100) {
            const contextStart = Math.max(0, line.length - 30);
            params.push({
              paramName,
              value,
              lineNumber: section.startLine + i,
              context: line.substring(contextStart, contextStart + 60),
            });
          }
          continue;
        }

        // 模式2: "参数名为/是/等于 XXX"
        const namedMatch = line.match(new RegExp(`(${paramNamePattern})(?:为|是|等于|取值为?|值为?)\\s*([\\d.]+\\s*[℃%°mMkKgGtTLl秒分小时天月年]?|[^，。,.]{1,30})`));
        if (namedMatch) {
          const paramName = namedMatch[1].trim();
          const value = namedMatch[2].trim();
          if (value.length > 0 && value.length < 50) {
            params.push({
              paramName,
              value,
              lineNumber: section.startLine + i,
              context: line.substring(0, 60),
            });
          }
        }
      }
    }

    return params;
  }

  /**
   * 检测同一参数名的多个不同值
   * @param opts.extractedText 原文（用于计算字符级定位，可缺省）
   * @param opts.tolerance 数值相对容差，默认 0.01（1%），|a-b|/max(|a|,|b|) ≤ tol 视为一致
   */
  private static findInconsistencies(
    params: ParamEntry[],
    opts?: { extractedText?: string; tolerance?: number; paramTolerance?: ParamToleranceConfig },
  ): Inconsistency[] {
    // 按参数名分组
    const grouped = new Map<string, ParamEntry[]>();
    for (const p of params) {
      const key = p.paramName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    const tolerance = opts?.tolerance ?? 0.01;
    const extractedText = opts?.extractedText;
    const lineOffsets = extractedText ? IntraFileConsistencyService.buildLineOffsets(extractedText) : undefined;

    const inconsistencies: Inconsistency[] = [];

    for (const [paramName, entries] of grouped) {
      if (entries.length < 2) continue;

      // 去重后看有多少种不同的值
      const uniqueValues = new Set(entries.map(e => e.value.trim()));
      if (uniqueValues.size <= 1) continue;

      // 数值类型的特殊处理：解析单位并换算到基准单位后按相对容差比对
      const numericValues: Array<{ original: string; value: number; unit: string }> = [];
      let allNumeric = true;
      for (const v of uniqueValues) {
        const parsed = normalizeNumericValue(v);
        if (!parsed) {
          allNumeric = false;
          break;
        }
        numericValues.push({ original: v, value: parsed.value, unit: parsed.unit });
      }

      let description: string | undefined;
      if (allNumeric) {
        const evalResult = IntraFileConsistencyService.evaluateNumericGroup(numericValues, tolerance, opts?.paramTolerance);
        if (evalResult.consistent) continue; // 数值相同或在容差内 → 视为一致（跳过）
        description = evalResult.description;
      }

      inconsistencies.push({
        paramName,
        entries: entries.map(e => ({
          value: e.value,
          lineNumber: e.lineNumber,
          context: e.context,
          position: lineOffsets
            ? IntraFileConsistencyService.computePosition(extractedText!, lineOffsets, e.lineNumber, e.value)
            : undefined,
        })),
        position: lineOffsets
          ? IntraFileConsistencyService.computePosition(extractedText!, lineOffsets, entries[0].lineNumber, entries[0].value)
          : undefined,
        description,
      });
    }

    return inconsistencies;
  }

  /**
   * 数值组判定：两两按相对容差比对，全部在容差内 → { consistent: true }；
   * 否则 → { consistent: false, description: 单位说明 }（单位说明可能为 undefined，走默认文案）
   */
  private static evaluateNumericGroup(
    values: Array<{ original: string; value: number; unit: string }>,
    tolerance: number,
    paramTolerance?: ParamToleranceConfig,
  ): { consistent: boolean; description?: string } {
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const a = values[i];
        const b = values[j];
        if (IntraFileConsistencyService.compareNumericPair(a, b, tolerance, paramTolerance) === 'equal') continue;
        return { consistent: false, description: IntraFileConsistencyService.buildUnitMismatchDescription(a, b) };
      }
    }
    return { consistent: true };
  }

  /**
   * 数值对比较：换算到基准单位后按相对容差判定相等（|a-b|/max(|a|,|b|) ≤ tol）
   * - 单位维度不同（如 m vs kg）→ 不可换算 → 判不一致
   * - 无单位（''）与任意单位兼容，直接比基准值
   * - 单位未知（如 m³）→ 退回比较原始数值
   */
  private static compareNumericPair(
    a: { value: number; unit: string },
    b: { value: number; unit: string },
    tolerance: number,
    paramTolerance?: ParamToleranceConfig,
  ): 'equal' | 'different' {
    // CONSISTENCY 容差口径统一：配置了 paramTolerance（DB 可覆盖，含 byUnit）时按单位取容差，
    // 与跨文件检查共用 getToleranceForUnit，不再恒用 1%。
    const effectiveTol = paramTolerance ? getToleranceForUnit(a.unit, paramTolerance) : tolerance;
    const aDef = UNIT_TABLE[a.unit];
    const bDef = UNIT_TABLE[b.unit];
    const aBase = aDef ? aDef.toBase(a.value) : null;
    const bBase = bDef ? bDef.toBase(b.value) : null;

    // 两侧单位均可换算 → 换算到基准单位后比对
    if (aBase !== null && bBase !== null) {
      // 明确的不同维度（两侧均非纯数值）→ 不可换算 → 判不一致（如 5m vs 5kg）
      if (aDef!.dimension !== 'number' && bDef!.dimension !== 'number' && aDef!.dimension !== bDef!.dimension) {
        return 'different';
      }
      return IntraFileConsistencyService.withinTolerance(aBase, bBase, effectiveTol) ? 'equal' : 'different';
    }

    // 至少一侧单位未知 → 退回原始数值比较
    return IntraFileConsistencyService.withinTolerance(a.value, b.value, effectiveTol) ? 'equal' : 'different';
  }

  /** 相对容差判定：|a-b| / max(|a|,|b|) ≤ tolerance */
  private static withinTolerance(a: number, b: number, tolerance: number): boolean {
    if (a === b) return true;
    const maxAbs = Math.max(Math.abs(a), Math.abs(b));
    if (maxAbs === 0) return false;
    return Math.abs(a - b) / maxAbs <= tolerance;
  }

  /**
   * 生成"单位不同且数值不等"描述：如 1MPa vs 1kPa → "单位不同且数值不等（1MPa = 1000kPa）"
   * 仅当两侧单位均已知、不同且属同一维度时生成；否则返回 undefined（走默认文案）
   */
  private static buildUnitMismatchDescription(
    a: { original: string; value: number; unit: string },
    b: { original: string; value: number; unit: string },
  ): string | undefined {
    if (!a.unit || !b.unit || a.unit === b.unit) return undefined;
    const aDef = UNIT_TABLE[a.unit];
    const bDef = UNIT_TABLE[b.unit];
    if (!aDef || !bDef || aDef.dimension !== bDef.dimension) return undefined;
    // 把 a 的基准值换算回 b 的单位，示例：1MPa → 1000kPa
    const aInBUnit = bDef.fromBase(aDef.toBase(a.value));
    return `单位不同且数值不等（${a.original} = ${formatNumber(aInBUnit)}${bDef.display}）`;
  }

  /** 计算各行在原文中的起始字符偏移（1-indexed 行号 → 偏移数组） */
  private static buildLineOffsets(text: string): number[] {
    const offsets: number[] = [];
    let pos = 0;
    for (const line of text.split('\n')) {
      offsets.push(pos);
      pos += line.length + 1;
    }
    return offsets;
  }

  /**
   * 基于 1-indexed 行号 + 行内值定位计算字符区间 [start, end)
   * 行号越界、行内找不到值 → 返回 undefined（尽力而为）
   */
  private static computePosition(
    text: string,
    lineOffsets: number[],
    lineNumber: number,
    value: string,
  ): { start: number; end: number } | undefined {
    if (lineNumber < 1 || lineNumber > lineOffsets.length) return undefined;
    const lineStart = lineOffsets[lineNumber - 1];
    const lineEnd = lineNumber < lineOffsets.length ? lineOffsets[lineNumber] - 1 : text.length;
    const line = text.slice(lineStart, lineEnd);
    const idx = line.indexOf(value);
    if (idx === -1) return undefined;
    return { start: lineStart + idx, end: lineStart + idx + value.length };
  }
}
