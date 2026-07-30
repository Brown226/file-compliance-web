import prisma from '../../config/db';
import { redisClient } from '../../utils/redis';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PromptLoader } from '../prompts';
import { MaxKBService } from '../knowledge/maxkb.service';
import { OcrService } from './ocr.service';

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
  /** Task 22: CoT 推理过程（模型先思考再下结论，前端可折叠展示） */
  reasoning?: string;
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
  /** Task 22: CoT 推理过程（模型先分析违规原因再下结论，前端可折叠展示） */
  reasoning?: string;
  /** Task 21: SoM 区域标号（1=标题栏/2=图例表/3=标注/4=设计说明/5=图框/6=主体图形），VLM 引用标号定位 */
  markId?: number;
}

export interface ComplianceResult {
  designNotes: string[];
  issues: ComplianceIssue[];
  summary: string;
}

// ==================== Task 17: 专业分流结果类型 ====================

/** 支持的专业枚举 */
export type DwgProfession =
  | 'building'
  | 'structural'
  | 'plumbing'
  | 'hvac'
  | 'electrical'
  | 'process'
  | 'nuclear';

/** 专业审查 issue（与 AnnotationIssue 类似，但含 CoT reasoning） */
export interface ProfessionIssue {
  reasoning?: string;
  item: string;
  location: string;
  severity: 'error' | 'warning' | 'info';
  bbox?: [number, number, number, number];
  confidence?: number;
}

/** 专业审查结果 */
export interface ProfessionCheckResult {
  profession: DwgProfession;
  issues: ProfessionIssue[];
  summary: string;
}

// ==================== Task 18: 图框规范检查结果类型 ====================

/** 图框规范 issue */
export interface FrameCheckIssue {
  reasoning?: string;
  item: string;
  location: string;
  severity: 'error' | 'warning' | 'info';
  bbox?: [number, number, number, number];
  confidence?: number;
}

/** 图框规范检查结果 */
export interface FrameCheckResult {
  frameSize: string;        // A0/A1/A2/A3/A4/unknown
  frameWidth: number;       // mm
  frameHeight: number;      // mm
  hasTitleBlock: boolean;
  hasBindingMargin: boolean;
  issues: FrameCheckIssue[];
  summary: string;
}

export interface VisionAnalyzeResult {
  titleBlock?: TitleBlockResult | null;
  symbols?: SymbolListResult | null;
  annotations?: AnnotationCheckResult | null;
  compliance?: ComplianceResult | null;
  /** Task 17: 专业审查结果（用户选择专业时填充） */
  profession?: ProfessionCheckResult | null;
  /** Task 18: 图框规范检查结果 */
  frameCheck?: FrameCheckResult | null;
  duration_ms: number;
  errors: string[];
  /** 本次分析使用的模型信息 */
  modelInfo?: { model: string; modelType: string };
  /** 轻量版 DWG 规则校验结果（基于 VLM 输出，非 DWG 元数据） */
  ruleIssues?: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }>;
  /**
   * Task 24: OCR + VLM 交叉验证结果
   * - 用 PaddleOCR/doc-parser 对整图做 OCR，与 VLM 提取的标题栏字段做子串匹配
   * - diff 大（关键字段 drawingNo/title 不一致）则 needsReview=true
   * - OCR 不可用时该字段为 undefined（降级跳过，不中断主流程）
   */
  ocrVerification?: OcrVerificationResult;
  /**
   * Task 20: DWG 元数据双校验结果
   * - 前端 WASM 解析 DWG 文件提取的图层/文本/标注/标准引用
   * - 与 VLM 视觉识别结果交叉验证
   * - 前端未传 dwgMetadata 时该字段为 undefined
   */
  dwgMetadataVerification?: DwgMetadataVerification;
}

/**
 * Task 24: OCR + VLM 交叉验证结果
 */
export interface OcrVerificationResult {
  /** OCR 提取的整图文本（截断至 5000 字符） */
  ocrText: string;
  /** OCR 引擎名称（如 doc-parser vision-llm） */
  ocrEngine?: string;
  /** OCR 文本字符数（原始，未截断） */
  ocrCharCount: number;
  /** 不一致的字段列表（每条格式："字段名: VLM值=X vs OCR找不到"） */
  mismatches: string[];
  /** 是否需要人工复核（关键字段 drawingNo/title 不一致时为 true） */
  needsReview: boolean;
  /** OCR 调用状态：success / unavailable / failed */
  status: 'success' | 'unavailable' | 'failed';
  /** 失败原因（status=unavailable/failed 时存在） */
  reason?: string;
}

// ==================== Task 16: SSE 进度事件类型 ====================

/**
 * Task 16: SSE 推送给前端的事件类型
 *
 * 事件流：
 *   start → (dimension_done × N) → complete
 *   start → error（任意阶段失败）
 *
 * progress 事件用于推送 0-100 的整体进度百分比
 */
export type SseProgressEvent =
  | { type: 'start'; jobKey: string; analyses: string[]; totalDimensions: number; timestamp: number }
  | { type: 'progress'; jobKey: string; progress: number; message?: string; timestamp: number }
  | { type: 'dimension_done'; jobKey: string; dimension: string; success: boolean; error?: string; timestamp: number }
  | { type: 'complete'; jobKey: string; result: VisionAnalyzeResult; timestamp: number }
  | { type: 'error'; jobKey: string; error: string; timestamp: number };

// ==================== Task 20: DWG 元数据双校验类型 ====================

/**
 * Task 20: 前端 WASM 解析出的 DWG 元数据
 * 前端 dwg-parser.ts 提取后随 analyzeDwgVision 请求传给后端
 */
export interface DwgMetadata {
  /** 图层名列表 */
  layers?: string[];
  /** 文本实体（仅取 text 字段，用于与 VLM 提取的设计说明交叉验证） */
  textEntities?: Array<{ text: string; layer: string }>;
  /** 尺寸标注 */
  dimensions?: Array<{ text: string; layer: string }>;
  /** 标准引用（前端正则提取） */
  standardRefs?: Array<{ standardNo: string; standardName: string; fullMatch: string }>;
  /** 元数据汇总 */
  metadata?: {
    layerCount: number;
    textCount: number;
    dimensionCount: number;
    entityCount: number;
    converted: boolean;
    version?: string;
  };
}

/**
 * Task 20: DWG 元数据双校验结果
 * 将 WASM 元数据与 VLM 视觉识别结果交叉验证，找出不一致项
 */
export interface DwgMetadataVerification {
  /** WASM 提取的图层数量 */
  wasLayerCount: number;
  /** WASM 提取的文本数量 */
  wasTextCount: number;
  /** WASM 提取的标注数量 */
  wasDimensionCount: number;
  /** WASM 提取的标准引用列表（标准号） */
  wasStandardRefs: string[];
  /** 不一致项列表（每条描述一项差异） */
  mismatches: string[];
  /** 是否需要人工复核（关键不一致时为 true） */
  needsReview: boolean;
  /** 校验状态：success（有元数据）/ unavailable（前端未传元数据）/ failed（解析异常） */
  status: 'success' | 'unavailable' | 'failed';
  reason?: string;
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
//
// 4 个维度的 system/user prompt 已迁移至 `services/prompts/registry.ts`，
// 通过 PromptLoader 动态加载（DB 优先 → Registry fallback）。
// 维度与 variant 对应关系：
//   title_block  → 标题栏识别
//   symbols      → 图例符号识别
//   annotations  → 标注完整性检查（Task 22: 含 CoT reasoning 字段）
//   compliance   → 设计说明合规审查（含 ${refSection} 占位符，Task 22: 含 CoT reasoning 字段）
//   prof_*       → Task 17: 7 套专业分流 prompt（building/structural/plumbing/hvac/electrical/process/nuclear）
//   frame_check  → Task 18: 图框规范检查（幅面代号/尺寸/装订边）
//
// 用户可在「提示词管理」界面修改这些模板，重置时回退到 registry 默认值。

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
   *
   * Task 30: 多模型路由
   *   - dimension 参数指定当前调用的维度（titleBlock/symbols/annotations/compliance/profession/frameCheck）
   *   - 优先从 system_configs.dwg_vision_model_routes 读取该维度的 providerId
   *   - 未配置或读取失败 → 降级到默认 llm_vision_model / llm_ocr_model
   *   - dwg_vision_model_routes 格式：{ titleBlock: { providerId: 'xxx' }, compliance: { providerId: 'yyy' } }
   */
  private static async getVisionConfig(dimension?: string): Promise<VisionConfig> {
    // Task 30: 先尝试按维度路由
    if (dimension) {
      try {
        const routesCfg = await prisma.systemConfig.findUnique({ where: { key: 'dwg_vision_model_routes' } });
        if (routesCfg?.value && typeof routesCfg.value === 'object') {
          const routes = routesCfg.value as any;
          const route = routes[dimension];
          if (route?.providerId) {
            // 查 LlmProfile
            const profilesCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
            if (profilesCfg?.value) {
              const profilesRaw =
                typeof profilesCfg.value === 'string'
                  ? JSON.parse(profilesCfg.value)
                  : profilesCfg.value;
              const profiles = Array.isArray(profilesRaw) ? profilesRaw : [];
              const profile = profiles.find((p: any) => p.id === route.providerId);
              if (profile && profile.apiKey && profile.model) {
                console.log(`[DWG Vision] 维度 ${dimension} 路由到模型 ${profile.model}`);
                return this.buildVisionConfig(
                  profile.apiBase || '',
                  profile.apiKey,
                  profile.model,
                  (route.timeout || profile.timeout || 120) * 1000,
                  route,
                );
              }
            }
          }
        }
      } catch (e: any) {
        console.warn(`[DWG Vision] 读取维度路由失败 (dimension=${dimension}):`, e.message);
      }
    }

    // 默认：读 llm_vision_model / llm_ocr_model
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
   * Task 21: SoM 区域标号校验
   * 必须是 1-6 的整数（1=标题栏/2=图例表/3=标注/4=设计说明/5=图框/6=主体图形），否则返回 undefined
   */
  private static normalizeMarkId(raw: any): number | undefined {
    if (typeof raw !== 'number' || Number.isNaN(raw)) return undefined;
    if (!Number.isInteger(raw)) return undefined;
    if (raw < 1 || raw > 6) return undefined;
    return raw;
  }

  /**
   * Task 21: SoM 标号 → 区域名称映射（供前端展示）
   */
  static readonly MARK_ID_LABELS: Record<number, string> = {
    1: '标题栏',
    2: '图例表',
    3: '标注',
    4: '设计说明',
    5: '图框',
    6: '主体图形',
  };

  /**
   * 标题栏/图签识别
   */
  static async analyzeTitleBlock(imageBase64: string, config: VisionConfig): Promise<TitleBlockResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'title_block' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'title_block'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
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
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'symbols' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'symbols'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
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
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'annotations' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'annotations'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
    if (!parsed) return null;

    const missingItems: AnnotationIssue[] = (parsed.missingItems || []).map((item: any) => ({
      item: item.item || '',
      location: item.location || '',
      severity: (['error', 'warning', 'info'].includes(item.severity) ? item.severity : 'warning') as any,
      bbox: this.normalizeBbox(item.bbox),
      confidence: this.normalizeConfidence(item.confidence),
      reasoning: typeof item.reasoning === 'string' ? item.reasoning : undefined,
    }));

    return {
      missingItems,
      completenessScore: typeof parsed.completenessScore === 'number' ? parsed.completenessScore : 0,
      summary: parsed.summary || '',
    };
  }

  /**
   * 设计说明合规审查
   *
   * refText 来源（按优先级）：
   *   1. 调用方手动传入的标准条文（手动 refText 模式，向后兼容）
   *   2. 知识库 RAG 注入（Task 15 实现后，由 caller 检索后传入）
   *   3. 无参照 → refSection 为空字符串
   *
   * Task 23: 多次采样投票
   *   - 从 system_configs.dwg_vision_sampling 读取配置（默认 enabled=true, samples=3, threshold=2）
   *   - 启用时对 compliance 维度做 N 次 temperature=0.7 采样
   *   - 多数投票合并 issue：fingerprint = note+violation 拼接归一化，出现次数 >= threshold 保留
   *   - 合并后 issue.confidence = 出现次数 / 总采样次数
   *   - 采样失败（API 错误）降级为单次结果，错误进 errors
   *
   * Task 21: SoM 区域标号
   *   - prompt 已在 registry 中预定义 6 个标号区域
   *   - 解析时提取 markId（1-6 整数），超出范围或非整数丢弃
   */
  static async checkDesignCompliance(imageBase64: string, config: VisionConfig, refText?: string): Promise<ComplianceResult | null> {
    let refSection = '';
    if (refText && refText.trim()) {
      refSection = `\n\n以下是需要对照的标准条文/规范要求：\n"""\n${refText.substring(0, 3000)}\n"""`;
    }

    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'compliance' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'compliance', { refSection }),
    ]);

    // Task 23: 读取采样配置
    const samplingCfg = await this.getSamplingConfig();
    if (!samplingCfg.enabled || samplingCfg.samples < 2) {
      // 单次模式（向后兼容）
      const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
      if (!parsed) return null;
      return this.buildComplianceResult(parsed);
    }

    // 多次采样模式：用 temperature=0.7 并行调 N 次
    const sampledConfig: VisionConfig = { ...config, temperature: 0.7 };
    const samples: any[] = [];
    const sampleErrors: string[] = [];
    const results = await Promise.allSettled(
      Array.from({ length: samplingCfg.samples }, () =>
        this.callAndParse(imageBase64, systemPrompt, userPrompt, sampledConfig),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value) {
        samples.push(r.value);
      } else if (r.status === 'rejected') {
        sampleErrors.push(`采样 ${i + 1} 失败: ${r.reason?.message || r.reason}`);
      }
    }

    // 所有采样都失败 → 返回 null
    if (samples.length === 0) {
      console.warn('[DWG Vision] compliance 多次采样全部失败:', sampleErrors);
      return null;
    }

    // 仅 1 次成功 → 降级为单次结果（不合并）
    if (samples.length === 1) {
      console.warn('[DWG Vision] compliance 多次采样仅 1 次成功，降级为单次结果');
      const single = this.buildComplianceResult(samples[0]);
      single.summary = `[采样降级] ${single.summary}`;
      return single;
    }

    // 多次采样成功 → 多数投票合并
    return this.mergeComplianceSamples(samples, samplingCfg.threshold, samplingCfg.samples);
  }

  /**
   * Task 23: 读取多次采样配置
   * 配置来源：system_configs.dwg_vision_sampling
   * 默认：{ enabled: true, samples: 3, threshold: 2 }
   */
  private static async getSamplingConfig(): Promise<{ enabled: boolean; samples: number; threshold: number }> {
    const defaults = { enabled: true, samples: 3, threshold: 2 };
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'dwg_vision_sampling' } });
      if (cfg?.value && typeof cfg.value === 'object') {
        const v = cfg.value as any;
        return {
          enabled: typeof v.enabled === 'boolean' ? v.enabled : defaults.enabled,
          samples: typeof v.samples === 'number' && v.samples >= 1 && v.samples <= 5 ? Math.floor(v.samples) : defaults.samples,
          threshold: typeof v.threshold === 'number' && v.threshold >= 1 ? Math.floor(v.threshold) : defaults.threshold,
        };
      }
    } catch { /* 用默认值 */ }
    return defaults;
  }

  /**
   * Task 21 + 23: 从单次 parsed 构建 ComplianceResult（含 markId 提取）
   */
  private static buildComplianceResult(parsed: any): ComplianceResult {
    const issues: ComplianceIssue[] = (parsed.issues || []).map((issue: any) => ({
      note: issue.note || '',
      violation: issue.violation || '',
      suggestion: issue.suggestion || '',
      severity: (['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning') as any,
      bbox: this.normalizeBbox(issue.bbox),
      confidence: this.normalizeConfidence(issue.confidence),
      reasoning: typeof issue.reasoning === 'string' ? issue.reasoning : undefined,
      markId: this.normalizeMarkId(issue.markId),
    }));

    return {
      designNotes: parsed.designNotes || [],
      issues,
      summary: parsed.summary || '',
    };
  }

  /**
   * Task 23: 多次采样结果合并（多数投票）
   *
   * 算法：
   *   1. 对每个 issue 计算 fingerprint = 归一化(note + violation)（去空格/转小写/截前 100 字符）
   *   2. 按 fingerprint 分组，统计出现次数
   *   3. 出现次数 >= threshold 的 issue 保留，confidence = 出现次数 / 总采样次数
   *   4. 保留时合并策略：取第一次出现的那条（保持 note/violation/suggestion/bbox 原样），
   *      仅覆盖 confidence 为投票比例，reasoning 取最长的那条（信息最全）
   *   5. designNotes 取所有采样的并集（去重）
   *   6. summary 取采样 0 的 summary，加 [多次采样合并] 前缀
   *
   * @param samples    N 次 parsed 结果
   * @param threshold  保留阈值（默认 2，即 3 次中至少 2 次出现）
   * @param totalSamples 总采样次数（用于计算 confidence 比例）
   */
  private static mergeComplianceSamples(samples: any[], threshold: number, totalSamples: number): ComplianceResult {
    const fingerprintMap = new Map<string, { count: number; firstIssue: any; longestReasoning: string }>();

    for (const parsed of samples) {
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      for (const issue of issues) {
        const note = String(issue.note || '').trim();
        const violation = String(issue.violation || '').trim();
        // 归一化：去所有空白 + 转小写 + 截前 100 字符
        const fp = `${note}|${violation}`.replace(/\s+/g, '').toLowerCase().slice(0, 100);
        if (!fp || fp === '|') continue;  // 空内容跳过

        const existing = fingerprintMap.get(fp);
        if (existing) {
          existing.count++;
          // 取最长的 reasoning
          const r = typeof issue.reasoning === 'string' ? issue.reasoning : '';
          if (r.length > existing.longestReasoning.length) {
            existing.longestReasoning = r;
          }
        } else {
          fingerprintMap.set(fp, {
            count: 1,
            firstIssue: issue,
            longestReasoning: typeof issue.reasoning === 'string' ? issue.reasoning : '',
          });
        }
      }
    }

    // 过滤 + 合并
    const mergedIssues: ComplianceIssue[] = [];
    for (const { count, firstIssue, longestReasoning } of fingerprintMap.values()) {
      if (count < threshold) continue;
      // 用投票比例覆盖 confidence（更可信：3 次中出现 2 次 → 0.67）
      const voteConfidence = Math.round((count / totalSamples) * 100) / 100;

      mergedIssues.push({
        note: firstIssue.note || '',
        violation: firstIssue.violation || '',
        suggestion: firstIssue.suggestion || '',
        severity: (['error', 'warning', 'info'].includes(firstIssue.severity) ? firstIssue.severity : 'warning') as any,
        bbox: this.normalizeBbox(firstIssue.bbox),
        confidence: voteConfidence,
        // 合并后 confidence 用投票比例覆盖（更可信），reasoning 取最长那条
        reasoning: longestReasoning || undefined,
        markId: this.normalizeMarkId(firstIssue.markId),
      });
    }

    // designNotes 取并集去重
    const designNotesSet = new Set<string>();
    for (const parsed of samples) {
      const notes = Array.isArray(parsed.designNotes) ? parsed.designNotes : [];
      for (const n of notes) {
        const s = String(n || '').trim();
        if (s) designNotesSet.add(s);
      }
    }

    // summary 取第一个非空的
    let summary = '';
    for (const parsed of samples) {
      if (parsed.summary && typeof parsed.summary === 'string') {
        summary = parsed.summary;
        break;
      }
    }

    return {
      designNotes: Array.from(designNotesSet),
      issues: mergedIssues,
      summary: `[多次采样合并：${samples.length}/${totalSamples} 成功，${mergedIssues.length} 条 issue 通过多数投票] ${summary}`,
    };
  }

  // ==================== Task 17: 专业分流审查 ====================

  /** 专业 → variant 映射 */
  private static readonly PROFESSION_VARIANT_MAP: Record<DwgProfession, string> = {
    building: 'prof_building',
    structural: 'prof_structural',
    plumbing: 'prof_plumbing',
    hvac: 'prof_hvac',
    electrical: 'prof_electrical',
    process: 'prof_process',
    nuclear: 'prof_nuclear',
  };

  /**
   * 专业审查：按用户选择的专业加载对应 prompt 进行针对性审查
   * Task 17 实现，Task 33 专业路由自动判定将复用此方法
   */
  static async analyzeProfession(
    imageBase64: string,
    profession: DwgProfession,
    config: VisionConfig,
  ): Promise<ProfessionCheckResult | null> {
    const variant = this.PROFESSION_VARIANT_MAP[profession];
    if (!variant) {
      throw new Error(`不支持的专业类型: ${profession}`);
    }

    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant }),
      PromptLoader.loadUserPrompt('dwg_vision', variant),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
    if (!parsed) return null;

    const issues: ProfessionIssue[] = (parsed.issues || []).map((issue: any) => ({
      reasoning: typeof issue.reasoning === 'string' ? issue.reasoning : undefined,
      item: issue.item || '',
      location: issue.location || '',
      severity: (['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning') as any,
      bbox: this.normalizeBbox(issue.bbox),
      confidence: this.normalizeConfidence(issue.confidence),
    }));

    return {
      profession,
      issues,
      summary: parsed.summary || '',
    };
  }

  // ==================== Task 18: 图框规范检查 ====================

  /**
   * 图框规范检查：检查幅面代号、尺寸、装订边、标题栏位置等
   */
  static async checkFrame(imageBase64: string, config: VisionConfig): Promise<FrameCheckResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'frame_check' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'frame_check'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config);
    if (!parsed) return null;

    const issues: FrameCheckIssue[] = (parsed.issues || []).map((issue: any) => ({
      reasoning: typeof issue.reasoning === 'string' ? issue.reasoning : undefined,
      item: issue.item || '',
      location: issue.location || '',
      severity: (['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning') as any,
      bbox: this.normalizeBbox(issue.bbox),
      confidence: this.normalizeConfidence(issue.confidence),
    }));

    return {
      frameSize: typeof parsed.frameSize === 'string' ? parsed.frameSize : 'unknown',
      frameWidth: typeof parsed.frameWidth === 'number' ? parsed.frameWidth : 0,
      frameHeight: typeof parsed.frameHeight === 'number' ? parsed.frameHeight : 0,
      hasTitleBlock: !!parsed.hasTitleBlock,
      hasBindingMargin: !!parsed.hasBindingMargin,
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
   *
   * options:
   *   - userId:    触发分析的用户 ID（用于历史回放筛选）
   *   - fileName:  原始图纸文件名（用于历史回放展示）
   *   - kbId:      MaxKB 知识库 ID（Task 15，用于 compliance 维度的 RAG 注入）
   *   - query:     RAG 检索查询词（可选，默认用图纸合规通用关键词）
   *
   * RAG 注入策略（Task 15）：
   *   - 仅当 analyses 包含 'compliance' 且 kbId 存在时触发检索
   *   - 检索结果与手动 refText 合并（手动在前，RAG 在后，用换行分隔）
   *   - 检索失败降级为仅使用手动 refText，不中断主流程
   *
   * 落库策略：分析完成后将结果写入 vision_analyses 表（失败不中断主流程），
   * 前端可通过历史查询端点回放。
   */
  /**
   * Task 16: 发布 SSE 进度事件到 Redis 频道
   *
   * 频道命名：dwg-vision:progress:{jobKey}
   * 事件格式（SSE data 字段）：
   *   { type: 'start' | 'progress' | 'dimension_done' | 'complete' | 'error', ...payload }
   *
   * 发布失败仅记日志，不中断主流程（SSE 是可选增强，降级到轮询也能工作）
   *
   * @param jobKey   任务唯一 key（前端生成）
   * @param event    事件对象
   */
  static async publishProgress(jobKey: string, event: SseProgressEvent): Promise<void> {
    try {
      const channel = `dwg-vision:progress:${jobKey}`;
      await redisClient.getClient().publish(channel, JSON.stringify(event));
    } catch (e: any) {
      console.warn(`[DWG Vision] SSE publish 失败 (jobKey=${jobKey}):`, e.message);
    }
  }

  static async analyze(
    imageBase64: string,
    analyses: string[],
    refText?: string,
    options?: { userId?: string; fileName?: string; kbId?: string; query?: string; profession?: DwgProfession; jobKey?: string; dwgMetadata?: DwgMetadata },
  ): Promise<VisionAnalyzeResult> {
    // 缓存检查：相同输入直接返回历史结果
    const cacheKey = this.buildCacheKey(imageBase64, analyses, refText, options?.kbId, options?.query, options?.profession);
    try {
      const cached = await redisClient.get<VisionAnalyzeResult>(cacheKey);
      if (cached) {
        console.log('[DWG Vision] 缓存命中，跳过 API 调用');
        // 缓存命中也落库（记录一次历史）
        this.persistVisionAnalysis(imageBase64, analyses, cached, refText, options).catch(() => { /* ignore */ });
        return cached;
      }
    } catch (e: any) {
      console.warn('[DWG Vision] 缓存读取失败，跳过缓存:', e.message);
    }

    const startTime = Date.now();
    const errors: string[] = [];
    const config = await this.getVisionConfig();
    const jobKey = options?.jobKey;

    // Task 30: 按维度预取模型配置（多模型路由）
    // 各维度独立 config，未配置时降级到默认 config
    const configMap: Record<string, VisionConfig> = { default: config };
    const dimensionKeys = ['titleBlock', 'symbols', 'annotations', 'compliance', 'profession', 'frameCheck'];
    await Promise.all(dimensionKeys.map(async (dim) => {
      try {
        configMap[dim] = await this.getVisionConfig(dim);
      } catch {
        configMap[dim] = config;  // 降级到默认
      }
    }));

    // Task 16: 发布 start 事件（SSE）
    if (jobKey) {
      await this.publishProgress(jobKey, {
        type: 'start',
        jobKey,
        analyses,
        totalDimensions: analyses.length,
        timestamp: Date.now(),
      });
    }

    // ── Task 15: MaxKB RAG 注入（仅 compliance 维度需要）──
    let mergedRefText = refText;
    if (analyses.includes('compliance') && options?.kbId) {
      try {
        const ragText = await this.fetchRagContext(options.kbId, options.query);
        if (ragText) {
          mergedRefText = mergedRefText
            ? `${mergedRefText}\n---\n${ragText}`
            : ragText;
          console.log('[DWG Vision] MaxKB RAG 注入成功，refText 长度:', mergedRefText.length);
        }
      } catch (e: any) {
        console.warn('[DWG Vision] MaxKB RAG 注入失败，降级为手动 refText:', e.message);
        errors.push(`知识库检索失败: ${e.message}`);
      }
    }

    const result: VisionAnalyzeResult = {
      titleBlock: null,
      symbols: null,
      annotations: null,
      compliance: null,
      profession: null,
      frameCheck: null,
      duration_ms: 0,
      errors,
    };

    // 构建并行任务
    const tasks: Promise<void>[] = [];

    // Task 16: 维度完成/失败时发布 dimension_done 事件
    const emitDimensionDone = (dimension: string, success: boolean, error?: string) => {
      if (jobKey) {
        this.publishProgress(jobKey, { type: 'dimension_done', jobKey, dimension, success, error, timestamp: Date.now() }).catch(() => { /* ignore */ });
      }
    };

    if (analyses.includes('titleBlock')) {
      tasks.push(
        (async () => {
          try {
            // Task 31: 预处理剪裁 - 裁剪标题栏区域送小模型识别
            const { imageBase64: titleBlockImage } = await this.cropTitleBlockRegion(imageBase64);
            const r = await this.analyzeTitleBlock(titleBlockImage, configMap.titleBlock);
            result.titleBlock = r;
            emitDimensionDone('titleBlock', true);

            // Task 24: 标题栏识别成功后触发 OCR + VLM 交叉验证（用原图，非剪裁图）
            if (r) {
              try {
                const v = await this.crossValidateWithOcr(imageBase64, r);
                if (v) result.ocrVerification = v;
              } catch (e: any) {
                errors.push(`OCR 交叉验证失败: ${e.message}`);
              }
            }
          } catch (e: any) {
            errors.push(`标题栏识别失败: ${e.message}`);
            emitDimensionDone('titleBlock', false, e.message);
          }
        })()
      );
    }

    if (analyses.includes('symbols')) {
      tasks.push(
        this.analyzeSymbols(imageBase64, configMap.symbols)
          .then(r => { result.symbols = r; emitDimensionDone('symbols', true); })
          .catch(e => { errors.push(`图例符号识别失败: ${e.message}`); emitDimensionDone('symbols', false, e.message); })
      );
    }

    if (analyses.includes('annotations')) {
      tasks.push(
        this.checkAnnotations(imageBase64, configMap.annotations)
          .then(r => { result.annotations = r; emitDimensionDone('annotations', true); })
          .catch(e => { errors.push(`标注完整性检查失败: ${e.message}`); emitDimensionDone('annotations', false, e.message); })
      );
    }

    if (analyses.includes('compliance')) {
      tasks.push(
        this.checkDesignCompliance(imageBase64, configMap.compliance, mergedRefText)
          .then(r => { result.compliance = r; emitDimensionDone('compliance', true); })
          .catch(e => { errors.push(`设计说明合规审查失败: ${e.message}`); emitDimensionDone('compliance', false, e.message); })
      );
    }

    // Task 17: 专业分流审查
    if (analyses.includes('profession') && options?.profession) {
      tasks.push(
        this.analyzeProfession(imageBase64, options.profession, configMap.profession)
          .then(r => { result.profession = r; emitDimensionDone('profession', true); })
          .catch(e => { errors.push(`专业审查失败: ${e.message}`); emitDimensionDone('profession', false, e.message); })
      );
    }

    // Task 18: 图框规范检查
    if (analyses.includes('frameCheck')) {
      tasks.push(
        this.checkFrame(imageBase64, configMap.frameCheck)
          .then(r => { result.frameCheck = r; emitDimensionDone('frameCheck', true); })
          .catch(e => { errors.push(`图框规范检查失败: ${e.message}`); emitDimensionDone('frameCheck', false, e.message); })
      );
    }

    // 并行执行
    await Promise.all(tasks);

    // 填入本次分析使用的模型信息
    result.modelInfo = { model: config.modelName, modelType: config.modelType };

    // 规则校验
    result.ruleIssues = this.applyRuleChecks(result);

    // Task 20: DWG 元数据双校验（前端传 WASM 元数据时执行）
    if (options?.dwgMetadata) {
      try {
        result.dwgMetadataVerification = this.crossValidateWithDwgMetadata(options.dwgMetadata, result);
      } catch (e: any) {
        console.warn('[DWG Vision] Task 20 元数据双校验失败:', e.message);
      }
    }

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

    // 结果落库（失败不中断主流程）
    this.persistVisionAnalysis(imageBase64, analyses, result, mergedRefText, options).catch((e: any) => {
      console.warn('[DWG Vision] 结果落库失败，跳过:', e.message);
    });

    // Task 16: 发布 complete 事件（SSE）
    if (jobKey) {
      await this.publishProgress(jobKey, {
        type: 'complete',
        jobKey,
        result,
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * MaxKB RAG 检索（Task 15）
   * 用 query 在指定知识库中检索相关条文，格式化为 refText 片段
   *
   * @param kbId  MaxKB 知识库 ID
   * @param query 检索查询词（可选，默认用图纸合规通用关键词）
   * @returns     格式化的条文文本（空字符串表示无结果）
   */
  private static async fetchRagContext(kbId: string, query?: string): Promise<string> {
    const searchQuery = query?.trim() || '核电工程图纸设计说明 安全 材料 焊接 检验 标准引用';
    const workspaceId = await MaxKBService.getDefaultWorkspaceId();

    const hits = await MaxKBService.hitTest(workspaceId, kbId, searchQuery, 5);
    if (!Array.isArray(hits) || hits.length === 0) {
      console.log('[DWG Vision] MaxKB 检索无结果');
      return '';
    }

    const chunks: string[] = [];
    for (const hit of hits) {
      const content = (hit as any).content || (hit as any).text || '';
      if (content) {
        const title = (hit as any).title || (hit as any).document_name || '';
        chunks.push(title ? `【${title}】\n${content}` : content);
      }
    }

    return chunks.join('\n---\n');
  }

  /**
   * 将分析结果落库（Task 25）
   * - imageHash: imageBase64 的 sha256，用于同图去重查询
   * - refText:   截断至 3000 字符，避免存储过大
   * - 落库失败仅记录日志，不抛错（历史回放是辅助功能，不影响主流程）
   */
  private static async persistVisionAnalysis(
    imageBase64: string,
    analyses: string[],
    result: VisionAnalyzeResult,
    refText: string | undefined,
    options: { userId?: string; fileName?: string } | undefined,
  ): Promise<void> {
    try {
      const imageHash = crypto.createHash('sha256').update(imageBase64).digest('hex');
      await prisma.visionAnalysis.create({
        data: {
          userId: options?.userId || null,
          fileName: options?.fileName || null,
          imageHash,
          analyses: analyses as any,
          result: result as any,
          modelInfo: (result.modelInfo || null) as any,
          durationMs: result.duration_ms,
          errors: result.errors as any,
          refText: refText ? refText.substring(0, 3000) : null,
        },
      });
      console.log('[DWG Vision] 分析结果已落库 (imageHash=%s)', imageHash.substring(0, 12));
    } catch (e: any) {
      console.warn('[DWG Vision] 结果落库失败:', e.message);
      // 不抛错，避免影响主流程
    }
  }

  /**
   * 查询历史分析记录（Task 25）
   * @param filter.userId    按用户筛选（可选）
   * @param filter.fileName  按文件名模糊匹配（可选）
   * @param filter.imageHash 按图片 hash 精确匹配（可选，用于同图历史）
   * @param filter.limit     返回条数（默认 20，最大 100）
   * @param filter.offset    分页偏移
   */
  static async queryHistory(filter: {
    userId?: string;
    fileName?: string;
    imageHash?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ total: number; items: any[] }> {
    const where: any = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.imageHash) where.imageHash = filter.imageHash;
    if (filter.fileName) where.fileName = { contains: filter.fileName, mode: 'insensitive' };

    const limit = Math.min(Math.max(filter.limit || 20, 1), 100);
    const offset = Math.max(filter.offset || 0, 0);

    const [total, rows] = await Promise.all([
      prisma.visionAnalysis.count({ where }),
      prisma.visionAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      total,
      items: rows.map(r => ({
        id: r.id,
        userId: r.userId,
        fileName: r.fileName,
        imageHash: r.imageHash,
        analyses: r.analyses,
        result: r.result,
        modelInfo: r.modelInfo,
        durationMs: r.durationMs,
        errors: r.errors,
        refText: r.refText,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Task 20: DWG 元数据双校验
   * 将前端 WASM 解析的 DWG 元数据与 VLM 视觉识别结果交叉验证
   *
   * 校验项：
   *   1. 标准引用一致性：WASM 正则提取的标准号 vs VLM compliance 维度 designNotes 中的标准号
   *      - WASM 有但 VLM 未识别 → 记 mismatch（VLM 漏识）
   *      - VLM 有但 WASM 未匹配 → 记 mismatch（VLM 可能幻觉，需复核）
   *   2. 文本数量合理性：WASM textCount > 0 但 VLM 提取的 designNotes 为空 → 记 mismatch
   *   3. 图层信息：WASM layerCount 与 VLM 视觉感知的图层（图例表/标注层/设计说明层）一致性（启发式）
   *
   * needsReview 触发条件：
   *   - VLM 识别出的标准号在 WASM 提取的 standardRefs 中完全找不到（疑似幻觉）
   *   - WASM 有大量文本（>10）但 VLM designNotes 为空
   *
   * @param metadata  前端 WASM 解析的元数据
   * @param result    VLM 视觉识别结果
   */
  private static crossValidateWithDwgMetadata(
    metadata: DwgMetadata,
    result: VisionAnalyzeResult,
  ): DwgMetadataVerification {
    const wasStandardRefs = (metadata.standardRefs || [])
      .map(r => r.standardNo)
      .filter(s => s && s.length > 0);
    const wasTextCount = metadata.metadata?.textCount || (metadata.textEntities?.length || 0);
    const wasLayerCount = metadata.metadata?.layerCount || (metadata.layers?.length || 0);
    const wasDimensionCount = metadata.metadata?.dimensionCount || (metadata.dimensions?.length || 0);

    const mismatches: string[] = [];

    // 1. 标准引用一致性校验
    // VLM compliance 维度提取的 designNotes 中找标准号（正则匹配 GB/NB/EJ 等开头）
    const vlmDesignNotes = result.compliance?.designNotes || [];
    const vlmStandardRefs: string[] = [];
    const standardPattern = /((?:GB|GB\/T|NB|NB\/T|HJ|DL|DL\/T|CECS|HAF|EJ|EJ\/T|JGJ|CJJ|JG|HG|SH|SY|YY|QB|SL|TB|JT|YB|DB|DBJ|QX|GBJ|TJ|BJG|GYJ)\s?\/?\d+[-/.]?\d*([-/.:]\d+)*)/g;
    for (const note of vlmDesignNotes) {
      const noteStr = String(note || '');
      let match: RegExpExecArray | null;
      while ((match = standardPattern.exec(noteStr)) !== null) {
        vlmStandardRefs.push(match[1].replace(/\s+/g, ''));
      }
    }

    // WASM 有但 VLM 未识别（VLM 漏识）
    for (const was of wasStandardRefs) {
      const wasNorm = was.replace(/\s+/g, '');
      const found = vlmStandardRefs.some(vlm => vlm.includes(wasNorm) || wasNorm.includes(vlm));
      if (!found && wasNorm.length >= 4) {
        mismatches.push(`标准引用漏识: WASM 识别 "${was}" 但 VLM 设计说明中未提及`);
      }
    }

    // VLM 有但 WASM 未匹配（VLM 疑似幻觉）
    let hallucinationCount = 0;
    for (const vlm of vlmStandardRefs) {
      const found = wasStandardRefs.some(was => {
        const wasNorm = was.replace(/\s+/g, '');
        return vlm.includes(wasNorm) || wasNorm.includes(vlm);
      });
      if (!found && vlm.length >= 4) {
        mismatches.push(`标准引用疑似幻觉: VLM 提及 "${vlm}" 但 WASM 未在 DWG 文本中匹配到`);
        hallucinationCount++;
      }
    }

    // 2. 文本数量合理性
    if (wasTextCount > 10 && vlmDesignNotes.length === 0 && result.compliance) {
      mismatches.push(`文本数量异常: WASM 提取 ${wasTextCount} 条文本但 VLM designNotes 为空`);
    }

    // 3. 图层信息（启发式：WASM 有图层但 VLM 图例表为空）
    if (wasLayerCount > 0 && result.symbols && result.symbols.symbols.length === 0) {
      mismatches.push(`图层信息异常: WASM 识别 ${wasLayerCount} 个图层但 VLM 图例表为空`);
    }

    // needsReview：标准引用疑似幻觉 ≥ 1 条，或文本数量异常
    const needsReview = hallucinationCount >= 1 || mismatches.some(m => m.includes('文本数量异常'));

    return {
      wasLayerCount,
      wasTextCount,
      wasDimensionCount,
      wasStandardRefs,
      mismatches,
      needsReview,
      status: 'success',
    };
  }

  /**
   * Task 31: 预处理剪裁 - 裁剪标题栏区域（图框右下角）
   *
   * 工程图标题栏按 GB/T 10609.1 标准位于图框右下角，常规约占图框宽度 25-35%、高度 8-12%。
   * 剪裁后送小模型识别可显著降低 token 消耗、提升识别精度。
   *
   * 策略：
   *   1. 用 sharp 读取原图尺寸
   *   2. 裁剪右下角区域：x = width * 0.65, y = height * 0.88, w = width * 0.35, h = height * 0.12
   *      （覆盖大多数 A0-A3 图纸的标题栏位置）
   *   3. 重新编码为 PNG base64 返回
   *   4. 同时返回剪裁区域相对于原图的归一化坐标 [x1,y1,x2,y2]（0-1000 坐标系），
   *      用于 VLM 输出的 bbox 坐标换算回原图坐标系
   *
   * 降级策略：
   *   - sharp 处理失败 → 返回原图，region 为 null（VLM 仍能工作，只是没用上剪裁优化）
   *   - 图片过小（< 400px）→ 不剪裁，直接返回原图
   *
   * @param imageBase64 原图 PNG base64
   * @returns           { imageBase64, region } 剪裁后图片 base64 + 剪裁区域归一化坐标
   */
  private static async cropTitleBlockRegion(imageBase64: string): Promise<{
    imageBase64: string;
    region: { x1: number; y1: number; x2: number; y2: number } | null;
  }> {
    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      const meta = await sharp(buffer).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;

      // 图片过小 → 不剪裁
      if (width < 400 || height < 400) {
        return { imageBase64, region: null };
      }

      // 剪裁右下角标题栏区域
      const cropX = Math.floor(width * 0.65);
      const cropY = Math.floor(height * 0.88);
      const cropW = Math.floor(width * 0.35);
      const cropH = Math.floor(height * 0.12);

      const croppedBuffer = await sharp(buffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .png()
        .toBuffer();

      // 归一化坐标（0-1000 坐标系）
      const region = {
        x1: Math.round((cropX / width) * 1000),
        y1: Math.round((cropY / height) * 1000),
        x2: Math.round(((cropX + cropW) / width) * 1000),
        y2: Math.round(((cropY + cropH) / height) * 1000),
      };

      return {
        imageBase64: croppedBuffer.toString('base64'),
        region,
      };
    } catch (e: any) {
      console.warn('[DWG Vision] Task 31 标题栏剪裁失败，降级用原图:', e.message);
      return { imageBase64, region: null };
    }
  }

  /**
   * Task 24: OCR + VLM 交叉验证
   *
   * 策略：
   *   1. 将 imageBase64 写入临时 PNG 文件
   *   2. 调用现有 OcrService.recognizeFile（复用 doc-parser 视觉模型 OCR 管道）
   *   3. 对 VLM 提取的标题栏字段（drawingNo/title/scale/designer/checker 等）做子串匹配：
   *      - 字段值长度 >= 2 才参与校验（避免单字符误判）
   *      - 在 OCR 文本中查找该字段值（去空格归一化），找不到则记入 mismatches
   *   4. needsReview = mismatches 包含关键字段（drawingNo 或 title）
   *   5. 清理临时文件
   *
   * 降级策略：
   *   - OCR 服务不可用（status='unavailable'）→ 返回 status='unavailable' 结果，needsReview=false
   *   - OCR 调用失败（status='failed'）→ 返回 status='failed' 结果，needsReview=false
   *   - 临时文件写入/清理失败 → 仅记日志，不中断
   *
   * @param imageBase64 PNG 图片 base64 字符串
   * @param titleBlock  VLM 提取的标题栏结果
   * @returns           OCR 交叉验证结果（即使失败也返回结果对象，不抛错）
   */
  private static async crossValidateWithOcr(
    imageBase64: string,
    titleBlock: TitleBlockResult,
  ): Promise<OcrVerificationResult> {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `dwg-vision-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`);

    try {
      // 1. 写入临时 PNG 文件
      try {
        const buffer = Buffer.from(imageBase64, 'base64');
        await fs.promises.writeFile(tmpFile, buffer);
      } catch (e: any) {
        return {
          ocrText: '',
          ocrCharCount: 0,
          mismatches: [],
          needsReview: false,
          status: 'failed',
          reason: `临时文件写入失败: ${e.message}`,
        };
      }

      // 2. 调用 OCR 服务（复用 doc-parser 视觉模型 OCR 管道）
      const ocrResult = await OcrService.recognizeFile(tmpFile, 'png');

      // OCR 不可用（视觉模型未配置）→ 降级返回
      if (ocrResult.status === 'unavailable') {
        return {
          ocrText: '',
          ocrCharCount: 0,
          mismatches: [],
          needsReview: false,
          status: 'unavailable',
          reason: ocrResult.reason || 'OCR 服务不可用',
        };
      }

      // OCR 调用失败 → 降级返回
      if (ocrResult.status === 'failed' || !ocrResult.text) {
        return {
          ocrText: '',
          ocrCharCount: 0,
          mismatches: [],
          needsReview: false,
          status: 'failed',
          reason: ocrResult.reason || 'OCR 返回空文本',
        };
      }

      // 3. 字段子串匹配
      const ocrTextRaw = ocrResult.text;
      const ocrTextNormalized = ocrTextRaw.replace(/\s+/g, '');
      const mismatches: string[] = [];

      // 关键字段（不一致 → needsReview=true）
      const KEY_FIELDS: (keyof TitleBlockResult)[] = ['drawingNo', 'title'];
      // 次要字段（不一致 → 仅记入 mismatches，不触发 needsReview）
      const MINOR_FIELDS: (keyof TitleBlockResult)[] = ['revision', 'scale', 'designer', 'checker', 'reviewer', 'approver', 'date', 'company'];

      const checkField = (field: keyof TitleBlockResult, isKey: boolean): void => {
        const value = String(titleBlock[field] || '').trim();
        // 字段值长度 < 2 跳过（避免单字符误判）
        if (value.length < 2) return;
        // 归一化：去所有空白
        const valueNormalized = value.replace(/\s+/g, '');
        // 在 OCR 文本中查找（子串匹配）
        if (!ocrTextNormalized.includes(valueNormalized)) {
          mismatches.push(`${String(field)}: VLM="${value}" vs OCR 未匹配`);
          if (isKey) {
            // 关键字段不一致会在循环外置 needsReview=true
          }
        }
      };

      for (const f of KEY_FIELDS) checkField(f, true);
      for (const f of MINOR_FIELDS) checkField(f, false);

      // 4. needsReview = 关键字段（drawingNo/title）有不一致
      const keyFieldMismatched = mismatches.some(m => m.startsWith('drawingNo:') || m.startsWith('title:'));

      return {
        ocrText: ocrTextRaw.length > 5000 ? ocrTextRaw.substring(0, 5000) : ocrTextRaw,
        ocrEngine: 'doc-parser (vision-llm)',
        ocrCharCount: ocrTextRaw.length,
        mismatches,
        needsReview: keyFieldMismatched,
        status: 'success',
      };
    } finally {
      // 5. 清理临时文件（失败仅记日志，不抛错）
      try {
        await fs.promises.unlink(tmpFile);
      } catch { /* ignore */ }
    }
  }

  /**
   * 构建缓存 key：基于图片+分析项+参考文本+知识库+查询词的 sha256
   * 分析项排序以保证不同顺序但相同内容命中缓存
   *
   * Task 15: kbId 和 query 纳入 cache key，避免不同知识库/查询词的结果误命中
   * Task 17: profession 纳入 cache key，避免不同专业审查结果误命中
   */
  private static buildCacheKey(
    imageBase64: string,
    analyses: string[],
    refText?: string,
    kbId?: string,
    query?: string,
    profession?: string,
  ): string {
    const hash = crypto.createHash('sha256')
      .update(imageBase64)
      .update(analyses.slice().sort().join(','))
      .update(refText || '')
      .update(kbId || '')
      .update(query || '')
      .update(profession || '')
      .digest('hex');
    return `dwg_vision:cache:${hash}`;
  }
}
