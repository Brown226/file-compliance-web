/**
 * upload_file 工具 — 上传文件到 Agent 临时目录
 *
 * 工厂模式：context 携带 userId / sessionId，用于隔离不同用户/会话的临时文件。
 * 路径计算：从 tools/file/ 到 backend/uploads/ 需往上 5 层
 *   tools/file/ → tools/ → agent/ → services/ → src/ → backend/
 *
 * Vercel AI SDK v7 的 tool() 来自 @ai-sdk/provider-utils（d.ts 明确 export）
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// require ESM-only 包，类型通过 typeof import 断言保留
const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 工具上下文 — 由 createAllTools 注入 */
export interface ToolContext {
  userId: string;
  sessionId: string;
}

/**
 * 创建 upload_file 工具
 *
 * 参数：
 * - fileName: 文件名（含扩展名）
 * - fileBase64: 文件内容的 base64 编码
 * - mimeType: 可选 MIME 类型（仅记录，不影响存储）
 *
 * 返回：
 * - filePath: 服务端绝对路径
 * - fileName: 文件名
 * - size: 文件字节数
 */
export function createUploadFileTool(context: ToolContext) {
  return tool({
    description: '上传文件到临时目录。将 base64 编码的文件内容保存到服务端，返回文件路径供后续 extract_text 等工具使用。',
    inputSchema: z.object({
      fileName: z.string().describe('文件名，含扩展名（如 contract.pdf）'),
      fileBase64: z.string().describe('文件内容的 base64 编码字符串'),
      mimeType: z.string().optional().describe('文件 MIME 类型（如 application/pdf），可选，仅用于记录'),
    }),
    execute: async ({ fileName, fileBase64 }) => {
      // 解码 base64（容忍 data URL 前缀，如 "data:application/pdf;base64,..."）
      const base64Data = fileBase64.includes(',')
        ? fileBase64.substring(fileBase64.indexOf(',') + 1)
        : fileBase64;
      const buffer = Buffer.from(base64Data, 'base64');

      // 计算存储路径：backend/uploads/agent_temp/{userId}/{sessionId}/{fileName}
      // __dirname 在 CommonJS（module:commonjs）下可用，指向 tools/file/
      const uploadsRoot = path.join(__dirname, '../../../../../uploads/agent_temp');
      const targetDir = path.join(uploadsRoot, context.userId, context.sessionId);
      const filePath = path.join(targetDir, fileName);

      // 创建目录（recursive: true 不会因目录已存在而报错）
      await fs.promises.mkdir(targetDir, { recursive: true });

      // 写入文件
      await fs.promises.writeFile(filePath, buffer);

      return {
        filePath,
        fileName,
        size: buffer.length,
      };
    },
  });
}
