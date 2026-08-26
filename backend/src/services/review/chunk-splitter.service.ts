// backend/src/services/review/chunk-splitter.service.ts
/**
 * 章节感知切块服务
 *
 * 替代 splitText(4000) 的按字符切片，按 TOC 树章节边界切块。
 * 跨章节不合并，保留章节上下文。
 *
 * 架构边界：
 * - 本服务切分「设计文档」（被审查文档），按 markdown 标题树
 * - ClauseSplitterService（standard/checkpoint/）切分「规范文本」，按条文编号
 * - 两者职责分离，不互相依赖
 * - 仅用于 DEC_REVIEW 双分支路径，其他 9 种模式仍用 LlmService.splitText（surgical change）
 */

import { LlmService, TextChunk } from '../llm/llm.service';

export interface OutlineNode {
  level: number;      // 1=章, 2=节, 3=条
  title: string;
  startIndex: number; // 在原文中的字符偏移
  endIndex?: number;
  children?: OutlineNode[];
}

export interface SectionChunk {
  chunkIndex: number;
  text: string;
  startIndex: number;
  sectionPath: string;  // 如 "第5章 > 5.2 > 5.2.3"
  sectionLevel: number;
}

export class ChunkSplitterService {
  /**
   * 从 markdown 文本提取 TOC 树
   *
   * 识别两类标题：
   * 1. markdown 标题：# / ## / ### ...（level = # 的数量）
   * 2. 数字编号行：5 / 5.2 / 5.2.3 后接空格+标题（level = 编号段数）
   *
   * 注意：数字编号行必须顶格（不以空格开头），避免误匹配正文中的数字列表项。
   */
  static extractOutline(text: string): OutlineNode[] {
    // 归一化 CRLF：行尾 \r 会导致 /$/ 断言失效、标题正则匹配不到（JS 的 . 不匹配 \r）
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const nodes: OutlineNode[] = [];
    let currentOffset = 0;
    const stack: OutlineNode[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      const numberedMatch = line.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);

      let level: number | null = null;
      let title = '';

      if (headerMatch) {
        level = headerMatch[1].length;
        title = headerMatch[2].trim();
      } else if (numberedMatch && !line.startsWith('  ')) {
        const parts = numberedMatch[1].split('.').length;
        level = parts;
        title = `${numberedMatch[1]} ${numberedMatch[2].trim()}`;
      }

      if (level !== null) {
        const node: OutlineNode = { level, title, startIndex: currentOffset };

        // 弹出栈中 level >= 当前的
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          const popped = stack.pop()!;
          popped.endIndex = currentOffset;
          if (stack.length > 0) {
            stack[stack.length - 1].children = stack[stack.length - 1].children || [];
            stack[stack.length - 1].children!.push(popped);
          } else {
            nodes.push(popped);
          }
        }
        stack.push(node);
      }

      currentOffset += line.length + 1; // +1 for \n
    }

    // 弹出剩余
    while (stack.length > 0) {
      const popped = stack.pop()!;
      popped.endIndex = currentOffset;
      if (stack.length > 0) {
        stack[stack.length - 1].children = stack[stack.length - 1].children || [];
        stack[stack.length - 1].children!.push(popped);
      } else {
        nodes.push(popped);
      }
    }

    return nodes;
  }

  /**
   * 按章节切块（跨章节不合并）
   *
   * 策略：
   * 1. 章节内容 <= maxChunkSize：整章作为一个 chunk
   * 2. 章节内容 > maxChunkSize：按段落（\n\n）再切，累计到 maxChunkSize 即切出
   * 3. 递归处理子章节（子章节独立切块，不与父章节合并）
   *
   * 注意：父章节的 sectionText 包含子章节内容，但子章节会被单独切成 chunks，
   *      会导致子章节内容在父 chunk 和子 chunk 中都出现。这是有意的——
   *      父 chunk 提供章节级上下文，子 chunk 提供细粒度审查单元。
   *      如需去重，调用方可在审查阶段按 startIndex 去重。
   */
  static splitBySection(text: string, outline: OutlineNode[], maxChunkSize: number = 4000): SectionChunk[] {
    // 归一化 CRLF：确保 outline 的 startIndex/endIndex 与 sectionText 切片在同一字符坐标下
    const normalized = text.replace(/\r\n/g, '\n');
    const chunks: SectionChunk[] = [];
    let chunkIndex = 0;

    const processNode = (node: OutlineNode, parentPath: string) => {
      const path = parentPath ? `${parentPath} > ${node.title}` : node.title;
      const start = node.startIndex;
      const end = node.endIndex || normalized.length;
      const sectionText = normalized.substring(start, end);

      if (sectionText.length <= maxChunkSize) {
        chunks.push({
          chunkIndex: chunkIndex++,
          text: sectionText,
          startIndex: start,
          sectionPath: path,
          sectionLevel: node.level,
        });
      } else {
        // 章节内容超长，按段落再切（兼容 \r\n 段落分隔，避免 CRLF 文档整段不切）
        const paragraphs = sectionText.split(/\r?\n\r?\n+/);
        let currentChunk = '';
        let currentStart = start;

        for (const para of paragraphs) {
          if ((currentChunk + para).length > maxChunkSize && currentChunk) {
            chunks.push({
              chunkIndex: chunkIndex++,
              text: currentChunk,
              startIndex: currentStart,
              sectionPath: path,
              sectionLevel: node.level,
            });
            currentChunk = para;
            currentStart = start + sectionText.indexOf(para, currentStart - start);
          } else {
            currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
          }
        }
        if (currentChunk) {
          chunks.push({
            chunkIndex: chunkIndex++,
            text: currentChunk,
            startIndex: currentStart,
            sectionPath: path,
            sectionLevel: node.level,
          });
        }
      }

      // 递归子节点
      if (node.children) {
        for (const child of node.children) {
          processNode(child, path);
        }
      }
    };

    for (const node of outline) {
      processNode(node, '');
    }

    return chunks;
  }

  /**
   * 一站式：提取 outline + 按章节切块
   *
   * 调用方（DEC_REVIEW handler）用法：
   * ```ts
   * const { outline, chunks } = ChunkSplitterService.splitTextBySection(markdown);
   * // outline 写入 TaskFile.outline（JSON）
   * // chunks 喂给完整性审核 + 遵从性审核双分支
   * ```
   */
  static splitTextBySection(text: string, maxChunkSize: number = 4000): {
    outline: OutlineNode[];
    chunks: SectionChunk[];
  } {
    // 归一化 CRLF → LF：Windows 文档若保留 \r，按 \n\n 切段会整体失效，
    // 且 extractOutline 里 \r 会残留进标题、字符偏移量错位。
    const normalized = text.replace(/\r\n/g, '\n');
    const outline = this.extractOutline(normalized);
    const chunks = this.splitBySection(normalized, outline, maxChunkSize);
    return { outline, chunks };
  }

  /**
   * 章节感知切块 + 纯文本兜底（P0 修复 2026-08-26）
   *
   * document 无 markdown 标题/数字编号结构时，splitTextBySection 返回空 chunks，
   * 下游 fact-check / text-style-check 的 for 循环一次都不进 → DEC 双分支整体空跑，
   * 用户看到「审查完成、0 问题」假合规报告。
   *
   * 本方法在空结果时回退 LlmService.splitText 字符分片：
   * - sectionPath 标记为「全文」+ 分片序号，提示调用方当前是无章节兜底模式
   * - 其余字段与章节 chunk 同构，调用方无需区分
   */
  static splitTextBySectionWithFallback(text: string, maxChunkSize: number = 4000): {
    outline: OutlineNode[];
    chunks: SectionChunk[];
    /** 是否走了纯文本兜底（原文无章节结构为 true，正常章节切块为 false） */
    usedFallback: boolean;
  } {
    const { outline, chunks } = this.splitTextBySection(text, maxChunkSize);
    if (chunks.length > 0) return { outline, chunks, usedFallback: false };

    const plainChunks = LlmService.splitText(text, maxChunkSize, true, 300) as TextChunk[];
    const fallbackChunks: SectionChunk[] = plainChunks.map((c, i) => ({
      chunkIndex: c.chunkIndex,
      text: c.text,
      startIndex: c.startIndex,
      sectionPath: `全文（第 ${i + 1}/${plainChunks.length} 段）`,
      sectionLevel: 0,
    }));
    return { outline, chunks: fallbackChunks, usedFallback: true };
  }
}
