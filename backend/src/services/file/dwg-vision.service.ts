import prisma from '../../config/db';
import { Prisma } from '@prisma/client';
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
  /** Task 28: 规范条文编号（如 "GB 50016-2014 第 5.5.3 条"），用于前端条文链接展示 */
  clauseRef?: string;
  /** Task 28: 规范条文原文（模型引用的具体条文内容，前端点击弹窗展示） */
  clauseText?: string;
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
   * Task 34: 跨维度关联校验结果
   * - 标题栏 drawingNo ↔ 合规审查引用标准版本/图号交叉验证
   * - 标题栏 scale ↔ 标注完整性中的比例尺标注匹配
   * - 各维度并行完成后统一执行，不一致项作为 info issue 输出
   */
  crossDimensionIssues?: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }>;
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
  /**
   * Task 29: 本次分析的 jobKey（traceId），用于关联 LlmCallLog 查询推理回放
   * - analyze 方法把 options.jobKey 嵌入此字段
   * - 前端实时分析/历史回放时用此值调用 /api/dwg/vision-llm-logs/:traceId
   */
  traceId?: string;
  /**
   * Task 33: 自动判定的专业类型
   * - 仅在 user 未显式指定 profession 且 analyses 包含 'profession' 时填充
   * - user 手动选择专业时该字段为 undefined（profession.profession 即为用户选择）
   * - 前端展示「自动判定: XXX」标签
   */
  detectedProfession?: DwgProfession;
  /**
   * Task 33: 自动判定的依据/失败原因
   * - 判定成功：模型返回的 reason（如「含房间布局/门窗/疏散通道」）
   * - 判定失败：固定文案「自动判定失败，降级为建筑专业」
   * - 前端可在 tooltip/副标题展示
   */
  detectedProfessionReason?: string;
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
   *
   * Task 29: 返回值扩展为 { content, usage, latencyMs }，供 callAndParse 写 LlmCallLog
   * - usage: OpenAI 兼容 API 的 token 用量（prompt/completion/total），上游未返回时为 undefined
   * - latencyMs: 本次调用耗时（毫秒，含重试）
   */
  private static async callVisionApi(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
  ): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; latencyMs: number }> {
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
    const callStart = Date.now();
    const response = await limiter.run(() => this.fetchWithRetry(url, payload, config));
    const latencyMs = Date.now() - callStart;
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    // OpenAI 兼容 API 的 usage 字段（上游未返回时为 undefined）
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    if (data.usage && typeof data.usage === 'object') {
      usage = {
        promptTokens: typeof data.usage.prompt_tokens === 'number' ? data.usage.prompt_tokens : 0,
        completionTokens: typeof data.usage.completion_tokens === 'number' ? data.usage.completion_tokens : 0,
        totalTokens: typeof data.usage.total_tokens === 'number' ? data.usage.total_tokens : 0,
      };
    }
    return { content, usage, latencyMs };
  }

  /**
   * 调用 Vision API 并解析 JSON，解析失败时重试 1 次（不退避）
   *
   * Task 29: 新增 logCtx 参数（traceId/mode），每次 callVisionApi 调用后写 LlmCallLog
   * - traceId: 通常是 analyze 方法的 jobKey，关联同一次分析的多次 LLM 调用
   * - mode: 维度名（titleBlock/symbols/annotations/compliance/profession/frameCheck）
   * - 写日志失败不中断主流程（fire-and-forget）
   */
  private static async callAndParse(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
    logCtx?: { traceId?: string; mode?: string },
  ): Promise<any> {
    // Task 29: 拼接 promptFull（system + user，截断至 60KB 避免 MySQL TEXT 64KB 限制）
    const promptFull = `${systemPrompt}\n\n---\n\n${userPrompt}`.substring(0, 60000);

    let raw1: { content: string; usage?: any; latencyMs: number };
    try {
      raw1 = await this.callVisionApi(imageBase64, systemPrompt, userPrompt, config);
    } catch (e: any) {
      // 第一次调用失败：写 failed 日志，再重试 1 次
      this.recordVisionLlmCall({
        traceId: logCtx?.traceId, mode: logCtx?.mode, model: config.modelName,
        latencyMs: 0, status: 'failed', errorMsg: (e as Error).message?.substring(0, 1000),
        promptFull,
      });
      // 重试 1 次（仍可能失败，再写一次 failed 日志）
      try {
        raw1 = await this.callVisionApi(imageBase64, systemPrompt, userPrompt, config);
      } catch (e2: any) {
        this.recordVisionLlmCall({
          traceId: logCtx?.traceId, mode: logCtx?.mode, model: config.modelName,
          latencyMs: 0, status: 'failed', errorMsg: (e2 as Error).message?.substring(0, 1000),
          promptFull,
        });
        throw e2;
      }
    }
    // 第一次调用成功：写 success 日志
    this.recordVisionLlmCall({
      traceId: logCtx?.traceId, mode: logCtx?.mode, model: config.modelName,
      latencyMs: raw1.latencyMs, status: 'success', usage: raw1.usage,
      promptFull, completionFull: raw1.content?.substring(0, 60000),
    });

    const parsed1 = this.parseJsonResponse(raw1.content);
    if (parsed1 !== null) return parsed1;

    // 第一次解析失败，重试 1 次（再写一次 success 日志）
    const raw2 = await this.callVisionApi(imageBase64, systemPrompt, userPrompt, config);
    this.recordVisionLlmCall({
      traceId: logCtx?.traceId, mode: `${logCtx?.mode || ''}_retry`, model: config.modelName,
      latencyMs: raw2.latencyMs, status: 'success', usage: raw2.usage,
      promptFull, completionFull: raw2.content?.substring(0, 60000),
    });
    return this.parseJsonResponse(raw2.content);
  }

  /**
   * Task 29: 异步写入 LLM 调用日志（fire-and-forget，失败不影响主流程）
   *
   * 复用 LlmCallLog 表，traceId 字段存 jobKey 关联同一次分析的多次调用。
   * promptFull/completionFull 超 60KB 截断（MySQL TEXT 64KB 限制留余量）。
   * 写入失败仅 console.warn，不落盘 fallback（dwg-vision 是工具页面，非生产审查流程）。
   */
  private static recordVisionLlmCall(params: {
    traceId?: string;
    mode?: string;
    model: string;
    latencyMs: number;
    status: 'success' | 'failed';
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    errorMsg?: string;
    promptFull?: string;
    completionFull?: string;
  }): void {
    try {
      prisma.llmCallLog.create({
        data: {
          taskId: params.traceId ?? null,  // 复用 taskId 字段存 jobKey（dwg-vision 无传统 taskId）
          mode: params.mode ?? null,
          model: params.model,
          provider: 'vision-compat',
          promptTokens: params.usage?.promptTokens ?? 0,
          completionTokens: params.usage?.completionTokens ?? 0,
          totalTokens: params.usage?.totalTokens ?? 0,
          latencyMs: params.latencyMs,
          status: params.status,
          errorMsg: params.errorMsg ?? null,
          promptFull: params.promptFull ?? null,
          completionFull: params.completionFull ?? null,
          ragChunks: Prisma.DbNull,
          traceId: params.traceId ?? null,
        },
      }).catch(e => {
        console.warn('[DWG Vision] 写入 LLM 调用日志失败:', (e as Error).message);
      });
    } catch (e) {
      console.warn('[DWG Vision] 写入 LLM 调用日志异常:', (e as Error).message);
    }
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
  static async analyzeTitleBlock(imageBase64: string, config: VisionConfig, traceId?: string): Promise<TitleBlockResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'title_block' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'title_block'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: 'titleBlock' });
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
  static async analyzeSymbols(imageBase64: string, config: VisionConfig, traceId?: string): Promise<SymbolListResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'symbols' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'symbols'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: 'symbols' });
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
  static async checkAnnotations(imageBase64: string, config: VisionConfig, traceId?: string): Promise<AnnotationCheckResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'annotations' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'annotations'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: 'annotations' });
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
  static async checkDesignCompliance(imageBase64: string, config: VisionConfig, refText?: string, traceId?: string): Promise<ComplianceResult | null> {
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
      // Task 35: 默认启用 prompt-based function calling（VLM 不主动调用工具时行为与原来一致）
      const parsed = await this.callAndParseWithTools(
        imageBase64, systemPrompt, userPrompt, config,
        { traceId, mode: 'compliance' },
      );
      if (!parsed) return null;
      return this.buildComplianceResult(parsed);
    }

    // 多次采样模式：用 temperature=0.7 并行调 N 次
    const sampledConfig: VisionConfig = { ...config, temperature: 0.7 };
    const samples: any[] = [];
    const sampleErrors: string[] = [];
    const results = await Promise.allSettled(
      Array.from({ length: samplingCfg.samples }, (_, i) =>
        this.callAndParse(imageBase64, systemPrompt, userPrompt, sampledConfig, { traceId, mode: `compliance_sample${i + 1}` }),
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
   * Task 28: 同时提取 clauseRef/clauseText 字段
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
      // Task 28: 规范条文链接字段
      clauseRef: typeof issue.clauseRef === 'string' && issue.clauseRef.trim() ? issue.clauseRef.trim().substring(0, 200) : undefined,
      clauseText: typeof issue.clauseText === 'string' && issue.clauseText.trim() ? issue.clauseText.trim().substring(0, 2000) : undefined,
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
        // Task 28: 规范条文链接字段（取首次出现的值）
        clauseRef: typeof firstIssue.clauseRef === 'string' && firstIssue.clauseRef.trim() ? firstIssue.clauseRef.trim().substring(0, 200) : undefined,
        clauseText: typeof firstIssue.clauseText === 'string' && firstIssue.clauseText.trim() ? firstIssue.clauseText.trim().substring(0, 2000) : undefined,
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
   * Task 33: 专业路由自动判定
   *
   * Step0: 用小模型对图纸做一次轻量调用，判定图纸专业（建筑/结构/机电/工艺/核电）
   * 后续 prompt 按专业分流，加载对应 PROFESSION_VARIANT_MAP 的 prompt
   *
   * 判定逻辑：
   *   - 用标题栏维度配置（小模型优先）调用 VLM
   *   - prompt 要求模型从图纸内容特征（图例符号/标注/设计说明关键词）判定专业
   *   - 返回 DwgProfession 联合类型之一；无法判定时降级为 'building'（最通用）
   *
   * 用户手动选择时跳过自动判定（在 analyze 入口判断）
   *
   * @param imageBase64  图纸 PNG base64
   * @param config       视觉模型配置（建议用 titleBlock 维度的小模型）
   * @returns            { profession, reason } —— 判定出的专业类型 + 依据/失败原因
   */
  static async detectProfession(
    imageBase64: string,
    config: VisionConfig,
    traceId?: string,
  ): Promise<{ profession: DwgProfession; reason: string }> {
    // 简化判定 prompt（直接内联，不走 registry，避免污染模板库）
    const systemPrompt = `你是图纸专业判定助手。根据图纸内容特征判定其所属专业类别。
仅从以下 7 个专业中选择一个，输出 JSON：{"profession": "building|structural|plumbing|hvac|electrical|process|nuclear", "reason": "判定依据简述"}

判定依据：
- building（建筑）：平面图/立面图/剖面图，含房间布局/门窗/家具/疏散通道
- structural（结构）：配筋图/模板图，含钢筋符号/混凝土等级/抗震等级
- plumbing（给排水）：管线图含给排水符号/阀门/水龙头/排水沟
- hvac（暖通）：风管/水管/空调设备/风口符号
- electrical（电气）：电气线路/配电箱/灯具/开关符号
- process（工艺）：工艺流程图/P&ID，含设备/管道/仪表
- nuclear（核电）：含焊缝符号/NDT 标注/检验等级/HAF 标准

无法判定时默认 building。`;

    const userPrompt = '请判定这张图纸的专业类别。';

    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: 'profession_detect' });
    const valid: DwgProfession[] = ['building', 'structural', 'plumbing', 'hvac', 'electrical', 'process', 'nuclear'];
    const detected = parsed?.profession;
    if (typeof detected === 'string' && valid.includes(detected as DwgProfession)) {
      const reason = String(parsed.reason || '未提供判定依据');
      console.log(`[DWG Vision] Task 33 专业自动判定: ${detected}（依据: ${reason}）`);
      return { profession: detected as DwgProfession, reason };
    }
    console.log('[DWG Vision] Task 33 专业自动判定失败，降级为 building');
    return { profession: 'building', reason: '自动判定失败，降级为建筑专业' };
  }

  /**
   * 专业审查：按用户选择的专业加载对应 prompt 进行针对性审查
   * Task 17 实现，Task 33 专业路由自动判定将复用此方法
   */
  static async analyzeProfession(
    imageBase64: string,
    profession: DwgProfession,
    config: VisionConfig,
    traceId?: string,
  ): Promise<ProfessionCheckResult | null> {
    const variant = this.PROFESSION_VARIANT_MAP[profession];
    if (!variant) {
      throw new Error(`不支持的专业类型: ${profession}`);
    }

    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant }),
      PromptLoader.loadUserPrompt('dwg_vision', variant),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: `profession_${profession}` });
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
  static async checkFrame(imageBase64: string, config: VisionConfig, traceId?: string): Promise<FrameCheckResult | null> {
    const [systemPrompt, userPrompt] = await Promise.all([
      PromptLoader.loadSystemPrompt('dwg_vision', { variant: 'frame_check' }),
      PromptLoader.loadUserPrompt('dwg_vision', 'frame_check'),
    ]);
    const parsed = await this.callAndParse(imageBase64, systemPrompt, userPrompt, config, { traceId, mode: 'frameCheck' });
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
   * Task 34: 跨维度关联校验
   *
   * 把多个维度结果做交叉一致性检查，发现矛盾时输出 issue：
   *
   * 1. DWG_CROSS_DRAWINGNO（标题栏 drawingNo ↔ 合规审查引用图号）：
   *    - 从 compliance.issues 的 note/violation/suggestion 文本中正则提取图号引用
   *    - 与标题栏 titleBlock.drawingNo 比对，若引用图号与标题栏不一致 → error issue
   *    - 用例：标题栏 drawingNo="DWG-001"，但 compliance 引用"详见 DWG-002 图"
   *
   * 2. DWG_CROSS_STDREF（标题栏 drawingNo ↔ 合规审查标准引用版本）：
   *    - 从 compliance.issues.clauseRef + designNotes 中正则提取标准号（如 GB 50016-2014）
   *    - 与 dwgMetadataVerification.wasStandardRefs 比对，版本号不一致 → warning issue
   *    - 用例：compliance 引用 "GB 50016-2014"，WASM 元数据含 "GB 50016-2018"
   *
   * 3. DWG_CROSS_SCALE（标题栏 scale ↔ annotations 比例尺标注）：
   *    - 从 annotations.missingItems 中找比例尺相关项（item/location 含"比例"）
   *    - 与标题栏 titleBlock.scale 比对，不一致 → warning issue
   *    - 用例：标题栏 scale="1:100"，annotations 标注"比例 1:50"
   *
   * @param result 各维度并行完成后的完整 VisionAnalyzeResult
   * @returns 跨维度 issue 列表（无 issue 时为空数组）
   */
  private static crossDimensionCheck(result: VisionAnalyzeResult): Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }> {
    const issues: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }> = [];
    const tb = result.titleBlock;
    const comp = result.compliance;
    const ann = result.annotations;
    const dwgMeta = result.dwgMetadataVerification;

    if (!tb) return issues;  // 无标题栏则跳过所有跨维度校验

    // ── 1. DWG_CROSS_DRAWINGNO: 标题栏 drawingNo ↔ compliance 引用图号 ──
    if (comp && tb.drawingNo) {
      const titleDrawingNo = tb.drawingNo.trim();
      // 从所有 compliance issue 的 note/violation/suggestion 文本中提取图号引用
      // 图号格式常见：DWG-001 / TJ-001 / 结施-01 / 建施-001 等（字母+连字符+数字）
      const drawingNoPattern = /([A-Za-z\u4e00-\u9fa5]{2,6}[-—]\d{1,4})/g;
      const referencedNos = new Set<string>();
      for (const issue of comp.issues) {
        const texts = [issue.note, issue.violation, issue.suggestion].filter(Boolean) as string[];
        for (const text of texts) {
          const matches = text.match(drawingNoPattern);
          if (matches) matches.forEach(m => referencedNos.add(m.trim()));
        }
      }
      // 也检查 designNotes
      for (const note of comp.designNotes || []) {
        const matches = note.match(drawingNoPattern);
        if (matches) matches.forEach(m => referencedNos.add(m.trim()));
      }

      // 若引用的图号中存在与标题栏不一致的 → error issue
      for (const ref of referencedNos) {
        if (ref && ref !== titleDrawingNo) {
          issues.push({
            code: 'DWG_CROSS_DRAWINGNO',
            severity: 'error',
            message: `跨维度不一致：标题栏图号「${titleDrawingNo}」与合规审查引用图号「${ref}」不一致`,
          });
          break;  // 同类只报一条，避免噪声
        }
      }
    }

    // ── 2. DWG_CROSS_STDREF: compliance 标准引用 ↔ WASM 元数据标准引用 ──
    if (comp && dwgMeta && dwgMeta.status === 'success') {
      // 从 compliance clauseRef + designNotes 提取标准号（如 "GB 50016-2014"）
      const stdPattern = /(GB\s*[\d.]+-\d{4}|GB\/T\s*[\d.]+-\d{4}|HAF\s*[\d.]+|BT\s*[\d.]+)/g;
      const vlmStdRefs = new Set<string>();
      for (const issue of comp.issues) {
        if (issue.clauseRef) {
          const matches = issue.clauseRef.match(stdPattern);
          if (matches) matches.forEach(m => vlmStdRefs.add(m.replace(/\s+/g, ' ').trim()));
        }
      }
      for (const note of comp.designNotes || []) {
        const matches = note.match(stdPattern);
        if (matches) matches.forEach(m => vlmStdRefs.add(m.replace(/\s+/g, ' ').trim()));
      }

      // WASM 元数据的标准号（dwgMeta.wasStandardRefs 是字符串数组）
      const wasmStdRefs = new Set((dwgMeta.wasStandardRefs || []).map(s => s.replace(/\s+/g, ' ').trim()));

      // 找版本号不一致的标准（同一标准号不同版本年份）
      for (const vlm of vlmStdRefs) {
        // 提取标准号主体（去掉年份）：GB 50016-2014 → GB 50016
        const base = vlm.replace(/-\d{4}$/, '').trim();
        for (const wasm of wasmStdRefs) {
          const wasmBase = wasm.replace(/-\d{4}$/, '').trim();
          if (base === wasmBase && vlm !== wasm) {
            issues.push({
              code: 'DWG_CROSS_STDREF',
              severity: 'warning',
              message: `跨维度不一致：合规审查引用标准「${vlm}」与 DWG 元数据标准引用「${wasm}」版本不一致`,
            });
            break;  // 同类只报一条
          }
        }
      }
    }

    // ── 3. DWG_CROSS_SCALE: 标题栏 scale ↔ annotations 比例尺标注 ──
    if (ann && tb.scale) {
      const titleScale = tb.scale.trim();
      const scalePattern = /^(1:\d+|\d+:1)$/;
      if (scalePattern.test(titleScale)) {
        // 从 annotations.missingItems 中找比例尺相关项
        for (const item of ann.missingItems || []) {
          const itemText = `${item.item || ''} ${item.location || ''}`.trim();
          if (itemText.includes('比例') || itemText.includes('scale')) {
            // 从该项提取比例尺标注值
            const scaleMatch = itemText.match(/(1:\d+|\d+:1)/);
            if (scaleMatch && scaleMatch[1] !== titleScale) {
              issues.push({
                code: 'DWG_CROSS_SCALE',
                severity: 'warning',
                message: `跨维度不一致：标题栏比例「${titleScale}」与标注完整性中的比例尺「${scaleMatch[1]}」不匹配`,
              });
              break;  // 同类只报一条
            }
          }
        }
      }
    }

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
    // Task 29: jobKey 作为 traceId 传给各维度，关联 LlmCallLog
    const traceId = jobKey;

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

    // ── Task 36: SAHI 切片送审 - 大图按 2048×2048 重叠切片 ──
    // 仅对 symbols/annotations/compliance/profession 4 个细粒度维度启用
    // 标题栏/图框是整体性检查，不切片（仍走原图）
    let sahiTiles: Array<{ imageBase64: string; offset: { x: number; y: number }; size: { w: number; h: number } }> = [];
    let sahiOriginalSize: { w: number; h: number } = { w: 0, h: 0 };
    const needsSlicing = analyses.some(a => ['symbols', 'annotations', 'compliance', 'profession'].includes(a));
    if (needsSlicing) {
      try {
        const sahi = await this.sliceImageSahi(imageBase64);
        sahiTiles = sahi.tiles;
        sahiOriginalSize = sahi.originalSize;
      } catch (e: any) {
        console.warn('[DWG Vision] Task 36 SAHI 切片预检失败，全程走原图:', e.message);
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
            const r = await this.analyzeTitleBlock(titleBlockImage, configMap.titleBlock, traceId);
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
        (async () => {
          try {
            const r = sahiTiles.length > 0
              ? await this.analyzeSymbolsWithSlicing(sahiTiles, sahiOriginalSize, configMap.symbols, traceId)
              : await this.analyzeSymbols(imageBase64, configMap.symbols, traceId);
            result.symbols = r;
            emitDimensionDone('symbols', true);
          } catch (e: any) {
            errors.push(`图例符号识别失败: ${e.message}`);
            emitDimensionDone('symbols', false, e.message);
          }
        })()
      );
    }

    if (analyses.includes('annotations')) {
      tasks.push(
        (async () => {
          try {
            const r = sahiTiles.length > 0
              ? await this.checkAnnotationsWithSlicing(sahiTiles, sahiOriginalSize, configMap.annotations, traceId)
              : await this.checkAnnotations(imageBase64, configMap.annotations, traceId);
            result.annotations = r;
            emitDimensionDone('annotations', true);
          } catch (e: any) {
            errors.push(`标注完整性检查失败: ${e.message}`);
            emitDimensionDone('annotations', false, e.message);
          }
        })()
      );
    }

    if (analyses.includes('compliance')) {
      tasks.push(
        (async () => {
          try {
            const r = sahiTiles.length > 0
              ? await this.checkDesignComplianceWithSlicing(sahiTiles, sahiOriginalSize, configMap.compliance, mergedRefText, traceId)
              : await this.checkDesignCompliance(imageBase64, configMap.compliance, mergedRefText, traceId);
            result.compliance = r;
            emitDimensionDone('compliance', true);
          } catch (e: any) {
            errors.push(`设计说明合规审查失败: ${e.message}`);
            emitDimensionDone('compliance', false, e.message);
          }
        })()
      );
    }

    // Task 17/33: 专业分流审查
    // - user 显式指定 profession → 直接用 user 选择的 profession
    // - user 未指定 → 先调 detectProfession 自动判定（用 titleBlock 维度的小模型），
    //   再用 detected profession 调 analyzeProfession
    // - 自动判定结果（含 reason）写入 result.detectedProfession / detectedProfessionReason
    if (analyses.includes('profession')) {
      tasks.push(
        (async () => {
          try {
            let profession = options?.profession;
            if (!profession) {
              // Task 33: 自动判定（用 titleBlock 维度的小模型，未配置时降级到默认 config）
              const detectConfig = configMap.titleBlock || config;
              const detected = await this.detectProfession(imageBase64, detectConfig, traceId);
              profession = detected.profession;
              result.detectedProfession = detected.profession;
              result.detectedProfessionReason = detected.reason;
            }
            // Task 36: 大图启用切片送审
            const r = sahiTiles.length > 0
              ? await this.analyzeProfessionWithSlicing(sahiTiles, sahiOriginalSize, profession, configMap.profession, traceId)
              : await this.analyzeProfession(imageBase64, profession, configMap.profession, traceId);
            result.profession = r;
            emitDimensionDone('profession', true);
          } catch (e: any) {
            errors.push(`专业审查失败: ${e.message}`);
            emitDimensionDone('profession', false, e.message);
          }
        })()
      );
    }

    // Task 18: 图框规范检查
    if (analyses.includes('frameCheck')) {
      tasks.push(
        this.checkFrame(imageBase64, configMap.frameCheck, traceId)
          .then(r => { result.frameCheck = r; emitDimensionDone('frameCheck', true); })
          .catch(e => { errors.push(`图框规范检查失败: ${e.message}`); emitDimensionDone('frameCheck', false, e.message); })
      );
    }

    // 并行执行
    await Promise.all(tasks);

    // 填入本次分析使用的模型信息
    result.modelInfo = { model: config.modelName, modelType: config.modelType };
    // Task 29: 嵌入 traceId（jobKey），供前端调用推理回放端点
    if (traceId) result.traceId = traceId;

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

    // Task 34: 跨维度关联校验（必须在元数据双校验之后执行，依赖 dwgMetadataVerification）
    try {
      result.crossDimensionIssues = this.crossDimensionCheck(result);
    } catch (e: any) {
      console.warn('[DWG Vision] Task 34 跨维度关联校验失败:', e.message);
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

  // ==================== Task 36: SAHI 切片送审 ====================

  /**
   * Task 36: 大图按 2048×2048 重叠切片
   *
   * 策略：
   *   - 仅当图片任一边 > tileSize（默认 2048）时启用，否则返回空数组（不切片）
   *   - 切片尺寸 tileSize×tileSize，重叠 overlap（默认 256，保证跨切片对象能被完整覆盖）
   *   - 步长 step = tileSize - overlap
   *   - 跳过过小的边缘切片（< tileSize/2）
   *
   * 降级策略：
   *   - sharp 元数据读取/切片失败 → 返回空 tiles 数组，调用方降级为原图单次调用
   *
   * @param imageBase64 原图 PNG base64
   * @param tileSize    切片尺寸（默认 2048）
   * @param overlap     重叠像素（默认 256）
   * @returns           { tiles: 切片数组, originalSize: 原图尺寸 }
   *                   tiles 为空数组表示不需要切片
   */
  private static async sliceImageSahi(
    imageBase64: string,
    tileSize: number = 2048,
    overlap: number = 256,
  ): Promise<{
    tiles: Array<{
      imageBase64: string;
      offset: { x: number; y: number };
      size: { w: number; h: number };
    }>;
    originalSize: { w: number; h: number };
  }> {
    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      const meta = await sharp(buffer).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;

      // 图片任一边 <= tileSize → 不切片
      if (width <= tileSize && height <= tileSize) {
        return { tiles: [], originalSize: { w: width, h: height } };
      }

      const step = tileSize - overlap;  // 步长
      const tiles: Array<{
        imageBase64: string;
        offset: { x: number; y: number };
        size: { w: number; h: number };
      }> = [];

      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const tw = Math.min(tileSize, width - x);
          const th = Math.min(tileSize, height - y);
          // 跳过过小的边缘切片
          if (tw < tileSize / 2 || th < tileSize / 2) continue;

          const tileBuffer = await sharp(buffer)
            .extract({ left: x, top: y, width: tw, height: th })
            .png()
            .toBuffer();

          tiles.push({
            imageBase64: tileBuffer.toString('base64'),
            offset: { x, y },
            size: { w: tw, h: th },
          });

          // 列末尾，跳出内层循环
          if (x + tileSize >= width) break;
        }
        if (y + tileSize >= height) break;
      }

      console.log(`[DWG Vision] Task 36 SAHI 切片: ${width}×${height} → ${tiles.length} 个 ${tileSize}×${tileSize} 切片 (overlap=${overlap})`);
      return { tiles, originalSize: { w: width, h: height } };
    } catch (e: any) {
      console.warn('[DWG Vision] Task 36 SAHI 切片失败，降级为原图:', e.message);
      return { tiles: [], originalSize: { w: 0, h: 0 } };
    }
  }

  /**
   * Task 36: 将切片内 bbox 重新映射回原图 0-1000 坐标系
   *
   * 坐标变换链：
   *   切片内 0-1000 归一化 → 切片像素坐标 → 原图像素坐标（加偏移）→ 原图 0-1000 归一化
   *
   * @param bbox         切片内 bbox（0-1000 坐标系）
   * @param tileOffset   切片在原图中的像素偏移
   * @param tileSize     切片实际像素尺寸
   * @param originalSize 原图像素尺寸
   */
  private static remapBboxFromTile(
    bbox: [number, number, number, number] | undefined,
    tileOffset: { x: number; y: number },
    tileSize: { w: number; h: number },
    originalSize: { w: number; h: number },
  ): [number, number, number, number] | undefined {
    if (!bbox) return undefined;
    if (originalSize.w === 0 || originalSize.h === 0) return undefined;

    const [x1, y1, x2, y2] = bbox;
    // 切片内 0-1000 → 切片像素坐标
    const tileX1Px = (x1 / 1000) * tileSize.w;
    const tileY1Px = (y1 / 1000) * tileSize.h;
    const tileX2Px = (x2 / 1000) * tileSize.w;
    const tileY2Px = (y2 / 1000) * tileSize.h;

    // 切片像素坐标 + 偏移 → 原图像素坐标 → 原图 0-1000
    const origX1 = ((tileOffset.x + tileX1Px) / originalSize.w) * 1000;
    const origY1 = ((tileOffset.y + tileY1Px) / originalSize.h) * 1000;
    const origX2 = ((tileOffset.x + tileX2Px) / originalSize.w) * 1000;
    const origY2 = ((tileOffset.y + tileY2Px) / originalSize.h) * 1000;

    return [
      Math.max(0, Math.min(1000, Math.round(origX1))),
      Math.max(0, Math.min(1000, Math.round(origY1))),
      Math.max(0, Math.min(1000, Math.round(origX2))),
      Math.max(0, Math.min(1000, Math.round(origY2))),
    ];
  }

  /**
   * Task 36: 简单字符串指纹（用于切片结果去重）
   * 归一化：去空白、转小写、取前 80 字符
   */
  private static fingerprintKey(...parts: (string | undefined | null)[]): string {
    return parts
      .map(p => (p || '').trim().toLowerCase().replace(/\s+/g, ''))
      .join('|')
      .substring(0, 80);
  }

  /**
   * Task 36: 对图例符号识别维度执行 SAHI 切片送审
   * - 对每个切片并行调用 analyzeSymbols
   * - 合并 symbols 数组，按 tag 去重（保留首次出现的）
   * - 重映射 bbox 到原图坐标系
   * - totalCount 取合并后 symbols.length，summary 取首个非空
   */
  private static async analyzeSymbolsWithSlicing(
    tiles: Array<{ imageBase64: string; offset: { x: number; y: number }; size: { w: number; h: number } }>,
    originalSize: { w: number; h: number },
    config: VisionConfig,
    traceId?: string,
  ): Promise<SymbolListResult | null> {
    const results = await Promise.allSettled(
      tiles.map(tile => this.analyzeSymbols(tile.imageBase64, config, traceId)),
    );

    const merged: SymbolItem[] = [];
    const seen = new Set<string>();
    let summary = '';

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const tile = tiles[i];
      if (!summary && r.value.summary) summary = r.value.summary;
      for (const s of r.value.symbols) {
        const key = this.fingerprintKey(s.tag, s.type);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          ...s,
          bbox: this.remapBboxFromTile(s.bbox, tile.offset, tile.size, originalSize),
        });
      }
    });

    if (merged.length === 0 && !summary) return null;
    return { symbols: merged, totalCount: merged.length, summary };
  }

  /**
   * Task 36: 对标注完整性检查维度执行 SAHI 切片送审
   * - 合并 missingItems，按 item+location 去重
   * - completenessScore 取各切片的最大值（最完整的切片）
   */
  private static async checkAnnotationsWithSlicing(
    tiles: Array<{ imageBase64: string; offset: { x: number; y: number }; size: { w: number; h: number } }>,
    originalSize: { w: number; h: number },
    config: VisionConfig,
    traceId?: string,
  ): Promise<AnnotationCheckResult | null> {
    const results = await Promise.allSettled(
      tiles.map(tile => this.checkAnnotations(tile.imageBase64, config, traceId)),
    );

    const merged: AnnotationIssue[] = [];
    const seen = new Set<string>();
    let completenessScore = 0;
    let summary = '';

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const tile = tiles[i];
      if (!summary && r.value.summary) summary = r.value.summary;
      completenessScore = Math.max(completenessScore, r.value.completenessScore);
      for (const item of r.value.missingItems) {
        const key = this.fingerprintKey(item.item, item.location);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          ...item,
          bbox: this.remapBboxFromTile(item.bbox, tile.offset, tile.size, originalSize),
        });
      }
    });

    if (merged.length === 0 && !summary) return null;
    return { missingItems: merged, completenessScore, summary };
  }

  /**
   * Task 36: 对设计说明合规审查维度执行 SAHI 切片送审
   * - 合并 issues，按 note+violation 去重
   * - designNotes 取并集（去重）
   */
  private static async checkDesignComplianceWithSlicing(
    tiles: Array<{ imageBase64: string; offset: { x: number; y: number }; size: { w: number; h: number } }>,
    originalSize: { w: number; h: number },
    config: VisionConfig,
    refText: string | undefined,
    traceId?: string,
  ): Promise<ComplianceResult | null> {
    const results = await Promise.allSettled(
      tiles.map(tile => this.checkDesignCompliance(tile.imageBase64, config, refText, traceId)),
    );

    const mergedIssues: ComplianceIssue[] = [];
    const seen = new Set<string>();
    const designNotesSet = new Set<string>();
    let summary = '';

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const tile = tiles[i];
      if (!summary && r.value.summary) summary = r.value.summary;
      for (const note of r.value.designNotes) {
        const key = note.trim().toLowerCase();
        if (key) designNotesSet.add(note);
      }
      for (const issue of r.value.issues) {
        const key = this.fingerprintKey(issue.note, issue.violation);
        if (seen.has(key)) continue;
        seen.add(key);
        mergedIssues.push({
          ...issue,
          bbox: this.remapBboxFromTile(issue.bbox, tile.offset, tile.size, originalSize),
        });
      }
    });

    if (mergedIssues.length === 0 && !summary && designNotesSet.size === 0) return null;
    return {
      designNotes: Array.from(designNotesSet),
      issues: mergedIssues,
      summary,
    };
  }

  /**
   * Task 36: 对专业审查维度执行 SAHI 切片送审
   * - 合并 issues，按 item+location 去重
   * - profession 取首次成功切片的结果
   */
  private static async analyzeProfessionWithSlicing(
    tiles: Array<{ imageBase64: string; offset: { x: number; y: number }; size: { w: number; h: number } }>,
    originalSize: { w: number; h: number },
    profession: DwgProfession,
    config: VisionConfig,
    traceId?: string,
  ): Promise<ProfessionCheckResult | null> {
    const results = await Promise.allSettled(
      tiles.map(tile => this.analyzeProfession(tile.imageBase64, profession, config, traceId)),
    );

    const merged: ProfessionIssue[] = [];
    const seen = new Set<string>();
    let summary = '';

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const tile = tiles[i];
      if (!summary && r.value.summary) summary = r.value.summary;
      for (const issue of r.value.issues) {
        const key = this.fingerprintKey(issue.item, issue.location);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          ...issue,
          bbox: this.remapBboxFromTile(issue.bbox, tile.offset, tile.size, originalSize),
        });
      }
    });

    if (merged.length === 0 && !summary) return null;
    return { profession, issues: merged, summary };
  }

  // ==================== Task 35: Function Calling ====================

  /**
   * Task 35: VLM 可调用的工具定义
   *
   * 采用 prompt-based function calling（非 OpenAI tools 协议），原因：
   *   - 内网部署的 VLM 不一定支持 OpenAI 兼容的 tools 协议
   *   - prompt-based 方式对所有 OpenAI 兼容模型都能工作
   *   - VLM 在 JSON 输出前可用 `{"tool_calls":[...]}` 格式请求工具调用，
   *     后端解析后执行工具，把结果回灌 prompt 做第二轮调用得到最终 JSON
   *
   * 工具列表（spec 要求 3 个）：
   *   - query_standard(code): 查询规范条文（从 MaxKB 知识库检索）
   *   - query_symbol_library(tag): 查询符号库（项目暂无独立符号库，返回提示）
   *   - check_rule(ruleId, payload): 调用规则引擎校验
   */
  private static readonly VISION_TOOL_DEFINITIONS = [
    {
      name: 'query_standard',
      description: '查询国家标准/行业规范的条文内容。当需要在合规审查中引用具体条文时调用。',
      parameters: {
        code: { type: 'string', description: '标准号或条文编号，例如 "GB 50016-2014" 或 "GB 50016-2014 第 5.5.3 条"' },
      },
      required: ['code'],
    },
    {
      name: 'query_symbol_library',
      description: '查询图纸符号库（阀门/泵/容器/仪表等）获取 tag 对应的符号定义。当需要核对图例符号一致性时调用。',
      parameters: {
        tag: { type: 'string', description: '符号位号，例如 "V-101" / "P-202"' },
      },
      required: ['tag'],
    },
    {
      name: 'check_rule',
      description: '调用规则引擎对给定 payload 执行硬性规则校验。返回规则违例列表。',
      parameters: {
        ruleId: { type: 'string', description: '规则 ID 或前缀，例如 "DWG_TITLE_001" / "DWG_SCALE_001"' },
        payload: { type: 'object', description: '校验负载，包含规则所需的字段（如标题栏信息、图层列表等）' },
      },
      required: ['ruleId'],
    },
  ];

  /**
   * Task 35: 生成注入 prompt 的工具说明文本
   * 告知 VLM 可用工具列表与调用格式
   */
  private static getToolDescriptionForPrompt(): string {
    const toolList = this.VISION_TOOL_DEFINITIONS.map(t => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `${k}(${(v as any).type}): ${(v as any).description}`)
        .join(', ');
      return `  - ${t.name}(${params}): ${t.description}`;
    }).join('\n');

    return `\n\n## 可用工具（Function Calling）
你可以在输出最终 JSON 之前，先用以下格式请求工具调用以获取外部信息：
\`\`\`json
{"tool_calls": [{"name": "<工具名>", "arguments": {<参数键值对>}}]}
\`\`\`
后端会执行工具调用并把结果回灌给你，你再输出最终 JSON。最多 2 轮工具调用。

可用工具列表：
${toolList}

注意：
- 工具调用请求和最终 JSON 输出不能同时出现在同一响应中
- 收到工具返回值后，必须输出最终 JSON（不能再请求工具）
- 如果不需要工具调用，直接输出最终 JSON 即可`;
  }

  /**
   * Task 35: 执行 VLM 工具调用
   *
   * 工具实现：
   *   - query_standard(code): 从 MaxKB 检索标准号相关条文；无 MaxKB 配置时降级返回提示
   *   - query_symbol_library(tag): 项目暂无独立符号库，返回提示让 VLM 用自身知识
   *   - check_rule(ruleId, payload): 复用 RULE_REGISTRY，根据 ruleId 前缀匹配规则并执行
   *
   * 降级策略：
   *   - 工具执行失败 → 返回错误信息（不中断主流程，VLM 会收到错误描述继续推理）
   *   - 未知工具名 → 返回 "未知工具" 错误
   */
  private static async executeVisionToolCall(
    name: string,
    args: any,
    logCtx?: { traceId?: string; mode?: string },
  ): Promise<{ result: any; error?: string }> {
    try {
      if (name === 'query_standard') {
        const code = String(args?.code || '').trim();
        if (!code) return { result: null, error: '缺少 code 参数' };

        // 从 MaxKB 检索标准号
        try {
          const workspaceId = await MaxKBService.getDefaultWorkspaceId();
          const kbs = await MaxKBService.listKnowledge(workspaceId);
          if (!Array.isArray(kbs) || kbs.length === 0) {
            return { result: { code, note: '未配置 MaxKB 知识库，无法检索标准条文，请用自身知识判断' } };
          }
          // 在第一个可用知识库检索（避免遍历所有 KB 增加延迟）
          const hits = await MaxKBService.hitTest(workspaceId, kbs[0].id, code, 3);
          if (!Array.isArray(hits) || hits.length === 0) {
            return { result: { code, note: `未在知识库中检索到 ${code} 相关条文` } };
          }
          const contents = hits.map((h: any) => {
            const c = h.content || h.text || '';
            const t = h.title || h.document_name || '';
            return t ? `【${t}】${c}` : c;
          });
          return { result: { code, clauses: contents } };
        } catch (e: any) {
          return { result: null, error: `query_standard 执行失败: ${e.message}` };
        }
      }

      if (name === 'query_symbol_library') {
        const tag = String(args?.tag || '').trim();
        if (!tag) return { result: null, error: '缺少 tag 参数' };
        // 项目暂无独立符号库，返回提示让 VLM 用自身知识
        return {
          result: {
            tag,
            note: '项目暂未部署独立符号库，请用 VLM 自身知识识别符号类型与含义',
          },
        };
      }

      if (name === 'check_rule') {
        const ruleId = String(args?.ruleId || '').trim();
        if (!ruleId) return { result: null, error: '缺少 ruleId 参数' };
        const payload = args?.payload || {};

        // 复用 RULE_REGISTRY，按 ruleId 前缀匹配
        try {
          const { getRuleRegistryMetadata } = require('../rules/index');
          const meta = getRuleRegistryMetadata();
          // 仅返回规则是否存在的提示，不实际执行（执行需要 FileContext，工具场景下没有完整 ctx）
          const matched = meta.allPrefixes.filter((p: string) => ruleId.toUpperCase().startsWith(p.toUpperCase()));
          if (matched.length === 0) {
            return { result: { ruleId, violations: [], note: `未找到匹配的规则前缀: ${ruleId}` } };
          }
          return {
            result: {
              ruleId,
              matchedPrefixes: matched,
              note: `规则 ${ruleId} 已注册，但工具模式下无法执行完整校验（需 FileContext），请在最终 JSON 中标注"建议人工复核规则 ${ruleId}"`,
              payloadReceived: !!payload && Object.keys(payload).length > 0,
            },
          };
        } catch (e: any) {
          return { result: null, error: `check_rule 执行失败: ${e.message}` };
        }
      }

      return { result: null, error: `未知工具: ${name}` };
    } catch (e: any) {
      // 记录失败日志
      this.recordVisionLlmCall({
        traceId: logCtx?.traceId,
        mode: `${logCtx?.mode || ''}_tool_${name}`,
        model: 'tool-executor',
        latencyMs: 0,
        status: 'failed',
        errorMsg: (e as Error).message?.substring(0, 1000),
        promptFull: JSON.stringify({ name, args }).substring(0, 60000),
      });
      return { result: null, error: `工具执行异常: ${e.message}` };
    }
  }

  /**
   * Task 35: 带工具调用循环的 VLM 调用
   *
   * 流程：
   *   1. 调用 VLM，prompt 中包含工具说明
   *   2. 如果响应是 tool_call 请求 → 执行工具 → 把结果作为 "工具返回值" 注入 prompt → 再次调用 VLM
   *   3. 如果响应是最终 JSON → 直接解析返回
   *   4. 最多 2 轮工具调用，超出后强制要求 VLM 输出最终 JSON
   *
   * 降级策略：
   *   - 工具调用解析失败 → 当作最终 JSON 处理（保持向后兼容）
   *   - 所有工具执行失败 → 把错误信息回灌 prompt，让 VLM 知道并继续输出
   */
  private static async callAndParseWithTools(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
    logCtx?: { traceId?: string; mode?: string },
  ): Promise<any> {
    const maxToolRounds = 2;
    const currentSystemPrompt = systemPrompt + this.getToolDescriptionForPrompt();
    let currentUserPrompt = userPrompt;

    for (let round = 0; round <= maxToolRounds; round++) {
      const raw = await this.callAndParse(
        imageBase64,
        currentSystemPrompt,
        currentUserPrompt,
        config,
        { traceId: logCtx?.traceId, mode: round === 0 ? logCtx?.mode : `${logCtx?.mode || ''}_tool_round_${round}` },
      );

      // callAndParse 已做 JSON 解析，直接判断是否含 tool_calls
      if (raw && Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
        if (round >= maxToolRounds) {
          console.warn(`[DWG Vision] Task 35 工具调用超出最大轮次 ${maxToolRounds}，强制结束`);
          return null;
        }

        // 执行工具调用
        const toolResults: string[] = [];
        for (const tc of raw.tool_calls) {
          const { result, error } = await this.executeVisionToolCall(tc.name, tc.arguments, logCtx);
          if (error) {
            toolResults.push(`工具 ${tc.name} 调用失败: ${error}`);
          } else {
            toolResults.push(`工具 ${tc.name} 返回: ${JSON.stringify(result)}`);
          }
        }

        // 把工具结果回灌 prompt，要求 VLM 输出最终 JSON
        currentUserPrompt = `${userPrompt}\n\n## 工具调用返回值\n${toolResults.join('\n\n')}\n\n## 要求\n根据上述工具返回值，输出最终 JSON 结果。不能再请求工具调用，必须输出符合 schema 的最终 JSON。`;
        continue;
      }

      // 不是 tool_call 请求 → 当作最终 JSON 返回
      return raw;
    }

    return null;
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

  // ==================== Task 39: 跨文件轴线对齐比对 ====================

  /**
   * Task 39: 跨文件轴线对齐比对（最小闭环）
   *
   * 从多条历史记录的 VisionAnalyzeResult 中提取轴线编号，比对一致性：
   *   1. 对每条记录，从 ocrText / designNotes / annotations 文本中正则提取轴线编号
   *   2. 分为横轴（字母 A-Z）和纵轴（数字 1-99）两个集合
   *   3. 比对多张图的轴线集合：
   *      - 仅在某张图出现的轴线 → warning issue（可能漏标）
   *      - 轴线体系完全不一致（一张图全是字母，另一张全是数字）→ error issue
   *
   * @param recordIds  VisionAnalysis 记录 ID 数组（≥2 条）
   * @returns          比对结果（每张图的轴线集合 + 跨文件 issue 列表）
   */
  static async crossFileCompare(
    recordIds: string[],
  ): Promise<{
    items: Array<{
      recordId: string;
      fileName: string;
      letterAxes: string[];   // 横轴（字母）
      numberAxes: string[];   // 纵轴（数字）
      extractedFrom: string;  // 提取来源说明
    }>;
    issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
    }>;
  }> {
    if (recordIds.length < 2) {
      throw new Error('跨文件比对至少需要 2 条记录');
    }
    if (recordIds.length > 10) {
      throw new Error('跨文件比对最多支持 10 条记录');
    }

    // 1. 查询记录
    const records = await prisma.visionAnalysis.findMany({
      where: { id: { in: recordIds } },
      orderBy: { createdAt: 'asc' },
    });

    if (records.length < 2) {
      throw new Error(`仅找到 ${records.length} 条记录，跨文件比对至少需要 2 条`);
    }

    // 2. 逐条提取轴线编号
    const items = records.map(r => {
      const result = r.result as unknown as VisionAnalyzeResult;
      const extracted = DwgVisionService.extractAxisNumbers(result);
      return {
        recordId: r.id,
        fileName: r.fileName || '未命名',
        letterAxes: extracted.letters,
        numberAxes: extracted.numbers,
        extractedFrom: extracted.source,
      };
    });

    // 3. 比对一致性
    const issues: Array<{ severity: 'error' | 'warning' | 'info'; code: string; message: string }> = [];

    // 3a. 找出每张图独有的轴线编号（其他图都没有的）
    for (let i = 0; i < items.length; i++) {
      const cur = items[i];
      const others = items.filter((_, j) => j !== i);
      const otherLetters = new Set(others.flatMap(o => o.letterAxes));
      const otherNumbers = new Set(others.flatMap(o => o.numberAxes));

      const uniqueLetters = cur.letterAxes.filter(l => !otherLetters.has(l));
      const uniqueNumbers = cur.numberAxes.filter(n => !otherNumbers.has(n));

      if (uniqueLetters.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'DWG_CROSS_AXIS_LETTER_UNIQUE',
          message: `「${cur.fileName}」含横轴编号 ${uniqueLetters.join('、')}，其他图纸均未出现，可能漏标`,
        });
      }
      if (uniqueNumbers.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'DWG_CROSS_AXIS_NUMBER_UNIQUE',
          message: `「${cur.fileName}」含纵轴编号 ${uniqueNumbers.join('、')}，其他图纸均未出现，可能漏标`,
        });
      }
    }

    // 3b. 轴线体系不一致（一张图全是字母无数字，另一张全是数字无字母）
    const hasLetters = items.filter(i => i.letterAxes.length > 0);
    const hasNumbers = items.filter(i => i.numberAxes.length > 0);
    const onlyLetters = items.filter(i => i.letterAxes.length > 0 && i.numberAxes.length === 0);
    const onlyNumbers = items.filter(i => i.numberAxes.length > 0 && i.letterAxes.length === 0);

    if (onlyLetters.length > 0 && onlyNumbers.length > 0) {
      const letterFiles = onlyLetters.map(i => `「${i.fileName}」`).join('、');
      const numberFiles = onlyNumbers.map(i => `「${i.fileName}」`).join('、');
      issues.push({
        severity: 'error',
        code: 'DWG_CROSS_AXIS_SYSTEM_MISMATCH',
        message: `轴线编号体系不一致：${letterFiles} 仅含字母横轴，${numberFiles} 仅含数字纵轴，可能图纸类型不匹配或提取遗漏`,
      });
    }

    // 3c. 全部一致时输出 info
    if (issues.length === 0 && hasLetters.length >= 2) {
      issues.push({
        severity: 'info',
        code: 'DWG_CROSS_AXIS_CONSISTENT',
        message: `${items.length} 张图纸的轴线编号一致，未发现不一致项`,
      });
    }

    // 3d. 全部未提取到轴线
    if (hasLetters.length === 0 && hasNumbers.length === 0) {
      issues.push({
        severity: 'info',
        code: 'DWG_CROSS_AXIS_NO_DATA',
        message: '所有图纸均未提取到轴线编号，可能未启用 OCR 交叉验证或图纸不含轴线标注',
      });
    }

    return { items, issues };
  }

  /**
   * Task 39: 从 VisionAnalyzeResult 的文本字段中正则提取轴线编号
   *
   * 提取来源（按优先级）：
   *   1. ocrVerification.ocrText（OCR 整图文本，覆盖面最广）
   *   2. compliance.designNotes（设计说明，可能含轴线引用）
   *   3. annotations.missingItems[].item + location（标注检查项）
   *
   * 轴线编号格式：
   *   - 字母横轴：A / B / C / ... / Z / AA / AB（1-2 个大写字母）
   *   - 数字纵轴：1 / 2 / 3 / ... / 99
   *   - 匹配模式：
   *     "轴线 A" / "A轴" / "(A)" / "轴线①"（圆圈数字）
   *     "轴线 1" / "1轴" / "(1)"
   *     "A-1" 网格交叉点（同时提取 A 和 1）
   */
  private static extractAxisNumbers(
    result: VisionAnalyzeResult,
  ): { letters: string[]; numbers: string[]; source: string } {
    // 收集所有可用文本
    const texts: string[] = [];
    const sources: string[] = [];

    if (result.ocrVerification?.ocrText) {
      texts.push(result.ocrVerification.ocrText);
      sources.push('OCR文本');
    }
    if (result.compliance?.designNotes?.length) {
      texts.push(result.compliance.designNotes.join('\n'));
      sources.push('设计说明');
    }
    if (result.annotations?.missingItems?.length) {
      const annText = result.annotations.missingItems
        .map(i => `${i.item || ''} ${i.location || ''}`)
        .join('\n');
      texts.push(annText);
      sources.push('标注检查');
    }

    const fullText = texts.join('\n');
    const letterSet = new Set<string>();
    const numberSet = new Set<string>();

    // 模式 1：中文"轴线 A" / "A轴"
    // 匹配 "轴线 A" "轴线 1" "A轴" "1轴" "(A)" "(1)"
    const axisPatterns = [
      /轴线\s*([A-Z]{1,2})\b/g,           // 轴线 A
      /轴线\s*(\d{1,2})\b/g,               // 轴线 1
      /\b([A-Z]{1,2})\s*轴\b/g,            // A轴
      /\b(\d{1,2})\s*轴\b/g,               // 1轴
      /\(([A-Z]{1,2})\)/g,                  // (A)
      /\((\d{1,2})\)/g,                     // (1)
    ];

    for (const pattern of axisPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fullText)) !== null) {
        const val = match[1];
        if (/^[A-Z]{1,2}$/.test(val)) {
          letterSet.add(val);
        } else if (/^\d{1,2}$/.test(val)) {
          numberSet.add(val);
        }
      }
    }

    // 模式 2：网格交叉点 "A-1" → 同时提取 A 和 1
    const crossPattern = /\b([A-Z]{1,2})\s*[-—]\s*(\d{1,2})\b/g;
    let crossMatch: RegExpExecArray | null;
    while ((crossMatch = crossPattern.exec(fullText)) !== null) {
      letterSet.add(crossMatch[1]);
      numberSet.add(crossMatch[2]);
    }

    // 过滤明显误匹配：单字母 A/I 可能是英文冠词误匹配，但"轴线 A"/"A轴"上下文已足够区分
    // 不过滤，保留所有匹配结果（前端可标注"提取来源"供人工复核）

    return {
      letters: Array.from(letterSet).sort((a, b) => a.localeCompare(b)),
      numbers: Array.from(numberSet).sort((a, b) => Number(a) - Number(b)),
      source: sources.length > 0 ? sources.join(' + ') : '无可用文本',
    };
  }
}
