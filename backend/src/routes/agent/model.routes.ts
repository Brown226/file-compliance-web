/**
 * Agent 模型路由 — LLM 模型 / Provider 管理
 *
 * 端点（挂载于 /api/agent）：
 *   GET  /models               — 可用模型列表
 *   GET  /providers            — LLM 供应商配置列表（仅 ADMIN）
 *   PUT  /providers            — 保存 LLM 供应商配置（仅 ADMIN）
 *   POST /models/test          — 模型连通性测试（仅 ADMIN）
 *   POST /providers/discover   — 从 Provider 的 /models 接口拉取模型列表（仅 ADMIN）
 *   POST /providers/catalog    — 本地模型目录填充（仅 ADMIN）
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 * assertSafeFetchUrl 为导出函数（供 SSRF 单元测试复用），由 agent.routes.ts re-export。
 */

import { Router, Response } from 'express';
import { lookup as dnsLookup } from 'dns';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';
import { LlmService } from '../../services/llm/llm.service';
import { lookupCapabilities } from '../../services/llm/model-capabilities.registry';
import prisma from '../../config/db';

const router = Router();

// ===== 模型与 Provider 管理（2026-08-03 新增）=====

/**
 * GET /api/agent/models — 可用模型列表
 *
 * 从 system_configs.llm_profiles 展平所有 provider 的模型（不含系统默认条目，
 * 模型列表只来自用户配置；默认选中由前端取第一个模型）。
 *
 * 返回：{ success, data: { defaultKey: string|null, models: AgentModelOption[] } }
 *   AgentModelOption: { key, label, provider, modelId, name, vision }
 *   key 格式：<providerId>::<modelName>
 *   provider/modelId/name 为结构化字段（对齐参考 pi-web modelList: { id, name, provider }[]）
 *   vision 表示该模型配置时勾选了视觉能力（capabilities.inputModalities 含 image）
 */
router.get('/models', async (req: AuthRequest, res: Response) => {
  try {
    const models: Array<{ key: string | null; label: string; provider: string; modelId: string; name: string; vision: boolean }> = [];

    const profilesCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    if (profilesCfg?.value) {
      const raw = typeof profilesCfg.value === 'string' ? JSON.parse(profilesCfg.value) : profilesCfg.value;
      const profiles = Array.isArray(raw) ? raw : [];
      for (const p of profiles) {
        if (p?.id && p?.model) {
          // 模型用途过滤：embedding/rerank 是工具模型，不可用于对话，不得进入对话选择器。
          // usage 来源 = 供应商配置面板（usage: 'chat'|'embedding'|'vision'|'rerank'|'all'，
          // 未设置视为 chat，兼容旧数据）。其余消费方（LLMConfig 各 Tab）已有同口径过滤。
          if (p.usage === 'embedding' || p.usage === 'rerank') continue;
          // provider 分组用 p.name（真实供应商名，如 CNPE），而不是 p.id（随机串）。
          // llm_profiles 是「一 provider 一 model」扁平结构，同一供应商的多模型 name 相同，
          // 按 name 分组才能在对话下拉里归成一组（对齐 pi-web providers->models 两级视图）。
          const providerName = p.name || p.id;
          const inputModalities: string[] = Array.isArray(p?.capabilities?.inputModalities)
            ? p.capabilities.inputModalities
            : [];
          const vision = inputModalities.includes('image') || inputModalities.includes('images');
          models.push({
            key: `${p.id}::${p.model}`,
            label: p.model,
            provider: providerName,
            modelId: p.model,
            name: p.model,
            vision,
          });
        }
      }
    }

    // P2-㉑ 模型范围 scopedModels：?scope=a*,b* 用 minimatch glob 过滤可见模型
    const scopeRaw = req.query.scope;
    if (typeof scopeRaw === 'string' && scopeRaw.trim()) {
      const patterns = scopeRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (patterns.length > 0) {
        const { minimatch } = require('minimatch');
        const filtered = models.filter(m => {
          const target = m.key || m.label;
          return patterns.some(p => minimatch(target, p, { nocase: true }));
        });
        return res.json({ success: true, data: { defaultKey: null, models: filtered } });
      }
    }

    return res.json({ success: true, data: { defaultKey: null, models } });
  } catch (e: any) {
    console.error('[Agent] 列出模型失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出模型失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/providers — LLM 供应商配置列表（llm_profiles）
 * 仅管理员可读（含 apiKey 敏感信息）
 */
router.get('/providers', requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    const raw = cfg?.value
      ? (typeof cfg.value === 'string' ? JSON.parse(cfg.value) : cfg.value)
      : [];
    return res.json({ success: true, data: Array.isArray(raw) ? raw : [] });
  } catch (e: any) {
    console.error('[Agent] 读取 providers 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `读取 providers 失败: ${e?.message || e}` });
  }
});

/**
 * PUT /api/agent/providers — 保存 LLM 供应商配置
 * Body: { profiles: Array<{ id, name, apiBase, apiKey, model, provider?, timeout? }> }
 * 仅管理员可写
 */
router.put('/providers', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { profiles } = req.body || {};
    if (!Array.isArray(profiles)) {
      return res.status(400).json({ success: false, message: 'profiles 必须为数组' });
    }
    
    await prisma.systemConfig.upsert({
      where: { key: 'llm_profiles' },
      update: { value: JSON.stringify(profiles) },
      create: { key: 'llm_profiles', value: JSON.stringify(profiles) },
    });

    // P0 修复（2026-08-28）：保存后清 LLM 配置/能力缓存——否则审查与 Agent
    // 最长 1 小时内仍用旧 provider 配置（含密钥/模型/能力字段），「改了没反应」
    LlmService.invalidateLlmCaches();

    return res.json({ success: true, data: profiles });
  } catch (e: any) {
    console.error('[Agent] 保存 providers 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `保存 providers 失败: ${e?.message || e}` });
  }
});

/**
* POST /api/agent/models/test — 模型连通性测试
* Body: { apiBase, apiKey, model, apiFormat? }
* apiFormat='hezhi'（核智自定义协议）时直接 POST /hz_model 非流式 ping；默认走 OpenAI 兼容探测
* 仅管理员可调
*/
router.post('/models/test', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { apiBase, apiKey, model, apiFormat } = req.body || {};
    if (!apiBase || !apiKey || !model) {
      return res.status(400).json({ success: false, message: 'apiBase/apiKey/model 必填' });
    }

    // 核智自定义协议：/models 探测无意义，直接非流式 ping /hz_model（参照 T1 连通性测试）
    if (apiFormat === 'hezhi') {
      try {
        const text = await LlmService.hezhiChat(
          { apiBaseUrl: apiBase, apiKey, modelName: model, provider: 'hezhi' },
          '连通性测试，请只回答：OK',
          { timeout: 60, mode: 'model-test' },
        );
        return res.json({ success: true, data: { ok: true, message: `已连通（应答 ${text.length} 字）` } });
      } catch (e: any) {
        return res.json({ success: true, data: { ok: false, message: (e as Error)?.message?.slice(0, 200) || '核智大模型不可达' } });
      }
    }

    const caps = await LlmService.probeModelCapabilities(apiBase, apiKey, model);
    return res.json({
      success: true,
      data: caps
        ? { ok: true, contextWindow: caps.contextWindow, maxOutput: caps.maxOutput, reasoning: caps.reasoning }
        : { ok: false, message: '模型不可达或未识别（请检查 apiBase/apiKey/model）' },
    });
  } catch (e: any) {
    console.error('[Agent] 模型测试失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `模型测试失败: ${e?.message || e}` });
  }
});

// ===== Provider 模型发现与目录填充（参考项目 pi 的 discover/catalog 能力适配）=====

/** 判断 API Key 是否为脱敏值（系统脱敏格式：前4后4中间 ****） */
function isMaskedApiKey(key: string): boolean {
  return key.includes('***');
}

/**
 * 构建模型列表接口 URL（适配 OpenAI 兼容 / Anthropic / Google 三种协议）
 * 参考 pi-web model-discovery.ts buildModelsListUrl
 */
function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === 'anthropic-messages' && !/\/v\d+(?:beta)?$/i.test(path)) path += '/v1';
    if (api === 'google-generative-ai' && !/\/v\d+(?:beta)?$/i.test(path)) path += '/v1beta';
    url.pathname = `${path}/models`.replace(/\/+/g, '/');
  }
  return url;
}

/**
 * SSRF 防护：校验 /providers/discover 的 fetch 目标。
 *
 * 策略（平衡内网部署刚需与安全）：
 * - 协议白名单：仅 http/https
 * - 拒绝 link-local / 链路本地地址（169.254.0.0/16，含云元数据 169.254.169.254）
 * - 拒绝 0.0.0.0 / 组播 / 广播
 * - 其余内网网段（10.x / 172.16-31.x / 192.168.x / 127.0.0.1 本地 LLM）放行——
 *   本项目为内网部署，LLM 网关（CNPE 等）本身就在内网，全拒会破坏合法功能。
 * - 域名先经 dns.lookup 全量解析，任一解析地址命中黑名单即拒绝（缓解 DNS rebinding）
 *
 * @throws 校验失败时抛错（message 可直接回显给管理员）
 */
export async function assertSafeFetchUrl(endpoint: URL): Promise<void> {
  const proto = endpoint.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    throw new Error('仅支持 http/https 协议的 Base URL');
  }
  const isBlockedIp = (ip: string): boolean => {
    const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
    // IPv6 映射 IPv4 的十六进制形式（Node URL 会把 ::ffff:169.254.169.254
    // 规范化为 ::ffff:a9fe:a9fe，点分形式的 v4match 分支永远命中不了——
    // 必须先把十六进制两段还原为点分 IPv4 再走 IPv4 判定，否则可绕过
    // 云元数据/组播拦截（SSRF 绕过）
    const v6mapped = clean.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v6mapped) {
      const h1 = parseInt(v6mapped[1], 16);
      const h2 = parseInt(v6mapped[2], 16);
      return isBlockedIp(`${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`);
    }
    // IPv6 映射的 IPv4（::ffff:1.2.3.4）先还原
    const v4match = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    const target = v4match ? v4match[1] : clean;
    if (target.includes('.')) {
      const parts = target.split('.').map(Number);
      if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return false;
      const [a, b] = parts;
      if (a === 0) return true;                       // 0.0.0.0/8
      if (a === 169 && b === 254) return true;        // 169.254.0.0/16 link-local + 云元数据
      if (a >= 224) return true;                      // 组播 224.0.0.0/4 + 保留 + 广播 255.255.255.255
      if (a === 127) return false;                    // loopback 放行（本地 ollama 等）
      if (a === 10) return false;                     // 内网放行（内网部署刚需）
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 放行
      return false;
    }
    // IPv6：拒绝环回/链路本地/唯一本地地址
    if (target === '::1' || target === '::') return true;
    if (target.startsWith('fe80:')) return true;     // link-local
    if (target.startsWith('fc') || target.startsWith('fd')) return false; // ULA 放行
    return false;
  };

  const hostname = endpoint.hostname;
  // hostname 本身是 IP：直接校验
  const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.includes(':');
  if (isIpLiteral) {
    if (isBlockedIp(hostname)) {
      throw new Error('Base URL 指向禁止访问的地址（link-local/元数据/组播）');
    }
    return;
  }
  // 域名：dns.lookup 解析全部地址，任一命中即拒绝
  const addresses = await new Promise<string[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addrs) => {
      if (err) return reject(err);
      resolve((addrs as Array<{ address: string }>).map(a => a.address));
    });
  }).catch(() => []);
  if (addresses.length === 0) {
    throw new Error(`Base URL 域名解析失败: ${hostname}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new Error('Base URL 解析到禁止访问的地址（link-local/元数据/组播）');
    }
  }
}

/** 解析 /models 上游响应为模型列表（兼容 string[] / {id,model,name}[] / data/models/results/items 包裹）
 *  同时解析能力信息（capabilities.contextWindow/maxOutput/reasoning/inputModalities），
 *  供前端添加模型时自动回填上下文窗口 / 最大输出 / 推理 / 图片输入。 */
function parseDiscoveredModels(value: any): Array<{
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  inputModalities?: string[];
}> {
  const seen = new Set<string>();
  const models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    inputModalities?: string[];
  }> = [];
  const list = Array.isArray(value)
    ? value
    : (value?.data ?? value?.models ?? value?.results ?? value?.items ?? []);
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.id ?? item.model ?? item.name ?? '').trim();
    if (!rawId) continue;
    const id = rawId.startsWith('models/') ? rawId.slice('models/'.length) : rawId;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = String(item.display_name ?? item.displayName ?? '').trim() || undefined;
    // 能力解析：兼容 cbcn 网关 capabilities 字段与 OpenRouter/vLLM 的 context_length/max_model_len
    const c = item.capabilities || {};
    const contextWindow = Number(c.contextWindow ?? item.context_length ?? item.max_model_len ?? 0) || undefined;
    const maxTokens = Number(c.maxOutput ?? c.max_output_tokens ?? item.max_completion_tokens ?? 0) || undefined;
    const reasoning = c.reasoning === true ? true : undefined;
    const inputModalities = Array.isArray(c.inputModalities) && c.inputModalities.length
      ? c.inputModalities
      : undefined;

    const m: {
      id: string;
      name?: string;
      contextWindow?: number;
      maxTokens?: number;
      reasoning?: boolean;
      inputModalities?: string[];
    } = { id };
    if (name && name !== id) m.name = name;
    if (contextWindow) m.contextWindow = contextWindow;
    if (maxTokens) m.maxTokens = maxTokens;
    if (reasoning) m.reasoning = true;
    if (inputModalities) m.inputModalities = inputModalities;
    models.push(m);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}

/**
 * POST /api/agent/providers/discover — 从 Provider 的 /models 接口拉取模型列表
 * Body: { providerName, provider: { baseUrl, api, apiKey } }
 * apiKey 为空或为脱敏值时，从 llm_profiles 按 providerName 匹配真实凭证。
 * 仅管理员可调
 */
router.post('/providers/discover', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { providerName, provider } = req.body || {};
    if (!providerName || typeof providerName !== 'string') {
      return res.status(400).json({ success: false, message: 'providerName 必填' });
    }
    if (!provider || typeof provider !== 'object') {
      return res.status(400).json({ success: false, message: 'provider 必填' });
    }

    const baseUrl = String(provider.baseUrl || '').trim();
    if (!baseUrl) {
      return res.status(400).json({ success: false, message: 'Base URL 必填' });
    }
    const api = String(provider.api || 'openai-completions');
    let apiKey = String(provider.apiKey || '').trim();

    // 脱敏/空 key 时从 llm_profiles 匹配真实凭证
    if (!apiKey || isMaskedApiKey(apiKey)) {
      
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
      if (cfg?.value) {
        const raw = typeof cfg.value === 'string' ? JSON.parse(cfg.value) : cfg.value;
        const profiles = Array.isArray(raw) ? raw : [];
        const matched = profiles.find((p: any) => (p.name || p.id) === providerName);
        if (matched?.apiKey) apiKey = String(matched.apiKey);
      }
    }

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return res.status(400).json({ success: false, message: 'Base URL 无效' });
    }

    // SSRF 防护：协议白名单 + 拒绝 link-local/元数据/组播地址（内网网段放行）
    try {
      await assertSafeFetchUrl(endpoint);
    } catch (e: any) {
      return res.status(400).json({ success: false, message: `Base URL 校验失败: ${e?.message || e}` });
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) {
      if (api === 'anthropic-messages') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (api === 'google-generative-ai') {
        headers['x-goog-api-key'] = apiKey;
      } else if (!headers['Authorization']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    // 显式用全局 fetch 响应类型，避免与 express 的 Response 冲突
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(endpoint, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // 安全修复：不回显上游错误正文（可能包含 apiKey / 内部地址等敏感信息），只回显状态码
      return res.status(502).json({
        success: false,
        message: `上游返回 HTTP ${response.status}，请检查 Base URL / API Key / 网络连通性`,
      });
    }

    const payload = await response.json();
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return res.status(502).json({ success: false, message: '上游响应中没有可用模型' });
    }

    return res.json({ success: true, data: { models, endpoint: endpoint.toString() } });
  } catch (e: any) {
    console.error('[Agent] 模型发现失败:', e?.message || e);
    const message = e?.name === 'AbortError' ? '拉取模型列表超时（20s）' : (e?.message || '拉取失败');
    return res.status(500).json({ success: false, message });
  }
});

/**
 * POST /api/agent/providers/catalog — 本地模型目录填充（替代参考项目的 models.dev）
 * Body: { model }
 * 用本地预置能力库 lookupCapabilities 返回模型元数据建议，供前端回填空字段。
 * 仅管理员可调
 */
router.post('/providers/catalog', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { model } = req.body || {};
    const modelName = String(model || '').trim();
    if (!modelName) {
      return res.status(400).json({ success: false, message: 'model 必填' });
    }
    const caps = lookupCapabilities(modelName);
    if (!caps) {
      return res.json({
        success: true,
        data: { matched: false, recommendation: null },
      });
    }
    return res.json({
      success: true,
      data: {
        matched: true,
        recommendation: {
          name: modelName,
          reasoning: /reasoner|thinking|r1|o1|o3/i.test(modelName) || undefined,
          input: caps.inputModalities,
          contextWindow: caps.contextWindowTokens || undefined,
          maxTokens: caps.maxOutputTokens || undefined,
        },
      },
    });
  } catch (e: any) {
    console.error('[Agent] 目录填充失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `目录填充失败: ${e?.message || e}` });
  }
});

export default router;
