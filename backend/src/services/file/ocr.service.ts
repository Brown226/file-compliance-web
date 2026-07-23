import prisma from '../../config/db';
import fs from 'fs';
import path from 'path';
import { PythonParserService } from './python-parser.service';
import { FileTypeService } from './file-type.service';

interface OcrConfig {
  apiBaseUrl: string;
  apiKey?: string;
  modelName?: string;
  timeout: number;
}

const DEFAULT_OCR_CONFIG: OcrConfig = {
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  timeout: 300000,
};

/**
 * OCR 服务 — 使用 doc-parser 的视觉模型 OCR 端点
 *
 * 不再依赖独立 OCR 服务（PaddleOCR 容器），改为调用 doc-parser 的 /api/ocr/scan 端点。
 * doc-parser 内部使用 pdf2image + 视觉大模型 API 完成扫描件识别。
 */
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
              timeout: (v.timeout || 300) * 1000,
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
   * 检测 OCR 能力状态
   * 现在检查的是 doc-parser 服务 + 视觉模型配置
   */
  static async healthCheck(): Promise<{ healthy: boolean; info?: any; error?: string }> {
    try {
      const { reachable, error } = await PythonParserService.healthCheck();
      if (!reachable) {
        return { healthy: false, error: error || 'doc-parser 服务不可用' };
      }

      const visionConfig = await this.getVisionConfig();
      return {
        healthy: true,
        info: {
          service: 'doc-parser (vision-llm)',
          status: 'healthy',
          visionConfigured: !!(visionConfig.apiKey && visionConfig.modelName),
          visionModel: visionConfig.modelName || '未配置',
        },
      };
    } catch (e: any) {
      return { healthy: false, error: e.message || 'OCR 健康检查失败' };
    }
  }

  /**
   * 快速检测 OCR 服务是否可用（返回布尔值）
   */
  static async checkHealth(): Promise<boolean> {
    try {
      const result = await this.healthCheck();
      return result.healthy;
    } catch {
      return false;
    }
  }

  /**
   * 识别文件中的文字
   * 通过 doc-parser 的 /api/ocr/scan 端点，使用视觉大模型识别扫描件。
   * 返回结构化结果，携带状态信息而非仅字符串。
   */
  static async recognizeFile(filePath: string, fileType: string): Promise<{ text: string; status: 'success' | 'unavailable' | 'failed'; reason?: string; confidence?: number }> {
    const config = await this.getVisionConfig();

    if (!config.apiKey || !config.modelName) {
      console.warn('[OCR] 未配置视觉模型 (llm_vision_model)，跳过 OCR');
      return { text: '', status: 'unavailable', reason: '未配置视觉模型(llm_vision_model)' };
    }

    const serviceUrl = await PythonParserService.getServiceUrl();
    const fileName = path.basename(filePath);

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    const fileBuffer = await fs.promises.readFile(filePath);
    form.append('file', fileBuffer, fileName);
    form.append('apiBaseUrl', config.apiBaseUrl);
    form.append('apiKey', config.apiKey);
    form.append('modelName', config.modelName);
    form.append('timeoutSec', String(Math.round(config.timeout / 1000)));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      console.log(`[OCR] 调用 doc-parser 视觉模型 OCR: ${fileName}, model=${config.modelName}`);
      const response = await fetch(`${serviceUrl}/api/ocr/scan`, {
        method: 'POST',
        body: form as any,
        headers: form.getHeaders(),
        signal: controller.signal,
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        return { text: '', status: 'failed', reason: `OCR API 错误 (${response.status}): ${errorText}` };
      }

      const data = (await response.json()) as any;
      const text = data.data?.text || '';
      console.log(`[OCR] 识别完成: ${fileName}, ${text.length} 字符`);
      const processed = OcrService.postProcessOcrText(text);
      // OPT-028: 估算 OCR 置信度
      const confidence = OcrService.estimateConfidence(processed);
      return { text: processed, status: 'success', confidence };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { text: '', status: 'failed', reason: 'OCR 请求超时' };
      }
      return { text: '', status: 'failed', reason: e.message || 'OCR 网络请求失败' };
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

  /**
   * OPT-028: 估算 OCR 文本置信度（0-1）
   * 基于启发式规则：字符密度、乱码比例、有效字符占比
   */
  static estimateConfidence(text: string): number {
    if (!text || text.length === 0) return 0;

    const totalChars = text.length;

    // 1. 有效字符比例（中文 + 英文 + 数字 + 常见标点）
    const validChars = (text.match(/[\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9\s，。、；：""''（）【】《》,.:;()'"\-+/]/g) || []).length;
    const validRatio = validChars / totalChars;

    // 2. 乱码/控制字符比例
    const controlChars = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/g) || []).length;
    const garbageRatio = controlChars / totalChars;

    // 3. 字符密度（每行平均字符数，过低可能是识别碎片）
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const avgLineLength = lines.length > 0 ? totalChars / lines.length : 0;
    const densityScore = Math.min(1, avgLineLength / 20); // 20字符/行为满分

    // 综合评分
    let confidence = validRatio * 0.5 + (1 - garbageRatio) * 0.3 + densityScore * 0.2;

    // 文本过短惩罚
    if (totalChars < 50) confidence *= 0.7;

    return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
  }
}
