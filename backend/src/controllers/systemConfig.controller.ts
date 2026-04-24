import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/db';
import { success, error } from '../utils/response';

/**
 * 获取系统配置
 */
export const getSystemConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const config = await prisma.systemConfig.findUnique({
      where: { key },
    });

    success(res, { value: config?.value ?? null });
  } catch (err) {
    console.error('Get System Config Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/**
 * 保存系统配置
 */
export const saveSystemConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const { value } = req.body;

    if (!key) {
      error(res, '配置键名不能为空', 400);
      return;
    }

    if (value === undefined || value === null) {
      error(res, '配置值不能为空', 400);
      return;
    }

    // 验证 JSON 格式（如果是对象）
    let stringValue: string;
    if (typeof value === 'object') {
      try {
        stringValue = JSON.stringify(value);
      } catch (e) {
        error(res, '配置值格式错误，无法序列化为 JSON', 400);
        return;
      }
    } else {
      stringValue = String(value);
    }

    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue },
    });

    success(res, config, '配置保存成功');
  } catch (err: any) {
    console.error('Save System Config Error:', err);
    // 提供更详细的错误信息
    if (err.code === 'P2002') {
      error(res, '配置项已存在，请刷新后重试', 409);
    } else if (err.code === 'P2025') {
      error(res, '配置项不存在', 404);
    } else {
      error(res, `服务器内部错误: ${err.message || '未知错误'}`, 500);
    }
  }
};

/**
 * 测试 LLM 连接 - 真实 API 调用
 * 支持 chat（/chat/completions）、embedding（/embeddings）、rerank（/rerank）三种端点
 */
export const testLlmConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { serviceType, apiKey, apiBaseUrl, modelName, modelType = 'chat', topK } = req.body;

    if (!serviceType || !apiKey || !modelName) {
      error(res, '请填写完整的 LLM 配置参数', 400);
      return;
    }

    // 确定实际的 API 地址
    let baseUrl = apiBaseUrl;
    if (serviceType === 'volcengine') {
      baseUrl = baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
    } else if (serviceType === 'siliconflow') {
      baseUrl = baseUrl || 'https://api.siliconflow.cn/v1';
    }

    if (!baseUrl) {
      error(res, '请填写 API 基础 URL', 400);
      return;
    }

    // 根据模型类型选择端点和请求体
    let url: string;
    let body: any;
    
    if (modelType === 'embedding') {
      // Embedding 模型：使用 /embeddings 端点
      url = `${baseUrl.replace(/\/embeddings$/, '')}/embeddings`;
      body = {
        model: modelName,
        input: ['hello world'],
        encoding_format: 'float',
      };
    } else if (modelType === 'rerank') {
      // Rerank 模型：使用 /rerank 端点（硅基流动等 OpenAI 兼容格式）
      url = `${baseUrl.replace(/\/rerank$/, '')}/rerank`;
      body = {
        model: modelName,
        query: '建筑防火设计规范要求',
        documents: [
          '建筑设计防火规范适用于新建、改建和扩建的民用建筑及工业建筑的防火设计。',
          '建筑结构荷载规范适用于建筑结构的荷载取值与组合。',
          '建筑抗震设计规范适用于抗震设防烈度为6度及以上地区的建筑抗震设计。',
        ],
        return_documents: true,
        top_n: topK || 3,
      };
    } else {
      // Chat / OCR 模型：使用 /chat/completions 端点
      url = `${baseUrl}/chat/completions`;
      body = {
        model: modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      };
    }

    // 发送一个最简单的请求来验证连接
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        success(res, {
          success: false,
          message: `连接失败 (${response.status}): ${errorText.substring(0, 200)}`,
          model: modelName,
          baseUrl,
        });
        return;
      }

      const data = await response.json() as any;

      success(res, {
        success: true,
        message: `${serviceType} 连接测试成功`,
        model: modelName,
        baseUrl,
        usage: data.usage || null,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    console.error('Test LLM Connection Error:', err);
    const message = err.name === 'AbortError' ? '连接超时' : (err.message || '连接失败');
    success(res, {
      success: false,
      message: `连接测试失败: ${message}`,
    });
  }
};

/**
 * 发送 LLM 测试消息 - 真实 API 调用
 */
export const sendLlmTest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { prompt, serviceType, apiKey, apiBaseUrl, modelName, maxTokens, temperature } = req.body;

    if (!prompt || !serviceType || !apiKey || !modelName) {
      error(res, '请填写完整的测试参数', 400);
      return;
    }

    // 确定实际的 API 地址
    let baseUrl = apiBaseUrl;
    if (serviceType === 'volcengine') {
      baseUrl = baseUrl || 'https://ark.cn-beijing.volces.com/api/coding/v3';
    } else if (serviceType === 'siliconflow') {
      baseUrl = baseUrl || 'https://api.siliconflow.cn/v1';
    }

    if (!baseUrl) {
      error(res, '请填写 API 基础 URL', 400);
      return;
    }

    const url = `${baseUrl}/chat/completions`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens || 1000,
          temperature: temperature ?? 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        success(res, {
          success: false,
          response: `API 错误 (${response.status}): ${errorText.substring(0, 300)}`,
        });
        return;
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '无响应内容';

      success(res, {
        success: true,
        response: content,
        usage: data.usage || null,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    console.error('Send LLM Test Error:', err);
    const message = err.name === 'AbortError' ? '请求超时' : (err.message || '请求失败');
    success(res, {
      success: false,
      response: `测试请求失败: ${message}`,
    });
  }
};
