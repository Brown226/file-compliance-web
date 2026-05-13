import prisma from '../config/db';
import fs from 'fs';

interface OcrConfig {
  apiBaseUrl: string;
  apiKey?: string;
  modelName?: string;
  timeout: number;
}

const DEFAULT_OCR_CONFIG: OcrConfig = {
  apiBaseUrl: 'http://localhost:8001',
  timeout: 180000,
};

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
   * - 配置了 apiKey + modelName → 视觉模型 OCR（OpenAI 兼容 API）
   * - 否则 → PaddleOCR 微服务
   */
  static async recognizeFile(filePath: string, fileType: string): Promise<string> {
    const config = await this.getOcrConfig();

    if (config.apiKey && config.modelName) {
      return this.recognizeViaVisionModel(filePath, fileType, config);
    }

    return this.recognizeViaPaddleOCR(filePath, config);
  }

  // ========== VL 视觉模型路径 ==========

  private static async recognizeViaVisionModel(
    filePath: string,
    fileType: string,
    config: OcrConfig,
  ): Promise<string> {
    const imageDataUrls: string[] = [];

    if (fileType.toLowerCase() === 'pdf') {
      const pages = await this.pdfToDataUrls(filePath);
      imageDataUrls.push(...pages);
    } else {
      const buffer = fs.readFileSync(filePath);
      const mime = this.getImageMimeType(fileType);
      imageDataUrls.push(`data:${mime};base64,${buffer.toString('base64')}`);
    }

    if (imageDataUrls.length === 0) {
      console.warn('[OCR] 无法从文件中提取图像');
      return '';
    }

    // 最多处理前 3 页
    const pages = imageDataUrls.slice(0, 3);
    const totalPages = imageDataUrls.length;
    console.log(`[OCR] VL模型 ${config.modelName}, ${totalPages} 页, 处理前 ${pages.length} 页`);

    const results: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      try {
        const text = await this.callVisionApi(pages[i], config, i + 1, totalPages);
        if (text) results.push(text);
      } catch (e: any) {
        console.warn(`[OCR] 第${i + 1}页识别失败:`, e.message);
      }
    }

    const result = results.join('\n');
    console.log(`[OCR] VL模型完成, 文本长度: ${result.length}`);
    return OcrService.postProcessOcrText(result);
  }

  private static async callVisionApi(
    imageDataUrl: string,
    config: OcrConfig,
    pageNum: number,
    totalPages: number,
  ): Promise<string> {
    const pageHint = totalPages > 1 ? `（第${pageNum}/${totalPages}页）` : '';
    const prompt = `请识别并完整提取图片中的所有文字内容${pageHint}，保持原有格式和换行。只输出识别到的文字，不要添加任何说明。`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelName,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: imageDataUrl, detail: 'high' },
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
          max_tokens: 4096,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vision API 错误 (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static async pdfToDataUrls(filePath: string): Promise<string[]> {
    try {
      const { pdf } = await import('pdf-to-img');
      const doc = await pdf(filePath, { scale: 2 });
      const totalPages = Math.min(doc.length, 3);
      const dataUrls: string[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const pngBuffer = await doc.getPage(i);
        dataUrls.push(`data:image/png;base64,${pngBuffer.toString('base64')}`);
      }

      return dataUrls;
    } catch (e) {
      console.warn('[OCR] PDF 转图片失败:', e);
      return [];
    }
  }

  private static getImageMimeType(fileType: string): string {
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
    };
    return map[fileType.toLowerCase()] || 'image/png';
  }

  // ========== PaddleOCR 路径 ==========

  private static async recognizeViaPaddleOCR(
    filePath: string,
    config: OcrConfig,
  ): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const base64Data = buffer.toString('base64');
    const url = `${config.apiBaseUrl}/api/ocr/base64`;

    console.log(`[OCR] PaddleOCR: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data }),
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
