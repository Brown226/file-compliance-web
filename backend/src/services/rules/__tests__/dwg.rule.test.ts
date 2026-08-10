/**
 * DWG 图纸审查规则测试 (DWG_TITLE / DWG_LAYER / DWG_DIM / DWG_STDREF / DWG_SCALE / DWG_OVERLAP)
 * 测试文件: dwg.rule.ts → checkDwgRules / checkTitleBlock / checkLayerNaming / checkDimensions / checkStandardRefs / checkScale / checkOverlap
 */
import { describe, it, expect } from 'vitest';
import {
  checkDwgRules, checkTitleBlock, checkLayerNaming,
  checkDimensions, checkStandardRefs, checkScale, checkOverlap
} from '../dwg.rule';
import { FileContext } from '../types';

/** 创建带 DWG parseResult 的 FileContext */
function dwgCtx(overrides: Partial<{
  metadata: any;
  structure: any;
  extractedText: string;
  fileName: string;
}> = {}): FileContext {
  return {
    fileName: overrides.fileName || 'FJ24A00AC-JPS02-001(A).dwg',
    filePath: '/test/test.dwg',
    fileType: 'dwg',
    extractedText: overrides.extractedText || '',
    parseResult: {
      metadata: overrides.metadata || {},
      structure: overrides.structure || {},
    } as any,
  };
}

describe('DWG Rules', () => {

  /* ===== DWG_TITLE 正例 ===== */

  it('DWG_TITLE_001: should detect missing title block', () => {
    const issues = checkDwgRules('DWG_TITLE')(dwgCtx({ metadata: {}, extractedText: '普通文本' }));
    expect(issues.some(i => i.ruleCode === 'DWG_TITLE_001')).toBe(true);
  });

  it('DWG_TITLE_001: should detect missing required field in title block', () => {
    const issues = checkDwgRules('DWG_TITLE')(dwgCtx({
      metadata: {
        title_block: { found: true, drawingName: '平面图', drawingNo: null },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_TITLE_001')).toBe(true);
  });

  it('DWG_TITLE_001: should detect when title_block.found is false', () => {
    const issues = checkDwgRules('DWG_TITLE')(dwgCtx({
      metadata: {
        title_block: { found: false },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_TITLE_001')).toBe(true);
  });

  /* ===== DWG_LAYER 正例 ===== */

  it('DWG_LAYER_001: should detect forbidden layers (0 and Defpoints)', () => {
    const issues = checkDwgRules('DWG_LAYER')(dwgCtx({
      metadata: {
        dwg_layers: ['0', 'WALLS', 'Defpoints'],
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_LAYER_001')).toBe(true);
    const layerTexts = issues.map(i => i.originalText);
    expect(layerTexts.some(t => t.includes('0'))).toBe(true);
    expect(layerTexts.some(t => t.includes('Defpoints'))).toBe(true);
  });

  it('DWG_LAYER_001: should detect mixed Chinese/English layer naming', () => {
    const issues = checkDwgRules('DWG_LAYER')(dwgCtx({
      metadata: {
        dwg_layers: ['墙-WALL', 'DOOR', '窗户', 'FURNITURE', '设备-EQUIP'],
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_LAYER_001')).toBe(true);
  });

  /* ===== DWG_DIM 正例 ===== */

  it('DWG_DIM_001: should detect layer with text but no dimensions', () => {
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: {
          'WALLS': { text: 5, dimension: 0, other: 20 },
          'DOORS': { text: 2, dimension: 1, other: 5 },
        },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_DIM_001')).toBe(true);
  });

  it('DWG_DIM_001: should detect empty dimension texts', () => {
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: { 'WALLS': { text: 2, dimension: 0, other: 5 } },
      },
      structure: {
        dimensions: [
          { text: '', layer: 'WALLS', entityType: 'DIMENSION', handle: '1A2B' },
          { text: '', layer: 'WALLS', entityType: 'DIMENSION', handle: '3C4D' },
        ],
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_DIM_001')).toBe(true);
  });

  /* ===== DWG_STDREF 正例 ===== */

  it('DWG_STDREF_001: should detect missing standard refs when text count > 5', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: {
        dwg_text_count: 10,
        standard_ref_count: 0,
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_STDREF_001')).toBe(true);
  });

  /* ===== DWG_SCALE 正例 ===== */

  it('DWG_SCALE_001: should detect missing scale in title block', () => {
    const issues = checkDwgRules('DWG_SCALE')(dwgCtx({
      metadata: {
        title_block: { found: true, drawingName: '平面图', drawingNo: '001', scale: null },
      },
      extractedText: '普通文本',
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_SCALE_001')).toBe(true);
  });

  it('DWG_SCALE_001: should detect non-standard scale format', () => {
    const issues = checkDwgRules('DWG_SCALE')(dwgCtx({
      metadata: {
        title_block: { found: true, drawingName: '平面图', drawingNo: '001', scale: 'A4' },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_SCALE_001')).toBe(true);
  });

  /* ===== DWG_OVERLAP 正例 ===== */

  it('DWG_OVERLAP_001: should detect layer with too many entities', () => {
    const issues = checkDwgRules('DWG_OVERLAP')(dwgCtx({
      metadata: {
        layer_stats: {
          'PIPES': { text: 100, dimension: 50, other: 400 },
        },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_OVERLAP_001')).toBe(true);
  });

  /* ===== 反例 ===== */

  it('DWG_TITLE: should pass when title block is complete', () => {
    const issues = checkDwgRules('DWG_TITLE')(dwgCtx({
      metadata: {
        title_block: {
          found: true,
          drawingName: '一层平面图',
          drawingNo: 'ARC-001',
          designer: '张三',
          checker: '李四',
          approver: '王五',
          scale: '1:100',
        },
      },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_LAYER: should pass when no forbidden layers', () => {
    const issues = checkDwgRules('DWG_LAYER')(dwgCtx({
      metadata: {
        dwg_layers: ['WALLS', 'DOORS', 'FURNITURE', 'TEXT'],
      },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_LAYER: should pass when no layers data', () => {
    const issues = checkDwgRules('DWG_LAYER')(dwgCtx({ metadata: {} }));
    expect(issues.length).toBe(0);
  });

  it('DWG_DIM: should pass when layers have dimensions', () => {
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: {
          'WALLS': { text: 3, dimension: 5, other: 20 },
          'DOORS': { text: 1, dimension: 2, other: 8 },
        },
      },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_SCALE: should pass when scale has valid format', () => {
    const issues = checkDwgRules('DWG_SCALE')(dwgCtx({
      metadata: {
        title_block: { found: true, drawingName: '平面图', drawingNo: '001', scale: '1:100' },
      },
    }));
    expect(issues.some(i => i.ruleCode === 'DWG_SCALE_001')).toBe(false);
  });

  it('DWG_STDREF: should pass when text count <= 5', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 3 },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_OVERLAP: should pass when all layers within entity limit', () => {
    const issues = checkDwgRules('DWG_OVERLAP')(dwgCtx({
      metadata: {
        layer_stats: {
          'WALLS': { text: 10, dimension: 5, other: 50 },
          'DOORS': { text: 5, dimension: 2, other: 20 },
        },
      },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_OVERLAP: should pass when no layer_stats', () => {
    const issues = checkDwgRules('DWG_OVERLAP')(dwgCtx({ metadata: {} }));
    expect(issues.length).toBe(0);
  });

  /* ===== DWG_STDREF 格式校验（P2-13） ===== */

  it('DWG_STDREF_001: should detect standard ref without prefix', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 10 },
      structure: {
        standardRefs: [
          { standardNo: '50010-2010', standardName: '', standardIdent: '', fullMatch: '50010-2010' },
        ],
      },
    }));
    const issue = issues.find(i => i.ruleCode === 'DWG_STDREF_001');
    expect(issue).toBeTruthy();
    expect(issue!.originalText).toBe('50010-2010');
    expect(issue!.severity).toBe('warning');
  });

  it('DWG_STDREF_001: should detect standard ref without version year', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 10 },
      structure: {
        standardRefs: [
          { standardNo: 'GB/T 50010', standardName: '', standardIdent: 'GB/T', fullMatch: 'GB/T 50010' },
        ],
      },
    }));
    const issue = issues.find(i => i.ruleCode === 'DWG_STDREF_001');
    expect(issue).toBeTruthy();
    expect(issue!.originalText).toBe('GB/T 50010');
  });

  it('DWG_STDREF: should pass when all standard refs have valid format', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 10 },
      structure: {
        standardRefs: [
          { standardNo: 'GB/T 50010-2010', standardName: '混凝土结构设计规范', standardIdent: 'GB/T', fullMatch: 'GB/T 50010-2010' },
          { standardNo: 'DL/T 5210-2018', standardName: '', standardIdent: 'DL/T', fullMatch: 'DL/T 5210-2018' },
          { standardNo: 'EJ 1097-2016', standardName: '', standardIdent: 'EJ', fullMatch: 'EJ 1097-2016' },
        ],
      },
    }));
    expect(issues.length).toBe(0);
  });

  it('DWG_STDREF: refCount > 0 should not trigger "missing refs" warning', () => {
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 10, standard_ref_count: 1 },
      structure: {
        standardRefs: [
          { standardNo: 'NB/T 20292-2014', standardName: '', standardIdent: 'NB/T', fullMatch: 'NB/T 20292-2014' },
        ],
      },
    }));
    expect(issues.some(i => i.description.includes('未检测到标准规范引用'))).toBe(false);
  });

  it('DWG_STDREF: malformed refs should not prevent the missing-ref branch (both checked)', () => {
    // 有引用且引用格式异常 → 只报格式异常，不报"无引用"
    const issues = checkDwgRules('DWG_STDREF')(dwgCtx({
      metadata: { dwg_text_count: 10 },
      structure: {
        standardRefs: [
          { standardNo: 'GB/T 50010', standardName: '', standardIdent: 'GB/T', fullMatch: 'GB/T 50010' },
        ],
      },
    }));
    expect(issues.length).toBe(1);
    expect(issues[0].description).toContain('格式异常');
  });

  /* ===== DWG_DIM 阈值 config 覆盖（P2-13） ===== */

  it('DWG_DIM_001: dimensionOtherThreshold config should suppress default hit', () => {
    // 默认 other>10 会命中；配置抬高到 100 后不再命中
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: { 'WALLS': { text: 5, dimension: 0, other: 20 } },
      },
    }), { dimensionOtherThreshold: 100 });
    expect(issues.some(i => i.ruleCode === 'DWG_DIM_001')).toBe(false);
  });

  it('DWG_DIM_001: dimensionTextMin config should suppress default hit', () => {
    // 默认 text>2 会命中；抬高到 10 后不再命中
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: { 'WALLS': { text: 5, dimension: 0, other: 20 } },
      },
    }), { dimensionTextMin: 10 });
    expect(issues.some(i => i.ruleCode === 'DWG_DIM_001')).toBe(false);
  });

  it('DWG_DIM_001: description should note inference (需人工确认) on other-based hit', () => {
    const issues = checkDwgRules('DWG_DIM')(dwgCtx({
      metadata: {
        layer_stats: { 'WALLS': { text: 5, dimension: 0, other: 20 } },
      },
    }));
    const issue = issues.find(i => i.ruleCode === 'DWG_DIM_001');
    expect(issue).toBeTruthy();
    expect(issue!.description).toContain('需人工确认');
  });

  /* ===== DWG_OVERLAP other 推断提醒（P2-13） ===== */

  it('DWG_OVERLAP_001: should append inference note when other exceeds overlapOtherThreshold', () => {
    const issues = checkDwgRules('DWG_OVERLAP')(dwgCtx({
      metadata: {
        layer_stats: { 'PIPES': { text: 100, dimension: 50, other: 600 } },
      },
    }), { overlapOtherThreshold: 500 });
    expect(issues.some(i => i.ruleCode === 'DWG_OVERLAP_001')).toBe(true);
    const issue = issues.find(i => i.ruleCode === 'DWG_OVERLAP_001');
    expect(issue!.description).toContain('需人工确认');
  });

  it('DWG_OVERLAP_001: no inference note when other below threshold', () => {
    const issues = checkDwgRules('DWG_OVERLAP')(dwgCtx({
      metadata: {
        layer_stats: { 'PIPES': { text: 400, dimension: 50, other: 100 } },
      },
    }), { overlapOtherThreshold: 500 });
    expect(issues.some(i => i.ruleCode === 'DWG_OVERLAP_001')).toBe(true);
    const issue = issues.find(i => i.ruleCode === 'DWG_OVERLAP_001');
    expect(issue!.description).not.toContain('需人工确认');
  });

});
