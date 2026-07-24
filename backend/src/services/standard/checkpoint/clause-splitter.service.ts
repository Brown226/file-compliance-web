// backend/src/services/standard/checkpoint/clause-splitter.service.ts
/**
 * 条文切分器（路线 2 核心）— 从 Standard.content 按条文编号正则切分
 *
 * 数据源：Standard.content（纯文本，上传时由 doc-parser 提取，已落库）
 * 切分策略：按条文编号正则识别边界（如 "5.2.3"、"第5章"、"5.2.3 条"）
 * 过滤规则：丢弃过短（<20字）、无实质内容（纯图表标题/目录）的片段
 *
 * 不依赖 MaxKB，不依赖重新解析文件。
 */

import crypto from 'crypto';
import prisma from '../../../config/db';

export interface SplitClause {
  clauseCode: string | null;   // 条文编号（如 "5.2.3"），无法识别则为 null
  clauseText: string;          // 条文全文
  clauseHash: string;          // SHA-256 前 16 位，用于幂等去重
  orderIndex: number;          // 在原文中的顺序
}

export class ClauseSplitterService {
  /**
   * 从 Standard.content 切分条文
   */
  static async splitStandard(standardId: string): Promise<{
    standardId: string;
    totalClauses: number;
    clauses: SplitClause[];
  }> {
    const standard = await prisma.standard.findUnique({
      where: { id: standardId },
      select: { id: true, content: true, title: true },
    });

    if (!standard) {
      throw new Error(`标准 ${standardId} 不存在`);
    }
    if (!standard.content || standard.content.trim().length < 50) {
      throw new Error(`标准 ${standard.title} 无有效全文内容（content 为空或过短）`);
    }

    const clauses = this.splitText(standard.content);
    console.log(`[ClauseSplitter] 标准 "${standard.title}" 切分出 ${clauses.length} 条条文`);

    return {
      standardId,
      totalClauses: clauses.length,
      clauses,
    };
  }

  /**
   * 纯文本切分（不查库，可独立测试）
   */
  static splitText(text: string): SplitClause[] {
    const lines = text.split('\n');
    const clauses: SplitClause[] = [];
    let currentCode: string | null = null;
    let currentLines: string[] = [];
    let orderIndex = 0;

    const flush = () => {
      if (currentLines.length === 0) return;
      const clauseText = currentLines.join('\n').trim();
      // 过滤：过短（<20字）的片段丢弃（通常是图表标题/页眉）
      if (clauseText.length >= 20) {
        clauses.push({
          clauseCode: currentCode,
          clauseText,
          clauseHash: this.hashText(clauseText),
          orderIndex: orderIndex++,
        });
      }
      currentCode = null;
      currentLines = [];
    };

    for (const line of lines) {
      const code = this.detectClauseCode(line);
      if (code !== null) {
        // 遇到新条文编号，先 flush 上一条
        flush();
        currentCode = code;
        currentLines.push(line);
      } else {
        currentLines.push(line);
      }
    }
    flush();

    return clauses;
  }

  /**
   * 检测行首是否是条文编号
   * 返回编号字符串（如 "5.2.3"），或 null（非编号行）
   */
  private static detectClauseCode(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 数字层级编号：5 / 5.2 / 5.2.3 开头，后接空格/条/、/.
    const numericMatch = trimmed.match(/^(\d+(?:\.\d+){0,3})\s*[条节]?[、\.\s]/);
    if (numericMatch) {
      // 排除版本号误匹配（如 "2017年版"）
      if (trimmed.includes('年版') || trimmed.includes('版本')) return null;
      return numericMatch[1];
    }

    // 中文编号：第X章/节/条
    const chineseMatch = trimmed.match(/^第([一二三四五六七八九十百零\d]+)([章节条])/);
    if (chineseMatch) {
      return `第${chineseMatch[1]}${chineseMatch[2]}`;
    }

    return null;
  }

  /**
   * 计算文本 hash（SHA-256 前 16 位，用于幂等去重）
   */
  private static hashText(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex').substring(0, 16);
  }
}
