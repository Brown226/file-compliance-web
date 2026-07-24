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
    const lines = text.split('\n');
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
    const chunks: SectionChunk[] = [];
    let chunkIndex = 0;

    const processNode = (node: OutlineNode, parentPath: string) => {
      const path = parentPath ? `${parentPath} > ${node.title}` : node.title;
      const start = node.startIndex;
      const end = node.endIndex || text.length;
      const sectionText = text.substring(start, end);

      if (sectionText.length <= maxChunkSize) {
        chunks.push({
          chunkIndex: chunkIndex++,
          text: sectionText,
          startIndex: start,
          sectionPath: path,
          sectionLevel: node.level,
        });
      } else {
        // 章节内容超长，按段落再切
        const paragraphs = sectionText.split(/\n\n+/);
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
    const outline = this.extractOutline(text);
    const chunks = this.splitBySection(text, outline, maxChunkSize);
    return { outline, chunks };
  }
}
