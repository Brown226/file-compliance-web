/**
 * list_uploads 工具 — 列出当前会话的临时文件
 *
 * 列出 uploads/agent_temp/{userId}/{sessionId}/ 目录下所有文件，
 * 返回文件名、大小、修改时间、绝对路径。
 *
 * 安全约束：
 * - 只能列出当前用户当前会话的文件（path.resolve 规范化后校验）
 * - 目录不存在时返回空数组（不报错）
 *
 * 参数：无（context 自动注入 userId/sessionId）
 * 返回：
 * - files: [{ fileName, filePath, size, mtime }]
 * - total: 文件数
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
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
      // 会话目录：uploads/agent_temp/{userId}/{sessionId}/
      const sessionDir = path.join(
        __dirname,
        '../../../../../uploads/agent_temp',
        context.userId,
        context.sessionId,
      );
      const normalizedSessionDir = path.resolve(sessionDir);

      // 目录不存在返回空列表
      if (!fs.existsSync(normalizedSessionDir)) {
        return { files: [], total: 0 };
      }

      // 读取目录
      const entries = await fs.promises.readdir(normalizedSessionDir, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        // 只列文件，不递归子目录
        if (!entry.isFile()) continue;

        const filePath = path.join(normalizedSessionDir, entry.name);
        const stat = await fs.promises.stat(filePath);

        files.push({
          fileName: entry.name,
          filePath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }

      // 按修改时间降序（新上传的排前面）
      files.sort((a, b) => b.mtime.localeCompare(a.mtime));

      return { files, total: files.length };
    },
  });
}
