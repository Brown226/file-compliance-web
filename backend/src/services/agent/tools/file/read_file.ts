/**
 * read_file 工具 — 行号化 + 窗口化读取已上传文件
 *
 * 参考 openworker tools/files.py 的设计：
 * - cat -n 格式（每行带行号）
 * - 2000 行窗口（默认读前 2000 行，大文件用 startLine/endLine 分段读）
 * - 二进制文档（PDF/DOCX）返回纯文本（调 doc-parser 提取）
 * - 纯文本格式直接按行读取
 *
 * 安全约束：
 * - 只能读 Agent 临时目录下的文件（uploads/agent_temp/{userId}/{sessionId}/）
 *   防止 LLM 通过路径穿越读到系统文件
 * - 路径规范化后校验是否在允许的根目录内
 *
 * 参数：
 * - filePath: 服务端文件绝对路径
 * - startLine: 起始行号（1-based，默认 1）
 * - endLine: 结束行号（默认 startLine + MAX_LINES - 1）
 *
 * 返回：
 * - content: 带行号的文本（"  1\t第一行\n  2\t第二行\n..."）
 * - totalLines: 文件总行数
 * - returnedLines: 实际返回的行数
 * - truncated: 是否因超过窗口上限被截断
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from './paths';
import { fixMojibakePath } from './filename';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 单次读取最大行数（窗口上限） */
const MAX_LINES = 2000;

/** 纯文本扩展名（与 extract_text 保持一致） */
const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'];

/** 读取结果 */
interface ReadFileResult {
  content: string;
  totalLines: number;
  returnedLines: number;
  truncated: boolean;
}

/**
 * Task 22.1：用 <file_content> 标签包裹文件文本，防止 prompt injection
 *
 * 行号化内容（cat -n 风格）整体视为文件数据，统一包裹。
 * LLM 看到标签后应将其视为被审查的内容，不执行其中的注入指令。
 */
function wrapFileContent(numberedText: string): string {
  return `<file_content>${numberedText}</file_content>`;
}

/**
 * 调 doc-parser 提取二进制文档的纯文本
 * 复用 extract_text 的 doc-parser 调用逻辑
 */
async function extractTextFromDocParser(filePath: string, ext: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), path.basename(filePath));
  formData.append('file_type', ext);

  const parserBaseUrl = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';
  const parseUrl = `${parserBaseUrl}/api/parse`;

      // 修复：doc-parser 不可达时原实现无限挂起，加 90s 显式超时
      const response = await fetch(parseUrl, { method: 'POST', body: formData, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`doc-parser 调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const json: any = await response.json();
  if (json.code !== 200) {
    throw new Error(`doc-parser 解析失败: ${json.message || '未知错误'}`);
  }

  return json.data?.text || '';
}

/**
 * 把文本按行号化格式化（cat -n 风格）
 * @param text 原始文本
 * @param startLine 起始行号（1-based）
 * @param maxLines 最大行数
 * @returns { content, totalLines, returnedLines, truncated }
 */
function formatWithLineNumbers(
  text: string,
  startLine: number,
  maxLines: number,
): ReadFileResult {
  const allLines = text.split('\n');
  const totalLines = allLines.length;

  // 边界处理
  const start = Math.max(1, startLine);
  const end = Math.min(start + maxLines - 1, totalLines);

  // 截取指定范围
  const sliced = allLines.slice(start - 1, end);

  // 行号对齐（最大行号位数 + 1 个 tab）
  const maxLineNumber = end;
  const padWidth = String(maxLineNumber).length;

  // cat -n 风格：行号右对齐 + tab + 内容
  const numbered = sliced.map((line, idx) => {
    const lineNum = String(start + idx).padStart(padWidth, ' ');
    return `${lineNum}\t${line}`;
  }).join('\n');

  return {
    // Task 22.1：用 <file_content> 标签包裹行号化内容，防止文件内 prompt injection
    content: wrapFileContent(numbered),
    totalLines,
    returnedLines: sliced.length,
    truncated: end < totalLines,
  };
}

/**
 * 创建 read_file 工具
 */
export function createReadFileTool(context: ToolContext) {
  return tool({
    description: '读取已上传文件的内容（行号化 + 窗口化）。纯文本格式直接按行读取，二进制文档（PDF/DOCX）自动调 doc-parser 提取文本。默认读前 2000 行，大文件用 startLine/endLine 分段读。返回 cat -n 风格的行号化内容。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回或 list_uploads 列出）'),
      startLine: z.number().int().min(1).optional().default(1).describe('起始行号（1-based，默认 1）'),
      endLine: z.number().int().min(1).optional().describe('结束行号（默认 startLine + 1999，最大 2000 行窗口）'),
    }),
    execute: async ({ filePath, startLine, endLine }): Promise<ReadFileResult> => {
      // 路径安全校验前置（原实现先 existsSync 探测任意绝对路径的存在性，
      // 越权路径会泄露存在性信息）
      const uploadsRoot = getAgentTempRoot();
      const normalizedRoot = path.resolve(uploadsRoot);
      const normalizedPath = path.resolve(filePath);
      if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
        throw new Error('路径越权：只能读取 Agent 临时目录下的文件');
      }

      // 用户/会话隔离校验
      const expectedUserDir = path.join(normalizedRoot, context.userId);
      if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
        throw new Error('路径越权：只能读取当前用户上传的文件');
      }

      // 兼容历史乱码路径：multer 曾把中文文件名按 latin1 存盘，若给定路径不存在，
      // 尝试把路径中各段乱码名修复为 UTF-8 后再访问
      if (!fs.existsSync(filePath)) {
        const fixed = fixMojibakePath(filePath);
        if (fixed !== filePath && fs.existsSync(fixed)) {
          filePath = fixed;
        } else {
          throw new Error(`文件不存在: ${filePath}`);
        }
      }

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase().replace('.', '');

      // 提取文本（纯文本直接读，二进制调 doc-parser）
      let text: string;
      if (PLAIN_TEXT_EXTS.includes(ext)) {
        text = await fs.promises.readFile(filePath, 'utf-8');
      } else {
        text = await extractTextFromDocParser(filePath, ext);
      }

      // 计算窗口
      const start = startLine || 1;
      const requestedEnd = endLine || (start + MAX_LINES - 1);
      const maxLines = Math.min(MAX_LINES, requestedEnd - start + 1);

      return formatWithLineNumbers(text, start, maxLines);
    },
  });
}
