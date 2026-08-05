/**
 * list_uploads 工具 — 列出当前用户最近上传的临时文件
 *
 * 列出 uploads/agent_temp/{userId}/{YYYY-MM-DD}/ 目录下（最近 7 天内）所有文件，
 * 返回文件名、大小、修改时间、绝对路径。
 *
 * 设计：按用户 + 日期划分，跨会话共享。当前用户所有日期目录下的文件均可见，
 * 解决「同一批上传文件因 sessionId 不一致散落不同会话目录」导致 Agent 找不到文件的问题。
 *
 * 安全约束：
 * - 只能列出当前用户目录下的文件（path.resolve 规范化后校验）
 * - 目录不存在时返回空数组（不报错）
 *
 * 参数：无（context 自动注入 userId）
 * 返回：
 * - files: [{ fileName, filePath, size, mtime }]
 * - total: 文件数
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { fixMojibake } from './filename';
import { getUserAgentTempDir, isDateDirName } from './paths';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 文件信息 */
interface FileInfo {
  fileName: string;
  filePath: string;
  size: number;
  mtime: string;
}

/** 列表结果 */
interface ListUploadsResult {
  files: FileInfo[];
  total: number;
}

/**
 * 创建 list_uploads 工具
 */
export function createListUploadsTool(context: ToolContext) {
  return tool({
    description: '列出当前会话已上传的临时文件。返回文件名、绝对路径、大小（字节）、修改时间。目录为空或不存在时返回空列表。',
    inputSchema: z.object({}).describe('无参数（自动读取当前用户当前会话的临时目录）'),
    execute: async (): Promise<ListUploadsResult> => {
      // 用户根目录：uploads/agent_temp/{userId}/
      const userDir = getUserAgentTempDir(context.userId);
      const files: FileInfo[] = [];

      // 目录不存在返回空列表
      if (!fs.existsSync(userDir)) {
        return { files: [], total: 0 };
      }

      // 读取用户目录下的日期子目录（YYYY-MM-DD），聚合所有日期目录下的文件
      const dateEntries = await fs.promises.readdir(userDir, { withFileTypes: true });
      for (const dateEntry of dateEntries) {
        if (!dateEntry.isDirectory()) continue;
        // 仅处理日期目录（兼容：忽略旧 sessionId 目录等非日期目录，避免误列）
        if (!isDateDirName(dateEntry.name)) continue;

        const dateDir = path.join(userDir, dateEntry.name);
        const entries = await fs.promises.readdir(dateDir, { withFileTypes: true });

        for (const entry of entries) {
          // 只列文件，不递归子目录（reports/ 等子目录不在此列）
          if (!entry.isFile()) continue;

          const filePath = path.join(dateDir, entry.name);
          const stat = await fs.promises.stat(filePath);

          files.push({
            // 修复历史乱码文件名（UTF-8 被 latin1 误解码的存量文件）
            fileName: fixMojibake(entry.name),
            filePath,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        }
      }

      // 按修改时间降序（新上传的排前面）
      files.sort((a, b) => b.mtime.localeCompare(a.mtime));

      return { files, total: files.length };
    },
  });
}
