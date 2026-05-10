import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';

/**
 * DOCX 文本替换服务
 * 在 DOCX ZIP 归档中操作 word/*.xml，实现精确文本替换
 */
export class DocxReplaceService {
  /**
   * 在 DOCX 文件中替换文本
   * @param filePath DOCX 文件路径
   * @param originalText 原始文本
   * @param suggestedText 替换文本
   * @returns 替换次数
   */
  static replaceText(filePath: string, originalText: string, suggestedText: string): number {
    const absolutePath = path.resolve(filePath);
    const zip = new AdmZip(absolutePath);
    let totalReplacements = 0;

    const xmlEntries = zip.getEntries().filter(e =>
      e.entryName.startsWith('word/') && e.entryName.endsWith('.xml')
    );

    for (const entry of xmlEntries) {
      const xml = entry.getData().toString('utf8');

      // 策略1: XML 转义后的精确匹配
      const escapedOriginal = this.xmlEscape(originalText);
      const escapedSuggestion = this.xmlEscape(suggestedText);

      if (xml.includes(escapedOriginal)) {
        const newXml = xml.split(escapedOriginal).join(escapedSuggestion);
        zip.updateFile(entry.entryName, Buffer.from(newXml, 'utf8'));
        totalReplacements += xml.split(escapedOriginal).length - 1;
        continue;
      }

      // 策略2: 跨 run 的文本匹配（原文可能分散在多个 <w:t> 元素中）
      const newXml = this.replaceTextInXmlRuns(xml, originalText, suggestedText);
      if (newXml !== xml) {
        zip.updateFile(entry.entryName, Buffer.from(newXml, 'utf8'));
        totalReplacements++;
      }
    }

    if (totalReplacements === 0) {
      throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
    }

    zip.writeZip(absolutePath);
    return totalReplacements;
  }

  /**
   * 批量替换文本
   * @returns 每项替换结果
   */
  static batchReplaceText(
    filePath: string,
    suggestions: Array<{ originalText: string; suggestedText: string }>
  ): Array<{ originalText: string; replacements: number; error?: string }> {
    const results: Array<{ originalText: string; replacements: number; error?: string }> = [];

    for (const s of suggestions) {
      try {
        const count = this.replaceText(filePath, s.originalText, s.suggestedText);
        results.push({ originalText: s.originalText, replacements: count });
      } catch (e: any) {
        results.push({ originalText: s.originalText, replacements: 0, error: e.message });
      }
    }

    return results;
  }

  /**
   * 跨 run 文本替换：处理分散在多个 <w:t> 元素中的文本
   */
  private static replaceTextInXmlRuns(xml: string, originalText: string, suggestedText: string): string {
    // 提取所有 <w:t> 元素
    const textRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    const runs: Array<{ start: number; end: number; textStart: number; textEnd: number; fullMatch: string; text: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(xml)) !== null) {
      runs.push({
        start: match.index,
        end: match.index + match[0].length,
        textStart: match.index + match[1].length,
        textEnd: match.index + match[1].length + match[2].length,
        fullMatch: match[0],
        text: match[2],
      });
    }

    if (runs.length === 0) return xml;

    // 拼接所有 run 文本
    const fullText = runs.map(r => r.text).join('');

    // 尝试精确匹配
    let searchPos = 0;
    const normalizedOriginal = this.normalizeText(originalText);
    const normalizedFull = this.normalizeText(fullText);

    const normalizedIndex = normalizedFull.indexOf(normalizedOriginal, searchPos);
    if (normalizedIndex === -1) return xml;

    // 计算原始文本在拼接文本中的实际范围（考虑 normalize 差异）
    const actualRange = this.findActualRange(fullText, normalizedFull, normalizedIndex, normalizedOriginal.length);
    if (!actualRange) return xml;

    // 找出覆盖该范围的 run 集合
    const affectedRuns = this.findAffectedRuns(runs, actualRange.start, actualRange.end);
    if (affectedRuns.length === 0) return xml;

    // 在第一个受影响的 run 中插入替换文本，保留尾部文本
    let result = xml;
    const firstRun = affectedRuns[0];
    const lastRun = affectedRuns[affectedRuns.length - 1];

    // 计算在第一个 run 中的起始偏移
    const runTextStartInFull = runs.indexOf(firstRun) === 0 ? 0 :
      runs.slice(0, runs.indexOf(firstRun)).reduce((sum, r) => sum + r.text.length, 0);
    const offsetInFirstRun = actualRange.start - runTextStartInFull;

    // 计算在最后一个 run 中的结束偏移
    const lastRunIndex = runs.indexOf(lastRun);
    const lastRunTextStartInFull = runs.slice(0, lastRunIndex).reduce((sum, r) => sum + r.text.length, 0);
    const offsetInLastRun = actualRange.end - lastRunTextStartInFull;

    // 构建新的 XML
    // 第一个 run: 保留前缀 + 替换文本
    const firstRunPrefix = firstRun.text.substring(0, offsetInFirstRun);
    const lastRunSuffix = lastRun.text.substring(offsetInLastRun);

    const newFirstRunText = firstRunPrefix + suggestedText + (affectedRuns.length > 1 ? '' : lastRunSuffix);
    const newFirstRunXml = firstRun.fullMatch.replace(
      /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/,
      `$1${this.xmlEscape(newFirstRunText)}$3`
    );

    // 移除中间的 run 文本内容
    if (affectedRuns.length > 1) {
      // 第一个 run 替换
      result = result.substring(0, firstRun.start) + newFirstRunXml + result.substring(firstRun.end);

      // 中间 run 清空
      for (let i = 1; i < affectedRuns.length - 1; i++) {
        const run = affectedRuns[i];
        const emptyXml = run.fullMatch.replace(
          /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/,
          '$1$3'
        );
        // 需要重新计算位置（因为前面的替换改变了长度）
        const offset = result.length - xml.length;
        result = result.substring(0, run.start + offset) + emptyXml + result.substring(run.end + offset);
      }

      // 最后一个 run: 保留后缀
      const lastRunEmptyXml = lastRun.fullMatch.replace(
        /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/,
        `$1${this.xmlEscape(lastRunSuffix)}$3`
      );
      const offset = result.length - xml.length;
      result = result.substring(0, lastRun.start + offset) + lastRunEmptyXml + result.substring(lastRun.end + offset);
    } else {
      result = result.substring(0, firstRun.start) + newFirstRunXml + result.substring(firstRun.end);
    }

    return result;
  }

  /**
   * 查找在原始文本中对应 normalize 后位置的实际范围
   */
  private static findActualRange(fullText: string, normalizedFull: string, normalizedStart: number, normalizedLength: number): { start: number; end: number } | null {
    // 简单映射：统计 normalize 前的字符偏移
    let normPos = 0;
    let actualStart: number | null = null;
    let actualEnd: number | null = null;

    for (let i = 0; i < fullText.length; i++) {
      if (normPos === normalizedStart && actualStart === null) {
        actualStart = i;
      }
      if (normPos === normalizedStart + normalizedLength && actualEnd === null) {
        actualEnd = i;
        break;
      }
      // normalize 逻辑：跳过空白符差异
      const ch = fullText[i];
      if (/\s/.test(ch)) {
        // 连续空白只算一个
        if (i === 0 || !/\s/.test(fullText[i - 1])) {
          normPos++;
        }
      } else {
        normPos++;
      }
    }

    if (actualStart === null || actualEnd === null) return null;
    return { start: actualStart, end: actualEnd };
  }

  /**
   * 找出覆盖 [start, end) 范围的 run 集合
   */
  private static findAffectedRuns(
    runs: Array<{ start: number; end: number; textStart: number; textEnd: number; fullMatch: string; text: string }>,
    rangeStart: number,
    rangeEnd: number
  ) {
    const affected: typeof runs = [];
    let charPos = 0;

    for (const run of runs) {
      const runStart = charPos;
      const runEnd = charPos + run.text.length;

      if (runEnd > rangeStart && runStart < rangeEnd) {
        affected.push(run);
      }

      charPos = runEnd;
      if (charPos >= rangeEnd) break;
    }

    return affected;
  }

  /**
   * 文本标准化：统一空白和标点
   */
  private static normalizeText(text: string): string {
    return text
      .replace(/[\s ]+/g, ' ')
      .replace(/[""]/g, "'")
      .replace(/['']/g, "'")
      .replace(/[：]/g, ':')
      .replace(/[，]/g, ',')
      .replace(/[。]/g, '.')
      .replace(/[；]/g, ';')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .trim();
  }

  /**
   * XML 特殊字符转义
   */
  private static xmlEscape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
