import prisma from '../config/db';
import fs from 'fs';
import path from 'path';

interface OcrConfig {
  apiBaseUrl: string;
  apiKey?: string;
  modelName?: string;
  timeout: number;
}

const DEFAULT_OCR_CONFIG: OcrConfig = {
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  timeout: 180000,
};

const DEFAULT_OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:8001';

export class OcrService {
  static async getOcrConfig(): Promise<OcrConfig> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'llm_ocr_model' },
      });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        return {
          apiBaseUrl: v.apiBaseUrl || DEFAULT_OCR_CONFIG.apiBaseUrl,
          apiKey: v.apiKey || undefined,
          modelName: v.modelName || undefined,
          timeout: (v.timeout || 180) * 1000,
        };
      }
    } catch (e) {
      console.warn('获取 OCR 配置失败，使用默认值:', e);
    }
    return DEFAULT_OCR_CONFIG;
  }

  /**
   * 识别文件中的文字
   * 后端只负责传递原始文件内容与识别配置；PDF 渲染和 OCR 识别由独立 OCR 容器完成。
   */
  static async recognizeFile(filePath: string, fileType: string): Promise<string> {
    const config = await this.getOcrConfig();
    const base64Data = fs.readFileSync(filePath).toString('base64');
    const normalizedFileType = this.normalizeFileType(fileType);
    const requestBody: Record<string, unknown> = {
      image: base64Data,
      fileType: normalizedFileType,
      fileName: path.basename(filePath),
      timeoutMs: config.timeout,
    };

    if (config.apiKey && config.modelName) {
      requestBody.apiBaseUrl = config.apiBaseUrl;
      requestBody.apiKey = config.apiKey;
      requestBody.modelName = config.modelName;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(`${DEFAULT_OCR_SERVICE_URL}/api/ocr/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR API 错误 (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      return OcrService.postProcessOcrText(data.text || '');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static normalizeFileType(fileType: string): string {
    const value = (fileType || '').trim().toLowerCase();
    if (value.startsWith('application/pdf') || value.endsWith('.pdf')) return 'pdf';
    if (value.startsWith('data:image/')) return 'image';
    if (value.includes('jpeg') || value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'jpg';
    if (value.includes('png') || value.endsWith('.png')) return 'png';
    if (value.includes('gif') || value.endsWith('.gif')) return 'gif';
    if (value.includes('webp') || value.endsWith('.webp')) return 'webp';
    if (value.includes('bmp') || value.endsWith('.bmp')) return 'bmp';
    if (value.includes('tiff') || value.endsWith('.tif') || value.endsWith('.tiff')) return 'tiff';
    return value;
  }

  // ========== 后处理 ==========

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
