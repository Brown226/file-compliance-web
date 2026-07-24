import axios from 'axios';
import prisma from '../../config/db';
import { FileTypeService } from './file-type.service';

/** OPT-011: 封面结构化信息（由 Python 侧 pdf_enhanced.py 提取） */
export interface CoverInfo {
  doc_no: string;        // 文档编号: NPC-QA-001, HAF-601
  title: string;         // 文档标题（最长的中文行）
  revision: string;      // 版本号: V1.0 / 第3版 / Rev.A
  scale: string;         // 比例: 1:100
  approval: Record<string, string>;  // 审批信息: { 设计: '张三', 校核: '李四', ... }
  raw_lines?: string[];  // OCR 原始前 20 行（调试用）
}

export interface ParseResult {
  text: string;
  pages: string[];
  metadata: {
    page_count?: number | null;
    has_tables: boolean;
    has_images: boolean;
    dwg_layers?: string[];
    dwg_text_count?: number;
    dwg_dimension_count?: number;
    dwg_entity_count?: number;
    standard_ref_count?: number;
    dwg_converted?: boolean;
    title_block?: {
      found: boolean;
      drawingName?: string | null;
      drawingNo?: string | null;
      designer?: string | null;
      checker?: string | null;
      approver?: string | null;
      scale?: string | null;
    };
    layer_stats?: Record<string, { text: number; dimension: number; other: number }>;
    parse_error?: string;
    hint?: string;
    /** OPT-011: 封面结构化信息（图片封面页 OCR 提取） */
    cover_info?: CoverInfo | null;
    /** OCR 引擎名称（扫描件降级时存在） */
    ocr_engine?: string;
  };
  structure: {
    paragraphs: Array<{
      text: string;
      style: string | null;
      page: number | null;
      handle?: string;
    }>;
    tables: Array<{
      page: number | null;
      rows: string[][];
      caption: string | null;
    }>;
    headers?: Array<{
      text: string;
      type: string;
      page: number | null;
    }>;
    dimensions?: Array<{
      text: string;
      layer: string;
      entity_type: string;
      handle: string;
      measurement?: string | null;
    }>;
    standardRefs?: Array<{
      standardNo: string;
      standardName: string;
      standardIdent: string;
      fullMatch: string;
      cadHandleId?: string;
    }>;
  };
  /** Markdown 格式的文档内容（markitdown 服务新增字段） */
  markdown?: string;
}

interface ParseResponse {
  code: number;
  message: string;
  data: ParseResult;
}

/**
 * Python 文件解析微服务客户端
 * 调用 Python FastAPI 微服务进行文件解析，返回结构化数据
 */
export class PythonParserService {
  /**
   * 获取 Python 解析服务的 URL
   */
  static async getServiceUrl(): Promise<string> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'parser_service_url' },
      });
      if (config?.value && typeof config.value === 'string') {
        return config.value;
      }
    } catch {}
    return process.env.PARSER_SERVICE_URL || 'http://localhost:8000';
  }

  /**
   * 调用 Python 解析服务解析文件
   */
  static async parseFile(filePath: string, fileType: string): Promise<ParseResult> {
    const fs = await import('fs');
    const path = await import('path');

    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`);
    }

    const serviceUrl = await this.getServiceUrl();
    const fileBuffer = await fs.promises.readFile(absolutePath);
    const fileName = path.basename(absolutePath);

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileBuffer, fileName);
    form.append('file_type', fileType.toLowerCase());

    // 传递视觉模型配置（可选，用于扫描件 PDF OCR 降级）
    try {
      const visionKeys = ['llm_vision_model', 'llm_ocr_model'];
      for (const key of visionKeys) {
        const cfg = await prisma.systemConfig.findUnique({ where: { key } });
        if (cfg?.value && typeof cfg.value === 'object') {
          const v = cfg.value as any;

          // 新结构：providerId 引用 LlmProfile
          if (v.providerId) {
            const profilesCfg = await prisma.systemConfig.findUnique({
              where: { key: 'llm_profiles' },
            });
            if (profilesCfg?.value) {
              const profilesRaw =
                typeof profilesCfg.value === 'string'
                  ? JSON.parse(profilesCfg.value)
                  : profilesCfg.value;
              const profiles = Array.isArray(profilesRaw) ? profilesRaw : [];
              const profile = profiles.find((p: any) => p.id === v.providerId);
              if (profile && profile.apiKey && profile.model) {
                form.append('vision_api_key', profile.apiKey);
                form.append('vision_model_name', profile.model);
                form.append('vision_base_url', profile.apiBase || '');
                break;
              }
            }
          }

          // 兜底：旧结构
          if (v.apiKey && v.modelName) {
            form.append('vision_api_key', v.apiKey);
            form.append('vision_model_name', v.modelName);
            form.append('vision_base_url', v.apiBaseUrl || '');
            break;
          }
        }
      }
    } catch {
      // 配置读取失败时静默跳过
    }

    if (FileTypeService.isCadFile(fileType)) {
      return {
        text: '',
        pages: [],
        metadata: {
          page_count: 0,
          has_tables: false,
          has_images: false,
          parse_error: 'DWG 文件已改为前端 WASM 解析，后端不再提供解析服务',
        },
        structure: {
          paragraphs: [],
          tables: [],
          headers: [],
          dimensions: [],
          standardRefs: [],
        },
        markdown: '',
      };
    }

    const endpoint = '/api/parse';

    try {
      const response = await axios.post<ParseResponse>(
        `${serviceUrl}${endpoint}`,
        form,
        { headers: form.getHeaders(), timeout: 120000 }
      );

      if (response.data.code !== 200) {
        throw new Error(response.data.message || '解析服务返回错误');
      }

      return response.data.data;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Python 解析服务不可用，请检查服务是否启动');
      }
      if (error.response) {
        const detail = error.response.data?.detail || error.response.data?.message || '未知错误';
        throw new Error(`Python 解析服务错误: ${detail}`);
      }
      throw error;
    }
  }

  /**
   * 检查 Python 解析服务健康状态
   */
  static async healthCheck(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const serviceUrl = await this.getServiceUrl();
      const response = await axios.get(`${serviceUrl}/health`, { timeout: 5000 });
      return { reachable: response.status === 200 };
    } catch (error: any) {
      return { reachable: false, error: error.message };
    }
  }
}
