/**
 * chunk_document 工具 — 结构感知分块
 *
 * 支持 5 种策略：
 * - auto（默认）：根据文件类型自动选最优策略
 *     · PDF → by_page（PDF 有真实分页）
 *     · DOCX → by_section（按 Heading 标题层级）
 *     · TXT/MD/其他 → fixed_4000
 * - by_page：按 doc-parser 返回的 pages[] 数组分块（PDF 有真实分页，其他格式为单元素）
 * - by_section：按 structure.headers 标题层级分块（DOCX 有 Heading style）
 * - by_paragraph：按空行分段分块
 * - fixed_4000：按固定字符数 4000 分块（重叠 200 字符，避免切断句子）
 *
 * 输入：filePath + 可选 strategy
 * 输出：chunks 数组 [{ index, text, sectionTitle?, pageRange? }]
 *
 * 实现策略：
 * 1. 优先复用 extract_text 的解析逻辑（调 doc-parser 或直接读纯文本）
 * 2. 按 strategy 切分文本
 * 3. 返回带位置信息的 chunks（sectionTitle 用于 LLM 审查时的上下文）
 *
 * 参考：
 * - doc-parser 返回结构：{ text, pages[], structure: { paragraphs, headers }, markdown }
 *   · pages[]：PDF 有真实分页，其他格式为单元素 [markdown_text]
 *   · structure.paragraphs[]：[{ text, style, page }]（DOCX 有 style='Heading1/2/3'）
 *   · structure.headers[]：[{ text, type/level, page }]
 * - LlmService.TextChunk：项目既有分片结构，但本工具输出独立结构（不耦合 LlmService）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 纯文本扩展名集合（与 extract_text 保持一致） */
const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'];

/** 固定分块大小（字符数） */
const FIXED_CHUNK_SIZE = 4000;
/** 固定分块重叠（字符数，避免切断句子） */
const FIXED_CHUNK_OVERLAP = 200;

/** 单个 chunk 结构 */
interface DocumentChunk {
  index: number;
  text: string;
  sectionTitle?: string;
  pageRange?: string;
}

/** 分块结果 */
interface ChunkResult {
  chunks: DocumentChunk[];
  total: number;
  strategy: string;
}

/**
 * 调 doc-parser 解析文件（复用 extract_text 的逻辑）
 * 返回原始解析结果（含 text/pages/structure/markdown）
 */
async function parseWithDocParser(filePath: string, ext: string): Promise<{
  text: string;
  pages?: string[];
  structure: any;
  markdown?: string;
}> {
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
  };
}

/**
 * 按页分块（PDF 有真实分页）
 * @param pages doc-parser 返回的 pages[] 数组
 */
function chunkByPage(pages: string[]): DocumentChunk[] {
  return pages.map((text, idx) => ({
    index: idx,
    text,
    pageRange: `p${idx + 1}`,
  }));
}

/**
 * 按章节分块（DOCX 有 Heading style）
 * @param paragraphs doc-parser 返回的 structure.paragraphs[]
 *
 * 策略：
 * - 遇到 Heading1/Heading2 开启新 chunk
 * - 累积同章节段落文本
 * - 标题为 sectionTitle
 */
function chunkBySection(paragraphs: any[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let currentTitle = '（开篇）';
  let currentText = '';
  let currentIndex = 0;

  const isHeading = (style: string) => {
    if (!style) return false;
    const s = style.toLowerCase();
    return s.startsWith('heading') || s === 'title';
  };

  for (const para of paragraphs) {
    const text = para?.text?.trim();
    if (!text) continue;

    if (isHeading(para?.style)) {
      // 遇到新标题，先保存当前累积内容
      if (currentText.trim()) {
        chunks.push({
          index: currentIndex++,
          text: currentText.trim(),
          sectionTitle: currentTitle,
        });
      }
      currentTitle = text;
      currentText = text + '\n\n';
    } else {
      currentText += text + '\n\n';
    }
  }

  // 保存最后一段
  if (currentText.trim()) {
    chunks.push({
      index: currentIndex++,
      text: currentText.trim(),
      sectionTitle: currentTitle,
    });
  }

  return chunks;
}

/**
 * 按段落分块（空行分隔）
 */
function chunkByParagraph(text: string): DocumentChunk[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  return paragraphs.map((p, idx) => ({
    index: idx,
    text: p.trim(),
  }));
}

/**
 * 固定大小分块（4000 字符 + 200 重叠）
 */
function chunkByFixedSize(text: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let idx = 0;
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + FIXED_CHUNK_SIZE, text.length);
    const chunkText = text.slice(pos, end);
    chunks.push({ index: idx++, text: chunkText });

    if (end >= text.length) break;
    // 重叠：下一块从当前块末尾往前 200 字符开始
    pos = end - FIXED_CHUNK_OVERLAP;
    if (pos < 0) pos = 0;
  }

  return chunks;
}

/**
 * 自动选择策略
 * - PDF → by_page
 * - DOCX → by_section（若 structure.paragraphs 有 Heading style）
 * - 其他 → fixed_4000
 */
function autoStrategy(ext: string, structure: any): 'by_page' | 'by_section' | 'fixed_4000' {
  if (ext === 'pdf') return 'by_page';
  if (ext === 'docx' || ext === 'doc') {
    const paras = structure?.paragraphs;
    if (Array.isArray(paras) && paras.some((p: any) => {
      const s = (p?.style || '').toLowerCase();
      return s.startsWith('heading') || s === 'title';
    })) {
      return 'by_section';
    }
  }
  return 'fixed_4000';
}

/**
 * 创建 chunk_document 工具
 *
 * 参数：
 * - filePath: 服务端文件绝对路径（由 upload_file 返回）
 * - strategy: 分块策略（auto / by_page / by_section / by_paragraph / fixed_4000）
 *
 * 返回：
 * - chunks: DocumentChunk[] 数组
 * - total: 总分块数
 * - strategy: 实际使用的策略（auto 会解析为具体策略）
 */
export function createChunkDocumentTool(_context: ToolContext) {
  return tool({
    description: '将文档按结构感知分块，支持 5 种策略：auto（默认，根据文件类型自动选）/ by_page（按页）/ by_section（按标题层级）/ by_paragraph（按段落）/ fixed_4000（固定 4000 字符 + 200 重叠）。PDF 推荐用 by_page，DOCX 推荐用 by_section，纯文本推荐用 fixed_4000。返回 chunks 数组，每个 chunk 含 index/text/sectionTitle?/pageRange?。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
      strategy: z.enum(['auto', 'by_page', 'by_section', 'by_paragraph', 'fixed_4000'])
        .optional().default('auto')
        .describe('分块策略：auto（默认）/ by_page / by_section / by_paragraph / fixed_4000'),
    }),
    execute: async ({ filePath, strategy }): Promise<ChunkResult> => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase().replace('.', '');

      // 纯文本格式直接读取（与 extract_text 保持一致）
      let text: string;
      let pages: string[] | undefined;
      let structure: any = {};

      if (PLAIN_TEXT_EXTS.includes(ext)) {
        text = await fs.promises.readFile(filePath, 'utf-8');
        // 纯文本无 pages / structure
      } else {
        // 二进制文档调 doc-parser
        const parsed = await parseWithDocParser(filePath, ext);
        text = parsed.text;
        pages = parsed.pages;
        structure = parsed.structure || {};
      }

      // 解析策略
      let actualStrategy = strategy;
      if (strategy === 'auto') {
        actualStrategy = autoStrategy(ext, structure);
      }

      // 执行分块
      let chunks: DocumentChunk[] = [];
      switch (actualStrategy) {
        case 'by_page':
          if (Array.isArray(pages) && pages.length > 0) {
            chunks = chunkByPage(pages);
          } else {
            // 无 pages 信息，降级到 fixed_4000
            chunks = chunkByFixedSize(text);
            actualStrategy = 'fixed_4000';
          }
          break;

        case 'by_section':
          if (Array.isArray(structure?.paragraphs) && structure.paragraphs.length > 0) {
            chunks = chunkBySection(structure.paragraphs);
          } else {
            // 无 structure 信息，降级到 fixed_4000
            chunks = chunkByFixedSize(text);
            actualStrategy = 'fixed_4000';
          }
          break;

        case 'by_paragraph':
          chunks = chunkByParagraph(text);
          break;

        case 'fixed_4000':
        default:
          chunks = chunkByFixedSize(text);
          break;
      }

      return {
        chunks,
        total: chunks.length,
        strategy: actualStrategy,
      };
    },
  });
}
