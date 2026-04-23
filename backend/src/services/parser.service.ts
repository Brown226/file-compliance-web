import path from 'path';
import fs from 'fs';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import pdfParseLib from 'pdf-parse';
const pdfParse = (pdfParseLib as any).default || pdfParseLib;
import { PythonParserService, ParseResult } from './python-parser.service';

/**
 * 文件解析服务 - 根据文件类型提取文本内容
 * 优先调用 Python FastAPI 微服务（结构化解析），失败时 fallback 到 Node.js 解析
 * 支持: docx, xlsx, xls, pdf
 * DWG 文件已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理
 */
export class ParserService {
  // 存储最后一次 Python 解析的完整结果
  private static _lastParseResult: ParseResult | null = null;

  /** 清除字符串中的 null 字节和非法 UTF-8 控制字符，防止 PostgreSQL 报错 */
  private static sanitizeUtf8(str: string): string {
    if (!str) return str;
    return str.replace(/\x00/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  /**
   * 获取最后一次解析的结构化数据
   */
  static getLastParseResult(): ParseResult | null {
    return this._lastParseResult;
  }

  /**
   * 获取最后一次解析的 Markdown 内容
   * 优先返回 markitdown 生成的 Markdown，否则回退到纯文本
   */
  static getLastMarkdown(): string {
    if (this._lastParseResult?.markdown) {
      return this._lastParseResult.markdown;
    }
    // Fallback: 纯文本作为 Markdown
    return this._lastParseResult?.text || '';
  }

  /**
   * 解析文件，返回提取的文本内容（纯文本，用于规则引擎）
   * 优先使用 Python/MarkItDown 解析服务，失败时 fallback 到 Node.js 解析
   * 同时会缓存 Markdown 版本，可通过 getLastMarkdown() 获取
   */
  static async parseFile(filePath: string, fileType: string): Promise<string> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`);
    }

    // 尝试使用 Python 解析服务
    try {
      const result = await PythonParserService.parseFile(absolutePath, fileType);
      this._lastParseResult = result;
      return ParserService.sanitizeUtf8(result.text || '');
    } catch (error: any) {
      console.warn(`[Parser] Python 解析服务不可用，fallback 到 Node.js 解析: ${error.message}`);
      this._lastParseResult = null;
    }

    // Fallback: 使用 Node.js 解析
    let text: string;
    switch (fileType.toLowerCase()) {
      case 'docx':
      case 'doc':
        text = await this.parseDocx(absolutePath); break;
      case 'xlsx':
      case 'xls':
        text = await this.parseExcel(absolutePath); break;
      case 'pdf':
        text = await this.parsePdf(absolutePath); break;
      case 'pptx':
      case 'ppt':
        text = ''; break;  // PPT 由 MarkItDown 服务解析，Node.js 无 fallback
      case 'dwg':
      case 'dxf':
        // DWG 已改为前端 WASM 解析，后端不再处理，返回空文本
        // WASM 解析数据通过 review.service.ts 的 dwgMetadata 预填充到 PipelineContext
        text = ''; break;
      default:
        throw new Error(`不支持的文件类型: ${fileType}`);
    }
    return ParserService.sanitizeUtf8(text);
  }

  /**
   * 解析 DOCX 文件 - 使用 mammoth 提取纯文本 (Node.js fallback)
   */
  private static async parseDocx(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  /**
   * 解析 Excel 文件 - 提取所有工作表的单元格文本 (Node.js fallback)
   */
  private static async parseExcel(filePath: string): Promise<string> {
    const workbook = XLSX.readFile(filePath);
    const texts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1 });
      for (const row of rows) {
        if (Array.isArray(row)) {
          const cells = row
            .filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
            .map((cell) => String(cell).trim());
          if (cells.length > 0) {
            texts.push(cells.join(' | '));
          }
        }
      }
    }

    return texts.join('\n').trim();
  }

  /**
   * 解析 PDF 文件 - 使用 pdf-parse 提取文本 (Node.js fallback)
   */
  private static async parsePdf(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.trim();

    if (text.length < 20) {
      return '';
    }

    return text;
  }

  /**
   * 解析 PDF 文件 - 逐页提取文本
   * 优先使用 Python 解析结果的 pages 数据
   */
  static async parsePdfPages(filePath: string): Promise<string[]> {
    // 如果已有 Python 解析结果，直接使用
    if (this._lastParseResult?.pages?.length) {
      return this._lastParseResult.pages;
    }

    // Fallback: 使用 pdfjs-dist 逐页提取
    const buffer = fs.readFileSync(filePath);
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str || '')
          .join(' ');
        pages.push(pageText);
      }
      return pages;
    } catch (e) {
      console.warn('[Parser] pdfjs-dist 不可用，使用 pdf-parse 简化页面分割');
      const data = await pdfParse(buffer);
      return this.simpleSplitPages(data.text, data.numpages);
    }
  }

  /**
   * 简单页面分割 - 将全文按近似等长拆分
   */
  private static simpleSplitPages(fullText: string, numPages: number): string[] {
    if (numPages <= 1) return [fullText];

    const lines = fullText.split('\n');
    const linesPerPage = Math.ceil(lines.length / numPages);
    const pages: string[] = [];

    for (let i = 0; i < numPages; i++) {
      const pageLines = lines.slice(i * linesPerPage, (i + 1) * linesPerPage);
      pages.push(pageLines.join('\n'));
    }

    return pages;
  }

  /**
   * 检查文件是否需要 OCR 处理
   * DWG 文件已改为前端 WASM 解析，不需要 OCR
   */
  static needsOcr(extractedText: string, fileType: string): boolean {
    if (fileType.toLowerCase() === 'pdf' && extractedText.length < 20) {
      return true;
    }
    // DWG/DXF 不需要 OCR（前端 WASM 解析）
    if (['dwg', 'dxf'].includes(fileType.toLowerCase())) {
      return false;
    }
    return false;
  }
}
