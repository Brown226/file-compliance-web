/**
 * ocr_scan 工具 — 对图片/扫描件执行 OCR 文字识别
 *
 * 解决场景：Agent 收到扫描件 PDF、截图、照片等纯图像内容时，
 * extract_text / parse_document 只能解析「结构化二进制文档」，对纯图像拿不到文字。
 * ocr_scan 封装 OcrService.recognizeFile（doc-parser 的 /api/ocr/scan 端点 + 视觉大模型），
 * 让 Agent 能主动识别图片/扫描件中的文字。
 *
 * 支持类型（FileTypeService.OCR_SUPPORTED）：
 *   pdf、png、jpg、jpeg、gif、webp、bmp、tiff
 *
 * 安全约束（与 read_file 一致）：
 * - 只能识别 Agent 临时目录（agent_temp/{userId}/）下的文件，杜绝越权访问他人文件
 * - 兼容历史乱码路径（fixMojibakePath 兜底）
 *
 * 参数：
 * - filePath: 服务端文件绝对路径（upload_file / list_uploads 返回）
 * - fileType: 可选，文件类型（扩展名），用于预检是否支持 OCR
 *
 * 返回：
 * - text: 识别出的文字（<file_content> 标签包裹，防 prompt injection）
 * - status: success | unavailable | failed
 * - reason: 失败/不可用原因
 * - confidence: 识别置信度（0-1，仅 success 时有）
 * - charCount / lineCount: 文本规模统计
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from './paths';
import { OcrService } from '../../../file/ocr.service';
import { FileTypeService } from '../../../file/file-type.service';
import { fixMojibakePath } from './filename';
import type { ToolContext } from './upload_file';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** OCR 识别结果 */
export interface OcrScanResult {
  text: string;
  status: 'success' | 'unavailable' | 'failed';
  reason?: string;
  confidence?: number;
  charCount: number;
  lineCount: number;
}

/**
 * 创建 ocr_scan 工具
 */
export function createOcrScanTool(context: ToolContext) {
  return tool({
    description:
      '对图片或扫描件执行 OCR 文字识别。支持类型：pdf、png、jpg、jpeg、gif、webp、bmp、tiff。' +
      '当文件是扫描版 PDF、截图、照片等纯图像内容（extract_text/read_file 拿不到文字）时使用。' +
      '返回识别出的文字内容、置信度和文本统计。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回或 list_uploads 列出）'),
      fileType: z
        .string()
        .optional()
        .describe('文件类型（扩展名，如 png/pdf）。可选，用于预检是否支持 OCR'),
    }),
    execute: async ({ filePath, fileType }): Promise<OcrScanResult> => {
      // ---- 路径安全校验前置（原实现先 existsSync 探测任意绝对路径的存在性）----
      const uploadsRoot = getAgentTempRoot();
      const normalizedRoot = path.resolve(uploadsRoot);
      const normalizedPath = path.resolve(filePath);
      if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
        throw new Error('路径越权：只能识别 Agent 临时目录下的文件');
      }

      // ---- 用户隔离校验：只能识别当前用户上传的文件 ----
      const expectedUserDir = path.join(normalizedRoot, context.userId);
      if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
        throw new Error('路径越权：只能识别当前用户上传的文件');
      }

      // ---- 路径存在性 + 乱码兜底（与 read_file 一致）----
      if (!fs.existsSync(filePath)) {
        const fixed = fixMojibakePath(filePath);
        if (fixed !== filePath && fs.existsSync(fixed)) {
          filePath = fixed;
        } else {
          throw new Error(`文件不存在: ${filePath}`);
        }
      }

      // ---- 类型预检：确认是否支持 OCR ----
      const fileName = path.basename(filePath);
      const ext = (fileType || path.extname(fileName)).toLowerCase().replace(/^\./, '');
      if (!FileTypeService.isOcrSupported(ext)) {
        return {
          text: '',
          status: 'failed',
          reason: `暂不支持 OCR 识别 .${ext} 类型文件。支持类型：pdf、png、jpg、jpeg、gif、webp、bmp、tiff`,
          charCount: 0,
          lineCount: 0,
        };
      }

      // ---- 调 OcrService 识别 ----
      const result = await OcrService.recognizeFile(filePath, ext);

      if (result.status !== 'success') {
        return {
          text: '',
          status: result.status,
          reason: result.reason || 'OCR 识别失败',
          charCount: 0,
          lineCount: 0,
        };
      }

      const text = result.text || '';
      const lineCount = text ? text.split('\n').filter((l) => l.trim().length > 0).length : 0;

      // 用 <file_content> 标签包裹识别文本，防 prompt injection（与 read_file 一致）
      const wrapped = text
        ? `<file_content>\n${text}\n</file_content>`
        : '';

      return {
        text: wrapped,
        status: 'success',
        confidence: result.confidence,
        charCount: text.length,
        lineCount,
      };
    },
  });
}
