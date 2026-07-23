import prisma from '../../config/db';

export interface LlmProxyConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export interface ProxyRequest {
  model?: string;
  [key: string]: any;
}

export interface ProxyResponse {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
}

export class LlmProxyService {
  static async getModelConfig(modelType: 'chat' | 'embedding' | 'rerank'): Promise<LlmProxyConfig | null> {
    const configKeyMap = {
      chat: 'llm_chat_model',
      embedding: 'embedding_model',
      rerank: 'reranker_model',
    };

    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: configKeyMap[modelType] },
      });

      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          return {
            apiBaseUrl: v.apiBaseUrl || this.getDefaultBaseUrl(modelType),
            apiKey: v.apiKey,
            modelName: v.modelName,
            maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : 8192,
            temperature: typeof v.temperature === 'number' ? v.temperature : 0.3,
            timeout: typeof v.timeout === 'number' ? v.timeout : 120,
          };
        }
      }
    } catch (e) {
      console.warn(`[LLM Proxy] 获取 ${modelType} 配置失败:`, e);
    }
    return null;
  }

  static getDefaultBaseUrl(modelType: 'chat' | 'embedding' | 'rerank'): string {
    const defaults = {
      chat: 'https://api.siliconflow.cn/v1',
      embedding: 'https://api.siliconflow.cn/v1',
      rerank: 'https://api.siliconflow.cn/v1',
    };
    return defaults[modelType];
  }

  static validateBaseUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.pathname.endsWith('/v1');
    } catch {
      return false;
    }
  }

  static normalizeBaseUrl(url: string): string {
    let normalized = url.trim();
    if (!normalized.endsWith('/v1')) {
      normalized = normalized.replace(/\/+$/, '') + '/v1';
    }
    return normalized;
  }

  static async proxyChatCompletions(request: ProxyRequest): Promise<ProxyResponse> {
    const config = await this.getModelConfig('chat');
    if (!config) {
      return {
        success: false,
        error: 'Chat 模型未配置，请在系统配置中设置 LLM API',
        statusCode: 400,
      };
    }

    return this.makeRequest(
      config,
      '/chat/completions',
      request
    );
  }

  static async proxyEmbeddings(request: ProxyRequest): Promise<ProxyResponse> {
    const config = await this.getModelConfig('embedding');
    if (!config) {
      return {
        success: false,
        error: 'Embedding 模型未配置，请在系统配置中设置 Embedding API',
        statusCode: 400,
      };
    }

    return this.makeRequest(
      config,
      '/embeddings',
      request
    );
  }

  static async proxyRerank(request: ProxyRequest): Promise<ProxyResponse> {
    const config = await this.getModelConfig('rerank');
    if (!config) {
      return {
        success: false,
        error: 'Rerank 模型未配置，请在系统配置中设置 Rerank API',
        statusCode: 400,
      };
    }

    return this.makeRequest(
      config,
      '/rerank',
      request
    );
  }

  private static async makeRequest(
    config: LlmProxyConfig,
    endpoint: string,
    request: ProxyRequest
  ): Promise<ProxyResponse> {
    try {
      const normalizedUrl = this.normalizeBaseUrl(config.apiBaseUrl);
      const url = `${normalizedUrl}${endpoint}`;

      const body = {
        model: request.model || config.modelName,
        ...request,
      };

      const timeoutMs = (config.timeout || 120) * 1000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LLM Proxy] API 错误 (${response.status}):`, errorText);
        return {
          success: false,
          error: `API 错误 (${response.status}): ${errorText.substring(0, 500)}`,
          statusCode: response.status,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
        statusCode: response.status,
      };

    } catch (err: any) {
      console.error('[LLM Proxy] 请求失败:', err);
      const message = err.name === 'AbortError' ? '请求超时' : (err.message || '请求失败');
      return {
        success: false,
        error: `请求失败: ${message}`,
        statusCode: 500,
      };
    }
  }

  static validateChatRequest(request: ProxyRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.messages || !Array.isArray(request.messages)) {
      errors.push('messages 必须是数组格式');
    } else {
      for (const msg of request.messages) {
        if (!msg.role || !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
          errors.push(`消息角色 ${msg.role} 无效，必须是 system/user/assistant/tool`);
        }
        if (!msg.content || typeof msg.content !== 'string') {
          errors.push('消息内容不能为空');
        }
      }
    }

    if (request.max_tokens && (typeof request.max_tokens !== 'number' || request.max_tokens < 1)) {
      errors.push('max_tokens 必须是正整数');
    }

    if (request.temperature !== undefined && (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2)) {
      errors.push('temperature 必须在 0 到 2 之间');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static validateEmbeddingRequest(request: ProxyRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.input) {
      errors.push('input 不能为空');
    } else if (!Array.isArray(request.input) && typeof request.input !== 'string') {
      errors.push('input 必须是字符串或字符串数组');
    }

    if (request.encoding_format && !['float', 'base64'].includes(request.encoding_format)) {
      errors.push('encoding_format 必须是 float 或 base64');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static validateRerankRequest(request: ProxyRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.query || typeof request.query !== 'string') {
      errors.push('query 必须是字符串');
    }

    if (!request.documents || !Array.isArray(request.documents) || request.documents.length === 0) {
      errors.push('documents 必须是非空数组');
    }

    if (request.top_n && (typeof request.top_n !== 'number' || request.top_n < 1)) {
      errors.push('top_n 必须是正整数');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}