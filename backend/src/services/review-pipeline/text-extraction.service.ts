/**
 * 文本提取服务
 * 从 BasePipeline 中提取的公共文本解析/OCR/结构化方法，供各 Pipeline 复用
 */

import { PipelineContext } from './types';
import { ParserService } from '../parser.service';
import { OcrService } from '../ocr.service';
import { FileTypeService } from '../file-type.service';

/** 图片类型列表（Python 解析服务不支持，需直接走 OCR） */
const IMAGE_FILE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff']);

export class TextExtractionService {
  /**
   * 统一文件文本提取入口 (供所有模块复用)
   * 包含：图片→OCR、PDF空→OCR、docx/xlsx→Python解析器
   * 这是代码库中唯一的文件解析入口，不要直接调 ParserService.parseFile()
   */
  static async extractFileText(filePath: string, fileType: string, fileName?: string): Promise<string> {
    const ctx: Partial<PipelineContext> = {
      filePath,
      fileType,
      fileName: fileName || '',
      extractedText: '',
    };
    return this.ensureText(ctx as PipelineContext);
  }

  /**
   * 确保文本已提取
   * 如果 ctx.extractedText 已有内容则跳过
   * 对图片类型直接尝试 OCR（跳过 Python 解析服务）
   */
  static async ensureText(ctx: PipelineContext): Promise<string> {
    if (ctx.extractedText && ctx.extractedText.trim().length > 0) {
      return ctx.extractedText;
    }

    const normalizedType = FileTypeService.normalizeFileType(ctx.fileType, ctx.fileName).toLowerCase();

    // 图片类型：直接走 OCR，跳过 Python 解析服务
    if (IMAGE_FILE_TYPES.has(normalizedType)) {
      return TextExtractionService.ocrForFile(ctx);
    }

    let text = '';
    try {
      const parsed = await ParserService.parseFileWithResult(ctx.filePath, ctx.fileType);
      text = parsed.text;
      if (!text || text.trim().length === 0) {
        console.warn(`[Pipeline] 文件解析返回空文本: ${ctx.fileName}, fileType=${ctx.fileType}`);
      }
      ctx.parseResult = parsed.result;
    } catch (e) {
      console.warn(`[Pipeline] 文件解析失败: ${ctx.fileName}, fileType=${ctx.fileType}, error=${(e as Error).message || e}`);
    }

    // PDF 文本过少时 OCR 降级
    if (ParserService.needsOcr(text, ctx.fileType) && OcrService.isOcrSupported(ctx.fileType)) {
      return TextExtractionService.ocrForFile(ctx);
    }

    return text;
  }

  /**
   * 对文件执行 OCR 识别
   */
  private static async ocrForFile(ctx: PipelineContext): Promise<string> {
    try {
      const ocrText = await OcrService.recognizeFile(ctx.filePath, ctx.fileType);
      if (ocrText) {
        console.log(`[Pipeline] OCR 识别成功: ${ctx.fileName}, ${ocrText.length} 字符`);
        return ocrText;
      }
    } catch (e) {
      console.warn(`[Pipeline] OCR 处理失败: ${ctx.fileName}`, e);
    }
    return '';
  }

  static async extractPdfPages(ctx: PipelineContext): Promise<string[] | undefined> {
    const normalizedFileType = FileTypeService.normalizeFileType(ctx.fileType);
    if (normalizedFileType !== 'pdf') return undefined;
    try {
      const { pages, result } = await ParserService.parsePdfPagesWithResult(ctx.filePath);
      // 同步更新 ctx.parseResult，确保并发安全
      if (result) ctx.parseResult = result;
      return pages;
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