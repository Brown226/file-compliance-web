/**
 * 表格结构化提取服务
 * 从文本/Excel 中提取表格结构，并验证数据完整性
 */

import * as XLSX from 'xlsx';
import { RuleIssue } from '../rules/types';

/** 表格单元格 */
export interface TableCell {
  row: number;
  col: number;
  text: string;
  isHeader: boolean;
}

/** 表格结构 */
export interface TableStructure {
  pageIndex?: number;
  headers: TableCell[];
  rows: TableCell[][];
  rawText: string;        // 原始纯文本
  structuredJson: string;  // 结构化 JSON 字符串
}

export class TableExtractionService {
  /**
   * 从文本中提取表格结构（基于启发式规则）
   *
   * 识别策略：
   * 1. 连续行包含制表符 \t 或连续空格对齐
   * 2. 管道符 | 分隔的表格（Markdown/PDF 提取常见）
   * 3. 边框线表格（+---+ 或 ┌───┐ 等）
   * 4. 按分隔符提取列
   * 5. 第一行作为 header，后续行作为 data
   * 6. 检测合并单元格（某行列数少于 header 列数）
   */
  static extractTablesFromText(text: string): TableStructure[] {
    const tables: TableStructure[] = [];
    if (!text || !text.trim()) return tables;

    const lines = text.split(/\r?\n/);
    const tableRanges: Array<{ startLine: number; endLine: number; separator: string }> = [];

    // 1. 识别表格边界
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }

      // 判断是否为表格行
      const tabCount = (line.match(/\t/g) || []).length;
      const multiSpaceColumns = line.split(/\s{3,}/).filter(s => s.trim()).length;
      const pipeCount = (line.match(/\|/g) || []).length;
      const isBorderLine = /^[+\u250c\u2514\u251c\u252c\u2534\u253c\u2500\u2502\u2550\u2551\u2554\u2557\u255a\u255d\u2560\u2563\u2566\u2569\u256c-]+$/.test(line);

      if (tabCount >= 1 || multiSpaceColumns >= 2 || pipeCount >= 2 || isBorderLine) {
        const separator = isBorderLine ? 'border' : pipeCount >= 2 ? '|' : tabCount >= 1 ? '\t' : 'multi-space';
        const startLine = i;
        let endLine = i;

        // 扩展表格范围
        while (endLine + 1 < lines.length) {
          const nextLine = lines[endLine + 1].trim();
          if (!nextLine) {
            if (endLine + 2 < lines.length && lines[endLine + 2].trim()) {
              const afterBlank = lines[endLine + 2].trim();
              const afterTab = (afterBlank.match(/\t/g) || []).length;
              const afterSpace = afterBlank.split(/\s{3,}/).filter(s => s.trim()).length;
              const afterPipe = (afterBlank.match(/\|/g) || []).length;
              if (afterTab >= 1 || afterSpace >= 2 || afterPipe >= 2) {
                endLine += 2;
                continue;
              }
            }
            break;
          }
          const nextTab = (nextLine.match(/\t/g) || []).length;
          const nextSpace = nextLine.split(/\s{3,}/).filter(s => s.trim()).length;
          const nextPipe = (nextLine.match(/\|/g) || []).length;
          const nextBorder = /^[+\u250c\u2514\u251c\u252c\u2534\u253c\u2500\u2502\u2550\u2551\u2554\u2557\u255a\u255d\u2560\u2563\u2566\u2569\u256c-]+$/.test(nextLine);
          if (nextTab >= 1 || nextSpace >= 2 || nextPipe >= 2 || nextBorder) {
            endLine++;
          } else {
            break;
          }
        }

        // 至少 2 行才算表格
        if (endLine - startLine >= 1) {
          tableRanges.push({ startLine, endLine, separator });
        }
        i = endLine + 1;
      } else {
        i++;
      }
    }

    // 2. 从每个表格范围提取结构
    for (const range of tableRanges) {
      const tableLines = lines.slice(range.startLine, range.endLine + 1);
      const table = this.parseTableLines(tableLines, range.separator);
      if (table.headers.length > 0) {
        // OPT-023: 关联表格上下文（前方最近的章节标题）
        table.pageIndex = range.startLine;
        tables.push(table);
      }
    }

    return tables;
  }

  /**
   * 从 Excel 文件提取表格
   * 每个 Sheet 提取为一个 TableStructure，支持 merged cells
   */
  static async extractFromExcel(filePath: string): Promise<TableStructure[]> {
    const tables: TableStructure[] = [];

    try {
      const workbook = XLSX.readFile(filePath);

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet['!ref']) continue;

        const range = XLSX.utils.decode_range(worksheet['!ref']);
        const merges = worksheet['!merges'] || [];

        // 构建 merged cell 映射
        const mergeMap = new Map<string, { text: string; isOrigin: boolean }>();
        for (const merge of merges) {
          const originAddr = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
          const originCell = worksheet[originAddr];
          const originText = originCell ? String(originCell.v ?? '') : '';
          for (let r = merge.s.r; r <= merge.e.r; r++) {
            for (let c = merge.s.c; c <= merge.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              mergeMap.set(addr, { text: originText, isOrigin: r === merge.s.r && c === merge.s.c });
            }
          }
        }

        const headers: TableCell[] = [];
        const rows: TableCell[][] = [];

        for (let r = range.s.r; r <= range.e.r; r++) {
          const rowCells: TableCell[] = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            let cellText = '';

            if (mergeMap.has(addr)) {
              const mergeInfo = mergeMap.get(addr)!;
              cellText = mergeInfo.isOrigin ? mergeInfo.text : '';
            } else {
              const cell = worksheet[addr];
              cellText = cell ? String(cell.v ?? '') : '';
            }

            const isHeader = r === range.s.r;
            const tableCell: TableCell = {
              row: r - range.s.r,
              col: c - range.s.c,
              text: cellText.trim(),
              isHeader,
            };

            if (isHeader) {
              headers.push(tableCell);
            }
            rowCells.push(tableCell);
          }

          // 跳过完全空的行
          if (rowCells.some(cell => cell.text !== '')) {
            if (r > range.s.r) {
              rows.push(rowCells);
            }
          }
        }

        // 构建 rawText
        const rawLines: string[] = [];
        const allRows = [headers, ...rows];
        for (const row of allRows) {
          rawLines.push(row.map(c => c.text).join('\t'));
        }
        const rawText = rawLines.join('\n');

        // 构建 structuredJson
        const structuredData = rows.map(row => {
          const obj: Record<string, string> = {};
          for (const cell of row) {
            const headerCell = headers.find(h => h.col === cell.col);
            const key = headerCell?.text || `col_${cell.col}`;
            obj[key] = cell.text;
          }
          return obj;
        });

        tables.push({
          headers,
          rows,
          rawText,
          structuredJson: JSON.stringify(structuredData, null, 2),
        });
      }
    } catch (e) {
      console.warn('[TableExtraction] Excel 提取失败:', e);
    }

    return tables;
  }

  /**
   * 验证表格数据完整性
   *
   * TABLE_001: 表头缺失必填字段（序号/名称/编号/版本至少有一个）
   * TABLE_002: 数据行有空值（必填字段为空）
   * TABLE_003: 数值列中存在非数值数据
   * TABLE_004: 表格行数与声明不符（如果表头有"共N项"）
   */
  static validateTableData(table: TableStructure): RuleIssue[] {
    const issues: RuleIssue[] = [];
    const headerTexts = table.headers.map(h => h.text.toLowerCase());

    // TABLE_001: 表头缺失必填字段
    const requiredHeaders = ['序号', '名称', '编号', '版本', 'no', 'name', 'id', 'version'];
    const hasRequired = headerTexts.some(h =>
      requiredHeaders.some(r => h.includes(r.toLowerCase())),
    );
    if (!hasRequired && table.headers.length > 0) {
      issues.push({
        issueType: 'COMPLETENESS',
        ruleCode: 'TABLE_001',
        severity: 'warning',
        originalText: table.headers.map(h => h.text).join(' | '),
        description: '表格表头缺失常见必填字段（序号/名称/编号/版本），建议确认表头是否完整。',
      });
    }

    // TABLE_002: 数据行有空值
    if (table.rows.length > 0 && table.headers.length > 0) {
      for (let r = 0; r < table.rows.length; r++) {
        const row = table.rows[r];
        const emptyCols: string[] = [];
        for (const cell of row) {
          if (!cell.text.trim() && cell.col < table.headers.length) {
            const headerCell = table.headers.find(h => h.col === cell.col);
            emptyCols.push(headerCell?.text || `第${cell.col + 1}列`);
          }
        }
        if (emptyCols.length > 0 && emptyCols.length < table.headers.length) {
          // 部分列为空（非整行空行）
          issues.push({
            issueType: 'COMPLETENESS',
            ruleCode: 'TABLE_002',
            severity: 'warning',
            originalText: row.map(c => c.text || '(空)').join(' | '),
            description: `表格第 ${r + 2} 行存在空值字段: ${emptyCols.join('、')}，建议补充完整。`,
          });
        }
      }
    }

    // TABLE_003: 数值列中存在非数值数据
    if (table.rows.length > 0 && table.headers.length > 0) {
      // 找出可能的数值列：表头含"数"/"量"/"值"/"额"/"率"等关键词，或大部分数据行为数字
      for (let c = 0; c < table.headers.length; c++) {
        const headerCell = table.headers.find(h => h.col === c);
        const headerText = headerCell?.text || '';
        const numericKeywords = ['数', '量', '值', '额', '率', '比', '重', '度', '长', '宽', '高', '厚', '压力', '温度', '流量', '功率'];
        const isNumericHeader = numericKeywords.some(k => headerText.includes(k));

        if (isNumericHeader) {
          for (let r = 0; r < table.rows.length; r++) {
            const cell = table.rows[r].find(cc => cc.col === c);
            if (cell && cell.text.trim() && isNaN(Number(cell.text.trim().replace(/[,，%％]/g, '')))) {
              issues.push({
                issueType: 'CONSISTENCY',
                ruleCode: 'TABLE_003',
                severity: 'warning',
                originalText: cell.text,
                description: `数值列"${headerText}"第 ${r + 2} 行存在非数值数据"${cell.text}"，请检查数据正确性。`,
              });
            }
          }
        }
      }
    }

    // TABLE_004: 表格行数与声明不符
    const headerFullText = table.headers.map(h => h.text).join('');
    const countMatch = headerFullText.match(/共\s*(\d+)\s*[项条行个]/);
    if (countMatch) {
      const declaredCount = parseInt(countMatch[1], 10);
      const actualCount = table.rows.length;
      if (declaredCount !== actualCount) {
        issues.push({
          issueType: 'CONSISTENCY',
          ruleCode: 'TABLE_004',
          severity: 'error',
          originalText: headerFullText,
          description: `表格声明共 ${declaredCount} 项，但实际数据行数为 ${actualCount} 行，行数不一致。`,
        });
      }
    }

    return issues;
  }

  // ---- 内部辅助方法 ----

  /**
   * 从表格行文本解析为 TableStructure
   */
  private static parseTableLines(lines: string[], separator: string): TableStructure {
    const headers: TableCell[] = [];
    const rows: TableCell[][] = [];
    let maxCols = 0;

    // 解析所有行
    const parsedRows: string[][] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // OPT-023: 跳过边框线（+---+ 或 ┌───┐ 等）
      if (separator === 'border' && /^[+\u250c\u2514\u251c\u252c\u2534\u253c\u2500\u2502\u2550\u2551\u2554\u2557\u255a\u255d\u2560\u2563\u2566\u2569\u256c-]+$/.test(trimmed)) {
        continue;
      }

      let cells: string[];
      if (separator === '|') {
        // 管道符分隔：去掉首尾 | 后按 | 切分
        cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      } else if (separator === '\t') {
        cells = trimmed.split('\t');
      } else if (separator === 'border') {
        // 边框线表格：按 | 或 │ 切分
        cells = trimmed.replace(/^[\u2502|]/, '').replace(/[\u2502|]$/, '').split(/[\u2502|]/).map(c => c.trim());
      } else {
        // 多空格分隔
        cells = trimmed.split(/\s{3,}/).filter(s => s.trim());
      }

      // 清理每个单元格
      cells = cells.map(c => c.trim());
      // 跳过 Markdown 分隔行（如 |---|---|）
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      parsedRows.push(cells);
      if (cells.length > maxCols) maxCols = cells.length;
    }

    if (parsedRows.length === 0 || maxCols === 0) {
      return { headers: [], rows: [], rawText: '', structuredJson: '[]' };
    }

    // 第一行作为 header
    const headerRow = parsedRows[0];
    for (let c = 0; c < headerRow.length; c++) {
      headers.push({
        row: 0,
        col: c,
        text: headerRow[c],
        isHeader: true,
      });
    }

    // 后续行作为 data
    for (let r = 1; r < parsedRows.length; r++) {
      const rowCells: TableCell[] = [];
      for (let c = 0; c < maxCols; c++) {
        const text = c < parsedRows[r].length ? parsedRows[r][c] : '';
        rowCells.push({
          row: r,
          col: c,
          text,
          isHeader: false,
        });
      }
      rows.push(rowCells);
    }

    // 构建 rawText
    const rawText = lines.join('\n');

    // 构建 structuredJson
    const structuredData = rows.map(row => {
      const obj: Record<string, string> = {};
      for (const cell of row) {
        const headerCell = headers.find(h => h.col === cell.col);
        const key = headerCell?.text || `col_${cell.col}`;
        obj[key] = cell.text;
      }
      return obj;
    });

    return {
      headers,
      rows,
      rawText,
      structuredJson: JSON.stringify(structuredData, null, 2),
    };
  }

  /**
   * OPT-023: 获取表格前方最近的章节标题（用于关联表格与上下文）
   */
  static getTableSectionContext(fullText: string, tableStartLine: number): string | undefined {
    const lines = fullText.split(/\r?\n/);
    const SECTION_PATTERNS = [
      /^#{1,4}\s+(.+)/,
      /^(第[一二三四五六七八九十百千\d]+[章节篇部])\s*(.*)/,
      /^(\d+(?:\.\d+){0,3})\s+(.+)/,
      /^([一二三四五六七八九十]+[、.])\s*(.*)/,
    ];

    // 从表格位置向前搜索最近的章节标题
    for (let i = Math.min(tableStartLine - 1, lines.length - 1); i >= Math.max(0, tableStartLine - 30); i--) {
      const line = lines[i].trim();
      if (!line || line.length > 80) continue;
      for (const pattern of SECTION_PATTERNS) {
        if (pattern.test(line)) {
          return line.slice(0, 60);
        }
      }
    }
    return undefined;
  }
}
