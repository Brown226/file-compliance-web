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
   * 移植自旧系统 Normative 的字符纠正逻辑，并增强支持更多混淆场景
   * 
   * 纠正规则：
   *   — (U+2014 长破折号) → - (U+002D 连字符)
   *   一 (U+4E00 中文"一") → - (U+002D 连字符) — 仅在数字上下文中
   *   － (U+FF0D 全角减号) → - (U+002D 连字符)
   *   O (字母) → 0 (数字) — 在编号上下文中
   *   I (大写i) → 1 (数字) — 在编号上下文中
   *   l (小写L) → 1 (数字) — 在编号上下文中
   *   全角括号 → 半角括号
   *   中文数字年份 → 阿拉伯数字（如"二〇一七"→"2017"）
   */
  static normalizeOcrChars(text: string): string {
    if (!text) return text;
    
    let r = text;
    
    // ========== 全角字符转换 ==========
    // 全角减号 → 半角连字符
    r = r.replace(/－/g, '-');
    // 长破折号 → 半角连字符
    r = r.replace(/—/g, '-');
    // 全角括号 → 半角括号
    r = r.replace(/（/g, '(');
    r = r.replace(/）/g, ')');
    // 全角冒号 → 半角冒号
    r = r.replace(/：/g, ':');
    // 全角逗号 → 半角逗号
    r = r.replace(/，/g, ',');
    
    // ========== OCR常见混淆字符 ==========
    // O (字母) → 0 (数字) — 在数字上下文中（如 GB/T 5O001 → GB/T 50001）
    // 模式：数字/字母后紧跟O再跟数字
    r = r.replace(/([\dA-Za-z/])O(\d)/gi, '$10$2');
    // I (大写i) → 1 (数字) — 在编号上下文中（如 GB/T I5001 → GB/T 15001）
    r = r.replace(/([\dA-Za-z/])I(\d)/gi, '$11$2');
    // l (小写L) → 1 (数字) — 在编号上下文中（如 GB/T l5001 → GB/T 15001）
    r = r.replace(/([\dA-Za-z/])l(\d)/gi, '$11$2');
    
    // ========== 中文"一"转换 ==========
    // 中文"一" → 半角连字符（仅在数字上下文中：数字-一-数字 或 编号前缀后）
    // 例如: "GB/T 50001一2017" → "GB/T 50001-2017"
    r = r.replace(/(\d)一(\d)/g, '$1-$2');
    // 编号前缀后的"一": "GB/T一50001" → "GB/T-50001"（罕见但可能）
    r = r.replace(/([A-Za-z/])一(\d)/g, '$1-$2');
    
    // ========== 中文数字年份转换 ==========
    // 处理中文数字年份（如"二〇一七"→"2017"，"贰零贰零"→"2020"）
    const chineseNumMap: Record<string, string> = {
      '〇': '0', '零': '0', 'O': '0',
      '一': '1', '壹': '1', 'I': '1', 'i': '1',
      '二': '2', '贰': '2',
      '三': '3', '叁': '3',
      '四': '4', '肆': '4',
      '五': '5', '伍': '5',
      '六': '6', '陆': '6',
      '七': '7', '柒': '7',
      '八': '8', '捌': '8',
      '九': '9', '玖': '9',
    };
    
    // 匹配连续4个中文数字（年份格式）
    r = r.replace(/([〇零一二三四五六七八九十壹贰叁肆伍陆柒捌玖OI]{4})/g, (match) => {
      return match.split('').map(c => chineseNumMap[c] || c).join('');
    });
    
    return r;
  }

  /**
   * 从文本中提取标准规范引用
   * 移植自旧系统 DocHandleBase.GetDocStandards
   * 
   * @param text 文档文本内容
   * @param docType 文档类型
   * @returns 提取到的标准引用列表（已去重）
   */
  static extractFromText(text: string, docType: string = ''): ExtractedStandard[] {
    if (!text) return [];

    // OCR 字符纠正（在正则匹配前修复混淆字符）
    text = StandardExtractorService.normalizeOcrChars(text);

    const results: ExtractedStandard[] = [];
    const seen = new Set<string>(); // 用于去重

    // ========== 阶段1：匹配 《标准名称》标准编号 格式 ==========
    STANDARD_REF_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    
    while ((match = STANDARD_REF_PATTERN.exec(text)) !== null) {
      const fullMatch = match[0];
      
      // 去重
      if (seen.has(fullMatch)) continue;
      seen.add(fullMatch);

      // 从《标准名称》标准编号 格式中分离
      const bookTitleEnd = fullMatch.indexOf('》');
      const bookTitleStart = fullMatch.indexOf('《');
      const standardName = bookTitleEnd >= 0 && bookTitleStart >= 0
        ? fullMatch.substring(bookTitleStart + 1, bookTitleEnd).trim()
        : '';
      const standardNo = bookTitleEnd >= 0
        ? fullMatch.substring(bookTitleEnd + 1).trim()
        : fullMatch.trim();

      // 清理编号中的括号
      const cleanedNo = standardNo.replace(/^[\s\(（]+|[\s\)）]+$/g, '');

      if (cleanedNo) {
        results.push({
          standardNo: cleanedNo,
          standardName,
          standardIdent: StandardExtractorService.getIdent(cleanedNo),
          fullMatch,
        });
      }
    }

    // ========== 阶段2：匹配纯编号格式（所有文档类型都支持） ==========
    // 覆盖以下场景：
    // - 普通文档中的纯编号引用（如正文提到"参见GB/T 50001-2017"）
    // - 表格中的标准编号（无书名号）
    // - 列表形式的标准引用
    CODE_ONLY_PATTERN.lastIndex = 0;
    
    while ((match = CODE_ONLY_PATTERN.exec(text)) !== null) {
      const fullMatch = match[0];
      
      // 去重（可能与阶段1的结果重复）
      if (seen.has(fullMatch)) continue;
      seen.add(fullMatch);

      // 清理编号中的括号和空格
      const standardNo = fullMatch.replace(/^[\s\(（]+|[\s\)）]+$/g, '').trim();

      if (standardNo) {
        results.push({
          standardNo,
          standardName: '',
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
