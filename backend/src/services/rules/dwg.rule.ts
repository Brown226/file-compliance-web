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
        issueType: 'DWG',
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
      issueType: 'DWG',
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
        issueType: 'DWG',
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
        issueType: 'DWG',
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
      issueType: 'DWG',
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
 */
function checkDimensions(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata?.layer_stats) return issues;

  const layerStats = dwg.metadata.layer_stats;

  // 检查有文本但无标注的图层（可能遗漏标注）
  for (const [layerName, stats] of Object.entries(layerStats)) {
    // 跳过标题栏相关图层和默认图层
    const skipPatterns = ['标题栏', 'TITLE', '图框', 'BORDER', '0', 'Defpoints'];
    if (skipPatterns.some(p => layerName.toUpperCase().includes(p.toUpperCase()))) {
      continue;
    }

    // 有文本且有其他图元，但无标注
    if (stats.text > 2 && stats.other > 10 && stats.dimension === 0) {
      issues.push({
        issueType: 'DWG',
        ruleCode: 'DWG_DIM_001',
        severity: 'warning',
        originalText: `图层: ${layerName}`,
        description: `图层"${layerName}"包含 ${stats.text} 个文本实体和 ${stats.other} 个其他图元，但无尺寸标注，可能遗漏标注。`,
      });
    }
  }

  // 检查标注文本为空的尺寸
  const dimensions = dwg.structure?.dimensions || [];
  const emptyDimCount = dimensions.filter(d => !d.text || d.text.trim() === '').length;
  if (emptyDimCount > 0) {
    issues.push({
      issueType: 'DWG',
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
 */
function checkStandardRefs(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg) return issues;

  const standardRefs = dwg.structure?.standardRefs || [];
  const refCount = (dwg.metadata as any)?.standard_ref_count ?? standardRefs.length;

  // 如果图纸有内容但无标准引用
  const textCount = dwg.metadata?.dwg_text_count ?? 0;
  if (textCount > 5 && refCount === 0) {
    issues.push({
      issueType: 'DWG',
      ruleCode: 'DWG_STDREF_001',
      severity: 'warning',
      originalText: '(标准引用)',
      description: '图纸中未检测到标准规范引用，建议检查是否需要引用相关设计标准。',
    });
  }

  // 检查已废止标准（需要配合标准库检查，此处仅做基本提示）
  for (const ref of standardRefs) {
    // 这里可以做更精确的标准库匹配检查
    // 目前仅检查引用格式是否规范
    const ident = ref.standardIdent || '';
    if (ident && !ident.includes('/')) {
      // 可能是强制性国标（GB），无 /T 后缀，需特别关注
      // 但不一定是问题，所以仅记录为 info
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
        issueType: 'DWG',
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
      issueType: 'DWG',
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
 */
function checkOverlap(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const dwg = getDwgData(ctx);
  if (!dwg?.metadata?.layer_stats) return issues;

  const maxEntitiesPerLayer: number = config?.maxEntitiesPerLayer ?? 500;

  for (const [layerName, stats] of Object.entries(dwg.metadata.layer_stats)) {
    const totalEntities = stats.text + stats.dimension + stats.other;
    if (totalEntities > maxEntitiesPerLayer) {
      issues.push({
        issueType: 'DWG',
        ruleCode: 'DWG_OVERLAP_001',
        severity: 'warning',
        originalText: `图层: ${layerName} (${totalEntities} 个图元)`,
        description: `图层"${layerName}"包含 ${totalEntities} 个图元（超过阈值 ${maxEntitiesPerLayer}），可能存在图元重叠，建议检查。`,
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
