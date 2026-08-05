/**
 * draft_document 工具 — 文档起草（P1-⑤）
 *
 * 根据标题 + 要点大纲 + 参考资料，用 LLM 起草初稿，输出 Markdown 文本。
 *
 * 逻辑：
 * 1. 拼 prompt（标题 / 大纲 / 参考资料）
 * 2. LlmService.chat → 初稿文本
 * 3. 可选写出 .md 到 reports 目录（复用写队列）
 *
 * 输出：
 * - title: 文档标题
 * - content: Markdown 初稿
 * - filePath?: 写出到服务端的 .md 路径（saveToDisk=true 时）
 */

import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { getTodayDir } from '../file/paths';
import { LlmService } from '../../../llm/llm.service';
import { FileWriteQueueService } from '../../file-queue/file-write-queue.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

const DRAFT_SYSTEM =
  '你是专业的文档起草助手。根据用户给定的标题、大纲和参考资料，起草一份结构完整、语言规范的文档初稿。' +
  '使用 Markdown 格式（# 标题、## 章节、- 列表）。内容要具体、专业，不要空话套话。' +
  '若提供了参考资料，尽量引用其中关键数据/要求；若无，可基于常识合理撰写并标注【待补充】。';

/** 起草结果 */
interface DraftResult {
  title: string;
  content: string;
  filePath?: string;
  chars: number;
}

/**
 * 创建 draft_document 工具
 */
export function createDraftDocumentTool(context: ToolContext) {
  return tool({
    description:
      '文档起草：根据标题 + 要点大纲 + 参考资料，用 LLM 起草 Markdown 初稿。' +
      'saveToDisk=true 时把初稿保存到会话 reports 目录，返回文件路径。' +
      '输出 { title, content, chars }，content 为 Markdown 文本。',
    inputSchema: z.object({
      title: z.string().describe('文档标题'),
      outline: z.array(z.string()).optional().describe('要点大纲（章节/要点列表）'),
      references: z.string().optional().describe('参考资料（文本，可空）'),
      saveToDisk: z.boolean().optional().default(false).describe('是否保存到服务端 reports 目录'),
      fileName: z.string().optional().describe('保存文件名（不含扩展名，默认用标题）'),
    }),
    execute: async ({ title, outline, references, saveToDisk, fileName }): Promise<DraftResult> => {
      if (!title || !title.trim()) throw new Error('title 必填');

      const outlineText = outline && outline.length > 0 ? outline.map((o, i) => `${i + 1}. ${o}`).join('\n') : '（无大纲，请合理组织章节）';
      const refText = references && references.trim() ? references.trim().slice(0, 6000) : '（无参考资料）';

      const userPrompt =
        `## 标题\n${title}\n\n` +
        `## 大纲\n${outlineText}\n\n` +
        `## 参考资料\n${refText}\n\n` +
        '请起草这份文档的完整初稿（Markdown 格式）。';

      const content = await LlmService.chat(userPrompt, {
        systemPrompt: DRAFT_SYSTEM,
        maxTokens: 3000,
        timeout: 120,
      });

      let filePath: string | undefined;
      if (saveToDisk) {
        const safeName = (fileName || title)
          .replace(/[\\\/]/g, '_')
          .replace(/\.md$/i, '')
          .replace(/[^a-zA-Z0-9_\-一-龥]/g, '_')
          .slice(0, 100) || 'draft';
        const reportsDir = path.join(getTodayDir(context.userId), 'reports');
        const normalizedDir = path.resolve(reportsDir);
        await (await import('fs')).promises.mkdir(normalizedDir, { recursive: true });
        const fp = path.join(normalizedDir, `${safeName}.md`);
        await FileWriteQueueService.enqueue(fp, async () => {
          await (await import('fs')).promises.writeFile(fp, content, 'utf-8');
        });
        filePath = fp;
      }

      return { title, content, filePath, chars: content.length };
    },
  });
}
