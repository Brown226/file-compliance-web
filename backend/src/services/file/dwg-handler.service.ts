/**
 * DWG 图纸处理服务
 *
 * 统一处理所有 DWG 相关的预处理逻辑，消除 review.service 与 pipeline 间的重复。
 *
 * 职责：
 * 1. 将前端 WASM 解析数据预填充到 PipelineContext（供 Pipeline 跳过重复解析）
 * 2. 构建 DWG 元数据用于持久化（合并 WASM 和 Python Parser 两条路径）
 */

import { PipelineContext } from '../review-pipeline/types';

/** DWG WASM 元数据的类型定义 */
export interface DwgWasmMetadata {
  dwg_wasm_parsed?: boolean;
  dwg_text_entities?: Array<{
    text: string;
    layer: string;
    handle: string;
    entityType?: 'TEXT' | 'MTEXT';
    insert?: [number, number];
  }>;
  dwg_dimensions?: Array<{
    text?: string;
    layer?: string;
    handle?: string;
    measurement?: number;
    raw?: string;
  }>;
  dwg_layers?: string[];
  dwg_text_count?: number;
  dwg_dimension_count?: number;
  dwg_entity_count?: number;
  dwg_converted?: boolean;
  dwg_standard_refs?: Array<{
    standardNo?: string;
    standardName?: string;
    standardIdent?: string;
    fullMatch?: string;
    cadHandleId?: string;
  }>;
}

/** DWG 元数据（持久化到 TaskFile.dwgMetadata） */
export interface DwgPersistMetadata {
  dwg_layers?: string[];
  dwg_text_count?: number;
  dwg_dimension_count?: number;
  dwg_entity_count?: number;
  dwg_converted?: boolean;
  title_block?: Record<string, unknown>;
  layer_stats?: Record<string, { text: number; dimension: number; other: number }>;
}

export class DwgHandlerService {
  /**
   * 使用前端 WASM 数据预填充 PipelineContext
   * 如果后端 Parser 已有数据，跳过（WASM 不再覆盖）
   */
  static populateContextFromWasm(ctx: PipelineContext, dwgMeta: DwgWasmMetadata | undefined, wasmText: string): boolean {
    if (ctx.fileType.toLowerCase() !== 'dwg') return false;
    if (!dwgMeta?.dwg_wasm_parsed) return false;
    if (!wasmText || wasmText.length === 0) return false;
    // 如果后端 Parser 已经填充了数据，保留后端结果
    if (ctx.extractedText && ctx.extractedText.trim().length > 0 && ctx.parseResult) return false;

    // 用前端 WASM 提取的文本预填充
    ctx.extractedText = wasmText;

    // 从 WASM 数据动态计算 layer_stats（解锁 DWG_DIM_001 / DWG_OVERLAP_001 规则）
    const textEntities: any[] = dwgMeta.dwg_text_entities || [];
    const dimEntities: any[] = dwgMeta.dwg_dimensions || [];
    const allLayers: string[] = dwgMeta.dwg_layers || [];
    const totalEntityCount: number = dwgMeta.dwg_entity_count || 0;
    const layerStatsMap: Record<string, { text: number; dimension: number; other: number }> = {};

    for (const layer of allLayers) {
      layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
    }
    for (const e of textEntities) {
      const layer = e.layer || '0';
      if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
      layerStatsMap[layer].text++;
    }
    for (const d of dimEntities) {
      const layer = d.layer || '0';
      if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
      layerStatsMap[layer].dimension++;
    }

    const countedEntities = textEntities.length + dimEntities.length;
    const otherTotal = Math.max(0, totalEntityCount - countedEntities);
    if (allLayers.length > 0 && otherTotal > 0) {
      const otherPerLayer = Math.ceil(otherTotal / allLayers.length);
      for (const layer of allLayers) {
        layerStatsMap[layer].other = otherPerLayer;
      }
    }

    // 从文本实体中提取标题栏信息（解锁 DWG_TITLE_001 / DWG_SCALE_001）
    let titleBlock: any = undefined;
    const titleKeywords = ['图名', '图号', '比例', '设计', '审核', '校对', '批准'];
    const titleRelatedEntities = textEntities.filter((e: any) =>
      titleKeywords.some((kw: string) => e.text?.includes(kw))
    );
    if (titleRelatedEntities.length > 0) {
      titleBlock = { found: true };
      for (const e of titleRelatedEntities) {
        const t = e.text || '';
        if (t.includes('图名')) titleBlock.drawingName = t.replace(/图名[：:]\s*/, '').trim() || null;
        if (t.includes('图号')) titleBlock.drawingNo = t.replace(/图号[：:]\s*/, '').trim() || null;
        if (t.includes('设计')) titleBlock.designer = t.replace(/设计[：:]\s*/, '').trim() || null;
        if (t.includes('校对')) titleBlock.checker = t.replace(/校对[：:]\s*/, '').trim() || null;
        if (t.includes('审核') || t.includes('批准')) titleBlock.approver = t.replace(/[审核批准][：:]\s*/, '').trim() || null;
        if (t.includes('比例')) {
          const scaleMatch = t.match(/1\s*[:：]\s*\d+|\d+\s*[:：]\s*1/i);
          titleBlock.scale = scaleMatch ? scaleMatch[0] : t.replace(/比例[：:]\s*/, '').trim() || null;
        }
      }
    }

    // 构建 parseResult 供 Pipeline 消费
    ctx.parseResult = {
      text: ctx.extractedText,
      pages: [],
      metadata: {
        page_count: 0,
        has_tables: false,
        has_images: false,
        dwg_layers: allLayers,
        dwg_text_count: dwgMeta.dwg_text_count || 0,
        dwg_dimension_count: dwgMeta.dwg_dimension_count || 0,
        dwg_entity_count: totalEntityCount,
        dwg_converted: dwgMeta.dwg_converted ?? true,
        layer_stats: layerStatsMap,
        title_block: titleBlock,
      } as any,
      structure: {
        paragraphs: textEntities.map((e: any) => ({
          text: e.text,
          style: e.layer,
          page: null as number | null,
          handle: e.handle,
          entityType: e.entityType, // 传递 entityType 以正确区分 TEXT/MTEXT
        })),
        tables: [],
        headers: [],
        dimensions: dimEntities,
        standardRefs: (dwgMeta.dwg_standard_refs || []).map((ref) => ({
          standardNo: ref.standardNo || '',
          standardName: ref.standardName || '',
          standardIdent: ref.standardIdent || '',
          fullMatch: ref.fullMatch || ref.standardNo || '',
          cadHandleId: ref.cadHandleId,
        })),
      },
      markdown: ctx.extractedText,
    };

    console.log(`[DWG] WASM 数据预填充: ${wasmText.length}字符, 标注${dwgMeta.dwg_dimension_count || 0}个, 图层${Object.keys(layerStatsMap).length}层${titleBlock ? ', 标题栏已识别' : ''}`);
    return true;
  }

  /**
   * 从 PipelineContext 提取 DWG 持久化元数据
   * 合并 WASM 和 Python Parser 两条路径的结果
   */
  static extractPersistMetadata(ctx: PipelineContext): DwgPersistMetadata | undefined {
    if (ctx.fileType.toLowerCase() !== 'dwg') return undefined;
    const metadata = ctx.parseResult?.metadata;
    if (!metadata) return undefined;

    return {
      dwg_layers: (metadata as any).dwg_layers,
      dwg_text_count: (metadata as any).dwg_text_count,
      dwg_dimension_count: (metadata as any).dwg_dimension_count,
      dwg_entity_count: (metadata as any).dwg_entity_count,
      dwg_converted: (metadata as any).dwg_converted,
      title_block: (metadata as any).title_block,
      layer_stats: (metadata as any).layer_stats,
    };
  }
}
