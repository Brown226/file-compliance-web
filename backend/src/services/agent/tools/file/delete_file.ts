/**
 * delete_file 工具 — 删除临时文件
 *
 * 安全约束：
 * - 只能删 Agent 临时目录下的文件（路径规范化后校验）
 * - 只能删当前用户当前会话的文件
 * - 不递归删除目录（避免误删整个会话目录）
 * - 文件不存在视为成功（幂等）
 *
 * 参考 Reasonix 的 Trash-only 模式（Task 22.5 会升级为移入 .trash/）：
 * - 阶段 2 直接硬删，阶段 3 改为可逆 GC
 *
 * 参数：
 * - filePath: 服务端文件绝对路径
 *
 * 返回：
 * - success: 是否删除成功
 * - filePath: 被删除的文件路径
 * - fileName: 文件名
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from './paths';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 删除结果 */
interface DeleteFileResult {
  success: boolean;
  filePath: string;
  fileName: string;
}

/**
 * 创建 delete_file 工具
 */
export function createDeleteFileTool(context: ToolContext) {
  return tool({
    description: '删除当前会话的临时文件。只能删除当前用户当前会话目录下的文件，不递归删除目录。文件不存在视为成功（幂等）。注意：这是删除操作，执行前必须先调 ask_user(method=confirm) 向用户说明并获得确认。',
    inputSchema: z.object({
      filePath: z.string().describe('要删除的文件绝对路径（由 upload_file 返回或 list_uploads 列出）'),
    }),
    execute: async ({ filePath }): Promise<DeleteFileResult> => {
      const fileName = path.basename(filePath);

      // 路径安全校验：只能删 Agent 临时目录下的文件
      const uploadsRoot = getAgentTempRoot();
      const normalizedRoot = path.resolve(uploadsRoot);
      const normalizedPath = path.resolve(filePath);

      // 必须在 Agent 临时目录内
      if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
        throw new Error('路径越权：只能删除 Agent 临时目录下的文件');
      }

      // 必须在当前用户目录内
      const expectedUserDir = path.join(normalizedRoot, context.userId);
      if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
        throw new Error('路径越权：只能删除当前用户上传的文件');
      }

      // 不允许删除目录（避免误删整个会话目录）
      if (fs.existsSync(normalizedPath)) {
        const stat = await fs.promises.stat(normalizedPath);
        if (!stat.isFile()) {
          throw new Error('不支持删除目录，只能删除文件');
        }
      }

      // 幂等删除：文件不存在视为成功
      if (!fs.existsSync(normalizedPath)) {
        return { success: true, filePath: normalizedPath, fileName };
      }

      await fs.promises.unlink(normalizedPath);

      return { success: true, filePath: normalizedPath, fileName };
    },
  });
}
