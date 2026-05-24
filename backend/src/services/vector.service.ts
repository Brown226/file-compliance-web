/**
 * 向量文档管理服务
 *
 * 基于 pgvector 的本地向量检索，替代 MaxKB
 * 功能：分块、入库、三阶段混合检索（向量 + 关键词 + Rerank）
 *
 * 分块逻辑移植自 MaxKB 2.8.0 的 SplitModel：
 * - 按 Markdown 标题层级构建树结构
 * - 每个段落携带父级标题链作为 title
 * - 返回 {title, content} 对，与 MaxKB 一致
 */

import crypto from 'crypto';
import prisma from '../config/db';
import { EmbeddingService } from './embedding.service';
import { ContextualRetrievalService } from './contextual-retrieval.service';
import { jiebaSplit } from './common/jieba';

export interface VectorSearchResult {
  id: string;
  source_type: string;
  source_id: string | null;
  title: string | null;
  clause_id: string | null;
  content: string;
  content_hash: string | null;
  chunk_index: number;
  metadata: any;
  score: number;
  rerank_score?: number;
}

interface ImportEntry {
  sourceType: string;
  sourceId?: string;
  title: string;
  clauseId?: string;
  category?: string;
  content: string;
  metadata?: Record<string, any>;
  categoryId?: string;
  /** 分块配置，不传则使用默认值 */
  chunkConfig?: ChunkingConfig;
  /** embedding 输入控制（按知识库配置） */
  embeddingUseDocumentTitle?: boolean;
  embeddingUseClauseId?: boolean;
  /** 预分好的段落（传入时跳过重新分块） */
  preChunkedParagraphs?: Array<{ title: string; content: string }>;
}

export interface ChunkingConfig {
  /** 分块模式：auto=标题感知分割(默认), fixed=纯固定长度, paragraph=按段落分割 */
  mode?: 'auto' | 'fixed' | 'paragraph';
  /** 每个chunk最大字符数（默认1500） */
  maxChars?: number;
  /** chunk间重叠字符数 */
  overlap?: number;
  /** 是否启用 Contextual Retrieval（上下文感知分块），用 LLM 为每个 chunk 生成上下文摘要再 embedding */
  contextualRetrieval?: boolean;
}

/** 分段结果：与 MaxKB 的 paragraph 格式一致 */
export interface ParagraphSegment {
  /** 标题（父级标题链拼接） */
  title: string;
  /** 段落正文内容 */
  content: string;
}

interface SearchOptions {
  limit?: number;
  sourceTypes?: string[];
  categoryId?: string;
  rerank?: boolean;
}

// ============ SplitModel（移植自 MaxKB 2.8.0 split_model.py） ============

/** Markdown 标题层级正则 */
const HEADING_PATTERNS: RegExp[] = [
  /^# .+/m,           // H1
  /^## (?!#).+/m,     // H2
  /^### (?!#).+/m,    // H3
  /^#### (?!#).+/m,   // H4
  /^##### (?!#).+/m,  // H5
  /^###### (?!#).+/m, // H6
];

/** 段落分隔正则（双换行） */
const PARAGRAPH_SEP = /\n\n+/;

interface TreeNode {
  content: string;
  state: 'title' | 'block';
  children?: TreeNode[];
}

const MIN_CHUNK_LENGTH = 100;
const TARGET_CHUNK_LENGTH = 600;
const MAX_CHUNK_LENGTH = 1500;

function normalizeForSplit(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\0/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^[\s.]*$/.test(trimmed)) return false;
      if (/^\d+\s*$/.test(trimmed)) return false;
      if (/^第\s*\d+\s*页$/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function trimRepeatedPrefix(current: string, previous: string): string {
  const a = String(previous || '').trim();
  const b = String(current || '').trim();
  if (!a || !b) return b;
  if (a === b) return '';

  const head = b.slice(0, Math.min(a.length, b.length));
  let matchLen = 0;
  for (let i = head.length; i >= 20; i--) {
    if (a.endsWith(head.slice(0, i))) {
      matchLen = i;
      break;
    }
  }
  if (matchLen >= 40) {
    return b.slice(matchLen).trim();
  }
  return b;
}

function mergeShortSegments(segments: ParagraphSegment[]): ParagraphSegment[] {
  const merged: ParagraphSegment[] = [];

  for (const segment of segments) {
    const current = {
      title: String(segment.title || '').replace(/[#\n\r]/g, '').replace(/\s+/g, ' ').trim(),
      content: String(segment.content || '').trim(),
    };

    if (!current.content) continue;

    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(current);
      continue;
    }

    const prevTitle = prev.title;
    const currentTitle = current.title;
    const sameTitle = prevTitle === currentTitle;
    const currentTooShort = current.content.length < MIN_CHUNK_LENGTH;
    const prevTooShort = prev.content.length < TARGET_CHUNK_LENGTH;

    if (sameTitle && (currentTooShort || prevTooShort)) {
      const deduped = trimRepeatedPrefix(current.content, prev.content);
      prev.content = [prev.content, deduped].filter(Boolean).join('\n\n').trim();
      continue;
    }

    if (sameTitle && current.content.length < TARGET_CHUNK_LENGTH) {
      const deduped = trimRepeatedPrefix(current.content, prev.content);
      prev.content = [prev.content, deduped].filter(Boolean).join('\n\n').trim();
      continue;
    }

    merged.push(current);
  }

  return merged.filter(item => item.content.trim().length > 0);
}

function splitBySoftLimit(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end >= text.length) {
      result.push(text.slice(start).trim());
      break;
    }
    let split = -1;
    for (const chars of ['。.!?！？；;\n', '：:', '，,、']) {
      for (let i = end - 1; i > start + Math.min(120, Math.floor(limit / 4)); i--) {
        if (chars.includes(text[i])) {
          split = i + 1;
          break;
        }
      }
      if (split > start) break;
    }
    if (split <= start) split = end;
    result.push(text.slice(start, split).trim());
    start = split;
  }
  return result.filter(Boolean);
}

/**
 * 智能分段：在 limit 附近找到自然断句点
 * 策略：从 limit 位置向前搜索，优先在高级标点处断开
 * 多轮搜索：先找句子级标点，找不到再找从句级，最后硬切
 * 最小分段保障：不会切出过短的段落
 */
function smartSplitParagraph(content: string, limit: number): string[] {
  if (content.length <= limit) return [content];

  // 表格原子化保护：包含 |---| 分隔行的内容不切割，保持表格完整性
  if (content.split('\n').some(l => isSeparatorLine(l))) {
    return [content];
  }

  // 按优先级分组的断句字符
  const breakLevels = [
    '。.！!？?；;',  // 句子级
    '：:',            // 冒号
    '，,、',          // 从句级
    '\n',             // 换行
  ];

  // 最小分段长度：提高到 1/3，避免切出过短的段落
  const minChunk = Math.max(Math.floor(limit / 3), MIN_CHUNK_LENGTH);

  const result: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = start + limit;
    if (end >= content.length) {
      result.push(content.slice(start));
      break;
    }

    // 多轮搜索：按优先级逐轮降低
    let bestSplit = -1;
    for (const chars of breakLevels) {
      // 从 limit 位置向前搜索，但不早于 minChunk
      const searchFrom = end - 1;
      const searchTo = Math.max(start + minChunk, start);
      for (let i = searchFrom; i >= searchTo; i--) {
        if (chars.includes(content[i])) {
          bestSplit = i + 1;
          break;
        }
      }
      if (bestSplit > start) break; // 找到了
    }

    // 都找不到 → 硬切
    if (bestSplit <= start) bestSplit = end;

    result.push(content.slice(start, bestSplit).trim());
    start = bestSplit;
  }

  return result.filter(t => t.length > 0);
}

/**
 * 在文本中查找匹配指定正则的所有标题
 */
function findHeadings(text: string, pattern: RegExp): Array<{ content: string; index: number }> {
  const results: Array<{ content: string; index: number }> = [];
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const content = match[0].trim();
    if (content && content.replace(/^#+\s*/, '').trim()) {
      results.push({ content, index: match.index });
    }
  }
  return results;
}

/**
 * 递归构建标题树（移植自 MaxKB SplitModel.parse_to_tree）
 */
function parseToTree(text: string, patternIndex: number, limit: number): TreeNode[] {
  if (patternIndex >= HEADING_PATTERNS.length) {
    // 没有更多标题层级，按段落分隔
    const parts = text.split(PARAGRAPH_SEP).filter(p => p.trim());
    if (parts.length <= 1) {
      // 没有双换行分隔，尝试按单换行分割
      const singleParts = text.split(/\n/).filter(p => p.trim());
      if (singleParts.length > 1) {
        return singleParts.flatMap(p => smartSplitParagraph(p, limit).map(s => ({ content: s, state: 'block' })));
      }
      // 都没有，按 limit 智能切割
      return smartSplitParagraph(text, limit).map(s => ({ content: s, state: 'block' }));
    }
    return parts.flatMap(p => smartSplitParagraph(p, limit).map(s => ({ content: s, state: 'block' })));
  }

  const headings = findHeadings(text, HEADING_PATTERNS[patternIndex]);

  if (headings.length === 0) {
    // 当前级别无标题，尝试下一级别
    return parseToTree(text, patternIndex + 1, limit);
  }

  const result: TreeNode[] = [];
  let cursor = 0;

  // 如果第一个标题之前有内容，作为 block
  if (headings[0].index > 0) {
    const preamble = text.slice(0, headings[0].index).trim();
    if (preamble) {
      result.push(...parseToTree(preamble, patternIndex + 1, limit).map(n => {
        if (n.state === 'block') return n;
        return { content: n.content, state: 'block' as const };
      }));
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeadingStart = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const blockStart = heading.index + heading.content.length;
    const block = text.slice(blockStart, nextHeadingStart).trim();

    const children: TreeNode[] = block
      ? parseToTree(block, patternIndex + 1, limit)
      : [];

    result.push({
      content: heading.content.replace(/^#+\s*/, ''),
      state: 'title',
      children,
    });
  }

  return result;
}

/**
 * 将树扁平化为 {title, content} 段落数组（移植自 MaxKB result_tree_to_paragraph）
 */
function flattenTree(nodes: TreeNode[], parentChain: string[], limit: number): ParagraphSegment[] {
  const result: ParagraphSegment[] = [];

  for (const node of nodes) {
    if (node.state === 'block') {
      // 叶子节点：内容块
      const segments = smartSplitParagraph(node.content, limit);
      for (const seg of segments) {
        result.push({
          title: parentChain.join(' '),
          content: seg,
        });
      }
    }

    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, [...parentChain, node.content], limit));
    }
  }

  return result;
}

/**
 * 表格区域检测：识别 Markdown 表格行
 */
function isSeparatorLine(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

export class VectorService {

  // ============ 分块（移植自 MaxKB SplitModel） ============

  /**
   * 将 Markdown 文本按标题层级分割为 {title, content} 段落数组
   * 与 MaxKB 的 SplitModel.parse() 行为完全一致：
   * - 不区分表格/文本，统一按标题树分割
   * - 表格只是内容的一部分，跟随所属标题段落
   * - 没有分块数量限制
   */
  static splitMarkdownIntoParagraphs(text: string, limit: number = 100000): ParagraphSegment[] {
    const raw = normalizeForSplit(text);
    if (!raw.trim()) return [];

    const cleaned = raw;
    if (!cleaned) return [];

    // 统一使用标题树解析（与 MaxKB SplitModel.parse 一致）
    const tree = parseToTree(cleaned, 0, limit);
    const result = mergeShortSegments(flattenTree(tree, [], limit));

    // 后处理：与 MaxKB post_reset_paragraph 一致
    const titleSet = new Set(result.map(p => p.title));
    return result
      .map(p => this.postResetParagraph(p, titleSet))
      .filter(p => p.content.trim().length > 0);
  }

  /**
   * 后处理单个段落（移植自 MaxKB post_reset_paragraph）
   */
  private static postResetParagraph(para: ParagraphSegment, titleSet: Set<string>): ParagraphSegment {
    let { title, content } = para;

    // content_is_null：如果 content 为空但 title 有值
    if (!content.trim() && title.trim()) {
      const isSubTitle = [...titleSet].some(t => t.includes(title) && t !== title);
      if (isSubTitle) return { title: '', content: '' };
      return { title: '', content: title };
    }

    // filter_title_special_characters
    title = title.replace(/[#\n\r]/g, '').replace(/\s+/g, ' ').trim();

    // sub_title：title 超过 255 字符时截断
    if (title.length > 255) {
      content = title.slice(255) + content;
      title = title.slice(0, 255);
    }

    return { title, content };
  }

  /**
   * 兼容旧接口：将 Markdown 分块为字符串数组
   * 内部调用 splitMarkdownIntoParagraphs，将 title+content 拼接
   */
  static splitTextIntoChunks(text: string, config: ChunkingConfig = {}): string[] {
    const { mode = 'auto', maxChars = 1500, overlap = 300 } = config;
    const raw = normalizeForSplit(text);
    if (!raw.trim()) return [];

    const cleaned = raw;
    if (!cleaned) return [];

    if (mode === 'fixed') {
      return this.splitFixed(cleaned, maxChars, overlap).filter(c => c.length >= MIN_CHUNK_LENGTH);
    }

    if (mode === 'paragraph') {
      return this.splitByParagraph(cleaned, maxChars, overlap).filter(c => c.length >= MIN_CHUNK_LENGTH);
    }

    // auto 模式：先 SplitModel，再做段落窗口重叠
    const paragraphs = this.splitMarkdownIntoParagraphs(cleaned, maxChars);
    const chunks = paragraphs.map((p, index) => {
      const base = p.content;
      if (index === 0 || overlap <= 0) return p.title ? `${p.title}\n${base}` : base;

      const prev = paragraphs[index - 1];
      const prevText = prev.content;
      const tail = prevText.slice(Math.max(0, prevText.length - overlap));
      const dedupedBase = trimRepeatedPrefix(base, prevText);
      const body = [tail, dedupedBase].filter(Boolean).join('\n');
      return p.title ? `${p.title}\n${body}`.trim() : body.trim();
    });

    return chunks.filter(c => c.length >= MIN_CHUNK_LENGTH);
  }

  private static splitFixed(text: string, maxChars: number, overlap: number = 0): string[] {
    const chunks: string[] = [];
    if (maxChars <= 0) return chunks;

    const safeOverlap = Math.max(0, Math.min(overlap, maxChars - 1));
    const step = Math.max(1, maxChars - safeOverlap);

    for (let start = 0; start < text.length; start += step) {
      const chunk = text.slice(start, start + maxChars).trim();
      if (chunk) chunks.push(chunk);
      if (start + maxChars >= text.length) break;
    }
    return chunks;
  }

  private static splitByParagraph(text: string, maxChars: number, overlap: number = 0): string[] {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
    const chunks: string[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraChunks = para.length <= maxChars ? [para] : splitBySoftLimit(para, maxChars);

      for (let j = 0; j < paraChunks.length; j++) {
        const current = paraChunks[j];
        if (overlap <= 0) {
          chunks.push(current);
          continue;
        }

        let prefix = '';
        if (j > 0) {
          const prevChunk = paraChunks[j - 1];
          prefix = prevChunk.slice(Math.max(0, prevChunk.length - overlap));
        } else if (i > 0) {
          const prevPara = paragraphs[i - 1];
          prefix = prevPara.slice(Math.max(0, prevPara.length - overlap));
        }

        const deduped = trimRepeatedPrefix(current, prefix || '');
        chunks.push(prefix ? `${prefix}\n${deduped}`.trim() : current);
      }
    }

    return chunks;
  }

  /**
   * 从内容头部提取条文号（章节号、表号、图号）
   */
  static extractClauseId(content: string): string | null {
    // 取前200字符进行匹配（条文号通常在段落开头）
    const head = content.substring(0, 200);
    const patterns = [
      /^(T-[\d.]+[-\d/（）()]*)/m,                    // 表号 T-2.3-1, T-2.3-36（1/5）
      /^(F-[\d.]+[-\d/（）()]*)/m,                    // 图号 F-2.1-1
      /^(\d+\.\d+(?:\.\d+)*(?:\.\d+)*)[\s,，、：:]/m, // 章节号 2.1.1 后跟空格/逗号/冒号
      /^(第[一二三四五六七八九十百千\d]+[章节条款])/m,  // 第X章/节/条
      /^(附录[A-Z\d])/m,                              // 附录A, 附录1
    ];

    for (const pattern of patterns) {
      const match = head.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

  // ============ 去重哈希 ============

  private static sourceHash(parts: string[]): string {
    return crypto
      .createHash('sha256')
      .update(parts.map(p => String(p || '')).join('|'))
      .digest('hex');
  }

  // ============ 文档导入 ============

  /**
   * 将文本内容分块、向量化后入库
   * 使用 SplitModel 按标题层级分块，每个 chunk 携带标题上下文
   * title 字段始终存原始文档名，标题链存入 metadata.heading
   */
  static async importDocument(entry: ImportEntry): Promise<{ chunks: number; deduped: number }> {
    const {
      sourceType,
      title,
      content,
      clauseId,
      category,
      metadata,
      categoryId,
      chunkConfig,
      embeddingUseDocumentTitle = false,
      embeddingUseClauseId = false,
    } = entry;
    const { mode = 'auto', maxChars = 1500, overlap = 300, contextualRetrieval = false } = chunkConfig || {};

    const paragraphs: ParagraphSegment[] = entry.preChunkedParagraphs?.length
      ? entry.preChunkedParagraphs.filter(p => p.content.length > 0)
      : (() => {
          const chunks = this.splitTextIntoChunks(content, { mode, maxChars, overlap });
          return chunks.map(chunk => {
            const parts = chunk.split('\n');
            if (parts.length > 1) {
              return { title: parts[0].trim(), content: parts.slice(1).join('\n').trim() };
            }
            return { title: '', content: chunk.trim() };
          }).filter(p => p.content.length > 0);
        })();

    if (paragraphs.length === 0) return { chunks: 0, deduped: 0 };

    // Contextual Retrieval: 为每个 chunk 生成上下文摘要
    let contextualMap: Map<number, string> = new Map();
    if (contextualRetrieval) {
      try {
        const chunkTexts = paragraphs.map(p => p.content);
        const enhanced = await ContextualRetrievalService.enhanceChunks(content, chunkTexts, {
          enabled: true,
          concurrency: 3,
          timeout: 30,
        });
        enhanced.forEach((item, idx) => {
          if (item.contextSummary) {
            contextualMap.set(idx, item.contextSummary);
          }
        });
        console.log(`[ContextualRetrieval] importDocument: ${contextualMap.size}/${paragraphs.length} chunks 已增强`);
      } catch (err: any) {
        console.warn(`[ContextualRetrieval] importDocument 上下文生成失败，继续使用原始内容: ${err.message}`);
      }
    }

    const MAX_EMBED_CHARS = 6000;

    const textsForEmbedding = paragraphs.map((p, idx) => {
      const fields: string[] = [];
      if (embeddingUseDocumentTitle && title) fields.push(title);
      if (p.title) fields.push(p.title);
      if (embeddingUseClauseId && clauseId) fields.push(clauseId);
      const contextSummary = contextualMap.get(idx);
      if (contextSummary) fields.push(`[${contextSummary}]`);
      fields.push(p.content);
      let text = fields.filter(Boolean).join('\n');
      if (text.length > MAX_EMBED_CHARS) {
        console.warn(`[VectorService] chunk ${idx} 超长(${text.length}字符)，截断至 ${MAX_EMBED_CHARS}`);
        text = text.slice(0, MAX_EMBED_CHARS);
      }
      return text;
    });

    const embeddings = await EmbeddingService.embedTexts(textsForEmbedding);
    let deduped = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const chunkContent = para.content;

      const extractedClause = this.extractClauseId(chunkContent);
      const chunkClauseId = extractedClause || clauseId || String(i + 1);
      const contentHash = this.sourceHash([sourceType, title, category || '', chunkClauseId, chunkContent]);
      const sourceId = entry.sourceId || `${sourceType}:${this.sourceHash([title, category || '', chunkClauseId, contentHash])}`;

      const existing = await prisma.vectorDocument.findFirst({
        where: { contentHash },
        select: { id: true },
      });

      if (existing) { deduped++; continue; }

      const embeddingStr = `[${embeddings[i].join(',')}]`;
      const isTable = chunkContent.split('\n').some(l => isSeparatorLine(l));

      // 段落标题优先，文档名兜底
      const paragraphTitle = para.title || title;

      const contextSummary = contextualMap.get(i);

      await prisma.$executeRawUnsafe(`
        INSERT INTO vector_documents
          (id, "categoryId", source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, embedding, vector_status, search_vector, created_at, updated_at)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, $11,
           to_tsvector('simple', coalesce($4::text, '') || ' ' || coalesce($5::text, '') || ' ' || coalesce($6::text, '')),
           NOW(), NOW())
      `,
        categoryId || null,
        sourceType,
        paragraphs.length > 1 ? `${sourceId}:chunk:${i}` : sourceId,
        paragraphTitle,
        chunkClauseId,
        chunkContent,
        contentHash,
        i,
        JSON.stringify({
          ...metadata,
          document_title: title,
          original_source_id: sourceId,
          is_table: isTable,
          heading: para.title || '',
          chunkConfigUsed: { mode, maxChars, overlap, contextualRetrieval },
          ...(contextSummary ? { contextSummary } : {}),
        }),
        embeddingStr,
        'SUCCESS'
      );
    }

    return { chunks: paragraphs.length, deduped };
  }

  /**
   * 直接导入已分块的内容（不重新分块）- 带事务保护
   * 用于分段预览确认后的导入，保证用户的分段编辑生效
   * 支持两种格式：string[]（兼容旧版）和 ParagraphSegment[]（新版）
   * title 字段始终存原始文档名，标题链存入 metadata.heading
   *
   * 事务保护：
   * - 所有向量入库操作在一个事务中执行
   * - 失败时自动回滚，保证数据一致性
   */
  static async importChunks(
    chunks: Array<string | ParagraphSegment>,
    entry: Omit<ImportEntry, 'content' | 'chunkConfig'> & { contextualRetrieval?: boolean; wholeDocumentContent?: string }
  ): Promise<{ chunks: number; deduped: number }> {
    const {
      sourceType,
      title,
      clauseId,
      category,
      metadata,
      categoryId,
      embeddingUseDocumentTitle = false,
      embeddingUseClauseId = false,
      contextualRetrieval = false,
      wholeDocumentContent,
    } = entry;

    if (chunks.length === 0) return { chunks: 0, deduped: 0 };

    const segments: ParagraphSegment[] = chunks.map(c =>
      typeof c === 'string' ? { title: '', content: c } : c
    );

    let contextualMap: Map<number, string> = new Map();
    if (contextualRetrieval && wholeDocumentContent) {
      try {
        const chunkTexts = segments.map(p => p.content);
        const enhanced = await ContextualRetrievalService.enhanceChunks(wholeDocumentContent, chunkTexts, {
          enabled: true,
          concurrency: 3,
          timeout: 30,
        });
        enhanced.forEach((item, idx) => {
          if (item.contextSummary) {
            contextualMap.set(idx, item.contextSummary);
          }
        });
        console.log(`[ContextualRetrieval] importChunks: ${contextualMap.size}/${segments.length} chunks 已增强`);
      } catch (err: any) {
        console.warn(`[ContextualRetrieval] importChunks 上下文生成失败，继续使用原始内容: ${err.message}`);
      }
    }

    const MAX_EMBED_CHARS = 6000;

    const textsForEmbedding = segments.map((p, idx) => {
      const fields: string[] = [];
      if (embeddingUseDocumentTitle && title) fields.push(title);
      if (p.title) fields.push(p.title);
      if (embeddingUseClauseId && clauseId) fields.push(clauseId);
      const contextSummary = contextualMap.get(idx);
      if (contextSummary) fields.push(`[${contextSummary}]`);
      fields.push(p.content);
      let text = fields.filter(Boolean).join('\n');
      if (text.length > MAX_EMBED_CHARS) {
        console.warn(`[VectorService] importChunks chunk ${idx} 超长(${text.length}字符)，截断至 ${MAX_EMBED_CHARS}`);
        text = text.slice(0, MAX_EMBED_CHARS);
      }
      return text;
    });

    const embeddings = await EmbeddingService.embedTexts(textsForEmbedding);

    let deduped = 0;
    const toInsert: Array<{
      para: ParagraphSegment;
      chunkContent: string;
      chunkClauseId: string;
      contentHash: string;
      sourceId: string;
      embeddingStr: string;
      isTable: boolean;
      storedContent: string;
      contextSummary?: string;
    }> = [];

    for (let i = 0; i < segments.length; i++) {
      const para = segments[i];
      const chunkContent = para.content;

      const extractedClause = this.extractClauseId(chunkContent);
      const chunkClauseId = extractedClause || clauseId || String(i + 1);
      const contentHash = this.sourceHash([sourceType, title, category || '', chunkClauseId, chunkContent]);
      const sourceId = entry.sourceId || `${sourceType}:${this.sourceHash([title, category || '', chunkClauseId, contentHash])}`;

      const existing = await prisma.vectorDocument.findFirst({
        where: { contentHash },
        select: { id: true },
      });

      if (existing) { deduped++; continue; }

      const embeddingStr = `[${embeddings[i].join(',')}]`;
      const isTable = chunkContent.split('\n').some(l => isSeparatorLine(l));

      // 段落标题优先，文档名兜底
      const paragraphTitle = para.title || title;

      const contextSummary = contextualMap.get(i);

      toInsert.push({
        para,
        chunkContent,
        chunkClauseId,
        contentHash,
        sourceId,
        embeddingStr,
        isTable,
        paragraphTitle,
        contextSummary,
      });
    }

    if (toInsert.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < toInsert.length; i++) {
          const item = toInsert[i];
          const paraIndex = segments.findIndex(p => p === item.para);

          await tx.$executeRawUnsafe(`
            INSERT INTO vector_documents
              (id, "categoryId", source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, embedding, vector_status, search_vector, created_at, updated_at)
            VALUES
              (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, $11,
               to_tsvector('simple', coalesce($4::text, '') || ' ' || coalesce($5::text, '') || ' ' || coalesce($6::text, '')),
               NOW(), NOW())
          `,
            categoryId || null,
            sourceType,
            toInsert.length > 1 ? `${item.sourceId}:chunk:${paraIndex}` : item.sourceId,
            item.paragraphTitle,
            item.chunkClauseId,
            item.chunkContent,
            item.contentHash,
            paraIndex,
            JSON.stringify({
              ...metadata,
              document_title: title,
              original_source_id: item.sourceId,
              is_table: item.isTable,
              heading: item.para.title || '',
              ...(item.contextSummary ? { contextSummary: item.contextSummary } : {}),
            }),
            item.embeddingStr,
            'SUCCESS'
          );
        }
      });
    }

    return { chunks: segments.length, deduped };
  }

  /**
   * 原子替换单文档向量：先完成分块与向量计算，成功后再事务替换旧数据
   * 失败时不删除旧向量，满足 fail-closed。
   */
  static async replaceDocumentAtomically(entry: ImportEntry & { categoryId: string; title: string }): Promise<{ chunks: number }> {
    const {
      sourceType,
      title,
      content,
      clauseId,
      category,
      metadata,
      categoryId,
      chunkConfig,
      embeddingUseDocumentTitle = false,
      embeddingUseClauseId = false,
    } = entry;

    const { mode = 'auto', maxChars = 1500, overlap = 300, contextualRetrieval = false } = chunkConfig || {};
    const chunks = this.splitTextIntoChunks(content, { mode, maxChars, overlap });
    const paragraphs: ParagraphSegment[] = chunks.map(chunk => {
      const parts = chunk.split('\n');
      if (parts.length > 1) {
        return { title: parts[0].trim(), content: parts.slice(1).join('\n').trim() };
      }
      return { title: '', content: chunk.trim() };
    }).filter(p => p.content.length > 0);

    if (paragraphs.length === 0) return { chunks: 0 };

    let contextualMap: Map<number, string> = new Map();
    if (contextualRetrieval) {
      try {
        const chunkTexts = paragraphs.map(p => p.content);
        const enhanced = await ContextualRetrievalService.enhanceChunks(content, chunkTexts, {
          enabled: true,
          concurrency: 3,
          timeout: 30,
        });
        enhanced.forEach((item, idx) => {
          if (item.contextSummary) {
            contextualMap.set(idx, item.contextSummary);
          }
        });
        console.log(`[ContextualRetrieval] replaceDocument: ${contextualMap.size}/${paragraphs.length} chunks 已增强`);
      } catch (err: any) {
        console.warn(`[ContextualRetrieval] replaceDocument 上下文生成失败，继续使用原始内容: ${err.message}`);
      }
    }

    const MAX_EMBED_CHARS = 6000;

    const textsForEmbedding = paragraphs.map((p, idx) => {
      const fields: string[] = [];
      if (embeddingUseDocumentTitle && title) fields.push(title);
      if (p.title) fields.push(p.title);
      if (embeddingUseClauseId && clauseId) fields.push(clauseId);
      const contextSummary = contextualMap.get(idx);
      if (contextSummary) fields.push(`[${contextSummary}]`);
      fields.push(p.content);
      let text = fields.filter(Boolean).join('\n');
      if (text.length > MAX_EMBED_CHARS) {
        console.warn(`[VectorService] replaceDocument chunk ${idx} 超长(${text.length}字符)，截断至 ${MAX_EMBED_CHARS}`);
        text = text.slice(0, MAX_EMBED_CHARS);
      }
      return text;
    });
    const embeddings = await EmbeddingService.embedTexts(textsForEmbedding);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM vector_documents WHERE "categoryId" = $1 AND COALESCE(metadata->>'original_file', title) = $2`,
        categoryId, title
      );

      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        const chunkContent = para.content;
        const extractedClause = this.extractClauseId(chunkContent);
        const chunkClauseId = extractedClause || clauseId || String(i + 1);
        const contentHash = this.sourceHash([sourceType, title, category || '', chunkClauseId, chunkContent]);
        const sourceId = entry.sourceId || `${sourceType}:${this.sourceHash([title, category || '', chunkClauseId, contentHash])}`;
        const embeddingStr = `[${embeddings[i].join(',')}]`;
        const isTable = chunkContent.split('\n').some(l => isSeparatorLine(l));

        // 段落标题优先，文档名兜底
        const paragraphTitle = para.title || title;

        const contextSummary = contextualMap.get(i);

        await tx.$executeRawUnsafe(
          `INSERT INTO vector_documents
            (id, "categoryId", source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, embedding, vector_status, search_vector, created_at, updated_at)
          VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, $11,
             to_tsvector('simple', coalesce($4::text, '') || ' ' || coalesce($6::text, '')),
             NOW(), NOW())`,
          categoryId,
          sourceType,
          paragraphs.length > 1 ? `${sourceId}:chunk:${i}` : sourceId,
          paragraphTitle,
          chunkClauseId,
          chunkContent,
          contentHash,
          i,
          JSON.stringify({
            ...metadata,
            document_title: title,
            original_source_id: sourceId,
            is_table: isTable,
            heading: para.title || '',
            chunkConfigUsed: { mode, maxChars, overlap, contextualRetrieval },
            ...(contextSummary ? { contextSummary } : {}),
          }),
          embeddingStr,
          'SUCCESS'
        );
      }
    });

    return { chunks: paragraphs.length };
  }

  /**
   * 批量导入多个文档
   */
  static async importDocuments(entries: ImportEntry[]): Promise<{ imported: number; totalChunks: number; deduped: number; errors: string[] }> {
    let imported = 0;
    let totalChunks = 0;
    let deduped = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      try {
        const result = await this.importDocument(entry);
        totalChunks += result.chunks;
        deduped += result.deduped;
        imported++;
      } catch (err: any) {
        const msg = `文档 "${entry.title}" 导入失败: ${err.message}`;
        console.error(`[VectorService] importDocuments: ${msg}`);
        errors.push(msg);
      }
    }

    return { imported, totalChunks, deduped, errors };
  }

  // ============ 文档删除 ============

  static async deleteDocuments(filter: {
    ids?: string[];
    sourceType?: string;
    categoryId?: string;
    title?: string;
  }): Promise<number> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.ids?.length) {
      conditions.push(`id = ANY($${paramIndex}::text[])`);
      params.push(filter.ids);
      paramIndex++;
    }
    if (filter.sourceType) {
      conditions.push(`source_type = $${paramIndex}`);
      params.push(filter.sourceType);
      paramIndex++;
    }
    if (filter.categoryId) {
      conditions.push(`"categoryId" = $${paramIndex}`);
      params.push(filter.categoryId);
      paramIndex++;
    }
    if (filter.title) {
      conditions.push(`COALESCE(metadata->>'original_file', title) = $${paramIndex}`);
      params.push(filter.title);
      paramIndex++;
    }

    if (conditions.length === 0) throw new Error('至少需要一个删除条件');

    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM vector_documents WHERE ${conditions.join(' AND ')}`,
      ...params
    );
    return result;
  }

  // ============ 三阶段混合检索 ============

  /**
   * 向量搜索（对外接口：自动embedding查询文本）
   */
  static async vectorSearchByQuery(
    query: string,
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const queryVector = await EmbeddingService.embedText(query);
    return this.vectorSearch(queryVector, options);
  }

  /**
   * 关键词搜索（对外接口）
   */
  static async keywordSearchByQuery(
    query: string,
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    return this.keywordSearch(query, options);
  }

  /**
   * 向量相似度搜索（pgvector <=> 算子）
   */
  private static async vectorSearch(
    queryVector: number[],
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const { limit, sourceTypes, categoryId } = options;
    const embeddingStr = `[${queryVector.join(',')}]`;

    const params: any[] = [embeddingStr];
    let paramIndex = 2;

    let sourceTypeFilter = '';
    if (sourceTypes?.length) {
      sourceTypeFilter = `AND source_type = ANY($${paramIndex}::text[])`;
      params.push(sourceTypes);
      paramIndex++;
    }
    let categoryFilter = '';
    if (categoryId) {
      categoryFilter = `AND "categoryId" = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }
    params.push(limit);

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id, source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata,
             1 - (embedding <=> $1::vector) AS score
      FROM vector_documents
      WHERE embedding IS NOT NULL ${sourceTypeFilter} ${categoryFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT $${paramIndex}
    `, ...params);

    return rows.map(row => ({
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      title: row.title,
      clause_id: row.clause_id,
      content: row.content,
      content_hash: row.content_hash,
      chunk_index: Number(row.chunk_index),
      metadata: this.parseMetadata(row.metadata),
      score: Number(row.score),
    }));
  }

  /**
   * 关键词搜索（中文分词 + ILIKE）- 保留兼容
   * 新代码应优先使用 ftsSearch（原生全文检索）
   */
  private static async keywordSearch(
    query: string,
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const { limit, sourceTypes, categoryId } = options;
    const terms = await this.tokenizeQuery(query);
    if (terms.length === 0) return [];

    let sql = `SELECT id, source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata, 0 as score
               FROM vector_documents WHERE (`;
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const term of terms) {
      conditions.push(
        `(title ILIKE $${paramIndex} OR clause_id ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`
      );
      params.push(`%${term}%`);
      paramIndex++;
    }
    sql += conditions.join(' OR ') + ')';

    if (sourceTypes?.length) {
      sql += ` AND source_type = ANY($${paramIndex}::text[])`;
      params.push(sourceTypes);
      paramIndex++;
    }
    if (categoryId) {
      sql += ` AND "categoryId" = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }

    sql += ` LIMIT ${limit * 4}`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    return rows.map(row => {
      const title = `${row.title || ''} ${row.clause_id || ''}`.toLowerCase();
      const content = String(row.content || '').toLowerCase();
      const score = terms.reduce((sum, term) => {
        return sum + (title.includes(term) ? 0.15 : 0) + (content.includes(term) ? 0.05 : 0);
      }, 0);
      return {
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        title: row.title,
        clause_id: row.clause_id,
        content: row.content,
        content_hash: row.content_hash,
        chunk_index: Number(row.chunk_index),
        metadata: this.parseMetadata(row.metadata),
        score,
      };
    }).filter(row => row.score > 0);
  }

  /**
   * P0-1: PostgreSQL 原生全文检索
   * 使用 tsvector + ts_rank 替代 ILIKE 全表扫描
   * - 中文：使用 simple 配置（不剔除单字），结合 jieba 分词的查询词
   * - 英语：simple 配置按空白分词，天然支持
   */
  private static async ftsSearch(
    query: string,
    options: { limit: number; sourceTypes?: string[]; categoryId?: string }
  ): Promise<VectorSearchResult[]> {
    const { limit, sourceTypes, categoryId } = options;
    const cleanQuery = query.replace(/\s+/g, ' ').trim();
    if (!cleanQuery) return [];

    // 用 jieba 分词后连接为 tsquery（& 连接 = 所有词都要匹配）
    const terms = await this.tokenizeQuery(cleanQuery);
    if (terms.length === 0) return [];

    // 构建 tsquery：多个词用 & 连接
    const tsqueryTerms = terms.map(t => `'${t.replace(/'/g, "''")}'`).join(' & ');

    const params: any[] = [tsqueryTerms];
    let paramIndex = 2;

    let sourceTypeFilter = '';
    if (sourceTypes?.length) {
      sourceTypeFilter = `AND source_type = ANY($${paramIndex}::text[])`;
      params.push(sourceTypes);
      paramIndex++;
    }
    let categoryFilter = '';
    if (categoryId) {
      categoryFilter = `AND "categoryId" = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }
    params.push(limit * 3);

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id, source_type, source_id, title, clause_id, content, content_hash, chunk_index, metadata,
        ts_rank(search_vector, to_tsquery('simple', $1)) * 1.0 AS score
      FROM vector_documents
      WHERE search_vector @@ to_tsquery('simple', $1)
        ${sourceTypeFilter} ${categoryFilter}
        AND vector_status = 'SUCCESS'
      ORDER BY score DESC
      LIMIT $${paramIndex}
    `, ...params);

    return rows.map(row => ({
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      title: row.title,
      clause_id: row.clause_id,
      content: row.content,
      content_hash: row.content_hash,
      chunk_index: Number(row.chunk_index),
      metadata: this.parseMetadata(row.metadata),
      score: Number(row.score),
    }));
  }

  /**
   * RRF（Reciprocal Rank Fusion）加权融合多个召回列表
   * 参照 FastGPT 的 datasetSearchResultConcat
   */
  private static rrfConcat(arr: { weight: number; list: VectorSearchResult[] }[]): VectorSearchResult[] {
    arr = arr.filter(item => item.list.length > 0);
    if (arr.length === 0) return [];
    if (arr.length === 1) return arr[0].list;

    const map = new Map<string, VectorSearchResult & { rrfScore: number }>();

    for (const item of arr) {
      const weight = item.weight;
      for (let index = 0; index < item.list.length; index++) {
        const data = item.list[index];
        const rank = index + 1;
        const score = weight * (1 / (60 + rank));
        const key = data.content_hash || data.source_id || data.id;
        const record = map.get(key);
        if (record) {
          record.rrfScore += score;
          if (data.score > record.score) {
            record.score = data.score;
          }
        } else {
          map.set(key, { ...data, rrfScore: score });
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map(({ rrfScore: _, ...result }) => result);
  }

  /**
   * 合并去重两个搜索结果（旧逻辑保留给其他方法）
   */
  private static mergeResults(primary: VectorSearchResult[], secondary: VectorSearchResult[], limit: number): VectorSearchResult[] {
    const byHash = new Map<string, VectorSearchResult>();
    for (const row of [...primary, ...secondary]) {
      const key = row.content_hash || row.source_id || row.id;
      const existing = byHash.get(key);
      if (!existing || row.score > existing.score) {
        byHash.set(key, row);
      }
    }
    return [...byHash.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * 三阶段混合检索：向量 + 关键词 + Rerank
   * FastGPT 风格增强版：RRF 融合 + jieba 分词 + Rerank 权重融合
   */
  static async hybridSearch(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const { limit = 5, sourceTypes, categoryId, rerank = true } = options;
    const cleanQuery = query.replace(/\s+/g, ' ').trim();
    const candidateLimit = Math.max(limit * 8, 80);

    // Stage 1: 向量搜索
    const queryVector = await EmbeddingService.embedText(cleanQuery);
    const vectorResults = await this.vectorSearch(queryVector, { limit: Math.round(candidateLimit * 0.8), sourceTypes, categoryId });

    // Stage 2: 全文检索（PostgreSQL tsvector + ts_rank，替代 ILIKE 全表扫描）
    const keywordResults = await this.ftsSearch(cleanQuery, { limit: Math.round(candidateLimit * 0.6), sourceTypes, categoryId });

    // Stage 3: RRF 加权融合（向量 70%，关键词 30%）
    let merged = this.rrfConcat([
      { weight: 0.7, list: vectorResults },
      { weight: 0.3, list: keywordResults },
    ]);

    // Stage 4: Rerank 权重融合（原始 RRF 40% + Rerank 60%）
    if (rerank && merged.length > limit) {
      try {
        const reranked = await EmbeddingService.rerankDocuments(cleanQuery, merged, limit * 2);
        const rerankList = (reranked as unknown as VectorSearchResult[]).map((r, idx) => ({
          ...r,
          rerank_score: r.rerank_score ?? r.score,
        }));

        merged = this.rrfConcat([
          { weight: 0.4, list: merged },
          { weight: 0.6, list: rerankList },
        ]);
      } catch (e: any) {
        console.warn(`[VectorService] Rerank 失败，使用原始 RRF 排序: ${e.message}`);
      }
    }

    return merged.slice(0, limit);
  }

  // ============ 文档列表查询 ============

  static async listDocuments(options: {
    page?: number;
    pageSize?: number;
    query?: string;
    sourceType?: string;
    categoryId?: string;
  } = {}) {
    const { page = 1, pageSize = 10, query, sourceType, categoryId } = options;
    const skip = (Math.max(1, page) - 1) * pageSize;

    const where: any = {};
    if (sourceType) where.sourceType = sourceType;
    if (categoryId) where.categoryId = categoryId;
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { clauseId: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.vectorDocument.count({ where }),
      prisma.vectorDocument.findMany({
        where,
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          title: true,
          clauseId: true,
          content: true,
          contentHash: true,
          chunkIndex: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return { page, pageSize, total, items };
  }

  // ============ 统计 ============

  static async getStats() {
    const totalCount = await prisma.vectorDocument.count();
    const byType = await prisma.vectorDocument.groupBy({
      by: ['sourceType'],
      _count: { id: true },
    });
    return { totalCount, byType };
  }

  // ============ 工具方法 ============

  private static async tokenizeQuery(query: string): Promise<string[]> {
    const terms = await jiebaSplit(query.toLowerCase());
    return [...new Set(terms)].slice(0, 16);
  }

  private static parseMetadata(metadata: any): any {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
      try { return JSON.parse(metadata); } catch { return {}; }
    }
    return metadata;
  }

}
