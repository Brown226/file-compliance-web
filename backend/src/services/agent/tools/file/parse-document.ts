/**
 * Agent 文档解析共享工具 — 供 compare_documents / extract_tables / summarize_document 等复用
 *
 * 从 extract_text.ts / chunk_document.ts 抽出公共解析逻辑：
 * 1. 调 doc-parser 解析二进制文档（docx/xlsx/pdf/pptx），或直接读取纯文本
 * 2. 返回统一的解析结果（text / pages / structure / markdown）
 *
 * 与 extract_text 工具的差异：
 * - 不包裹 <file_content> 标签（标签由调用方按需处理，避免重复包裹）
 * - 导出 parseWithDocParser 供多个工具复用
 */

import * as fs from 'fs';
import * as path from 'path';

/** doc-parser 解析结果（统一结构） */
export interface AgentParseResult {
  text: string;
  pages?: string[];
  structure: any;
  markdown?: string;
  pageCount?: number;
}

/** 纯文本扩展名集合（与 extract_text / chunk_document 保持一致） */
export const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'];

/** 判断是否为纯文本格式（无需调 doc-parser） */
export function isPlainTextExt(ext: string): boolean {
  return PLAIN_TEXT_EXTS.includes(ext.toLowerCase());
}

/**
 * 调 doc-parser 解析二进制文档
 * @throws 文件不存在 / doc-parser 调用失败 / 解析失败时抛错
 */
export async function parseWithDocParser(filePath: string, ext: string): Promise<AgentParseResult> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), path.basename(filePath));
  formData.append('file_type', ext);

  const parserBaseUrl = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';
  const parseUrl = `${parserBaseUrl}/api/parse`;

  const response = await fetch(parseUrl, { method: 'POST', body: formData });
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`doc-parser 调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const json: any = await response.json();
  if (json.code !== 200) {
    throw new Error(`doc-parser 解析失败: ${json.message || '未知错误'}`);
  }

  const data = json.data || {};
  return {
    text: data.text || '',
    pages: data.pages,
    structure: data.structure || {},
    markdown: data.markdown,
    pageCount: data.metadata?.page_count,
  };
}

/**
 * 解析文档为统一结构（自动判断纯文本 / 二进制）
 * @param filePath 服务端文件绝对路径
 * @returns AgentParseResult
 */
export async function parseDocument(filePath: string): Promise<AgentParseResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  if (isPlainTextExt(ext)) {
    const text = await fs.promises.readFile(filePath, 'utf-8');
    return {
      text,
      structure: { paragraphs: text.split(/\n\s*\n/).filter(Boolean) },
      markdown: undefined,
      pageCount: undefined,
    };
  }

  return parseWithDocParser(filePath, ext);
}
