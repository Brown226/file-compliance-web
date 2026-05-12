/**
 * 文本提取服务
 * 从 BasePipeline 中提取的公共文本解析/OCR/结构化方法，供各 Pipeline 复用
 */

import { PipelineContext } from './types';
import { ParserService } from '../parser.service';
import { OcrService } from '../ocr.service';

export class TextExtractionService {
  /**
   * 确保文本已提取
   * 如果 ctx.extractedText 已有内容则跳过
   */
  static async ensureText(ctx: PipelineContext): Promise<string> {
    if (ctx.extractedText && ctx.extractedText.trim().length > 0) {
      return ctx.extractedText;
    }

    let text = '';
    try {
      text = await ParserService.parseFile(ctx.filePath, ctx.fileType);
      // 将 Python 解析结果写入 ctx
      ctx.parseResult = ParserService.getLastParseResult();
    } catch (e) {
      console.warn(`[Pipeline] 文件解析失败: ${ctx.fileName}`, e);
    }

    // OCR 降级
    if (ParserService.needsOcr(text, ctx.fileType) && OcrService.isOcrSupported(ctx.fileType)) {
      try {
        const ocrText = await OcrService.recognizeFile(ctx.filePath, ctx.fileType);
        if (ocrText) text = ocrText;
      } catch (e) {
        console.warn(`[Pipeline] OCR 处理失败: ${ctx.fileName}`, e);
      }
    }

    return text;
  }

  /**
   * PDF 逐页文本提取
   */
  static async extractPdfPages(ctx: PipelineContext): Promise<string[] | undefined> {
    if (ctx.fileType.toLowerCase() !== 'pdf') return undefined;
    try {
      return await ParserService.parsePdfPages(ctx.filePath);
    } catch (e) {
      console.warn(`[Pipeline] PDF逐页提取失败: ${ctx.fileName}`, e);
      return undefined;
    }
  }

  /**
   * Word 文档结构化提取
   * 为 Word 文件提取页眉信息，模拟 pdfPages 格式供规则引擎使用
   */
  static async ensureWordStructure(ctx: PipelineContext): Promise<void> {
    if (!['docx', 'doc'].includes(ctx.fileType.toLowerCase())) return;

    try {
      const { WordStructureService } = await import('../word-structure.service');
      const structure = await WordStructureService.extractStructure(ctx.filePath, ctx.parseResult);
      ctx.wordStructure = structure;

      // 如果有页眉数据且当前没有 pdfPages，模拟 pdfPages 格式供规则引擎使用
      if (structure.headers.length > 0 && !ctx.pdfPages) {
        ctx.pdfPages = TextExtractionService.simulatePagesFromWord(structure);
      }
    } catch (e) {
      console.warn('[Pipeline] Word 结构提取失败:', e);
    }
  }

  /**
   * DWG 图纸结构化提取
   * 为 DWG 文件提取图层/文本/尺寸标注/标准引用数据，模拟 pdfPages 格式供规则引擎使用
   */
  static ensureDwgStructure(ctx: PipelineContext): void {
    if (ctx.fileType.toLowerCase() !== 'dwg' && ctx.fileType.toLowerCase() !== 'dxf') return;
    if (!ctx.parseResult?.structure && !ctx.parseResult?.metadata) return;

    const metadata = ctx.parseResult.metadata as any;
    const structure = ctx.parseResult.structure as any;

    // 构建 DwgStructure
    const layers: string[] = metadata?.dwg_layers || [];
    const textEntities = (structure?.paragraphs || []).map((p: any) => ({
      text: p.text || '',
      layer: (p.style || '').replace('图层:', ''),
      // 优先使用 paragraphs 中传入的 entityType（WASM 预填充路径已包含），
      //   回退到 'TEXT' 默认值（兼容旧版 Python 解析路径）
      entityType: (p.entityType || 'TEXT') as 'TEXT' | 'MTEXT',
      handle: p.handle || '',
      insert: p.insert as [number, number] | undefined,
    }));
    const dimensions = structure?.dimensions || [];
    const standardRefs = (structure?.standardRefs || []).map((r: any) => ({
      standardNo: r.standardNo || '',
      standardName: r.standardName || '',
      standardIdent: r.standardIdent || '',
      cadHandleId: r.cadHandleId || '',
    }));

    ctx.dwgStructure = { layers, textEntities, dimensions, standardRefs };

    // 模拟 pdfPages 供规则引擎使用（HEADER/PAGE 类规则需要 pdfPages 存在才能触发）
    if (!ctx.pdfPages && textEntities.length > 0) {
      ctx.pdfPages = TextExtractionService.simulatePagesFromDwg(ctx.dwgStructure);
    }
  }

  /**
   * 将 Word 结构化数据模拟为 PDF pages 格式
   * 使 HEADER/PAGE 规则可以正常触发
   */
  private static simulatePagesFromWord(structure: NonNullable<PipelineContext['wordStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 50; // 每 50 段模拟一页

    for (let i = 0; i < structure.paragraphs.length; i += PAGE_SIZE) {
      const pageParagraphs = structure.paragraphs.slice(i, i + PAGE_SIZE);
      const headerText = structure.headers.map(h => h.text).join('\n');
      const pageText = pageParagraphs.map(p => p.text).join('\n');
      pages.push(headerText ? `[页眉] ${headerText}\n\n${pageText}` : pageText);
    }

    return pages.length > 0 ? pages : [structure.paragraphs.map(p => p.text).join('\n')];
  }

  /**
   * 将 DWG 结构化数据模拟为 PDF pages 格式
   * 使 HEADER/PAGE 规则可以正常触发
   */
  private static simulatePagesFromDwg(dwg: NonNullable<PipelineContext['dwgStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 30; // 每 30 个文本实体模拟一页

    // 第一页：图层概览
    const layerOverview = `[图层概览] ${dwg.layers.length} 个图层: ${dwg.layers.slice(0, 10).join(', ')}${dwg.layers.length > 10 ? '...' : ''}`;
    pages.push(layerOverview);

    // 后续页：文本实体
    for (let i = 0; i < dwg.textEntities.length; i += PAGE_SIZE) {
      const pageEntities = dwg.textEntities.slice(i, i + PAGE_SIZE);
      const pageText = pageEntities.map(e => `[${e.layer}] ${e.text}`).join('\n');
      pages.push(pageText);
    }

    return pages.length > 0 ? pages : [dwg.textEntities.map(e => e.text).join('\n')];
  }
}
