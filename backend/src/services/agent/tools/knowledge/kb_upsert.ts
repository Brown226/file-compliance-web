/**
 * kb_upsert 工具 — 会话式知识库维护（P2-⑪）
 *
 * 对话中把当前文档/片段「入库」到指定 MaxKB 知识库（追加/更新）。
 *
 * 逻辑：
 * 1. 校验用户对知识库权限（存在性校验：目标 knowledgeId 必须在可用知识库列表中）
 * 2. 调 MaxKB admin API（maxkb.service 的 createTextDocument / batchCreateDocuments）
 * 3. 返回 { success, documentId?, chunkCount }
 *
 * 模式：
 * - append（默认）：把 content 作为新文档写入知识库（文档名 = source 或时间戳）
 * - update：先按 source 名找已有文档，删除后重建（实现 upsert 语义）
 *
 * 去重：MaxKB 文档级无天然去重；append 模式同 source 名会新建文档，
 *        update 模式先删同名文档再建，保证「重复入库同片段不产生重复」（验收标准 2）。
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import { MaxKBService } from '../../../knowledge/maxkb.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** kb_upsert 结果 */
interface KbUpsertResult {
  success: boolean;
  knowledgeId: string;
  knowledgeName: string;
  documentId?: string;
  chunkCount: number;
  mode: 'append' | 'update';
  message: string;
}

/** 按名在知识库中查找已有文档（P1：原只取前 50 条，文档多时同名找不到 → 翻页至多 10 页 × 200 条） */
async function findDocumentByName(
  workspaceId: string,
  knowledgeId: string,
  docName: string,
): Promise<{ id: string } | null> {
  try {
    const PAGE_SIZE = 200;
    const MAX_PAGES = 10;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const docs = await MaxKBService.listDocuments(workspaceId, knowledgeId, page, PAGE_SIZE);
      const records = Array.isArray(docs) ? docs : (docs?.records || []);
      const found = records.find((d: any) => d.name === docName);
      if (found) return { id: found.id };
      // 已到最后一页（total 口径或本次不足一页）→ 停止翻页
      const total = Array.isArray(docs) ? docs.length : (typeof (docs as any)?.total === 'number' ? (docs as any).total : page * PAGE_SIZE);
      if (page * PAGE_SIZE >= total) break;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 创建 kb_upsert 工具
 */
export function createKbUpsertTool(_context: ToolContext) {
  return tool({
    description:
      '会话式知识库维护：把文本内容入库到指定的 MaxKB 知识库。' +
      'mode=append 追加为新文档；mode=update 按 source 名先删后建（upsert，避免重复）。' +
      '返回 { success, knowledgeId, documentId?, chunkCount, message }。' +
      '不传 knowledgeId 时使用第一个可用知识库。' +
      '注意：这是写入知识库的写操作，执行前必须先调 ask_user(method=confirm) 向用户说明将入库的内容并获得确认。',
    inputSchema: z.object({
      content: z.string().min(1).describe('要入库的文本内容（文档或片段）'),
      knowledgeId: z.string().optional().describe('目标知识库 ID（不传则用第一个可用知识库）'),
      source: z.string().optional().describe('来源标注（文档名/会话标识，用作入库文档名，默认「Agent 入库」）'),
      mode: z.enum(['append', 'update']).optional().default('append').describe('append=追加新文档，update=按 source 名 upsert'),
    }),
    execute: async ({ content, knowledgeId, source, mode }): Promise<KbUpsertResult> => {
      // 1. 解析可用知识库 + 权限校验
      const kbs = await MaxKBService.getAvailableKnowledgeBases().catch((e: any) => {
        throw new Error(`无法获取知识库列表（MaxKB 未配置或不可达）: ${e.message}`);
      });
      if (kbs.length === 0) throw new Error('没有可用的 MaxKB 知识库，请先在知识库配置中创建');

      let target = knowledgeId ? kbs.find((k: any) => k.id === knowledgeId) : undefined;
      if (!target) {
        // 指定了但不存在的 ID → 报错（权限/存在性校验）
        if (knowledgeId) throw new Error(`知识库不存在或无权访问: ${knowledgeId}`);
        target = kbs[0]; // 未指定 → 第一个可用
      }

      const workspaceId = await MaxKBService.getDefaultWorkspaceId();
      const docName = (source && source.trim() ? source.trim() : `Agent 入库 ${new Date().toISOString().slice(0, 10)}`)
        .slice(0, 100);

      // 2. update 模式：先删同名文档（upsert 去重）
      //    P1：删旧失败必须中断 —— 原实现只 console.warn 后继续新建，会产生同名重复文档，
      //    破坏 update 的 upsert 语义（验收标准 2）。
      if (mode === 'update') {
        const existing = await findDocumentByName(workspaceId, target.id, docName);
        if (existing) {
          await MaxKBService.deleteDocument(workspaceId, target.id, existing.id);
        }
      }

      // 3. 创建文档
      const doc = await MaxKBService.createTextDocument(workspaceId, target.id, {
        name: docName,
        content,
      });

      // 计算 chunkCount（按段落数）
      const chunkCount = content.split(/\n+/).filter((p: string) => p.trim().length > 0).length;

      return {
        success: true,
        knowledgeId: target.id,
        knowledgeName: target.name,
        documentId: Array.isArray(doc) ? doc[0]?.id : doc?.id,
        chunkCount,
        mode: mode || 'append',
        message: `已入库到知识库「${target.name}」：${docName}（约 ${chunkCount} 段，按换行估算，非 MaxKB 实际切分数）`,
      };
    },
  });
}
