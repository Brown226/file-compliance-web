import prisma from '../config/db';
import fs from 'fs';
import { PromptTemplateService } from './prompt-template.service';

/**
 * OCR 服务 - 调用硅基流动 PaddleOCR-VL-1.5 进行图片/PDF 文字识别
 * API 兼容 OpenAI Chat Completions 格式
 */

// 默认 OCR 配置
const DEFAULT_OCR_CONFIG = {
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: '',  // 必须通过数据库配置提供，不再硬编码密钥
  modelName: 'PaddlePaddle/PaddleOCR-VL-1.5',
  timeout: 180000,
};

export class OcrService {
  /**
   * 从数据库获取 OCR 配置，不存在则使用默认值
   */
  static async getOcrConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
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
          apiKey: v.apiKey || DEFAULT_OCR_CONFIG.apiKey,
          modelName: v.modelName || DEFAULT_OCR_CONFIG.modelName,
          timeout: v.timeout || DEFAULT_OCR_CONFIG.timeout,
        };
      }
    } catch (e) {
      console.warn('获取 OCR 配置失败，使用默认值:', e);
    }
    if (!DEFAULT_OCR_CONFIG.apiKey) {
      console.warn('[OCR] API Key 未配置，请在系统配置中设置 OCR API Key');
    }
    return DEFAULT_OCR_CONFIG;
  }

  /**
   * OCR 识别文件 - 支持图片和 PDF
   * @param filePath 文件路径
   * @param fileType 文件类型 (pdf/png/jpg/jpeg 等)
   * @returns 识别出的文本内容
   */
  static async recognizeFile(filePath: string, fileType: string): Promise<string> {
    const config = await this.getOcrConfig();

    const buffer = fs.readFileSync(filePath);
    const base64Data = buffer.toString('base64');

    let mimeType: string;
    switch (fileType.toLowerCase()) {
      case 'pdf':
        mimeType = 'application/pdf';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'webp':
        mimeType = 'image/webp';
        break;
      case 'dwg':
        // DWG 文件作为二进制文件发送给 OCR，使用 application/octet-stream
        mimeType = 'application/octet-stream';
        break;
      default:
        mimeType = 'image/png';
    }

    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const result = await this.callOcrApi(dataUrl, config);
    return this.postProcessOcrText(result);
  }

  /**
   * OCR 文本后处理 - 字符纠正
   * 修复 OCR 识别中常见的混淆字符
   * 
   * 纠正规则：
   *   — (U+2014 长破折号) → - (U+002D 连字符)
   *   一 (U+4E00 中文"一") → - (U+002D 连字符) — 仅在数字上下文中
   *   － (U+FF0D 全角减号) → - (U+002D 连字符)
   */
  static postProcessOcrText(text: string): string {
    if (!text) return text;
    // 全角减号 → 半角连字符
    let r = text.replace(/－/g, '-');
    // 长破折号 → 半角连字符
    r = r.replace(/—/g, '-');
    // 中文"一" → 半角连字符（仅在数字上下文中）
    r = r.replace(/(\d)一(\d)/g, '$1-$2');
    r = r.replace(/([A-Za-z/])一(\d)/g, '$1-$2');
    return r;
  }

  /**
   * 调用硅基流动 PaddleOCR-VL API（动态加载提示词）
   */
  private static async callOcrApi(
    imageDataUrl: string,
    config: {
      apiBaseUrl: string;
      apiKey: string;
      modelName: string;
      timeout: number;
    }
  ): Promise<string> {
    const url = `${config.apiBaseUrl}/chat/completions`;

    // 动态加载 OCR 指令模板
    const defaultOcrInstruction = '<image>\n<|grounding|>OCR this image. 将所有识别到的文字按原文顺序输出。';
    const ocrInstruction = await PromptTemplateService.getPrompt('ocr_instruction', defaultOcrInstruction);

    const body = {
      model: config.modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
              },
            },
            {
              type: 'text',
              text: ocrInstruction,
            },
          ],
        },
      ],
      stream: false,
      max_tokens: 8192,
    };

    console.log(`[OCR] 调用模型: ${config.modelName}, URL: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      return content.trim();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 检查文件类型是否支持 OCR
   */
  static isOcrSupported(fileType: string): boolean {
    const supported = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'dwg'];
    return supported.includes(fileType.toLowerCase());
  }
}
