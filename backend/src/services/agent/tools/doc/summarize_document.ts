/**
 * summarize_document 工具 — 文档摘要（P1-④）
 *
 * 按章/按页生成文档摘要 + 要点清单。
 *
 * 逻辑：
 * 1. parseDocument 解析文档 → 文本
 * 2. 按 4000 字符分块（章节边界优先）
 * 3. 逐块 LLM 摘要 → 汇总 → 要点清单
 * 4. 输出 { summary, keyPoints[], outline? }
 *
 * 可缓存：按文件内容 hash 缓存（复用 tool-cache 的 FILE_CONTENT_KEY_TOOLS 机制，
 * 但需注册到缓存集合；此处先保持无缓存，后续可加）。
 *
 * 安全：路径校验复用 read_file 同款（仅当前用户/会话 agent_temp 目录）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { parseDocument } from '../file/parse-document';
import { LlmService } from '../../../llm/llm.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 摘要结果 */
interface SummarizeResult {
  summary: string;
  keyPoints: string[];
  outline?: string[];
  level: 'quick' | 'detailed';
}

/** 截断 */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 路径校验 */
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

/** 逐块生成摘要 */
async function summarizeChunks(chunks: string[], level: 'quick' | 'detailed'): Promise<string[]> {
  const summaries: string[] = [];
  const chunkLimit = level === 'quick' ? 3 : 8;
  for (const chunk of chunks.slice(0, chunkLimit)) {
    try {
      const instruction = level === 'quick'
        ? '请用 2-3 句话概括以下文档片段的核心内容。'
        : '请用 4-6 句话详细概括以下文档片段的内容，保留关键数据、期限、要求。';
      const s = await LlmService.chat(
        `以下是一份文档的片段，请按要求概括：\n${truncate(chunk, 4000)}`,
        { systemPrompt: instruction, maxTokens: level === 'quick' ? 300 : 600, timeout: 60 },
      );
      if (s.trim()) summaries.push(s.trim());
    } catch {
      /* 单块失败跳过 */
    }
  }
  return summaries;
}

/**
 * 创建 summarize_document 工具
 */
export function createSummarizeDocumentTool(context: ToolContext) {
  return tool({
    description:
      '文档摘要：解析文档（docx/pdf/txt/md 等），按章节分块后逐块 LLM 摘要，汇总为整体摘要 + 要点清单。' +
      'level=quick 快速摘要（前 3 块），level=detailed 详细摘要（前 8 块）。返回 { summary, keyPoints[], outline? }。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
      level: z.enum(['quick', 'detailed']).optional().default('quick').describe('摘要粒度：quick（快速）/ detailed（详细）'),
    }),
    execute: async ({ filePath, level }): Promise<SummarizeResult> => {
      const fp = assertReadablePath(context, filePath);
      if (!fs.existsSync(fp)) throw new Error(`文件不存在: ${filePath}`);

      const parsed = await parseDocument(fp);
      const text = (parsed.text || '').trim();
      if (!text) return { summary: '（文档无文本）', keyPoints: [], level: level || 'quick' };

      const chunks = LlmService.splitText(text, 4000, false) as string[];
      const summaries = await summarizeChunks(chunks, level || 'quick');

      if (summaries.length === 0) {
        return { summary: '（摘要生成失败）', keyPoints: [], level: level || 'quick' };
      }

      const combined = summaries.join('\n');
      return {
        summary: truncate(combined, 3000),
        keyPoints: summaries.map(s => truncate(s, 150)),
        outline: chunks.map((c, i) => `段落 ${i + 1}: ${truncate(c.replace(/\n/g, ' '), 60)}`).slice(0, 20),
        level: level || 'quick',
      };
    },
  });
}
