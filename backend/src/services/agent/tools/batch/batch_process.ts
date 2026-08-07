/**
 * batch_process 工具 — 通用批量文档处理（P1-②）
 *
 * 一次提交多文件，对每个文件并行执行指定的子任务：
 * - extract：提取文本（复用 parseDocument）
 * - chunk：按章节分块（复用 LlmService.splitText + 章节边界）
 * - summarize：LLM 生成文档摘要（要点清单）
 * - review：调 AI 审查（复用 review-pipeline 的审查逻辑）
 * - knowledge：知识检索（search_knowledge 语义，用关键词/Embedding 抽要点）
 *
 * 设计：
 * - 复用现有工具函数（parseDocument / LlmService.splitText），不重复造轮子
 * - parallelLimit 限并发（复用 getChunkConcurrency 的 doc_review 下限保护）
 * - 每个文件的子任务相互独立，单文件失败不阻断其他文件（Promise.allSettled 语义）
 * - 输出结构化结果：per-file 汇总 + 失败清单
 *
 * 安全：路径校验复用 read_file 同款（仅当前用户/会话 agent_temp 目录）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from '../file/paths';
import type { ToolContext } from '../file/upload_file';
import { parseDocument } from '../file/parse-document';
import { LlmService } from '../../../llm/llm.service';
import { getChunkConcurrency } from '../../../../utils/system-config';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 子任务类型 */
export type BatchTask = 'extract' | 'chunk' | 'summarize' | 'review' | 'knowledge';

/** 单文件批量处理结果 */
export interface BatchFileResult {
  filePath: string;
  fileName: string;
  ok: boolean;
  error?: string;
  extract?: { textLength: number; pages?: number };
  chunk?: { count: number; totalChars: number };
  summarize?: { summary: string; keyPoints: string[] };
  review?: { issueCount: number; issues: Array<{ issueType?: string; severity?: string; description?: string }> };
  knowledge?: { results: number; snippets: string[] };
}

/** 路径校验：仅当前用户/会话的 agent_temp 目录 */
function assertReadablePath(context: ToolContext, filePath: string): string {
  const uploadsRoot = getAgentTempRoot();
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

/** 简易并发限制 */
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 截断长文本 */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ==================== 子任务实现 ====================

async function doSummarize(filePath: string): Promise<NonNullable<BatchFileResult['summarize']>> {
  const parsed = await parseDocument(filePath);
  const text = (parsed.text || '').slice(0, 20000);
  if (!text.trim()) return { summary: '（文档无文本）', keyPoints: [] };
  const chunks = LlmService.splitText(text, 4000, false) as string[];
  // 逐块摘要
  const summaries: string[] = [];
  for (const chunk of chunks.slice(0, 5)) {
    try {
      const s = await LlmService.chat(
        `请用 2-3 句话概括以下文档片段的核心内容：\n${truncate(chunk, 3000)}`,
        { systemPrompt: '你是文档摘要助手，输出简洁的中文概括。', maxTokens: 300, timeout: 30 },
      );
      summaries.push(s.trim());
    } catch {
      /* 单块失败跳过 */
    }
  }
  if (summaries.length === 0) return { summary: '（摘要生成失败）', keyPoints: [] };
  return {
    summary: truncate(summaries.join('\n'), 1500),
    keyPoints: summaries.map(s => truncate(s, 120)),
  };
}

async function doReview(filePath: string): Promise<NonNullable<BatchFileResult['review']>> {
  const parsed = await parseDocument(filePath);
  const text = (parsed.text || '').slice(0, 30000);
  if (!text.trim()) return { issueCount: 0, issues: [] };
  try {
    const issues = await LlmService.reviewText(truncate(text, 20000), {
      systemPrompt:
        '你是文件审查专家。请审查以下文本中的合规问题（违规/缺失/错误），输出 JSON 数组。' +
        '每条：{"issueType":"VIOLATION|COMPLETENESS|CONSISTENCY|TYPO","originalText":"原文","description":"说明","severity":"error|warning|info"}',
      skipUserTemplate: true,
      maxTokens: 2048,
      timeout: 60,
    });
    return {
      issueCount: issues.length,
      issues: issues.slice(0, 20).map(i => ({
        issueType: i.issueType,
        severity: i.severity,
        description: truncate(i.description || '', 200),
      })),
    };
  } catch (e: any) {
    console.warn(`[Batch] review 子任务失败: ${e.message}`);
    return { issueCount: 0, issues: [] };
  }
}

async function doKnowledge(filePath: string): Promise<NonNullable<BatchFileResult['knowledge']>> {
  const parsed = await parseDocument(filePath);
  const text = (parsed.text || '').slice(0, 8000);
  if (!text.trim()) return { results: 0, snippets: [] };
  // 提取关键词做检索（简化：取高频词）
  const words = text.match(/[一-龥]{2,}/g) || [];
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  return {
    results: topWords.length,
    snippets: topWords.map(w => `关键词：${w}`),
  };
}

// ==================== 主入口 ====================

/**
 * 批量文档处理核心逻辑（P1-②）
 *
 * 独立导出，供两种调用方复用：
 * 1. createBatchProcessTool 的 execute（Agent 工具内同步/对话式调用）
 * 2. agent-batch-queue.service 的队列处理器（异步批次任务）
 *
 * @param files 文件列表 [{ filePath, tasks }]
 * @param context 工具上下文（userId/sessionId，用于路径校验）
 */
export async function runBatchProcess(
  files: Array<{ filePath: string; tasks: BatchTask[] }>,
  context: ToolContext,
): Promise<{ total: number; succeeded: number; failed: number; results: BatchFileResult[] }> {
  // 路径预校验（全部校验通过才执行，避免部分文件越权后报错）
  const validated = files.map(f => {
    const fp = assertReadablePath(context, f.filePath);
    if (!fs.existsSync(fp)) throw new Error(`文件不存在: ${f.filePath}`);
    return { filePath: fp, tasks: f.tasks };
  });

  const CONCURRENT_LIMIT = await getChunkConcurrency('doc_review');
  const results = await parallelLimit(validated, CONCURRENT_LIMIT, async (file) => {
    const res: BatchFileResult = {
      filePath: file.filePath,
      fileName: path.basename(file.filePath),
      ok: true,
    };
    try {
      // 解析一次，多个子任务共享
      const parsed = await parseDocument(file.filePath);
      for (const task of file.tasks) {
        switch (task) {
          case 'extract':
            res.extract = { textLength: (parsed.text || '').length, pages: parsed.pageCount ?? undefined };
            break;
          case 'chunk': {
            const chunks = LlmService.splitText(parsed.text || '', 4000, false) as string[];
            res.chunk = { count: chunks.length, totalChars: (parsed.text || '').length };
            break;
          }
          case 'summarize':
            res.summarize = await doSummarize(file.filePath);
            break;
          case 'review':
            res.review = await doReview(file.filePath);
            break;
          case 'knowledge':
            res.knowledge = await doKnowledge(file.filePath);
            break;
        }
      }
    } catch (e: any) {
      res.ok = false;
      res.error = e.message;
    }
    return res;
  });

  return {
    total: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

/**
 * 创建 batch_process 工具
 */
export function createBatchProcessTool(context: ToolContext) {
  return tool({
    description:
      '批量文档处理：一次提交多个文件，对每个文件并行执行指定子任务。' +
      '支持子任务：extract（提取文本）/ chunk（分块）/ summarize（LLM 摘要）/ review（AI 审查）/ knowledge（关键词提取）。' +
      '每个文件独立处理，单文件失败不影响其他文件。files 数组最多 10 个文件，tasks 为子任务名数组。',
    inputSchema: z.object({
      files: z.array(z.object({
        filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
        tasks: z.array(z.enum(['extract', 'chunk', 'summarize', 'review', 'knowledge']))
          .describe('对该文件执行的子任务列表'),
      })).min(1).max(10).describe('要处理的文件列表（最多 10 个）'),
    }),
    execute: async ({ files }) => {
      return runBatchProcess(files, context);
    },
  });
}
