import prisma from '../config/db';
import fs from 'fs';

/**
 * OCR 服务 - 使用 PaddleOCR Python 服务进行图片/PDF 文字识别
 * API 为自定义 REST 接口
 */

const DEFAULT_OCR_CONFIG = {
  apiBaseUrl: process.env.OCR_SERVICE_URL || 'http://localhost:8001',
  timeout: 180000,
};

export class OcrService {
  static async getOcrConfig(): Promise<{
    apiBaseUrl: string;
    timeout: number;
  }> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'llm_ocr_model' },
      });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        return {
          apiBaseUrl: v.apiBaseUrl || DEFAULT_OCR_CONFIG.apiBaseUrl,
          timeout: v.timeout || DEFAULT_OCR_CONFIG.timeout,
        };
      }
    } catch (e) {
      console.warn('获取 OCR 配置失败，使用默认值:', e);
    }
    return DEFAULT_OCR_CONFIG;
  }

  static async recognizeFile(filePath: string, fileType: string): Promise<string> {
    const config = await this.getOcrConfig();

    const buffer = fs.readFileSync(filePath);
    const base64Data = buffer.toString('base64');

    const url = `${config.apiBaseUrl}/api/ocr/base64`;

    console.log(`[OCR] 调用服务: ${url}, 文件类型: ${fileType}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64Data }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      return this.postProcessOcrText(data.text || '');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static postProcessOcrText(text: string): string {
    if (!text) return text;
    let r = text.replace(/－/g, '-');
    r = r.replace(/—/g, '-');
    r = r.replace(/(\d)一(\d)/g, '$1-$2');
    r = r.replace(/([A-Za-z/])一(\d)/g, '$1-$2');
    return r;
  }

  static isOcrSupported(fileType: string): boolean {
    const supported = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];
    return supported.includes(fileType.toLowerCase());
  }
}