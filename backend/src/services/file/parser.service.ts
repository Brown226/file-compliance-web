import path from 'path';
import fs from 'fs';
import { PythonParserService, ParseResult } from './python-parser.service';

/**
 * 文件解析服务 - 通过 Python 解析微服务提取文本内容
 * Python 微服务为唯一解析入口，不再提供 Node.js 回退
 * 支持: docx, xlsx, xls, pdf, pptx, ppt
 * DWG 文件已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理
 */
export class ParserService {
  private static _lastParseResult: ParseResult | null = null;

  /** 清除字符串中的 null 字节和非法 UTF-8 控制字符，防止 PostgreSQL 报错 */
  static sanitizeUtf8(str: string): string {
    if (!str) return str;
    return str.replace(/\x00/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  /** @deprecated 使用 parseFileWithResult 获取完整结果，避免并发场景下的静态状态污染 */
  static getLastParseResult(): ParseResult | null {
    return this._lastParseResult;
  }

  /** @deprecated 使用 parseFileWithResult 获取完整结果 */
  static getLastMarkdown(): string {
    if (this._lastParseResult?.markdown) {
      return this._lastParseResult.markdown;
    }
    return this._lastParseResult?.text || '';
  }

  /**
   * 解析文件，返回提取的文本内容
   * 纯文本格式 (txt, md, csv, json, xml, html) 直接读取
   * 其他格式通过 Python 解析微服务解析
   */
  static async parseFile(filePath: string, fileType: string): Promise<string> {
    const { text } = await this.parseFileWithResult(filePath, fileType);
    return text;
  }

  /**
   * 解析文件，返回文本内容和完整解析结果（并发安全）
   * 推荐使用此方法替代 parseFile + getLastParseResult 的组合
   */
  static async parseFileWithResult(filePath: string, fileType: string): Promise<{ text: string; result: ParseResult | null }> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`);
    }

    // DWG/DXF 由前端 WASM 解析，后端返回空
    if (['dwg', 'dxf'].includes(fileType.toLowerCase())) {
      this._lastParseResult = null;
      return { text: '', result: null };
    }

    // 纯文本格式直接读取，无需调用解析服务
    const textFormats = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'log', 'ini', 'yaml', 'yml'];
    if (textFormats.includes(fileType.toLowerCase())) {
      const text = await fs.promises.readFile(absolutePath, 'utf-8');
      const result: ParseResult = {
        text,
        markdown: text,
        pages: [],
        metadata: { has_tables: false, has_images: false },
        structure: { paragraphs: [], tables: [] },
      };
      this._lastParseResult = result;
      return { text: ParserService.sanitizeUtf8(text), result };
    }

    const result = await PythonParserService.parseFile(absolutePath, fileType);
    this._lastParseResult = result;
    return { text: ParserService.sanitizeUtf8(result.text || ''), result };
  }

  /**
   * 解析 PDF 文件 - 逐页文本提取（并发安全版本）
   */
  static async parsePdfPagesWithResult(filePath: string): Promise<{ pages: string[]; result: ParseResult | null }> {
    const result = await PythonParserService.parseFile(path.resolve(filePath), 'pdf');
    this._lastParseResult = result;
    return { pages: result.pages || [], result };
  }

  /**
   * 解析 PDF 文件 - 逐页提取文本
   */
  static async parsePdfPages(filePath: string): Promise<string[]> {
    const { pages } = await this.parsePdfPagesWithResult(filePath);
    return pages;
  }

  /**
   * 检查文件是否需要 OCR 处理
   * 对 PDF/图片类型（扫描件）如果提取文本为空或极少则触发 OCR
   */
  static needsOcr(extractedText: string, fileType: string): boolean {
    const normalized = fileType.toLowerCase();
    // PDF 或图片类型：文本过少时触发 OCR
    const imageTypes = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];
    if (imageTypes.includes(normalized) && extractedText.length < 200) {
      return true;
    }
    // DWG/DXF 不走 OCR
    if (['dwg', 'dxf'].includes(normalized)) {
      return false;
    }
    return false;
  }
}
