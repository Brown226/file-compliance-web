/**
 * extract_tables 工具 — 表格提取（P1-③）
 *
 * 复用 parse-document.ts 的 parseDocument（统一解析：纯文本直接读 / 二进制调 doc-parser），
 * 从 structure.tables 中提取结构化表格，输出统一 JSON：
 *   { tables: [{ sheetName?, page?, headers[], rows[][] }], count, totalRows, csv? }
 *
 * 设计要点：
 * - 纯文本格式（txt/md/csv 等）直接返回「无可提取的表格」，不调 doc-parser
 * - 表格数据是「数据」而非「指令」，但结构化 JSON 不直接呈现原文，
 *   因此不需要 <file_content> 标签包裹（与 extract_text 的包裹逻辑区分开）
 * - toCsv=true 时输出 CSV 文本（字段含逗号/换行/引号时按 RFC 4180 转义），供下载/导出
 *
 * 参考：
 * - doc-parser structure.tables 结构：[{ sheetName?, page?, headers?, rows? }]
 *   · headers: string[]（表头）
 *   · rows: (string | number)[][]（数据行）
 *   · page: 页码（PDF/xlsx 分页信息，可能缺失）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { assertUserFilePath } from './paths';
import type { ToolContext } from './upload_file';
import { parseDocument, isPlainTextExt } from './parse-document';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 单个表格结构 */
interface ExtractedTable {
  sheetName?: string;
  page?: number;
  headers: string[];
  rows: string[][];
}

/** 表格提取结果 */
interface ExtractTablesResult {
  tables: ExtractedTable[];
  count: number;
  totalRows: number;
  csv?: string;
}

/**
 * 从 doc-parser structure 中提取表格数组
 *
 * structure.tables 可能是数组（[{ headers, rows, page? }]），
 * 也可能嵌套在结构内。做兼容归一化：
 * - 数组元素直接取 headers / rows
 * - headers 缺省时用空数组（表格只有数据行）
 * - rows 元素统一转字符串
 */
function extractTablesFromStructure(structure: any): ExtractedTable[] {
  if (!structure || !Array.isArray(structure.tables)) return [];

  const tables: ExtractedTable[] = [];
  for (const raw of structure.tables) {
    if (!raw || typeof raw !== 'object') continue;
    const headers: string[] = Array.isArray(raw.headers)
      ? raw.headers.map(String)
      : [];
    const rows: string[][] = Array.isArray(raw.rows)
      ? raw.rows.map((row: any) =>
          Array.isArray(row) ? row.map(cell => String(cell ?? '')) : [String(row ?? '')],
        )
      : [];
    const table: ExtractedTable = {
      headers,
      rows,
    };
    if (typeof raw.sheetName === 'string' && raw.sheetName) table.sheetName = raw.sheetName;
    if (typeof raw.page === 'number' && raw.page > 0) table.page = raw.page;
    tables.push(table);
  }
  return tables;
}

/**
 * 单个表格转 CSV（RFC 4180 转义）
 * - 字段含逗号/双引号/换行时用双引号包裹
 * - 内部双引号转义为两个双引号
 */
function tableToCsv(table: ExtractedTable): string {
  const lines: string[] = [];
  const escapeCell = (cell: string): string => {
    if (/[",\r\n]/.test(cell)) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  if (table.headers.length > 0) {
    lines.push(table.headers.map(escapeCell).join(','));
  }
  for (const row of table.rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return lines.join('\r\n');
}

/**
 * 创建 extract_tables 工具
 *
 * 参数：
 * - filePath: 服务端文件绝对路径（由 upload_file 返回）
 * - sheet: 可选，xlsx 多 sheet 时指定（0-based），默认全部
 * - toCsv: 可选，默认 false；true 时把表格转 CSV 文本（供下载/导出）
 *
 * 返回：
 * - tables: 结构化表格数组（headers / rows / page? / sheetName?）
 * - count: 表格数量
 * - totalRows: 所有表格数据行合计
 * - csv?: toCsv=true 时返回，多个表格用空行分隔
 */
export function createExtractTablesTool(context: ToolContext) {
  return tool({
    description: '从文档中提取表格，返回结构化 JSON（表头/数据行/页码/sheet名）。支持 docx/xlsx/pdf/pptx 等二进制格式（调 doc-parser 解析）。可指定 sheet 提取 xlsx 的特定工作表，toCsv=true 时输出 CSV 文本。适合把表格内容交给 LLM 做数据比对、合规核对、字段抽取。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
      sheet: z.number().int().min(0).optional().describe('xlsx 多 sheet 时指定要提取的工作表索引（0-based），默认提取全部'),
      toCsv: z.boolean().optional().default(false).describe('是否把表格转换为 CSV 文本返回（默认 false）'),
    }),
    execute: async ({ filePath, sheet, toCsv }): Promise<ExtractTablesResult> => {
      // 安全修复：用户隔离校验前置（原实现先 existsSync 探测任意绝对路径的存在性）
      assertUserFilePath(filePath, context.userId);

      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase().replace('.', '');

      // 纯文本格式：无可提取的表格（txt/md/csv 等不调 doc-parser）
      if (isPlainTextExt(ext)) {
        return { tables: [], count: 0, totalRows: 0 };
      }

      // 二进制文档调 doc-parser
      const parsed = await parseDocument(filePath);
      let tables = extractTablesFromStructure(parsed.structure);

      // 按 sheet 过滤（sheet 参数为 0-based 表格索引；doc-parser 表格无 sheetName 字段，
      // 无法按名称匹配，按文档顺序取指定位置的表格）
      if (sheet !== undefined) {
        tables = tables.filter((_, idx) => idx === sheet);
      }

      const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
      const result: ExtractTablesResult = {
        tables,
        count: tables.length,
        totalRows,
      };

      // toCsv=true：每个表格转 CSV，多个表格用空行分隔
      if (toCsv && tables.length > 0) {
        result.csv = tables.map(tableToCsv).join('\r\n\r\n');
      }

      return result;
    },
  });
}
