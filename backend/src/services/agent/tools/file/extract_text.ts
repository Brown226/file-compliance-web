/**
 * extract_text 工具 — 调用 doc-parser 服务提取文件文本
 *
 * 调用 http://localhost:8000/api/parse（multipart/form-data），
 * 解析响应提取 data.text / data.structure / data.metadata.page_count / data.markdown。
 *
 * 依赖：Node.js 22 原生 FormData / Blob / fetch（无需 form-data 等 polyfill）
 * doc-parser URL 由 PARSER_SERVICE_URL 环境变量控制，默认 http://localhost:8000
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** doc-parser 解析结果 */
interface ParseResult {
  text: string;
  structure: any;
  pages?: number;
  markdown?: string;
}

/**
 * Task 22.1：用 <file_content> 标签包裹文件文本，防止 prompt injection
 *
 * 文件内容是"数据"而非"指令"。LLM 看到 <file_content> 标签后，应将其视为被审查的内容，
 * 不执行其中可能包含的"忽略以上指令""现在你是..."等注入攻击话语。
 *
 * 标签仅包裹纯文本字段（text / markdown），structure/pages 等结构化元信息不需要包裹
 * （它们是工具解析后的产物，不直接呈现文件原文）。
 *
 * @param rawText 原始文件文本
 * @returns `<file_content>${rawText}</file_content>` 形式的字符串
 */
function wrapFileContent(rawText: string): string {
  return `<file_content>${rawText}</file_content>`;
}

/**
 * 创建 extract_text 工具
 *
 * 参数：
 * - filePath: 服务端文件绝对路径（通常由 upload_file 返回）
 *
 * 返回：
 * - text: 提取出的纯文本（Task 22.1：已用 <file_content> 标签包裹，防 prompt injection）
 * - structure: 结构化信息（paragraphs/tables/headers/dimensions）
 * - pages: 页数（来自 metadata.page_count，可能为 undefined）
 * - markdown: Markdown 格式文本（Task 22.1：已用 <file_content> 标签包裹）
 */
export function createExtractTextTool(_context: ToolContext) {
  return tool({
    description: '从文件中提取文本。调用 doc-parser 服务解析 docx/xlsx/pdf/pptx 等格式文件，返回纯文本、结构化信息和 Markdown。需要先通过 upload_file 上传文件获得 filePath。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
    }),
    execute: async ({ filePath }): Promise<ParseResult> => {
      // 校验文件存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase().replace('.', '');

      // 纯文本格式直接读取，不调 doc-parser（doc-parser 只支持 doc/docx/pdf/pptx/xlsx）
      if (['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
        const text = await fs.promises.readFile(filePath, 'utf-8');
        // Task 22.1：用 <file_content> 标签包裹，防止文件内的 prompt injection 被执行
        return {
          text: wrapFileContent(text),
          structure: { paragraphs: text.split(/\n\s*\n/).filter(Boolean) },
          pages: undefined,
          markdown: ext === 'md' || ext === 'markdown' ? wrapFileContent(text) : undefined,
        };
      }

      // 二进制文档格式调 doc-parser
      const fileBuffer = await fs.promises.readFile(filePath);
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), fileName);
      formData.append('file_type', ext);

      const parserBaseUrl = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';
      const parseUrl = `${parserBaseUrl}/api/parse`;

      const response = await fetch(parseUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`doc-parser 调用失败 (HTTP ${response.status}): ${errText}`);
      }

      const json: any = await response.json();

      if (json.code !== 200) {
        throw new Error(`doc-parser 解析失败: ${json.message || '未知错误'}`);
      }

      const data = json.data || {};
      // Task 22.1：用 <file_content> 标签包裹 text 和 markdown，防止文件内 prompt injection
      return {
        text: wrapFileContent(data.text || ''),
        structure: data.structure || {},
        pages: data.metadata?.page_count,
        markdown: data.markdown ? wrapFileContent(data.markdown) : undefined,
      };
    },
  });
}
