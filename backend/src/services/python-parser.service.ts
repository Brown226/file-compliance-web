import axios from 'axios';
import prisma from '../config/db';

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
  private static async getServiceUrl(): Promise<string> {
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
    const fileBuffer = fs.readFileSync(absolutePath);
    const fileName = path.basename(absolutePath);

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileBuffer, fileName);
    form.append('file_type', fileType.toLowerCase());

    // DWG 文件不再通过 Python 服务解析，由前端 WASM 方案处理
    // 如果后端仍收到 DWG 解析请求，直接返回空结果
    if (['dwg', 'dxf'].includes(fileType.toLowerCase())) {
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
