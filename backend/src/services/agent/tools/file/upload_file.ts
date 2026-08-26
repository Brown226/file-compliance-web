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
import { getTodayDir } from './paths';
import { FileWriteQueueService } from '../../file-queue/file-write-queue.service';

// require ESM-only 包，类型通过 typeof import 断言保留
const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 工具上下文 — 由 createAllTools 注入 */
export interface ToolContext {
  userId: string;
  sessionId: string;
}

/**
 * 单次上传大小上限（base64 解码后字节数）：50MB。
 * 注意与 /api/agent/upload 端点的 100MB **有意不同**：端点通道文件直落磁盘、
 * 不经模型上下文，可放宽；本工具的 base64 要经 LLM 消息体传输（≈4/3 膨胀 +
 * token 成本），50MB 已是实际上限。两处口径不可混用。
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * 拒绝上传的可执行/脚本类扩展名（防 XSS 与恶意文件传播）。
 * html/htm/svg 是脚本注入载体（前端预览走 iframe/v-html），一并拒绝。
 */
const BLOCKED_EXT = new Set([
  'exe', 'dll', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'reg',
  'sh', 'bash', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'jar', 'class',
  'php', 'phtml', 'php3', 'php4', 'php5', 'asp', 'aspx', 'jsp', 'jspx',
  'html', 'htm', 'svg', 'swf', 'apk', 'app', 'gadget', 'msh',
]);

/** 净化文件名：仅保留 basename、拒绝空/点/隐藏系统保留名（防目录穿越） */
export function sanitizeFileName(raw: string): string {
  const base = path.basename(String(raw || '').trim()).replace(/^\.+$/, '');
  if (!base || base === '.' || base === '..') {
    throw new Error('文件名无效：不能为空或路径形式');
  }
  const ext = path.extname(base).toLowerCase().replace(/^\./, '');
  if (BLOCKED_EXT.has(ext)) {
    throw new Error(`不支持上传 .${ext} 类型的文件（可执行/脚本类文件被拒绝）`);
  }
  return base;
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

      // 大小上限：base64 长度 ≈ 字节数 * 4/3，先按长度估算拒绝超大输入
      if (base64Data.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 16) {
        throw new Error(`文件过大：上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
      }
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new Error(`文件过大：上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
      }

      // 文件名净化：只取 basename + 拒绝可执行/脚本类扩展名（防目录穿越 + XSS 载体）
      const safeName = sanitizeFileName(fileName);

      // 计算存储路径：backend/uploads/agent_temp/{userId}/{YYYY-MM-DD}/{fileName}
      // 按日期划分（跨会话共享当天目录），不再按 sessionId 分区
      const targetDir = getTodayDir(context.userId);
      const filePath = path.join(targetDir, safeName);

      // 创建目录（recursive: true 不会因目录已存在而报错）
      await fs.promises.mkdir(targetDir, { recursive: true });

      // P1：原子写入 — 先写同目录 tmp 再 rename，同名文件并发上传不出现"最后写者赢 +
      // 读取方读到半截"；写失败清理 tmp。与 edit_file 的 text 分支保持一致。
      const tmpPath = `${filePath}.upload.tmp`;
      await FileWriteQueueService.enqueue(filePath, async () => {
        try {
          await fs.promises.writeFile(tmpPath, buffer);
          await fs.promises.rename(tmpPath, filePath);
        } catch (err) {
          // 写入/重命名失败时清理残留的 .tmp 文件
          await fs.promises.unlink(tmpPath).catch(() => {});
          throw err;
        }
      });

      return {
        filePath,
        fileName: safeName,
        size: buffer.length,
      };
    },
  });
}
