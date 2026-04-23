/**
 * Word 文档结构化提取服务
 * 从 Word 文档中提取页眉、页脚、段落等结构化内容
 * 优先使用 Python 解析结果，fallback 使用 jszip 解析 docx XML
 */

export interface WordStructure {
  paragraphs: Array<{
    text: string;
    style: string | null;  // 'Heading1', 'Normal' 等
    page: number | null;
  }>;
  headers: Array<{
    text: string;
    type: 'odd' | 'even' | 'first';  // 页眉类型
    page: number | null;
  }>;
  tables: Array<{
    rows: string[][];
    caption: string | null;
  }>;
}

export class WordStructureService {
  /**
   * 从 Word 文档中提取结构化内容
   * 优先使用 Python 解析结果，fallback 使用 jszip 解析 docx XML
   */
  static async extractStructure(
    filePath: string,
    parseResult?: any,
  ): Promise<WordStructure> {
    // 1. 优先使用 Python 解析的 structure
    if (parseResult?.structure) {
      return this.mapPythonStructure(parseResult.structure);
    }

    // 2. Fallback: 使用 jszip 解析 docx XML 获取页眉
    return this.extractFromDocxXml(filePath);
  }

  /**
   * 将 Python 解析服务的 structure 映射为 WordStructure
   */
  private static mapPythonStructure(structure: any): WordStructure {
    const paragraphs: WordStructure['paragraphs'] = (structure.paragraphs || []).map((p: any) => ({
      text: p.text || '',
      style: p.style || null,
      page: p.page || null,
    }));

    // Python 解析结果中 headers 不直接存在，需从段落中识别
    const headers: WordStructure['headers'] = [];
    if (structure.headers && Array.isArray(structure.headers)) {
      for (const h of structure.headers) {
        headers.push({
          text: h.text || '',
          type: h.type || 'odd',
          page: h.page || null,
        });
      }
    }

    const tables: WordStructure['tables'] = (structure.tables || []).map((t: any) => ({
      rows: t.rows || [],
      caption: t.caption || null,
    }));

    return { paragraphs, headers, tables };
  }

  /**
   * Node.js Fallback: 直接解析 docx XML 获取页眉/页脚
   * docx 是 zip 包，页眉在 word/header1.xml 等文件中
   */
  private static async extractFromDocxXml(filePath: string): Promise<WordStructure> {
    const headers: WordStructure['headers'] = [];
    const paragraphs: WordStructure['paragraphs'] = [];
    const tables: WordStructure['tables'] = [];

    try {
      const JSZip = (await import('jszip')).default;
      const fs = await import('fs');
      const buffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buffer);

      // 读取 word/header1.xml, word/header2.xml, ...
      for (const [name, file] of Object.entries(zip.files)) {
        if (/word\/header\d*\.xml/.test(name)) {
          try {
            const xml = await file.async('string');
            const text = this.extractTextFromXml(xml);
            if (text.trim()) {
              const headerType = name.includes('header1') ? 'odd' : name.includes('header2') ? 'even' : 'first';
              headers.push({ text: text.trim(), type: headerType as 'odd' | 'even' | 'first', page: null });
            }
          } catch (e) {
            console.warn(`[WordStructure] 解析 ${name} 失败:`, e);
          }
        }
      }

      // 读取 document.xml 获取段落
      const docXmlFile = zip.files['word/document.xml'];
      if (docXmlFile) {
        try {
          const docXml = await docXmlFile.async('string');
          const docParagraphs = this.extractParagraphsFromXml(docXml);
          paragraphs.push(...docParagraphs);
        } catch (e) {
          console.warn('[WordStructure] 解析 document.xml 失败:', e);
        }
      }
    } catch (e) {
      console.warn('[WordStructure] jszip 解析 docx 失败:', e);
    }

    // 如果段落为空，使用 ParserService 提取的纯文本回退
    if (paragraphs.length === 0) {
      try {
        const { ParserService } = await import('./parser.service');
        const text = await ParserService.parseFile(filePath, 'docx');
        const lines = text.split('\n').filter(p => p.trim());
        for (const line of lines) {
          paragraphs.push({ text: line, style: null, page: null });
        }
      } catch (e) {
        console.error('[WordStructure] ParserService fallback 失败:', e);
      }
    }

    return { paragraphs, headers, tables };
  }

  /**
   * 从 XML 中提取纯文本内容
   * 简单实现：移除所有 XML 标签，保留文本
   */
  private static extractTextFromXml(xml: string): string {
    let text = xml.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  /**
   * 从 document.xml 中提取段落
   * 识别 w:p 标签作为段落，w:pStyle 识别样式
   */
  private static extractParagraphsFromXml(xml: string): WordStructure['paragraphs'] {
    const paragraphs: WordStructure['paragraphs'] = [];

    // 简单正则匹配 w:p 标签
    const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let match;

    while ((match = pRegex.exec(xml)) !== null) {
      const pXml = match[0];

      // 提取样式
      let style: string | null = null;
      const styleMatch = pXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
      if (styleMatch) {
        style = styleMatch[1];
      }

      // 提取文本（从 w:t 标签）
      const textParts: string[] = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(pXml)) !== null) {
        textParts.push(tMatch[1]);
      }

      const text = textParts.join('');
      if (text.trim()) {
        paragraphs.push({ text, style, page: null });
      }
    }

    return paragraphs;
  }
}
