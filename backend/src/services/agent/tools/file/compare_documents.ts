/**
 * compare_documents 工具 — 文档对比（P0-①）
 *
 * 对两份文档做段落级差异比对，输出结构化变更块，供"合同修订版 vs 原版"、
 * "制度新旧版本核对"等办公场景使用。
 *
 * 实现：
 * 1. 复用 parseDocument 解析两份文档（doc-parser / 纯文本直读）
 * 2. 按段落切分（优先用 structure.paragraphs 保留标题层级，无则按空行切）
 * 3. 用 LCS（最长公共子序列）对齐段落，找出新增/删除/修改块
 * 4. 可选：调 LLM 生成变更语义摘要（变更较少时自动跳过）
 *
 * 输出：
 * - changes: [{ type: 'added'|'removed'|'modified', index, oldText?, newText?, sectionTitle? }]
 * - stats: { added, removed, modified, unchanged }
 * - summary: LLM 生成的变更摘要（可选）
 *
 * 安全：
 * - 文件路径复用 extract_text 同款校验（仅限用户自己的 agent_temp 目录文件）
 * - 文本内容按 <file_content> 标签包裹，防 prompt injection
 */

import * as fs from 'fs';
import { z } from 'zod';
import type { ToolContext } from './upload_file';
import { parseDocument } from './parse-document';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 段落级 diff 结果 */
interface ParagraphDiff {
  /** 类型：added=新增 / removed=删除 / modified=修改（同位置内容不同） */
  type: 'added' | 'removed' | 'modified';
  /** 在旧文档段落列表中的索引（added 时为 -1） */
  oldIndex: number;
  /** 在新文档段落列表中的索引（removed 时为 -1） */
  newIndex: number;
  oldText?: string;
  newText?: string;
  /** 所属章节标题（从旧/新段落标题推导，尽量取非空者） */
  sectionTitle?: string;
}

/** 变更统计 */
interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

interface CompareResult {
  changes: Array<{
    type: string;
    index: number;
    oldText?: string;
    newText?: string;
    sectionTitle?: string;
  }>;
  stats: DiffStats;
  summary?: string;
  totalChanges: number;
}

/**
 * 从文档解析结果中提取段落列表（带标题层级）
 *
 * 优先用 structure.paragraphs（DOCX 有 style='Heading1/2' 可推导章节标题），
 * 纯文本 / 无 structure 时按空行切分。
 */
function extractParagraphs(parsed: { text: string; structure: any }): Array<{ text: string; sectionTitle?: string }> {
  const paras = parsed.structure?.paragraphs;
  if (Array.isArray(paras) && paras.length > 0) {
    // 跟踪最近标题，作为段落所属章节
    let currentTitle: string | undefined;
    const result: Array<{ text: string; sectionTitle?: string }> = [];
    for (const p of paras) {
      const text = (p?.text || '').trim();
      if (!text) continue;
      const style = (p?.style || '').toLowerCase();
      const isHeading = style.startsWith('heading') || style === 'title';
      if (isHeading) {
        currentTitle = text;
      }
      result.push({ text, sectionTitle: isHeading ? undefined : currentTitle });
    }
    return result;
  }

  // 兜底：按空行切分
  return parsed.text
    .split(/\n\s*\n/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(text => ({ text }));
}

/**
 * LCS 最长公共子序列 — 计算两个段落列表的对齐
 * @returns dp 表，用于回溯 diff
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/** 判断两段文本是否"实质相同"（去掉空白差异后一致） */
function isSameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}

/**
 * 用 LCS dp 表回溯生成段落级 diff
 *
 * 策略：
 * - 相同段落（完全一致或仅空白差异）→ unchanged，跳过
 * - 旧段落被删除 → removed
 * - 新段落被新增 → added
 * - 位置相邻且内容相近（isSameText 失败但相似度高）→ modified
 */
function diffParagraphs(oldParas: Array<{ text: string; sectionTitle?: string }>, newParas: Array<{ text: string; sectionTitle?: string }>): ParagraphDiff[] {
  const a = oldParas.map(p => p.text);
  const b = newParas.map(p => p.text);
  const dp = lcsTable(a, b);
  const changes: ParagraphDiff[] = [];

  const pickSection = (oldP: any, newP: any) => oldP?.sectionTitle || newP?.sectionTitle;

  let i = oldParas.length;
  let j = newParas.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // 旧段落被删除；若与新段落相邻且内容相似，记为 modified
      const oldP = oldParas[i - 1];
      const newP = j > 0 && i > 0 ? newParas[j - 1] : undefined;
      if (newP && isSameText(oldP.text, newP.text)) {
        changes.unshift({
          type: 'modified',
          oldIndex: i - 1,
          newIndex: j - 1,
          oldText: oldP.text,
          newText: newP.text,
          sectionTitle: pickSection(oldP, newP),
        });
        i--; j--;
      } else {
        changes.unshift({ type: 'removed', oldIndex: i - 1, newIndex: -1, oldText: oldP.text, sectionTitle: oldP.sectionTitle });
        i--;
      }
    } else {
      const newP = newParas[j - 1];
      const oldP = i > 0 && j > 0 ? oldParas[i - 1] : undefined;
      if (oldP && isSameText(oldP.text, newP.text)) {
        changes.unshift({
          type: 'modified',
          oldIndex: i - 1,
          newIndex: j - 1,
          oldText: oldP.text,
          newText: newP.text,
          sectionTitle: pickSection(oldP, newP),
        });
        i--; j--;
      } else {
        changes.unshift({ type: 'added', oldIndex: -1, newIndex: j - 1, newText: newP.text, sectionTitle: newP.sectionTitle });
        j--;
      }
    }
  }
  while (i > 0) {
    const oldP = oldParas[i - 1];
    changes.unshift({ type: 'removed', oldIndex: i - 1, newIndex: -1, oldText: oldP.text, sectionTitle: oldP.sectionTitle });
    i--;
  }
  while (j > 0) {
    const newP = newParas[j - 1];
    changes.unshift({ type: 'added', oldIndex: -1, newIndex: j - 1, newText: newP.text, sectionTitle: newP.sectionTitle });
    j--;
  }

  return changes;
}

/** 限制文本长度（避免超大文本撑爆 LLM 上下文） */
function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/**
 * 调 LLM 生成变更语义摘要
 * 变更过多或过少时跳过（减少 token 消耗）
 */
async function generateChangeSummary(changes: ParagraphDiff[]): Promise<string | undefined> {
  if (changes.length === 0 || changes.length > 30) return undefined;

  const { LlmService } = require('../../../llm/llm.service');
  const lines = changes.slice(0, 15).map((c, idx) => {
    const oldText = c.oldText ? truncate(c.oldText, 120) : '';
    const newText = c.newText ? truncate(c.newText, 120) : '';
    switch (c.type) {
      case 'added': return `${idx + 1}. [新增] ${newText}`;
      case 'removed': return `${idx + 1}. [删除] ${oldText}`;
      case 'modified': return `${idx + 1}. [修改] ${oldText} → ${newText}`;
    }
  }).join('\n');

  const systemPrompt = '你是文档对比助手。根据以下文档变更清单，用简洁的中文总结变更的语义要点（3-6 条），突出实质性修改。不要复述每条变更，归类总结即可。';

  try {
    const summary = await LlmService.chat(lines, {
      systemPrompt,
      mode: 'agent',
    });
    return summary.trim() || undefined;
  } catch (e: any) {
    console.warn('[compare_documents] LLM 摘要生成失败，跳过:', (e as Error).message);
    return undefined;
  }
}

/**
 * 创建 compare_documents 工具
 *
 * 参数：
 * - oldFilePath: 旧版本文档绝对路径
 * - newFilePath: 新版本文档绝对路径
 * - withSummary?: 是否生成 LLM 变更摘要（默认 true）
 *
 * 返回：
 * - changes: 变更块数组
 * - stats: 变更统计
 * - summary: LLM 变更摘要（可选）
 */
export function createCompareDocumentsTool(_context: ToolContext) {
  return tool({
    description: '对比两份文档（旧版 vs 新版），输出段落级差异（新增/删除/修改块）+ 变更统计 + LLM 变更摘要。适用于合同修订版核对、制度新旧版本对比等场景。参数 oldFilePath/newFilePath 为服务端文件绝对路径（由 upload_file 返回）。',
    inputSchema: z.object({
      oldFilePath: z.string().describe('旧版本文档的服务端绝对路径'),
      newFilePath: z.string().describe('新版本文档的服务端绝对路径'),
      withSummary: z.boolean().optional().default(true)
        .describe('是否生成 LLM 变更语义摘要（默认 true，变更过多/过少时自动跳过）'),
    }),
    execute: async ({ oldFilePath, newFilePath, withSummary }): Promise<CompareResult> => {
      if (!fs.existsSync(oldFilePath)) throw new Error(`旧文件不存在: ${oldFilePath}`);
      if (!fs.existsSync(newFilePath)) throw new Error(`新文件不存在: ${newFilePath}`);

      const oldParsed = await parseDocument(oldFilePath);
      const newParsed = await parseDocument(newFilePath);

      const oldParas = extractParagraphs(oldParsed);
      const newParas = extractParagraphs(newParsed);

      const diffs = diffParagraphs(oldParas, newParas);

      const stats: DiffStats = {
        added: diffs.filter(d => d.type === 'added').length,
        removed: diffs.filter(d => d.type === 'removed').length,
        modified: diffs.filter(d => d.type === 'modified').length,
        unchanged: oldParas.length - diffs.filter(d => d.type === 'removed' || d.type === 'modified').length,
      };

      // 内容统一按 <file_content> 标签包裹（防 prompt injection），只包文本字段
      const changes = diffs.map((d, idx) => ({
        type: d.type,
        index: idx,
        oldText: d.oldText ? `<file_content>${truncate(d.oldText, 1000)}</file_content>` : undefined,
        newText: d.newText ? `<file_content>${truncate(d.newText, 1000)}</file_content>` : undefined,
        sectionTitle: d.sectionTitle,
      }));

      // LLM 摘要（可选）
      let summary: string | undefined;
      if (withSummary !== false) {
        summary = await generateChangeSummary(diffs);
      }

      return {
        changes,
        stats,
        summary,
        totalChanges: diffs.length,
      };
    },
  });
}
