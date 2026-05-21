/**
 * 文本提取服务
 * 从 BasePipeline 中提取的公共文本解析/OCR/结构化方法，供各 Pipeline 复用
 */

import { PipelineContext } from './types';
import { ParserService } from '../parser.service';
import { OcrService } from '../ocr.service';
import { FileTypeService } from '../file-type.service';

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
      if (!text || text.trim().length === 0) {
        console.warn(`[Pipeline] 文件解析返回空文本: ${ctx.fileName}, fileType=${ctx.fileType}`);
      }
      ctx.parseResult = ParserService.getLastParseResult();
    } catch (e) {
      console.warn(`[Pipeline] 文件解析失败: ${ctx.fileName}, fileType=${ctx.fileType}, error=${(e as Error).message || e}`);
    }

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

  static async extractPdfPages(ctx: PipelineContext): Promise<string[] | undefined> {
    const normalizedFileType = FileTypeService.normalizeFileType(ctx.fileType);
    if (normalizedFileType !== 'pdf') return undefined;
    try {
      return await ParserService.parsePdfPages(ctx.filePath);
    } catch (e) {
      console.warn(`[Pipeline] PDF逐页提取失败: ${ctx.fileName}`, e);
      return undefined;
    }
  }

  static async ensureWordStructure(ctx: PipelineContext): Promise<void> {
    const normalizedFileType = FileTypeService.normalizeFileType(ctx.fileType);
    if (normalizedFileType !== 'docx') return;

    try {
      const { WordStructureService } = await import('../word-structure.service');
      const structure = await WordStructureService.extractStructure(ctx.filePath, ctx.parseResult);
      ctx.wordStructure = structure;

      if (structure.headers.length > 0 && !ctx.pdfPages) {
        ctx.pdfPages = TextExtractionService.simulatePagesFromWord(structure);
      }
    } catch (e) {
      console.warn('[Pipeline] Word 结构提取失败:', e);
    }
  }

  static ensureDwgStructure(ctx: PipelineContext): void {
    if (!FileTypeService.isCadFile(ctx.fileType)) return;
    if (!ctx.parseResult?.structure && !ctx.parseResult?.metadata) return;

    const metadata = ctx.parseResult.metadata as any;
    const structure = ctx.parseResult.structure as any;

    const layers: string[] = metadata?.dwg_layers || [];
    const textEntities = (structure?.paragraphs || []).map((p: any) => ({
      text: p.text || '',
      layer: (p.style || '').replace('图层:', ''),
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

    if (!ctx.pdfPages && textEntities.length > 0) {
      ctx.pdfPages = TextExtractionService.simulatePagesFromDwg(ctx.dwgStructure);
    }
  }

  private static simulatePagesFromWord(structure: NonNullable<PipelineContext['wordStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 50;

    for (let i = 0; i < structure.paragraphs.length; i += PAGE_SIZE) {
      const pageParagraphs = structure.paragraphs.slice(i, i + PAGE_SIZE);
      const headerText = structure.headers.map(h => h.text).join('\n');
      const pageText = pageParagraphs.map(p => p.text).join('\n');
      pages.push(headerText ? `[页眉] ${headerText}\n\n${pageText}` : pageText);
    }

    return pages.length > 0 ? pages : [structure.paragraphs.map(p => p.text).join('\n')];
  }

  private static simulatePagesFromDwg(dwg: NonNullable<PipelineContext['dwgStructure']>): string[] {
    const pages: string[] = [];
    const PAGE_SIZE = 30;

    const layerOverview = `[图层概览] ${dwg.layers.length} 个图层: ${dwg.layers.slice(0, 10).join(', ')}${dwg.layers.length > 10 ? '...' : ''}`;
    pages.push(layerOverview);

    for (let i = 0; i < dwg.textEntities.length; i += PAGE_SIZE) {
      const pageEntities = dwg.textEntities.slice(i, i + PAGE_SIZE);
      const pageText = pageEntities.map(e => `[${e.layer}] ${e.text}`).join('\n');
      pages.push(pageText);
    }

    return pages.length > 0 ? pages : [dwg.textEntities.map(e => e.text).join('\n')];
  }
}