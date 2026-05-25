import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { success, error } from '../utils/response';
import { LlmProxyService } from '../services/llm-proxy.service';

export const proxyChatCompletions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validation = LlmProxyService.validateChatRequest(req.body);
    if (!validation.valid) {
      error(res, `参数验证失败: ${validation.errors.join('; ')}`, 400);
      return;
    }

    const result = await LlmProxyService.proxyChatCompletions(req.body);

    if (result.success) {
      success(res, result.data, '请求成功');
    } else {
      error(res, result.error || '请求失败', result.statusCode || 500);
    }
  } catch (err: any) {
    console.error('[LLM Proxy] Chat Completions 处理失败:', err);
    error(res, `服务器内部错误: ${err.message}`, 500);
  }
};

export const proxyEmbeddings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validation = LlmProxyService.validateEmbeddingRequest(req.body);
    if (!validation.valid) {
      error(res, `参数验证失败: ${validation.errors.join('; ')}`, 400);
      return;
    }

    const result = await LlmProxyService.proxyEmbeddings(req.body);

    if (result.success) {
      success(res, result.data, '请求成功');
    } else {
      error(res, result.error || '请求失败', result.statusCode || 500);
    }
  } catch (err: any) {
    console.error('[LLM Proxy] Embeddings 处理失败:', err);
    error(res, `服务器内部错误: ${err.message}`, 500);
  }
};

export const proxyRerank = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validation = LlmProxyService.validateRerankRequest(req.body);
    if (!validation.valid) {
      error(res, `参数验证失败: ${validation.errors.join('; ')}`, 400);
      return;
    }

    const result = await LlmProxyService.proxyRerank(req.body);

    if (result.success) {
      success(res, result.data, '请求成功');
    } else {
      error(res, result.error || '请求失败', result.statusCode || 500);
    }
  } catch (err: any) {
    console.error('[LLM Proxy] Rerank 处理失败:', err);
    error(res, `服务器内部错误: ${err.message}`, 500);
  }
};

export const getProxyStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [chatConfig, embeddingConfig, rerankConfig] = await Promise.all([
      LlmProxyService.getModelConfig('chat'),
      LlmProxyService.getModelConfig('embedding'),
      LlmProxyService.getModelConfig('rerank'),
    ]);

    const status = {
      chat: {
        configured: !!chatConfig,
        modelName: chatConfig?.modelName || '未配置',
        apiBaseUrl: chatConfig?.apiBaseUrl || '未配置',
      },
      embedding: {
        configured: !!embeddingConfig,
        modelName: embeddingConfig?.modelName || '未配置',
        apiBaseUrl: embeddingConfig?.apiBaseUrl || '未配置',
      },
      rerank: {
        configured: !!rerankConfig,
        modelName: rerankConfig?.modelName || '未配置',
        apiBaseUrl: rerankConfig?.apiBaseUrl || '未配置',
      },
    };

    success(res, status, '获取状态成功');
  } catch (err: any) {
    console.error('[LLM Proxy] 获取状态失败:', err);
    error(res, `服务器内部错误: ${err.message}`, 500);
  }
};

export const testProxyConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { modelType } = req.body;

    if (!modelType || !['chat', 'embedding', 'rerank'].includes(modelType)) {
      error(res, 'modelType 必须是 chat、embedding 或 rerank', 400);
      return;
    }

    const config = await LlmProxyService.getModelConfig(modelType as any);
    if (!config) {
      error(res, `${modelType} 模型未配置`, 400);
      return;
    }

    let testResult;
    const startTime = Date.now();

    switch (modelType) {
      case 'chat':
        testResult = await LlmProxyService.proxyChatCompletions({
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
        });
        break;
      case 'embedding':
        testResult = await LlmProxyService.proxyEmbeddings({
          input: ['hello world'],
          encoding_format: 'float',
        });
        break;
      case 'rerank':
        testResult = await LlmProxyService.proxyRerank({
          query: 'test',
          documents: ['document 1', 'document 2'],
          top_n: 2,
        });
        break;
    }

    const latency = Date.now() - startTime;

    if (testResult?.success) {
      success(res, {
        success: true,
        modelType,
        modelName: config.modelName,
        apiBaseUrl: config.apiBaseUrl,
        latency: `${latency}ms`,
        message: '连接测试成功',
      }, '连接测试成功');
    } else {
      success(res, {
        success: false,
        modelType,
        modelName: config.modelName,
        apiBaseUrl: config.apiBaseUrl,
        latency: `${latency}ms`,
        message: testResult?.error || '连接测试失败',
      }, '连接测试失败');
    }
  } catch (err: any) {
    console.error('[LLM Proxy] 测试连接失败:', err);
    error(res, `测试连接失败: ${err.message}`, 500);
  }
};