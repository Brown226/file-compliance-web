import prisma from '../config/db';
import fs from 'fs';
import path from 'path';
import { FileTypeService } from './file-type.service';

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

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:8001';

export class OcrService {
  /**
   * 获取视觉模型兜底配置（优先从 llm_vision_model 读取，兼容旧 llm_ocr_model）
   */
  static async getVisionConfig(): Promise<OcrConfig> {
    try {
      const keys = ['llm_vision_model', 'llm_ocr_model'];
      for (const key of keys) {
        const config = await prisma.systemConfig.findUnique({ where: { key } });
        if (config?.value && typeof config.value === 'object') {
          const v = config.value as any;
          // 需要有 API key 和 modelName 才视为有效配置
          if (v.apiKey && v.modelName) {
            return {
              apiBaseUrl: v.apiBaseUrl || DEFAULT_OCR_CONFIG.apiBaseUrl,
              apiKey: v.apiKey,
              modelName: v.modelName,
              timeout: (v.timeout || 180) * 1000,
            };
          }
        }
      }
    } catch (e) {
      console.warn('获取视觉模型配置失败:', e);
    }
    return { ...DEFAULT_OCR_CONFIG };
  }

  /**
   * 检测 PaddleOCR 服务连通状态
   */
  static async healthCheck(): Promise<{ healthy: boolean; info?: any; error?: string }> {
    try {
      const resp = await fetch(`${OCR_SERVICE_URL}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      // 同时获取支持的模型列表
      let models: string[] = [];
      try {
        const mResp = await fetch(`${OCR_SERVICE_URL}/models`, { signal: AbortSignal.timeout(3000) });
        const mData = await mResp.json();
        models = mData.models || [];
      } catch {}
      return {
        healthy: true,
        info: {
          url: OCR_SERVICE_URL,
          service: data.service || 'PaddleOCR',
          status: data.status || 'healthy',
          models,
        },
      };
    } catch (e: any) {
      return { healthy: false, error: e.message || '无法连接 OCR 服务' };
    }
  }

  /**
   * 识别文件中的文字
   * 后端只负责传递原始文件内容与识别配置；PDF 渲染和 OCR 识别由独立 OCR 容器完成。
   */
  static async recognizeFile(filePath: string, fileType: string): Promise<string> {
    const config = await this.getVisionConfig();
    const base64Data = fs.readFileSync(filePath).toString('base64');
    const normalizedFileType = FileTypeService.normalizeFileType(fileType, path.basename(filePath));
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
    return FileTypeService.isOcrSupported(fileType);
  }
}