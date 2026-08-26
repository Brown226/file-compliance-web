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
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from './paths';
import type { ToolContext } from './upload_file';
import { parseDocument } from './parse-document';
import { LlmService } from '../../../llm/llm.service';

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
  /** 降级说明：段落规模超 LCS 上限时用简化窗口对齐，结果非 LCS 精确（2026 P0-2 新增） */
  degraded?: string;
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
 * 段落级 diff 的 LCS 单元格上限。
 * (m+1)×(n+1) 表随段落数平方膨胀：超过上限（约 500×500 段）时改用
 * O((m+n)×W) 的简化窗口对齐，避免万级段落 OOM / 长时间卡死（2026 P0-2）。
 */
const LCS_MAX_CELLS = 250_000;

/** 同位置替换判定为 "modified" 的相似度阈值（字符集 Jaccard） */
const MODIFIED_SIMILARITY_THRESHOLD = 0.6;

/** 简化窗口对齐的向前搜索窗口大小 */
const DEGRADED_WINDOW = 8;

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
 * 文本相似度 — 字符集合 Jaccard（O(n)，段落级快速判定）。
 * 归一化空白后比较字符集合：仅增删少量字符的两段得分高，
 * 完全不相关的中文段落得分低。
 */
function textSimilarity(a: string, b: string): number {
  const na = a.replace(/\s+/g, '');
  const nb = b.replace(/\s+/g, '');
  if (!na || !nb) return 0;
  const setA = new Set(na);
  const setB = new Set(nb);
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 用 LCS dp 表回溯生成段落级 diff
 *
 * 策略：
 * - 相同段落（完全一致或仅空白差异）→ unchanged，跳过
 * - 对角线方向最优（同位置替换）且相似度达阈值 → modified（2026 P0-2 补全）
 * - 旧段落被删除 → removed
 * - 新段落被新增 → added
 */
function diffParagraphs(oldParas: Array<{ text: string; sectionTitle?: string }>, newParas: Array<{ text: string; sectionTitle?: string }>): ParagraphDiff[] {
  const a = oldParas.map(p => p.text);
  const b = newParas.map(p => p.text);
  const dp = lcsTable(a, b);
  const changes: ParagraphDiff[] = [];

  let i = oldParas.length;
  let j = newParas.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i--; j--;
    } else if (dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
      // 对角线方向最优 → 视为同位置替换：相似度高 → modified；仅空白差异 → 跳过；
      // 相似度不足不强行配对 → 按删除+新增处理
      const oldP = oldParas[i - 1];
      const newP = newParas[j - 1];
      if (isSameText(oldP.text, newP.text)) {
        i--; j--;
      } else if (textSimilarity(oldP.text, newP.text) >= MODIFIED_SIMILARITY_THRESHOLD) {
        changes.unshift({
          type: 'modified', oldIndex: i - 1, newIndex: j - 1,
          oldText: oldP.text, newText: newP.text,
          sectionTitle: newP.sectionTitle || oldP.sectionTitle,
        });
        i--; j--;
      } else {
        changes.unshift({ type: 'removed', oldIndex: i - 1, newIndex: -1, oldText: oldP.text, sectionTitle: oldP.sectionTitle });
        changes.unshift({ type: 'added', oldIndex: -1, newIndex: j - 1, newText: newP.text, sectionTitle: newP.sectionTitle });
        i--; j--;
      }
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // 旧段落被删除；若与新段落内容仅空白差异 → 视为未变更（不误报为修改，验收标准 3）
      const oldP = oldParas[i - 1];
      const newP = j > 0 && i > 0 ? newParas[j - 1] : undefined;
      if (newP && isSameText(oldP.text, newP.text)) {
        i--; j--;
      } else {
        changes.unshift({ type: 'removed', oldIndex: i - 1, newIndex: -1, oldText: oldP.text, sectionTitle: oldP.sectionTitle });
        i--;
      }
    } else {
      const newP = newParas[j - 1];
      const oldP = i > 0 && j > 0 ? oldParas[i - 1] : undefined;
      if (oldP && isSameText(oldP.text, newP.text)) {
        // 内容仅空白差异 → 视为未变更（不误报为修改）
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

/**
 * 简化窗口对齐（LCS 超限降级）— O((m+n)×WINDOW)，无限段数场景线性可用。
 * 双指针向前小窗口查找相同段：窗口内命中 → 区间标 removed/added；
 * 同位置未命中且相似度高 → 合并为 modified。局部大量重排时结果比 LCS 粗糙，
 * 由调用方在返回中标注 degraded 让 LLM 知晓。
 */
function windowAlignedDiff(
  oldParas: Array<{ text: string; sectionTitle?: string }>,
  newParas: Array<{ text: string; sectionTitle?: string }>,
): ParagraphDiff[] {
  const changes: ParagraphDiff[] = [];
  const W = DEGRADED_WINDOW;
  let iOld = 0;
  let iNew = 0;
  while (iOld < oldParas.length && iNew < newParas.length) {
    if (oldParas[iOld].text === newParas[iNew].text) {
      iOld++; iNew++; continue;
    }
    // 在新列表窗口内找旧段
    let foundNew = -1;
    for (let k = iNew + 1; k <= Math.min(iNew + W, newParas.length - 1); k++) {
      if (oldParas[iOld].text === newParas[k].text) { foundNew = k; break; }
    }
    if (foundNew !== -1) {
      for (let k = iNew; k < foundNew; k++) {
        changes.push({ type: 'added', oldIndex: -1, newIndex: k, newText: newParas[k].text, sectionTitle: newParas[k].sectionTitle });
      }
      iNew = foundNew + 1; iOld++;
      continue;
    }
    // 在旧列表窗口内找新段
    let foundOld = -1;
    for (let k = iOld + 1; k <= Math.min(iOld + W, oldParas.length - 1); k++) {
      if (newParas[iNew].text === oldParas[k].text) { foundOld = k; break; }
    }
    if (foundOld !== -1) {
      for (let k = iOld; k < foundOld; k++) {
        changes.push({ type: 'removed', oldIndex: k, newIndex: -1, oldText: oldParas[k].text, sectionTitle: oldParas[k].sectionTitle });
      }
      iOld = foundOld + 1; iNew++;
      continue;
    }
    // 窗口内均未命中：同位置相似度高 → modified，否则 removed+added
    const oldP = oldParas[iOld];
    const newP = newParas[iNew];
    if (isSameText(oldP.text, newP.text)) {
      iOld++; iNew++; // 空白差异视为未变更
    } else if (textSimilarity(oldP.text, newP.text) >= MODIFIED_SIMILARITY_THRESHOLD) {
      changes.push({ type: 'modified', oldIndex: iOld, newIndex: iNew, oldText: oldP.text, newText: newP.text, sectionTitle: newP.sectionTitle || oldP.sectionTitle });
      iOld++; iNew++;
    } else {
      changes.push({ type: 'removed', oldIndex: iOld, newIndex: -1, oldText: oldP.text, sectionTitle: oldP.sectionTitle });
      changes.push({ type: 'added', oldIndex: -1, newIndex: iNew, newText: newP.text, sectionTitle: newP.sectionTitle });
      iOld++; iNew++;
    }
  }
  while (iOld < oldParas.length) {
    changes.push({ type: 'removed', oldIndex: iOld, newIndex: -1, oldText: oldParas[iOld].text, sectionTitle: oldParas[iOld].sectionTitle });
    iOld++;
  }
  while (iNew < newParas.length) {
    changes.push({ type: 'added', oldIndex: -1, newIndex: iNew, newText: newParas[iNew].text, sectionTitle: newParas[iNew].sectionTitle });
    iNew++;
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
export function createCompareDocumentsTool(context: ToolContext) {
  return tool({
    description: '对比两份文档（旧版 vs 新版），输出段落级差异（新增/删除/修改块）+ 变更统计 + LLM 变更摘要。适用于合同修订版核对、制度新旧版本对比等场景。参数 oldFilePath/newFilePath 为服务端文件绝对路径（由 upload_file 返回）。',
    inputSchema: z.object({
      oldFilePath: z.string().describe('旧版本文档的服务端绝对路径'),
      newFilePath: z.string().describe('新版本文档的服务端绝对路径'),
      withSummary: z.boolean().optional().default(true)
        .describe('是否生成 LLM 变更语义摘要（默认 true，变更过多/过少时自动跳过）'),
    }),
    execute: async ({ oldFilePath, newFilePath, withSummary }): Promise<CompareResult> => {
      // 路径安全校验（与 read_file 同款）：只能对比 Agent 临时目录下当前用户的文件
      const uploadsRoot = getAgentTempRoot();
      const normalizedRoot = path.resolve(uploadsRoot);
      for (const filePath of [oldFilePath, newFilePath]) {
        const normalizedPath = path.resolve(filePath);
        if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
          throw new Error('路径越权：只能读取 Agent 临时目录下的文件');
        }
        const expectedUserDir = path.join(normalizedRoot, context.userId);
        if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
          throw new Error('路径越权：只能读取当前用户上传的文件');
        }
      }

      if (!fs.existsSync(oldFilePath)) throw new Error(`旧文件不存在: ${oldFilePath}`);
      if (!fs.existsSync(newFilePath)) throw new Error(`新文件不存在: ${newFilePath}`);

      const oldParsed = await parseDocument(oldFilePath);
      const newParsed = await parseDocument(newFilePath);

      const oldParas = extractParagraphs(oldParsed);
      const newParas = extractParagraphs(newParsed);

      // P0-2：LCS 单元格上限保护 — (m+1)×(n+1) 表超限时降级为简化窗口对齐，
      // 避免万级段落 OOM / 长时间卡死；降级结果标注 degraded 供 LLM 知晓近似性
      let diffs: ParagraphDiff[];
      let degraded: string | undefined;
      if (oldParas.length * newParas.length > LCS_MAX_CELLS) {
        diffs = windowAlignedDiff(oldParas, newParas);
        degraded = `段落规模超 LCS 上限（旧 ${oldParas.length} × 新 ${newParas.length} = ${oldParas.length * newParas.length} 单元格），已降级为简化窗口对齐，结果可能遗漏局部重排的精确还原`;
        console.warn(`[compare_documents] ${degraded}`);
      } else {
        diffs = diffParagraphs(oldParas, newParas);
      }

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

      const result: CompareResult = {
        changes,
        stats,
        summary,
        totalChanges: diffs.length,
        ...(degraded ? { degraded } : {}),
      };
      return result;
    },
  });
}
