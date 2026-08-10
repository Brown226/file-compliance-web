/**
 * DWG 图纸专用审查规则
 * 错误代码: DWG_TITLE_001 ~ DWG_OVERLAP_001
 *
 * 规则列表:
 *   1. DWG_TITLE_001 - 标题栏信息检查（图名/图号/比例是否完整）
 *   2. DWG_LAYER_001 - 图层命名规范检查（是否有 0/Defpoints 等默认图层残留）
 *   3. DWG_DIM_001   - 尺寸标注检查（是否有遗漏标注的图层）
 *   4. DWG_STDREF_001 - 标准规范引用检查（图纸是否引用了相关标准）
 *   5. DWG_SCALE_001  - 比例标注检查（是否标注了比例且格式合理）
 *   6. DWG_OVERLAP_001 - 图元重叠检查（同一图层大量图元可能重叠）
 *
 * config 参数说明:
 *   requiredTitleFields?: string[]   — 标题栏必须字段（默认 ['drawingName', 'drawingNo']）
 *   forbiddenLayers?: string[]       — 禁止出现的图层名（默认 ['0', 'Defpoints']）
 *   maxEntitiesPerLayer?: number     — 单图层最大图元数（超过可能重叠，默认 500）
 *   scalePattern?: string            — 比例格式正则（默认匹配 1:N 或 N:1 格式）
 *   dimensionTextMin?: number        — DWG_DIM 文本实体数下限（默认 2）
 *   dimensionOtherThreshold?: number — DWG_DIM "其他"图元数阈值（默认 10；other 为 WASM 推断数据，判定仅作提示）
 *   overlapOtherThreshold?: number   — DWG_OVERLAP "其他"图元数阈值（默认 500；超过时重叠判定降置信提示）
 *   stdRefPattern?: string           — DWG_STDREF 标准引用格式正则（默认匹配核电工标/国标前缀 + 序号 + 版本年份）
 */

import { RuleIssue, FileContext } from './types';

/** DWG 规则可用的解析数据 */
interface DwgParseData {
  metadata?: {
    dwg_layers?: string[];
    dwg_text_count?: number;
    dwg_dimension_count?: number;
    dwg_entity_count?: number;
    dwg_converted?: boolean;
    title_block?: {
      found: boolean;
      drawingName?: string | null;
      drawingNo?: string | null;
      designer?: string | null;
      checker?: string | null;
      approver?: string | null;
      scale?: string | null;
    };
    layer_stats?: Record<string, { text: number; dimension: number; other: number }>;
  };
  structure?: {
    dimensions?: Array<{
      text: string;
      layer: string;
      entityType: string;  // camelCase（与 WASM 前端输出一致）
      handle: string;
      measurement?: string | null;
    }>;
    standardRefs?: Array<{
      standardNo: string;
      standardName: string;
      standardIdent: string;
      fullMatch: string;
      cadHandleId?: string;
    }>;
  };
}

/** 从 FileContext 中提取 DWG 解析数据 */
function getDwgData(ctx: FileContext): DwgParseData | null {
  const parseResult = ctx.parseResult;
  if (!parseResult) return null;
  return {
    metadata: parseResult.metadata as any,
    structure: parseResult.structure as any,
  };
}

/**
 * DWG_TITLE_001: 标题栏信息检查
 * 检查图纸标题栏中图名、图号等关键信息是否完整
 */
function checkTitleBlock(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata) return issues;

  const titleBlock = dwg.metadata.title_block;
  if (!titleBlock) {
    // 无标题栏数据，检查文本中是否包含标题栏关键字
    const text = ctx.extractedText || '';
    const hasTitleKeywords = ['图名', '图号', '比例', '设计', '审核'].some(kw => text.includes(kw));
    if (!hasTitleKeywords) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_TITLE_001',
        severity: 'warning',
        originalText: '(标题栏)',
        description: '图纸中未检测到标题栏信息，建议检查标题栏是否完整。',
      });
    }
    return issues;
  }

  if (!titleBlock.found) {
    issues.push({
      issueType: 'VIOLATION',
      ruleCode: 'DWG_TITLE_001',
      severity: 'warning',
      originalText: '(标题栏)',
      description: '图纸中未检测到标题栏信息，建议检查标题栏是否完整。',
    });
    return issues;
  }

  // 检查必须字段
  const requiredFields: string[] = config?.requiredTitleFields || ['drawingName', 'drawingNo'];
  const fieldLabels: Record<string, string> = {
    drawingName: '图名',
    drawingNo: '图号',
    designer: '设计',
    checker: '校对',
    approver: '审核/批准',
    scale: '比例',
  };

  for (const field of requiredFields) {
    const value = titleBlock[field as keyof typeof titleBlock];
    if (!value) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_TITLE_001',
        severity: 'error',
        originalText: `(标题栏-${fieldLabels[field] || field})`,
        suggestedText: `请补充${fieldLabels[field] || field}`,
        description: `标题栏中缺少"${fieldLabels[field] || field}"信息，建议补充完整。`,
      });
    }
  }

  return issues;
}

/**
 * DWG_LAYER_001: 图层命名规范检查
 * 检查是否残留 0、Defpoints 等默认图层，或图层命名不规范
 */
function checkLayerNaming(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata?.dwg_layers) return issues;

  const layers = dwg.metadata.dwg_layers;
  const forbiddenLayers: string[] = config?.forbiddenLayers || ['0', 'Defpoints'];

  for (const forbidden of forbiddenLayers) {
    if (layers.includes(forbidden)) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_LAYER_001',
        severity: 'warning',
        originalText: `图层: ${forbidden}`,
        suggestedText: '建议重命名为有意义的图层名',
        description: `检测到默认图层"${forbidden}"，建议将图元移动到有业务含义的图层中。`,
      });
    }
  }

  // 检查图层名是否包含中文（企业规范可能要求）
  const hasChineseLayers = layers.some(l => /[\u4e00-\u9fff]/.test(l));
  const hasEnglishLayers = layers.some(l => /^[A-Za-z_]/.test(l) && !/[\u4e00-\u9fff]/.test(l));
  if (hasChineseLayers && hasEnglishLayers && layers.length > 3) {
    issues.push({
      issueType: 'VIOLATION',
      ruleCode: 'DWG_LAYER_001',
      severity: 'info',
      originalText: `(共 ${layers.length} 个图层)`,
      description: '图层命名中中英文混用，建议统一命名规范。',
    });
  }

  return issues;
}

/**
 * DWG_DIM_001: 尺寸标注检查
 * 检查是否有图层包含文本但没有尺寸标注（可能遗漏标注）
 *
 * P2-13 降置信说明：`layer_stats.other`（"其他"图元数）是前端 WASM 的推断数据——
 * 由总图元数扣除 text/dimension 后平均分摊到各图层（见 dwg-handler.service.ts:70-98），
 * 并非逐图层真实统计。因此本规则的阈值通过 config 可调，且命中时描述标注"需人工确认"。
 */
function checkDimensions(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata?.layer_stats) return issues;

  const layerStats = dwg.metadata.layer_stats;

  // 阈值可配置（默认与旧硬编码一致）
  const textMin: number = config?.dimensionTextMin ?? 2;
  const otherThreshold: number = config?.dimensionOtherThreshold ?? 10;

  // 检查有文本但无标注的图层（可能遗漏标注）
  for (const [layerName, stats] of Object.entries(layerStats)) {
    // 跳过标题栏相关图层和默认图层
    const skipPatterns = ['标题栏', 'TITLE', '图框', 'BORDER', '0', 'Defpoints'];
    if (skipPatterns.some(p => layerName.toUpperCase().includes(p.toUpperCase()))) {
      continue;
    }

    // 有文本且有其他图元，但无标注
    if (stats.text > textMin && stats.other > otherThreshold && stats.dimension === 0) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_DIM_001',
        severity: 'warning',
        originalText: `图层: ${layerName}`,
        description: `图层"${layerName}"包含 ${stats.text} 个文本实体和 ${stats.other} 个其他图元，但无尺寸标注，可能遗漏标注（"其他"图元为图层统计推断数据，需人工确认）。`,
      });
    }
  }

  // 检查标注文本为空的尺寸
  const dimensions = dwg.structure?.dimensions || [];
  const emptyDimCount = dimensions.filter(d => !d.text || d.text.trim() === '').length;
  if (emptyDimCount > 0) {
    issues.push({
      issueType: 'VIOLATION',
      ruleCode: 'DWG_DIM_001',
      severity: 'info',
      originalText: `(${emptyDimCount} 个空标注)`,
      description: `检测到 ${emptyDimCount} 个尺寸标注的文本为空，建议检查标注是否完整。`,
    });
  }

  return issues;
}

/**
 * DWG_STDREF_001: 标准规范引用检查
 * 检查图纸中是否引用了相关标准
 *
 * 字段语义推断（2026-08-07，暂无真实 DWG 数据现场验证，按代码现有结构）：
 * - standardRefs 由前端 WASM（dwg_standard_refs → dwg-handler.service.ts:149-155）或 Python parser
 *   （python-parser.service.ts:69-75）填充，结构为 { standardNo, standardName, standardIdent, fullMatch, cadHandleId? }。
 * - standardIdent 只是前缀标识符（如 "GB/T"，见 standard-extractor.service.ts:16 与 getIdent），
 *   完整编号在 standardNo（如 "GB/T 50010-2010"）。因此格式校验以 standardNo 为准，
 *   standardNo 为空时回退 fullMatch / standardIdent。
 *
 * P2-13 修复：原循环体为空注释（等于没做），且 refCount > 0 时无任何检查。
 * 现在 refCount > 0 时逐条校验引用格式（前缀 + 序号 + 版本年份），异常报 DWG_STDREF_001。
 */
function checkStandardRefs(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg) return issues;

  const standardRefs = dwg.structure?.standardRefs || [];
  const refCount = (dwg.metadata as any)?.standard_ref_count ?? standardRefs.length;

  // 图纸有内容但无标准引用（保留原有告警分支）
  const textCount = dwg.metadata?.dwg_text_count ?? 0;
  if (textCount > 5 && refCount === 0) {
    issues.push({
      issueType: 'VIOLATION',
      ruleCode: 'DWG_STDREF_001',
      severity: 'warning',
      originalText: '(标准引用)',
      description: '图纸中未检测到标准规范引用，建议检查是否需要引用相关设计标准。',
    });
  }

  // refCount > 0：逐条校验引用格式（核电工标/国标前缀 + 序号 + 版本年份）
  // config.stdRefPattern 可覆盖默认正则；默认覆盖 GB/T、DL/T、NB/T、EJ、JB/T 等常见前缀
  const stdRefPattern: RegExp = config?.stdRefPattern
    ? new RegExp(config.stdRefPattern)
    : /^(GB\/T|GB|DL\/T|DL|NB\/T|NB|EJ|EJ\/T|JB\/T|JB|HG\/T|HG|SH\/T|SH|SY\/T|SY|SL|JTG|CJJ|JGJ|JG|HAF|T\/CECS|CECS)\s*\d+(?:\.\d+)?\s*[-—－]\s*\d{2,4}\s*(?:\(.*\))?$/i;

  for (const ref of standardRefs) {
    const ident = (ref.standardNo || ref.fullMatch || ref.standardIdent || '').trim();
    if (!ident) continue;
    if (!stdRefPattern.test(ident)) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_STDREF_001',
        severity: 'warning',
        originalText: ident,
        suggestedText: '示例: GB/T 50010-2010',
        description: `标准引用"${ident}"格式异常：应包含标准前缀（如 GB/T、DL/T、NB/T、EJ 等）及版本号/年份。`,
      });
    }
  }

  return issues;
}

/**
 * DWG_SCALE_001: 比例标注检查
 * 检查图纸比例是否标注且格式合理
 */
function checkScale(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata) return issues;

  const titleBlock = dwg.metadata.title_block;

  // 比例格式正则
  const scalePattern: RegExp = config?.scalePattern
    ? new RegExp(config.scalePattern)
    : /1\s*[:：]\s*\d+|\d+\s*[:：]\s*1/i;

  if (!titleBlock || !titleBlock.scale) {
    // 检查文本中是否有比例信息
    const text = ctx.extractedText || '';
    const scaleMatch = text.match(scalePattern);
    if (!scaleMatch) {
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_SCALE_001',
        severity: 'warning',
        originalText: '(比例)',
        description: '图纸中未检测到比例标注，建议在标题栏中标注图纸比例。',
      });
    }
    return issues;
  }

  // 检查比例格式是否合理
  const scaleValue = titleBlock.scale;
  if (!scalePattern.test(scaleValue)) {
    issues.push({
      issueType: 'VIOLATION',
      ruleCode: 'DWG_SCALE_001',
      severity: 'info',
      originalText: scaleValue,
      suggestedText: '1:100 或 1:50 等标准比例格式',
      description: `比例标注"${scaleValue}"格式非标准，建议使用 1:N 格式。`,
    });
  }

  return issues;
}

/**
 * DWG_OVERLAP_001: 图元重叠检查
 * 检查是否有图层包含大量图元（可能存在重叠）
 *
 * P2-13 降置信说明：totalEntities 包含 `layer_stats.other`（前端 WASM 推断数据，
 * 总图元数扣除 text/dimension 后平均分摊，见 dwg-handler.service.ts:70-98）。
 * 当 other 超过 config.overlapOtherThreshold 时，重叠判定依赖推断数据，描述追加"需人工确认"。
 */
function checkOverlap(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata?.layer_stats) return issues;

  const maxEntitiesPerLayer: number = config?.maxEntitiesPerLayer ?? 500;
  const overlapOtherThreshold: number = config?.overlapOtherThreshold ?? 500;

  for (const [layerName, stats] of Object.entries(dwg.metadata.layer_stats)) {
    const totalEntities = stats.text + stats.dimension + stats.other;
    if (totalEntities > maxEntitiesPerLayer) {
      // 其他图元占比高 → 判定依据为推断数据，降置信
      const otherInferred = stats.other > overlapOtherThreshold;
      issues.push({
        issueType: 'VIOLATION',
        ruleCode: 'DWG_OVERLAP_001',
        severity: 'warning',
        originalText: `图层: ${layerName} (${totalEntities} 个图元)`,
        description: `图层"${layerName}"包含 ${totalEntities} 个图元（超过阈值 ${maxEntitiesPerLayer}），可能存在图元重叠，建议检查。` +
          (otherInferred ? `（其中"其他"图元 ${stats.other} 个为图层统计推断数据，需人工确认）` : ''),
      });
    }
  }

  return issues;
}

/** 规则前缀 → 对应检查函数的映射 */
const DWG_RULE_FNS: Record<string, (ctx: FileContext, config?: any) => RuleIssue[]> = {
  DWG_TITLE: checkTitleBlock,
  DWG_LAYER: checkLayerNaming,
  DWG_DIM: checkDimensions,
  DWG_STDREF: checkStandardRefs,
  DWG_SCALE: checkScale,
  DWG_OVERLAP: checkOverlap,
};

/**
 * DWG 规则分发入口（工厂函数）
 * 根据调用时的前缀只执行对应规则，避免重复执行
 * 用法: checkDwgRules('DWG_TITLE') 返回 (ctx, config) => RuleIssue[]
 */
export function checkDwgRules(prefix: string): (ctx: FileContext, config?: any) => RuleIssue[] {
  const fn = DWG_RULE_FNS[prefix];
  if (fn) return fn;
  // 兜底：如果未匹配到前缀，执行所有规则
  return function checkAllDwgRules(ctx: FileContext, config?: any): RuleIssue[] {
    if (ctx.fileType.toLowerCase() !== 'dwg' && ctx.fileType.toLowerCase() !== 'dxf') return [];
    return [
      ...checkTitleBlock(ctx, config),
      ...checkLayerNaming(ctx, config),
      ...checkDimensions(ctx, config),
      ...checkStandardRefs(ctx, config),
      ...checkScale(ctx, config),
      ...checkOverlap(ctx, config),
    ];
  };
}

// 导出各子规则供单独使用
export { checkTitleBlock, checkLayerNaming, checkDimensions, checkStandardRefs, checkScale, checkOverlap };
