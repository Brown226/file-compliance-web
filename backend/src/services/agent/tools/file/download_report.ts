/**
 * download_report 工具 — 读取报告文件内容供 LLM 返回给前端
 *
 * 工作方式：
 * - LLM 调用本工具传入 write_report 返回的 filePath
 * - 工具读取报告文件，返回 base64 内容 + 文件名 + 大小 + 下载 URL
 * - 前端拿到 URL 后通过浏览器 <a download> 触发下载
 *
 * Task 20 扩展（PDF 方案）：
 * - format=md：返回 Markdown 文件下载 URL（直接浏览器下载）
 * - format=pdf：返回 Markdown 文件 URL + pdfPrintUrl（前端打开打印页，用户 Ctrl+P/点按钮调浏览器另存为 PDF）
 *   避免后端装 puppeteer/Chromium（镜像 +300MB），离线部署友好
 *
 * 安全约束：
 * - 只能读 Agent 临时目录下的报告文件
 * - 只能读当前用户当前会话的报告
 *
 * 参数：
 * - filePath: 报告文件绝对路径（由 write_report 返回）
 * - format: 输出格式（md / pdf，默认 md）
 *
 * 返回：
 * - fileName: 文件名
 * - filePath: 绝对路径
 * - size: 文件字节数
 * - contentBase64: 文件内容 base64 编码（供 LLM 内联返回给前端）
 * - downloadUrl: 浏览器可访问的下载 URL（/uploads/agent_temp/{userId}/{sessionId}/reports/{fileName}）
 * - format: 实际返回的格式
 * - pdfPrintUrl: 仅 format=pdf 时返回，前端打开此 URL 进入打印页，调浏览器打印另存为 PDF
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolContext } from './upload_file';
import { getUploadDir } from '../../../../config/upload';
// 路径核对：tools/file/download_report.ts → tools/file/ → tools/ → agent/ → services/ → src/
// config/upload.ts 在 src/config/upload.ts，需要 ../../../../config/upload

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 下载结果 */
interface DownloadReportResult {
  fileName: string;
  filePath: string;
  size: number;
  contentBase64: string;
  downloadUrl: string;
  format: 'md' | 'pdf';
  pdfPrintUrl?: string;
}

/**
 * 创建 download_report 工具
 */
export function createDownloadReportTool(context: ToolContext) {
  return tool({
    description: '读取已生成的审查报告文件内容，返回 base64 内容和下载 URL。支持 md 和 pdf 两种格式：md 直接下载，pdf 返回打印页 URL 由前端调浏览器打印另存为 PDF（无需后端依赖）。',
    inputSchema: z.object({
      filePath: z.string().describe('报告文件绝对路径（由 write_report 返回）'),
      format: z.enum(['md', 'pdf']).default('md').describe('输出格式：md 直接下载，pdf 返回打印页 URL'),
    }),
    execute: async ({ filePath, format }): Promise<DownloadReportResult> => {
      // 路径安全校验：只能读 Agent 临时目录下的文件
      const uploadsRoot = path.join(__dirname, '../../../../../uploads/agent_temp');
      const normalizedRoot = path.resolve(uploadsRoot);
      const normalizedPath = path.resolve(filePath);

      // 必须在 Agent 临时目录内
      if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
        throw new Error('路径越权：只能读取 Agent 临时目录下的报告');
      }

      // 必须在当前用户目录内
      const expectedUserDir = path.join(normalizedRoot, context.userId);
      if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
        throw new Error('路径越权：只能读取当前用户的报告');
      }

      // 必须在 reports/ 子目录内（防止读到上传的源文件）
      if (!normalizedPath.includes(`${path.sep}reports${path.sep}`) &&
          !normalizedPath.endsWith(`${path.sep}reports`)) {
        throw new Error('路径越权：只能读取 reports/ 子目录下的报告');
      }

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`报告文件不存在: ${path.basename(filePath)}`);
      }

      const stat = await fs.promises.stat(normalizedPath);
      if (!stat.isFile()) {
        throw new Error('不支持下载目录，只能下载文件');
      }

      const fileName = path.basename(normalizedPath);
      const buffer = await fs.promises.readFile(normalizedPath);
      const contentBase64 = buffer.toString('base64');

      // 构造浏览器可访问的下载 URL
      // uploads 目录由 app.ts 静态服务挂载在 /uploads/
      // downloadUrl = /uploads/ + uploads 目录下的相对路径（正斜杠）
      const uploadDir = getUploadDir();
      const relativePath = path.relative(uploadDir, normalizedPath);
      const downloadUrl = '/uploads/' + relativePath.replace(/\\/g, '/');

      const result: DownloadReportResult = {
        fileName,
        filePath: normalizedPath,
        size: stat.size,
        contentBase64,
        downloadUrl,
        format,
      };

      // PDF 格式：返回前端打印页 URL（前端路由 /agent/report-print?src=...）
      // 前端打开此路由会 fetch Markdown → 渲染为打印 HTML → window.print() 另存为 PDF
      if (format === 'pdf') {
        result.pdfPrintUrl = `/agent/report-print?src=${encodeURIComponent(downloadUrl)}`;
      }

      return result;
    },
  });
}
