import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/db';
import { success, error } from '../utils/response';
import { invalidateConfigCache } from '../utils/system-config';
import axios from 'axios';

/**
 * 获取系统配置
 */
export const getSystemConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const config = await prisma.systemConfig.findUnique({
      where: { key },
    });

    let value = config?.value ?? null;

    // 防御性修复：如果数据库存储的是 JSON 字符串(双重序列化)，自动解析为对象
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
          value = parsed;
        }
      } catch (e) {
        // 非 JSON 字符串则保持原样
      }
    }

    success(res, { value });
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

    // 防御性修复：如果 value 是字符串且看起来像 JSON，解析为对象后再存入
    // 防止 old client code 发送 stringify 后的值导致双重序列化
    let normalizedValue = value;
    if (typeof normalizedValue === 'string') {
      try {
        const parsed = JSON.parse(normalizedValue);
        if (typeof parsed === 'object' && parsed !== null) {
          normalizedValue = parsed;
        }
      } catch (e) {
        // 非 JSON 字符串，保持原样
      }
    }

    // Prisma Json 类型直接接受对象，无需手动 JSON.stringify
    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value: normalizedValue },
      create: { key, value: normalizedValue },
    });

    if (key === 'basic_settings') {
      invalidateConfigCache();
    }

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
 *
 * 凭证来源优先级：
 *   1. providerId（推荐）：从 LlmProfile 解析凭证（脱敏 key 无法直接传，必须走此路径）
 *   2. apiKey/apiBaseUrl/modelName 直传（用于 Provider Tab 编辑态测试）
 */
export const testLlmConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { serviceType, modelType = 'chat', topK, providerId } = req.body;

    // 凭证解析：providerId 优先，否则用直传字段
    let apiKey: string | undefined = req.body.apiKey;
    let apiBaseUrl: string | undefined = req.body.apiBaseUrl;
    let modelName: string | undefined = req.body.modelName;
    let resolvedServiceType: string | undefined = serviceType;

    if (providerId) {
      const profilesCfg = await prisma.systemConfig.findUnique({
        where: { key: 'llm_profiles' },
      });
      if (profilesCfg?.value) {
        const raw = typeof profilesCfg.value === 'string' ? JSON.parse(profilesCfg.value) : profilesCfg.value;
        const profiles = Array.isArray(raw) ? raw : [];
        const profile = profiles.find((p: any) => p.id === providerId);
        if (profile) {
          apiKey = profile.apiKey;
          apiBaseUrl = profile.apiBase;
          modelName = profile.model;
          resolvedServiceType = resolvedServiceType || profile.provider;
        } else {
          error(res, `未找到 Provider: ${providerId}`, 400);
          return;
        }
      }
    }

    if (!apiKey || !modelName) {
      error(res, '请填写完整的 LLM 配置参数（或选择有效的 Provider）', 400);
      return;
    }

    // 确定实际的 API 地址
    let baseUrl = apiBaseUrl;
    if (resolvedServiceType === 'volcengine') {
      baseUrl = baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
    } else if (resolvedServiceType === 'siliconflow') {
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
    } else if (modelType === 'rerank' || modelType === 'reranker') {
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
        message: `${resolvedServiceType || 'LLM'} 连接测试成功`,
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

// ==================== LLM Profiles 管理 ====================

/** 密钥脱敏工具函数 */
function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

/**
 * GET /api/system-config/llm-profiles
 * 获取所有 LLM 配置（密钥脱敏）
 */
export const getLlmProfiles = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'llm_profiles' },
    });

    let profiles: any[] = [];
    if (config?.value) {
      const raw = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
      profiles = Array.isArray(raw) ? raw : [];
    }

    // 密钥脱敏
    const masked = profiles.map((p: any) => ({
      ...p,
      apiKey: p.apiKey ? maskApiKey(p.apiKey) : undefined,
    }));

    success(res, masked);
  } catch (err: any) {
    console.error('Get LLM Profiles Error:', err);
    error(res, `服务器内部错误: ${err.message || '未知错误'}`, 500);
  }
};

/**
 * PUT /api/system-config/llm-profiles
 * 保存所有 LLM 配置
 */
export const saveLlmProfiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { profiles } = req.body;
    if (!Array.isArray(profiles)) {
      error(res, 'profiles 必须是数组', 400);
      return;
    }

    // 确保只有一个 active
    const hasActive = profiles.some((p: any) => p.isActive);
    if (hasActive) {
      profiles.forEach((p: any) => {
        if (p.isActive && !profiles.find((q: any) => q !== p && q.isActive === true && q.id !== p.id)) {
          // keep first active, deactivate rest
        }
      });
    }

    await prisma.systemConfig.upsert({
      where: { key: 'llm_profiles' },
      update: { value: JSON.stringify(profiles) },
      create: { key: 'llm_profiles', value: JSON.stringify(profiles) },
    });

    invalidateConfigCache();
    success(res, null, 'LLM 配置保存成功');
  } catch (err: any) {
    console.error('Save LLM Profiles Error:', err);
  }
};

/**
 * POST /api/system-config/llm-profiles/fetch-models
 * 从 Provider 的 API 地址拉取可用模型列表
 * 返回值附带预置能力库匹配结果（inputModalities/supportsToolCalling/contextWindowTokens/maxOutputTokens）
 */
export const fetchProviderModels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { apiBase, apiKey } = req.body;
    if (!apiBase) {
      error(res, '缺少 apiBase 参数', 400);
      return;
    }

    // 拼接 models 端点
    const base = apiBase.replace(/\/+$/, '');
    const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await axios.get(modelsUrl, {
      headers,
      timeout: 10000,
    });

    const { lookupCapabilities } = require('../services/llm/model-capabilities.registry');
    const models: Array<{ id: string; capabilities: any }> = (response.data?.data || [])
      .map((m: any) => m.id)
      .filter(Boolean)
      .sort()
      .map((id: string) => ({
        id,
        capabilities: lookupCapabilities(id),
      }));

    res.json({ success: true, data: models });
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message || '拉取模型列表失败';
    res.json({ success: false, message: msg });
  }
};

/**
 * 可观测性 P2：AI 调用看板统计数据
 * GET /api/system/ai-call-stats
 */
export const getAiCallStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const totalCalls = await prisma.llmCallLog.count();

    const tokenAgg = await prisma.llmCallLog.aggregate({
      _sum: { totalTokens: true },
      _avg: { latencyMs: true },
    });

    const failedCalls = await prisma.llmCallLog.count({
      where: { status: 'failed' },
    });

    const modelStats = await prisma.llmCallLog.groupBy({
      by: ['model'],
      _count: { _all: true },
      _sum: { totalTokens: true, costEstimate: true },
      _avg: { latencyMs: true },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyTrend = await prisma.$queryRaw<Array<{ date: string; tokens: bigint }>>`
      SELECT DATE(created_at) as date, COALESCE(SUM(total_tokens), 0)::bigint as tokens
      FROM llm_call_log
      WHERE created_at >= ${thirtyDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    success(res, {
      totalCalls,
      totalTokens: Number(tokenAgg._sum.totalTokens || 0),
      avgLatency: Math.round(Number(tokenAgg._avg.latencyMs || 0)),
      errorRate: totalCalls > 0 ? Number(((failedCalls / totalCalls) * 100).toFixed(1)) : 0,
      modelStats: modelStats.map(m => ({
        model: m.model,
        calls: m._count._all,
        totalTokens: Number(m._sum.totalTokens || 0),
        avgLatency: Math.round(Number(m._avg.latencyMs || 0)),
        costEstimate: Number((m._sum.costEstimate || 0).toFixed(4)),
      })),
      dailyTrend: dailyTrend.map(d => ({
        date: String(d.date),
        tokens: Number(d.tokens || 0),
      })),
    });
  } catch (err: any) {
    console.error('[Observability] 获取 AI 调用统计失败:', err);
    error(res, `获取统计失败: ${err.message || '未知错误'}`, 500);
  }
};
