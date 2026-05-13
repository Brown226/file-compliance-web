/**
 * 文件内一致性检查服务
 * 检测单个文件内部的参数值、语义描述前后不一致问题
 *
 * 检查维度：
 * 1. 数值一致性：同一参数在不同位置出现时值是否一致
 * 2. 引用一致性：引用的条款号、标准号是否前后一致
 * 3. 术语一致性：同一概念是否使用了统一的术语
 *
 * 规则代码: INTRA_CONSIST_001（文件内参数值不一致）
 */

import prisma from '../config/db';

/** 参数抽取结果 */
interface ParamEntry {
  paramName: string;
  value: string;
  lineNumber: number;
  context: string;  // 参数出现的上下文（前后各30字）
}

/** 不一致项 */
interface Inconsistency {
  paramName: string;
  entries: Array<{ value: string; lineNumber: number; context: string }>;
}

export class IntraFileConsistencyService {
  /**
   * 执行文件内一致性检查
   * @param taskId 任务 ID
   * @param fileId 文件 ID
   * @param fileName 文件名
   * @param extractedText 已提取的文本
   */
  static async check(
    taskId: string,
    fileId: string,
    fileName: string,
    extractedText: string,
  ): Promise<number> {
    if (!extractedText || extractedText.trim().length < 100) {
      console.log(`[IntraConsist] ${fileName}: 文本过短，跳过检查`);
      return 0;
    }

    console.log(`[IntraConsist] ${fileName}: 开始文件内一致性检查 (${extractedText.length} 字符)`);

    // 1. 按段落/章节分割文本
    const sections = this.splitIntoSections(extractedText);
    if (sections.length < 2) {
      console.log(`[IntraConsist] ${fileName}: 段落数不足2，跳过`);
      return 0;
    }

    // 2. 从各段落抽取参数
    const allParams = this.extractParametersFromSections(sections);
    if (allParams.length === 0) {
      console.log(`[IntraConsist] ${fileName}: 未抽取到参数`);
      return 0;
    }

    // 3. 检测不一致
    const inconsistencies = this.findInconsistencies(allParams);
    if (inconsistencies.length === 0) {
      console.log(`[IntraConsist] ${fileName}: 未发现文件内不一致`);
      return 0;
    }

    console.log(`[IntraConsist] ${fileName}: 发现 ${inconsistencies.length} 个文件内不一致`);

    // 4. 写入 task_details
    const issues = inconsistencies.map(inc => {
      const values = inc.entries.map(e => `"${e.value}" (行${e.lineNumber})`).join(' vs ');
      const context = inc.entries[0].context;
      return {
        taskId,
        fileId,
        issueType: 'INTRA_CONSISTENCY',
        severity: 'WARNING' as const,
        ruleCode: 'INTRA_CONSIST_001',
        originalText: context,
        suggestedText: `参数"${inc.paramName}"存在多个不同值: ${values}，请核实并统一`,
        description: `文件内"${inc.paramName}"在不同位置出现了不一致的值`,
        location: `多处出现`,
        source: 'rule_engine' as const,
      };
    });

    if (issues.length > 0) {
      await prisma.taskDetail.createMany({ data: issues });
    }

    return issues.length;
  }

  /**
   * 将文本按段落/章节分割
   */
  private static splitIntoSections(text: string): Array<{ index: number; text: string; startLine: number }> {
    const sections: Array<{ index: number; text: string; startLine: number }> = [];

    // 按换行符分割为段落，合并过短的段落
    const lines = text.split('\n');
    let currentSection = '';
    let sectionStartLine = 1;
    let sectionIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 空行或章节标题作为分隔
      const isSectionBreak = line === '' || /^[一二三四五六七八九十]+[、.．]/.test(line) || /^第[一二三四五六七八九十百千\d]+[章节条款]/.test(line) || /^\d+[.．、]\d*/.test(line);

      if (isSectionBreak && currentSection.trim().length > 50) {
        sections.push({
          index: sectionIndex++,
          text: currentSection.trim(),
          startLine: sectionStartLine,
        });
        currentSection = '';
        sectionStartLine = i + 2; // 1-indexed
      } else {
        currentSection += (currentSection ? '\n' : '') + lines[i];
      }
    }

    // 最后一个段落
    if (currentSection.trim().length > 50) {
      sections.push({
        index: sectionIndex,
        text: currentSection.trim(),
        startLine: sectionStartLine,
      });
    }

    return sections;
  }

  /**
   * 从各段落抽取参数（键值对形式）
   * 匹配模式：
   * - "参数名：值" 或 "参数名: 值"
   * - "参数名为XXX" 或 "参数名是XXX"
   * - "参数名 值"（表格行格式，用制表符或多空格分隔）
   */
  private static extractParametersFromSections(
    sections: Array<{ index: number; text: string; startLine: number }>,
  ): ParamEntry[] {
    const params: ParamEntry[] = [];

    // 参数名模式：中文词、英文词、带数字的编号
    const paramNamePattern = '[\\u4e00-\\u9fa5a-zA-Z][\\u4e00-\\u9fa5a-zA-Z0-9_/（）()]{1,20}';

    for (const section of sections) {
      const lines = section.text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 模式1: "参数名：值" 或 "参数名: 值" 或 "参数名＝值"
        const kvMatch = line.match(new RegExp(`^(${paramNamePattern})[：:=＝]\\s*(.+)$`));
        if (kvMatch) {
          const paramName = kvMatch[1].trim();
          const value = kvMatch[2].trim();
          if (value.length > 0 && value.length < 100) {
            const contextStart = Math.max(0, line.length - 30);
            params.push({
              paramName,
              value,
              lineNumber: section.startLine + i,
              context: line.substring(contextStart, contextStart + 60),
            });
          }
          continue;
        }

        // 模式2: "参数名为/是/等于 XXX"
        const namedMatch = line.match(new RegExp(`(${paramNamePattern})(?:为|是|等于|取值为?|值为?)\\s*([\\d.]+\\s*[℃%°mMkKgGtTLl秒分小时天月年]?|[^，。,.]{1,30})`));
        if (namedMatch) {
          const paramName = namedMatch[1].trim();
          const value = namedMatch[2].trim();
          if (value.length > 0 && value.length < 50) {
            params.push({
              paramName,
              value,
              lineNumber: section.startLine + i,
              context: line.substring(0, 60),
            });
          }
        }
      }
    }

    return params;
  }

  /**
   * 检测同一参数名的多个不同值
   */
  private static findInconsistencies(params: ParamEntry[]): Inconsistency[] {
    // 按参数名分组
    const grouped = new Map<string, ParamEntry[]>();
    for (const p of params) {
      const key = p.paramName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    const inconsistencies: Inconsistency[] = [];

    for (const [paramName, entries] of grouped) {
      if (entries.length < 2) continue;

      // 去重后看有多少种不同的值
      const uniqueValues = new Set(entries.map(e => e.value.trim()));
      if (uniqueValues.size > 1) {
        // 数值类型的特殊处理：忽略单位差异
        const numericValues = [...uniqueValues].map(v => {
          const num = parseFloat(v.replace(/[^\d.-]/g, ''));
          return isNaN(num) ? null : num;
        });

        // 如果都是数值，检查是否真的不同（忽略单位）
        const allNumeric = numericValues.every(v => v !== null);
        if (allNumeric) {
          const uniqueNums = new Set(numericValues);
          if (uniqueNums.size <= 1) continue; // 数值相同，只是单位不同
        }

        inconsistencies.push({
          paramName,
          entries: entries.map(e => ({
            value: e.value,
            lineNumber: e.lineNumber,
            context: e.context,
          })),
        });
      }
    }

    return inconsistencies;
  }
}
