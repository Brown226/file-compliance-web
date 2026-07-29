import prisma from '../../config/db';
import { redisClient } from '../../utils/redis';
import crypto from 'crypto';

// ==================== 内部工具：并发限制器 ====================

/**
 * 简单的并发限制器（避免新增 p-limit 依赖）
 * 同一时刻最多允许 max 个任务并行执行，超出部分排队等待
 */
class SimpleConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        this.queue.shift()!();
      }
    }
  }
}

// ==================== 类型定义 ====================

export interface TitleBlockResult {
  drawingNo: string;
  title: string;
  revision: string;
  scale: string;
  designer: string;
  checker: string;
  reviewer: string;
  approver: string;
  date: string;
  company: string;
  /** 标题栏区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系，左上为原点） */
  bbox?: [number, number, number, number];
  raw: any;
}

export interface SymbolItem {
  type: 'valve' | 'pump' | 'vessel' | 'instrument' | 'tank' | 'heat_exchanger' | 'other';
  tag: string;
  description: string;
  position: string;
  /** 符号区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系） */
  bbox?: [number, number, number, number];
}

export interface SymbolListResult {
  symbols: SymbolItem[];
  totalCount: number;
  summary: string;
}

export interface AnnotationIssue {
  item: string;
  location: string;
  severity: 'error' | 'warning' | 'info';
  /** 问题区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系） */
  bbox?: [number, number, number, number];
  /** 置信度 0-1，低于 0.6 将标记待人工复核 */
  confidence?: number;
}

export interface AnnotationCheckResult {
  missingItems: AnnotationIssue[];
  completenessScore: number;
  summary: string;
}

export interface ComplianceIssue {
  note: string;
  violation: string;
  suggestion: string;
  severity: 'error' | 'warning' | 'info';
  /** 对应文字区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系） */
  bbox?: [number, number, number, number];
  /** 置信度 0-1，低于 0.6 将标记待人工复核 */
  confidence?: number;
}

export interface ComplianceResult {
  designNotes: string[];
  issues: ComplianceIssue[];
  summary: string;
}

export interface VisionAnalyzeResult {
  titleBlock?: TitleBlockResult | null;
  symbols?: SymbolListResult | null;
  annotations?: AnnotationCheckResult | null;
  compliance?: ComplianceResult | null;
  duration_ms: number;
  errors: string[];
  /** 本次分析使用的模型信息 */
  modelInfo?: { model: string; modelType: string };
  /** 轻量版 DWG 规则校验结果（基于 VLM 输出，非 DWG 元数据） */
  ruleIssues?: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }>;
}

interface VisionConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: number;
  maxTokens: number;
  temperature: number;
  seed?: number;
  modelType: 'instruct' | 'thinking';
}

// ==================== Prompt 模板 ====================

const TITLE_BLOCK_SYSTEM_PROMPT = `你是一位核电工程图纸审查专家。请仔细分析图纸中的标题栏（通常位于图框右下角），提取所有结构化信息。
严格按照 JSON 格式输出，不要添加任何额外说明。`;

const TITLE_BLOCK_USER_PROMPT = `请识别这张工程图纸的标题栏/图签信息，提取以下字段：
- drawingNo: 图号/图纸编号
- title: 图纸名称/图名
- revision: 版本号/版次
- scale: 比例
- designer: 设计人
- checker: 校核人
- reviewer: 审核人
- approver: 批准人/审定人
- date: 日期
- company: 设计单位/公司名称
- bbox: 标题栏区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系，左上为原点）

如果某个字段在图中找不到，填空字符串 ""。
输出纯 JSON 对象，格式：{"drawingNo":"","title":"","revision":"","scale":"","designer":"","checker":"","reviewer":"","approver":"","date":"","company":"","bbox":[x1,y1,x2,y2]}`;

const SYMBOLS_SYSTEM_PROMPT = `你是一位核电工程 P&ID 图纸识别专家。请仔细分析图纸中的所有工程图例符号，识别设备、阀门、泵、仪表等标准图例。
严格按照 JSON 格式输出，不要添加任何额外说明。`;

const SYMBOLS_USER_PROMPT = `请识别这张工程图纸中所有可辨认的标准图例符号（阀门、泵、容器、仪表、储罐、换热器等），并生成设备/管阀清单。

对每个识别到的符号，输出：
- type: 类型（valve/pump/vessel/instrument/tank/heat_exchanger/other）
- tag: 位号/编号（如能看到，如 "V-101"、"P-201A"）
- description: 简要描述（如 "闸阀 DN50"、"离心泵"）
- position: 在图纸中的大致位置描述（如 "左上区域"、"主管线中段"）
- bbox: 符号区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系）

输出纯 JSON 对象，格式：{"symbols":[{"type":"","tag":"","description":"","position":"","bbox":[x1,y1,x2,y2]}],"totalCount":0,"summary":""}
其中 summary 为图纸内容的一句话概述。`;

const ANNOTATIONS_SYSTEM_PROMPT = `你是一位核电工程图纸质量审查专家。请检查图纸中的标注完整性，找出缺失或不规范的标注。
严格按照 JSON 格式输出，不要添加任何额外说明。`;

const ANNOTATIONS_USER_PROMPT = `请检查这张工程图纸的标注完整性，重点关注：
1. 管线是否有完整的管线编号/管道号
2. 设备是否有位号标识
3. 尺寸标注是否完整（关键尺寸是否遗漏）
4. 是否存在未标注的管线或设备
5. 阀门是否有编号或规格标注
6. 仪表是否有回路编号

对每个发现的问题，输出：
- item: 问题描述（如 "管线未标注管径"）
- location: 位置描述（如 "图纸右侧主管线"）
- severity: 严重程度（error=必须整改/warning=建议整改/info=提示）
- bbox: 问题区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系，无法定位时填 null）
- confidence: 置信度（0-1，低于 0.6 将标记待人工复核）

同时给出整体完整性评分（0-100分）。
输出纯 JSON 对象，格式：{"missingItems":[{"item":"","location":"","severity":"","bbox":[x1,y1,x2,y2],"confidence":0.0}],"completenessScore":0,"summary":""}`;

const COMPLIANCE_SYSTEM_PROMPT = `你是一位核电工程文件合规审查专家，熟悉 HAF、GB、NB/T、EJ 等核电相关标准。请审查图纸中的设计说明和技术要求是否合规。
严格按照 JSON 格式输出，不要添加任何额外说明。`;

const COMPLIANCE_USER_PROMPT_TEMPLATE = `请审查这张工程图纸中的设计说明、技术要求、注释文字等内容，检查是否存在合规性问题。

重点检查：
1. 设计参数是否合理（温度、压力、流量等）
2. 材料选用是否符合核电规范
3. 安全相关说明是否完整
4. 焊接/检验要求是否明确
5. 引用的标准是否为现行有效版本
{refSection}

对每个发现的问题，输出：
- note: 原文内容（图纸中的相关文字）
- violation: 违规/问题描述
- suggestion: 修改建议
- severity: 严重程度（error/warning/info）
- bbox: 对应文字区域的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系，无法定位时填 null）
- confidence: 置信度（0-1，低于 0.6 将标记待人工复核）

同时提取图纸中所有可见的设计说明/技术要求文字。
输出纯 JSON 对象，格式：{"designNotes":[""],"issues":[{"note":"","violation":"","suggestion":"","severity":"","bbox":[x1,y1,x2,y2],"confidence":0.0}],"summary":""}`;

// ==================== 核心服务 ====================

export class DwgVisionService {
  /** 请求级并发限制器（懒加载，max 从 system_configs 读） */
  private static _limiter: SimpleConcurrencyLimiter | null = null;

  /**
   * 获取并发限制器（懒加载）
   * max 从 system_configs.dwg_vision_api_concurrency 读，默认 4
   */
  private static async getLimiter(): Promise<SimpleConcurrencyLimiter> {
    if (!this._limiter) {
      let max = 4;
      try {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'dwg_vision_api_concurrency' } });
        const v = cfg?.value as any;
        if (typeof v === 'number' && v > 0) max = v;
        else if (v && typeof v === 'object' && typeof v.value === 'number' && v.value > 0) max = v.value;
      } catch { /* 用默认值 */ }
      this._limiter = new SimpleConcurrencyLimiter(max);
      console.log(`[DWG Vision] API 并发限制器已初始化: max=${max}`);
    }
    return this._limiter;
  }

  /**
   * 获取视觉模型配置
   * 支持新结构（providerId 引用 LlmProfile）和旧结构（apiKey/apiBaseUrl/modelName 副本）
   */
  private static async getVisionConfig(): Promise<VisionConfig> {
    const keys = ['llm_vision_model', 'llm_ocr_model'];
    for (const key of keys) {
      const config = await prisma.systemConfig.findUnique({ where: { key } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;

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
              return this.buildVisionConfig(
                profile.apiBase || '',
                profile.apiKey,
                profile.model,
                (v.timeout || profile.timeout || 120) * 1000,
                v,
              );
            }
          }
        }

        // 兜底：旧结构
        if (v.apiKey && v.modelName) {
          return this.buildVisionConfig(
            v.apiBaseUrl || '',
            v.apiKey,
            v.modelName,
            (v.timeout || 120) * 1000,
            v,
          );
        }
      }
    }
    throw new Error('视觉模型未配置，请在系统管理 → AI配置中设置视觉模型');
  }

  /**
   * 根据原始配置项构建 VisionConfig，统一处理 modelType/maxTokens/temperature/seed 的默认值与覆盖逻辑
   */
  private static buildVisionConfig(
    apiBaseUrl: string,
    apiKey: string,
    modelName: string,
    timeout: number,
    raw: any,
  ): VisionConfig {
    const modelType: 'instruct' | 'thinking' = raw?.modelType === 'thinking' ? 'thinking' : 'instruct';

    // 不同模型类型的默认参数
    const defaultMaxTokens = modelType === 'thinking' ? 16384 : 4096;
    const defaultTemperature = modelType === 'thinking' ? 0.6 : 0.1;

    // 显式配置值覆盖默认值
    const maxTokens = typeof raw?.maxTokens === 'number' && raw.maxTokens > 0
      ? raw.maxTokens
      : defaultMaxTokens;
    const temperature = typeof raw?.temperature === 'number'
      ? raw.temperature
      : defaultTemperature;

    // seed 可选，仅显式设置时才传
    const seed = typeof raw?.seed === 'number' ? raw.seed : undefined;

    return {
      apiBaseUrl,
      apiKey,
      modelName,
      timeout,
      maxTokens,
      temperature,
      seed,
      modelType,
    };
  }

  /**
   * 带重试与退避的 fetch 封装
   * - HTTP 429: 读 Retry-After 头等待后重试，最多 2 次
   * - HTTP 5xx: 指数退避（2s、4s），最多 2 次
   * - HTTP 4xx（非 429）: 立即失败不重试
   * - 网络错误 / AbortError（超时）: 不重试直接抛
   */
  private static async fetchWithRetry(
    url: string,
    payload: any,
    config: VisionConfig,
  ): Promise<Response> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Vision API 调用超时');
        }
        // 网络错误不重试，直接抛
        throw err;
      }
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // 4xx（非 429）立即失败
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Vision API 错误 (${response.status}): ${errorText.substring(0, 300)}`);
      }

      // 429: 读 Retry-After
      if (response.status === 429) {
        const errorText = await response.text().catch(() => '');
        lastError = new Error(`Vision API 限流 (${response.status}): ${errorText.substring(0, 300)}`);
        if (attempt >= maxRetries) {
          throw lastError;
        }
        const retryAfter = response.headers.get('Retry-After');
        const waitSec = retryAfter ? parseInt(retryAfter, 10) : 1;
        const waitMs = (isNaN(waitSec) ? 1 : waitSec) * 1000;
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // 5xx: 指数退避（2s、4s）
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => '');
        lastError = new Error(`Vision API 服务器错误 (${response.status}): ${errorText.substring(0, 300)}`);
        if (attempt >= maxRetries) {
          throw lastError;
        }
        const waitMs = Math.pow(2, attempt + 1) * 1000; // attempt=0 → 2s, attempt=1 → 4s
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // 其他状态码不重试
      const errorText = await response.text().catch(() => '');
      throw new Error(`Vision API 错误 (${response.status}): ${errorText.substring(0, 300)}`);
    }

    throw lastError || new Error('Vision API 调用失败');
  }

  /**
   * 调用 Vision LLM API（带 HTTP 重试）
   */
  private static async callVisionApi(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
  ): Promise<string> {
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;

    const payload: any = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      response_format: { type: 'json_object' },
    };

    if (config.seed !== undefined) {
      payload.seed = config.seed;
    }

    // 用并发限制器包裹实际 API 调用，避免瞬时并发过高触发上游限流
    const limiter = await this.getLimiter();
    return limiter.run(async () => {
      const response = await this.fetchWithRetry(url, payload, config);
      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || '';
    });
  }

  /**
   * 调用 Vision API 并解析 JSON，解析失败时重试 1 次（不退避）
   */
  private static async callAndParse(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
  ): Promise<any> {
    const raw1 = await this.callVisionApi(imageBase64, systemPrompt, userPrompt, config);
    const parsed1 = this.parseJsonResponse(raw1);
    if (parsed1 !== null) return parsed1;

    // 第一次解析失败，重试 1 次
    const raw2 = await this.callVisionApi(imageBase64, systemPrompt, userPrompt, config);
    return this.parseJsonResponse(raw2);
  }

  /**
   * 解析 JSON 响应（容错处理）
   * 先剥离 thinking 模式的 <think>...</think> 标签块，再走 JSON.parse / 正则提取
   */
  private static parseJsonResponse(raw: string): any {
    if (typeof raw !== 'string') return null;

    // 1. 剥离所有闭合的 <think>...</think> 块（全局非贪婪）
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    // 2. 剥离未闭合的 <think> 块（从 <think> 到字符串末尾）
    cleaned = cleaned.replace(/<think>[\s\S]*$/g, '');

    try {
      // 3. 尝试直接解析
      return JSON.parse(cleaned);
    } catch {
      // 4. 尝试提取 JSON 块
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      return null;
    }
  }

  /**
   * 归一化 bbox 校验
   * 校验：4 个数字、都在 0-1000 范围内、x2>x1 且 y2>y1，否则返回 undefined
   */
  private static normalizeBbox(raw: any): [number, number, number, number] | undefined {
    if (!Array.isArray(raw) || raw.length !== 4) return undefined;
    const [x1, y1, x2, y2] = raw;
    if (
      typeof x1 !== 'number' || typeof y1 !== 'number' ||
      typeof x2 !== 'number' || typeof y2 !== 'number'
    ) {
      return undefined;
    }
    if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) {
      return undefined;
    }
    if (x1 < 0 || x1 > 1000 || y1 < 0 || y1 > 1000 || x2 < 0 || x2 > 1000 || y2 < 0 || y2 > 1000) {
      return undefined;
    }
    if (!(x2 > x1) || !(y2 > y1)) return undefined;
    return [x1, y1, x2, y2];
  }

  /**
   * 置信度校验：必须是 0-1 的数字
   */
  private static normalizeConfidence(raw: any): number | undefined {
    if (typeof raw !== 'number' || Number.isNaN(raw)) return undefined;
    if (raw < 0 || raw > 1) return undefined;
    return raw;
  }

  /**
   * 标题栏/图签识别
   */
  static async analyzeTitleBlock(imageBase64: string, config: VisionConfig): Promise<TitleBlockResult | null> {
    const parsed = await this.callAndParse(imageBase64, TITLE_BLOCK_SYSTEM_PROMPT, TITLE_BLOCK_USER_PROMPT, config);
    if (!parsed) return null;

    return {
      drawingNo: parsed.drawingNo || '',
      title: parsed.title || '',
      revision: parsed.revision || '',
      scale: parsed.scale || '',
      designer: parsed.designer || '',
      checker: parsed.checker || '',
      reviewer: parsed.reviewer || '',
      approver: parsed.approver || '',
      date: parsed.date || '',
      company: parsed.company || '',
      bbox: this.normalizeBbox(parsed.bbox),
      raw: parsed,
    };
  }

  /**
   * 图例符号识别
   */
  static async analyzeSymbols(imageBase64: string, config: VisionConfig): Promise<SymbolListResult | null> {
    const parsed = await this.callAndParse(imageBase64, SYMBOLS_SYSTEM_PROMPT, SYMBOLS_USER_PROMPT, config);
    if (!parsed) return null;

    const symbols: SymbolItem[] = (parsed.symbols || []).map((s: any) => ({
      type: s.type || 'other',
      tag: s.tag || '',
      description: s.description || '',
      position: s.position || '',
      bbox: this.normalizeBbox(s.bbox),
    }));

    return {
      symbols,
      totalCount: parsed.totalCount || symbols.length,
      summary: parsed.summary || '',
    };
  }

  /**
   * 标注完整性检查
   */
  static async checkAnnotations(imageBase64: string, config: VisionConfig): Promise<AnnotationCheckResult | null> {
    const parsed = await this.callAndParse(imageBase64, ANNOTATIONS_SYSTEM_PROMPT, ANNOTATIONS_USER_PROMPT, config);
    if (!parsed) return null;

    const missingItems: AnnotationIssue[] = (parsed.missingItems || []).map((item: any) => ({
      item: item.item || '',
      location: item.location || '',
      severity: (['error', 'warning', 'info'].includes(item.severity) ? item.severity : 'warning') as any,
      bbox: this.normalizeBbox(item.bbox),
      confidence: this.normalizeConfidence(item.confidence),
    }));

    return {
      missingItems,
      completenessScore: typeof parsed.completenessScore === 'number' ? parsed.completenessScore : 0,
      summary: parsed.summary || '',
    };
  }

  /**
   * 设计说明合规审查
   */
  static async checkDesignCompliance(imageBase64: string, config: VisionConfig, refText?: string): Promise<ComplianceResult | null> {
    let refSection = '';
    if (refText && refText.trim()) {
      refSection = `\n\n以下是需要对照的标准条文/规范要求：\n"""\n${refText.substring(0, 3000)}\n"""`;
    }

    const userPrompt = COMPLIANCE_USER_PROMPT_TEMPLATE.replace('{refSection}', refSection);
    const parsed = await this.callAndParse(imageBase64, COMPLIANCE_SYSTEM_PROMPT, userPrompt, config);
    if (!parsed) return null;

    const issues: ComplianceIssue[] = (parsed.issues || []).map((issue: any) => ({
      note: issue.note || '',
      violation: issue.violation || '',
      suggestion: issue.suggestion || '',
      severity: (['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning') as any,
      bbox: this.normalizeBbox(issue.bbox),
      confidence: this.normalizeConfidence(issue.confidence),
    }));

    return {
      designNotes: parsed.designNotes || [],
      issues,
      summary: parsed.summary || '',
    };
  }

  /**
   * 轻量版 DWG 规则校验（基于 VLM 视觉输出，非 DWG 元数据）
   * 仅校验不依赖 DWG 解析元数据的 3 条规则
   */
  private static applyRuleChecks(result: VisionAnalyzeResult): VisionAnalyzeResult['ruleIssues'] {
    const issues: NonNullable<VisionAnalyzeResult['ruleIssues']> = [];

    // DWG_TITLE_001: 标题栏信息检查
    if (result.titleBlock) {
      const tb = result.titleBlock;
      if (!tb.drawingNo || !tb.title) {
        issues.push({
          code: 'DWG_TITLE_001',
          severity: 'error',
          message: '标题栏缺图号或图名',
        });
      }
    }

    // DWG_SCALE_001: 比例标注格式检查
    if (result.titleBlock && result.titleBlock.scale) {
      const scale = result.titleBlock.scale;
      const scalePattern = /^1:\d+$|^\d+:1$/;
      if (!scalePattern.test(scale)) {
        issues.push({
          code: 'DWG_SCALE_001',
          severity: 'warning',
          message: '比例格式不规范',
        });
      }
    }

    // DWG_STDREF_001: 标准规范引用检查
    if (result.compliance) {
      if (!result.compliance.designNotes || result.compliance.designNotes.length === 0) {
        issues.push({
          code: 'DWG_STDREF_001',
          severity: 'info',
          message: '未识别到标准引用',
        });
      }
    }

    // TODO: DWG_LAYER_001 / DWG_DIM_001 / DWG_OVERLAP_001 依赖 DWG 解析元数据
    // （dwg_layers / layer_stats / dimensions 等），dwg-vision 当前仅有 VLM 视觉输出，
    // 暂不接入，待后续与 DWG 解析服务打通后补齐。

    return issues;
  }

  /**
   * 统一分析入口（并行执行所选分析项）
   */
  static async analyze(
    imageBase64: string,
    analyses: string[],
    refText?: string,
  ): Promise<VisionAnalyzeResult> {
    // 缓存检查：相同输入直接返回历史结果
    const cacheKey = this.buildCacheKey(imageBase64, analyses, refText);
    try {
      const cached = await redisClient.get<VisionAnalyzeResult>(cacheKey);
      if (cached) {
        console.log('[DWG Vision] 缓存命中，跳过 API 调用');
        return cached;
      }
    } catch (e: any) {
      console.warn('[DWG Vision] 缓存读取失败，跳过缓存:', e.message);
    }

    const startTime = Date.now();
    const errors: string[] = [];
    const config = await this.getVisionConfig();

    const result: VisionAnalyzeResult = {
      titleBlock: null,
      symbols: null,
      annotations: null,
      compliance: null,
      duration_ms: 0,
      errors,
    };

    // 构建并行任务
    const tasks: Promise<void>[] = [];

    if (analyses.includes('titleBlock')) {
      tasks.push(
        this.analyzeTitleBlock(imageBase64, config)
          .then(r => { result.titleBlock = r; })
          .catch(e => { errors.push(`标题栏识别失败: ${e.message}`); })
      );
    }

    if (analyses.includes('symbols')) {
      tasks.push(
        this.analyzeSymbols(imageBase64, config)
          .then(r => { result.symbols = r; })
          .catch(e => { errors.push(`图例符号识别失败: ${e.message}`); })
      );
    }

    if (analyses.includes('annotations')) {
      tasks.push(
        this.checkAnnotations(imageBase64, config)
          .then(r => { result.annotations = r; })
          .catch(e => { errors.push(`标注完整性检查失败: ${e.message}`); })
      );
    }

    if (analyses.includes('compliance')) {
      tasks.push(
        this.checkDesignCompliance(imageBase64, config, refText)
          .then(r => { result.compliance = r; })
          .catch(e => { errors.push(`设计说明合规审查失败: ${e.message}`); })
      );
    }

    // 并行执行
    await Promise.all(tasks);

    // 填入本次分析使用的模型信息
    result.modelInfo = { model: config.modelName, modelType: config.modelType };

    // 规则校验
    result.ruleIssues = this.applyRuleChecks(result);

    result.duration_ms = Date.now() - startTime;

    // 写入缓存（失败不中断主流程）
    try {
      let ttl = 86400;  // 默认 24 小时
      const ttlCfg = await prisma.systemConfig.findUnique({ where: { key: 'dwg_vision_cache_ttl' } });
      const tv = ttlCfg?.value as any;
      if (typeof tv === 'number' && tv > 0) ttl = tv;
      else if (tv && typeof tv === 'object' && typeof tv.value === 'number' && tv.value > 0) ttl = tv.value;
      await redisClient.set(cacheKey, result, ttl);
    } catch (e: any) {
      console.warn('[DWG Vision] 缓存写入失败，跳过:', e.message);
    }

    return result;
  }

  /**
   * 构建缓存 key：基于图片+分析项+参考文本的 sha256
   * 分析项排序以保证不同顺序但相同内容命中缓存
   */
  private static buildCacheKey(imageBase64: string, analyses: string[], refText?: string): string {
    const hash = crypto.createHash('sha256')
      .update(imageBase64)
      .update(analyses.slice().sort().join(','))
      .update(refText || '')
      .digest('hex');
    return `dwg_vision:cache:${hash}`;
  }
}
