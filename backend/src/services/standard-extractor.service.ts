/**
 * 标准引用提取服务 - 从文档文本中提取标准规范引用
 * 移植自旧系统 Normative DocHandleBase.GetDocStandards + NormativeHelper.GetIdent
 */

// 核心正则：匹配《标准名称》标准编号 格式（1:1 移植旧系统）
const STANDARD_REF_PATTERN = /《.*?》\s*[\(（]?\s*([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)）])?/gi;

// 仅编号正则：匹配不含书名号的标准编号（Excel类型专用）
// 限定常见标准前缀，避免误匹配 DN/PN/Cr/Ni 等非标准编号
const CODE_ONLY_PATTERN = /[\(（]?(GB|GB\/T|NB|NB\/T|HJ|DL|DL\/T|CECS|HAF|EJ|EJ\/T|JGJ|CJJ|JG|HG|SH|SY|YY|QB|SL|TB|JT|YB|DB|DBJ|QX|GBJ|TJ|BJG|GYJ)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)）])?/gi;

export interface ExtractedStandard {
  standardNo: string;      // 标准编号，如 "GB/T 50001-2017"
  standardName: string;    // 标准名称（Excel类型为空字符串）
  standardIdent: string;   // 标识符，如 "GB"、"GB/T"、"NB/T"
  fullMatch: string;       // 原始匹配文本
}

export class StandardExtractorService {
  /**
   * OCR 字符纠正 - 修复 OCR 识别中常见的混淆字符
   * 移植自旧系统 Normative 的字符纠正逻辑
   * 
   * 纠正规则：
   *   — (U+2014 长破折号) → - (U+002D 连字符)
   *   一 (U+4E00 中文"一") → - (U+002D 连字符) — 仅在数字上下文中
   *   － (U+FF0D 全角减号) → - (U+002D 连字符)
   */
  static normalizeOcrChars(text: string): string {
    if (!text) return text;
    // 全角减号 → 半角连字符
    let r = text.replace(/－/g, '-');
    // 长破折号 → 半角连字符
    r = r.replace(/—/g, '-');
    // 中文"一" → 半角连字符（仅在数字上下文中：数字-一-数字 或 编号前缀后）
    // 例如: "GB/T 50001一2017" → "GB/T 50001-2017"
    r = r.replace(/(\d)一(\d)/g, '$1-$2');
    // 编号前缀后的"一": "GB/T一50001" → "GB/T-50001"（罕见但可能）
    r = r.replace(/([A-Za-z/])一(\d)/g, '$1-$2');
    return r;
  }

  /**
   * 从文本中提取标准规范引用
   * 移植自旧系统 DocHandleBase.GetDocStandards
   * 
   * @param text 文档文本内容
   * @param docType 文档类型（xlsx/xls 使用 CODE_ONLY_PATTERN，其他使用 STANDARD_REF_PATTERN）
   * @returns 提取到的标准引用列表（已去重）
   */
  static extractFromText(text: string, docType: string = ''): ExtractedStandard[] {
    if (!text) return [];

    // OCR 字符纠正（在正则匹配前修复混淆字符）
    text = StandardExtractorService.normalizeOcrChars(text);

    const isExcelType = docType === 'xlsx' || docType === 'xls';
    const pattern = isExcelType ? CODE_ONLY_PATTERN : STANDARD_REF_PATTERN;
    
    const results: ExtractedStandard[] = [];
    const seen = new Set<string>(); // 用于去重

    let match: RegExpExecArray | null;
    // 需要重置正则的 lastIndex
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      
      // 去重
      if (seen.has(fullMatch)) continue;
      seen.add(fullMatch);

      let standardNo = '';
      let standardName = '';

      if (isExcelType) {
        // Excel 类型只提取编号，不提取名称
        standardNo = match[0].trim();
        standardName = '';
      } else {
        // 从《标准名称》标准编号 格式中分离
        const bookTitleEnd = fullMatch.indexOf('》');
        if (bookTitleEnd >= 0) {
          const bookTitleStart = fullMatch.indexOf('《');
          standardName = fullMatch.substring(bookTitleStart + 1, bookTitleEnd).trim();
          standardNo = fullMatch.substring(bookTitleEnd + 1).trim();
        } else {
          standardNo = fullMatch.trim();
        }
      }

      // 清理编号中的括号
      standardNo = standardNo.replace(/^[\s\(（]+|[\s\)）]+$/g, '');

      if (standardNo) {
        results.push({
          standardNo,
          standardName,
          standardIdent: StandardExtractorService.getIdent(standardNo),
          fullMatch,
        });
      }
    }

    return results;
  }

  /**
   * Excel 固定列提取模式 - 从指定列提取标准编号
   * 移植自旧系统 Normative 的 Excel 固定列读取逻辑
   * 
   * @param filePath Excel 文件路径
   * @param options 提取选项
   *   - startRow: 起始行号（从1开始，默认5，旧系统从第5行开始）
   *   - column: 列号（从1开始，默认8，即H列，旧系统读第8列）
   *   - sheetIndex: 工作表索引（默认0，即第一个表）
   * @returns 提取到的标准引用列表
   */
  static async extractFromExcelByColumn(
    filePath: string,
    options: {
      startRow?: number;
      column?: number;
      sheetIndex?: number;
    } = {}
  ): Promise<ExtractedStandard[]> {
    const { startRow = 5, column = 8, sheetIndex = 0 } = options;
    
    const XLSX = await import('xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[sheetIndex];
    if (!sheetName) return [];
    
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    const results: ExtractedStandard[] = [];
    const seen = new Set<string>();
    
    for (let i = startRow - 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      
      const cellValue = row[column - 1];
      if (!cellValue) continue;
      
      const text = String(cellValue).trim();
      if (!text) continue;
      
      // 使用 CODE_ONLY_PATTERN 对单元格内容进行正则匹配
      CODE_ONLY_PATTERN.lastIndex = 0;
      const match = CODE_ONLY_PATTERN.exec(text);
      
      if (match) {
        const fullMatch = match[0];
        if (seen.has(fullMatch)) continue;
        seen.add(fullMatch);
        
        results.push({
          standardNo: fullMatch.trim(),
          standardName: '',
          standardIdent: StandardExtractorService.getIdent(fullMatch),
          fullMatch,
        });
      }
    }
    
    return results;
  }

  /**
   * 从标准编号中提取字母标识符
   * 移植自旧系统 NormativeHelper.GetIdent
   * 
   * 示例：
   *   "GB/T 50001-2017" → "GB/T"
   *   "NB/T 20292-2014" → "NB/T"
   *   "HJ 212-2017" → "HJ"
   * 
   * @param str 标准编号字符串
   * @returns 标识符（大写字母+斜杠组合）
   */
  static getIdent(str: string): string {
    if (!str) return '';
    let ident = '';
    for (const c of str) {
      if (c === '/') {
        ident += c;
        continue;
      }
      const code = c.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) { // A-Z
        ident += c;
      } else {
        break;
      }
    }
    return ident;
  }
}
