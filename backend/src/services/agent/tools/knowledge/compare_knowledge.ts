/**
 * compare_knowledge 工具 — 多文档对比问答（P2-⑩）
 *
 * 就同一问题对比 A/B 两份文档（或两个知识库片段）的表述是否一致。
 *
 * 逻辑：
 * 1. 用 parseDocument 解析两份文档（doc-parser / 纯文本直读）
 * 2. 从每份文档提取段落，按与 query 的相关度筛选出 topN 相关片段
 *    （优先用 EmbeddingService 语义打分，失败降级关键词加权——内网环境稳妥）
 * 3. 调 LLM 比对：对每个主题点判断 一致/不一致/缺失
 * 4. 输出结构化结论
 *
 * 输出：
 * - conclusion: LLM 整体结论
 * - items: [{ topic, status: 'consistent'|'inconsistent'|'missing', docAText, docBText }]
 * - docAHits / docBHits: 各自检索到的相关片段数
 * - totalCompared: 比对的片段对数
 *
 * 验收标准对照：
 * - 同一文档不同版本对比能识别实质差异 → LLM 比对不一致标红
 * - 表述不一致的主题标记「不一致」并给出双方原文
 * - A 有 B 无的主题标「缺失」
 * - 无相关片段时明确返回「未检索到可比对内容」
 *
 * 安全：文件路径复用 read_file 同款校验（仅限 agent_temp 当前会话目录）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { parseDocument } from '../file/parse-document';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 比对项 */
interface CompareItem {
  topic: string;
  status: 'consistent' | 'inconsistent' | 'missing';
  docAText?: string;
  docBText?: string;
}

interface CompareResult {
  conclusion: string;
  items: CompareItem[];
  docAHits: number;
  docBHits: number;
  totalCompared: number;
}

/** 路径校验：只能访问当前用户/会话的 agent_temp 文件 */
function assertReadablePath(context: ToolContext, filePath: string): string {
  const uploadsRoot = path.join(__dirname, '../../../../../uploads/agent_temp');
  const normalizedRoot = path.resolve(uploadsRoot);
  const normalizedPath = path.resolve(filePath);
  if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
    throw new Error('路径越权：只能读取 Agent 临时目录下的文件');
  }
  const expectedUserDir = path.join(normalizedRoot, context.userId);
  if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
    throw new Error('路径越权：只能读取当前用户上传的文件');
  }
  return normalizedPath;
}

/** 提取文档段落（兼容 structure.paragraphs 元素为字符串或对象；兜底按空行切） */
function extractParagraphs(parsed: { text: string; structure: any }): Array<{ text: string; sectionTitle?: string }> {
  const paras = parsed.structure?.paragraphs;
  if (Array.isArray(paras) && paras.length > 0) {
    let currentTitle: string | undefined;
    const result: Array<{ text: string; sectionTitle?: string }> = [];
    for (const p of paras) {
      // 兼容字符串元素（txt 直读时 paragraphs 可能是整份文本的单个字符串）
      const rawText = typeof p === 'string' ? p : p?.text;
      const text = (rawText || '').trim();
      if (!text) continue;
      const style = typeof p === 'object' ? (p?.style || '').toLowerCase() : '';
      const isHeading = style.startsWith('heading') || style === 'title';
      if (isHeading) currentTitle = text;
      result.push({ text, sectionTitle: isHeading ? undefined : currentTitle });
    }
    // 若整份文档被当作单一段落（无空行分隔的纯文本），按行拆分成多个段落以便按主题筛选
    if (result.length === 1 && result[0].text.includes('\n')) {
      return result[0].text
        .split('\n')
        .map(t => t.trim())
        .filter(Boolean)
        .map(text => ({ text }));
    }
    return result;
  }
  return parsed.text
    .split(/\n\s*\n/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(text => ({ text }));
}

/**
 * 按 query 相关度筛选 topN 段落
 * 优先 EmbeddingService 语义打分；失败降级关键词加权（词重叠 + 位置靠前加分）
 */
async function selectRelevantParagraphs(
  query: string,
  paragraphs: Array<{ text: string; sectionTitle?: string }>,
  topN: number,
): Promise<Array<{ text: string; sectionTitle?: string; score: number }>> {
  if (paragraphs.length === 0) return [];
  const qTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  // 尝试语义打分（内网 embedding 服务可能不可用，2s 超时后静默降级关键词）
  try {
    const { EmbeddingService } = require('../../../knowledge/embedding.service');
    const timeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('embedding 超时')), ms))]);
    const qVec = (await timeout(EmbeddingService.embedText(query), 2000)) as number[];
    const texts = paragraphs.map(p => p.text.slice(0, 500));
    const vecs = (await timeout(EmbeddingService.embedTexts(texts), 4000)) as number[][];
    const scored = paragraphs.map((p, i) => {
      const va = vecs[i] || [];
      const score = cosineSimilarity(qVec, va);
      return { ...p, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, topN);
  } catch {
    // 降级：关键词加权
    const scored = paragraphs.map((p, i) => {
      const lower = p.text.toLowerCase();
      let score = 0;
      for (const t of qTerms) {
        const idx = lower.indexOf(t);
        if (idx >= 0) score += 1 + 0.5 / (1 + idx / 200); // 靠前出现加分
      }
      // 与 query 的词重叠率
      const overlap = qTerms.filter(t => lower.includes(t)).length;
      score += overlap * 2;
      // 轻微偏向靠前段落
      score += Math.max(0, 1 - i / paragraphs.length);
      return { ...p, score };
    });
    // 阈值过滤：一个词都没命中的段落（score < 1 仅位置加分）视为不相关
    const relevant = scored.filter(s => s.score >= 1);
    if (relevant.length === 0) return [];
    return relevant.sort((a, b) => b.score - a.score).slice(0, topN);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 截断长文本（避免 prompt 过大） */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * 调 LLM 做主题级一致性比对
 * 输入：query + A/B 相关片段，输出结构化 JSON 数组
 */
async function llmCompare(
  query: string,
  docAName: string,
  docBName: string,
  selA: Array<{ text: string; sectionTitle?: string }>,
  selB: Array<{ text: string; sectionTitle?: string }>,
): Promise<CompareResult> {
  const { LlmService } = require('../../../llm/llm.service');

  const systemPrompt =
    '你是文档一致性比对助手。给定一个查询主题和两份文档（A/B）的相关片段，' +
    '逐主题点判断两份文档表述是否一致。' +
    '输出严格的 JSON 对象：{"conclusion": "整体结论（简洁中文）", "items": [{"topic": "主题点", "status": "consistent|inconsistent|missing", "docAText": "A 中表述（可空）", "docBText": "B 中表述（可空）"}]}。' +
    '规则：A 有 B 无的主题 status=missing；B 有 A 无的也 status=missing（docAText 留空）；' +
    '表述冲突/不一致 status=inconsistent；表述一致 status=consistent。' +
    'status 只允许这三种值。最多输出 10 个主题点。';

  const userPrompt = `查询主题：${query}\n\n【文档A：${docAName}】相关片段：\n` +
    selA.map((p, i) => `${i + 1}. ${p.sectionTitle ? `[${p.sectionTitle}] ` : ''}${truncate(p.text, 800)}`).join('\n') +
    `\n\n【文档B：${docBName}】相关片段：\n` +
    selB.map((p, i) => `${i + 1}. ${p.sectionTitle ? `[${p.sectionTitle}] ` : ''}${truncate(p.text, 800)}`).join('\n');

  try {
    const raw = await LlmService.chat(userPrompt, { systemPrompt, mode: 'agent' });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 未返回 JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    const items: CompareItem[] = (parsed.items || []).slice(0, 10).map((it: any) => ({
      topic: String(it.topic || '未命名主题'),
      status: ['consistent', 'inconsistent', 'missing'].includes(it.status) ? it.status : 'consistent',
      docAText: it.docAText ? truncate(String(it.docAText), 500) : undefined,
      docBText: it.docBText ? truncate(String(it.docBText), 500) : undefined,
    }));
    return {
      conclusion: truncate(String(parsed.conclusion || '未生成结论'), 1000),
      items,
      docAHits: selA.length,
      docBHits: selB.length,
      totalCompared: items.length,
    };
  } catch (e: any) {
    console.warn('[compare_knowledge] LLM 比对失败，降级返回片段统计:', (e as Error).message);
    return {
      conclusion: `LLM 比对失败（${(e as Error).message}），仅返回片段统计`,
      items: [],
      docAHits: selA.length,
      docBHits: selB.length,
      totalCompared: 0,
    };
  }
}

/**
 * 创建 compare_knowledge 工具
 */
export function createCompareKnowledgeTool(context: ToolContext) {
  return tool({
    description:
      '多文档对比问答：就同一查询主题对比两份文档的表述是否一致。解析两份文档后按相关度筛选片段，LLM 逐主题点判断 一致/不一致/缺失。适用于新旧版本规范对比、两份制度文件表述核对等场景。参数 docAPath/docBPath 为服务端文件绝对路径（由 upload_file 返回）。',
    inputSchema: z.object({
      query: z.string().min(1).describe('对比查询主题（如「接地电阻要求」「消防疏散距离」）'),
      docAPath: z.string().describe('文档A的服务端绝对路径'),
      docBPath: z.string().describe('文档B的服务端绝对路径'),
      topNumber: z.number().int().min(1).max(10).optional().default(5).describe('每份文档筛选的相关片段数（默认 5）'),
    }),
    execute: async ({ query, docAPath, docBPath, topNumber }): Promise<CompareResult> => {
      const aPath = assertReadablePath(context, docAPath);
      const bPath = assertReadablePath(context, docBPath);
      if (!fs.existsSync(aPath)) throw new Error(`文档A不存在: ${docAPath}`);
      if (!fs.existsSync(bPath)) throw new Error(`文档B不存在: ${docBPath}`);

      const docAName = path.basename(aPath);
      const docBName = path.basename(bPath);

      const [aParsed, bParsed] = await Promise.all([parseDocument(aPath), parseDocument(bPath)]);
      const aParas = extractParagraphs(aParsed);
      const bParas = extractParagraphs(bParsed);

      const topN = Math.min(topNumber || 5, 10);
      const selA = await selectRelevantParagraphs(query, aParas, topN);
      const selB = await selectRelevantParagraphs(query, bParas, topN);

      // 无相关片段：明确提示
      if (selA.length === 0 && selB.length === 0) {
        return {
          conclusion: '未检索到可比对内容',
          items: [],
          docAHits: 0,
          docBHits: 0,
          totalCompared: 0,
        };
      }
      if (selA.length === 0) {
        return {
          conclusion: `文档A（${docAName}）未检索到与「${query}」相关的内容，无法比对`,
          items: [],
          docAHits: 0,
          docBHits: selB.length,
          totalCompared: 0,
        };
      }
      if (selB.length === 0) {
        return {
          conclusion: `文档B（${docBName}）未检索到与「${query}」相关的内容，无法比对`,
          items: [],
          docAHits: selA.length,
          docBHits: 0,
          totalCompared: 0,
        };
      }

      return llmCompare(query, docAName, docBName, selA, selB);
    },
  });
}
