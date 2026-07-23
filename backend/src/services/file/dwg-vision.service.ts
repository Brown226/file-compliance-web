import prisma from '../../config/db';

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
  raw: any;
}

export interface SymbolItem {
  type: 'valve' | 'pump' | 'vessel' | 'instrument' | 'tank' | 'heat_exchanger' | 'other';
  tag: string;
  description: string;
  position: string;
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
}

interface VisionConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: number;
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

如果某个字段在图中找不到，填空字符串 ""。
输出纯 JSON 对象，格式：{"drawingNo":"","title":"","revision":"","scale":"","designer":"","checker":"","reviewer":"","approver":"","date":"","company":""}`;

const SYMBOLS_SYSTEM_PROMPT = `你是一位核电工程 P&ID 图纸识别专家。请仔细分析图纸中的所有工程图例符号，识别设备、阀门、泵、仪表等标准图例。
严格按照 JSON 格式输出，不要添加任何额外说明。`;

const SYMBOLS_USER_PROMPT = `请识别这张工程图纸中所有可辨认的标准图例符号（阀门、泵、容器、仪表、储罐、换热器等），并生成设备/管阀清单。

对每个识别到的符号，输出：
- type: 类型（valve/pump/vessel/instrument/tank/heat_exchanger/other）
- tag: 位号/编号（如能看到，如 "V-101"、"P-201A"）
- description: 简要描述（如 "闸阀 DN50"、"离心泵"）
- position: 在图纸中的大致位置描述（如 "左上区域"、"主管线中段"）

输出纯 JSON 对象，格式：{"symbols":[{"type":"","tag":"","description":"","position":""}],"totalCount":0,"summary":""}
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

同时给出整体完整性评分（0-100分）。
输出纯 JSON 对象，格式：{"missingItems":[{"item":"","location":"","severity":""}],"completenessScore":0,"summary":""}`;

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

同时提取图纸中所有可见的设计说明/技术要求文字。
输出纯 JSON 对象，格式：{"designNotes":[""],"issues":[{"note":"","violation":"","suggestion":"","severity":""}],"summary":""}`;

// ==================== 核心服务 ====================

export class DwgVisionService {
  /**
   * 获取视觉模型配置
   */
  private static async getVisionConfig(): Promise<VisionConfig> {
    const keys = ['llm_vision_model', 'llm_ocr_model'];
    for (const key of keys) {
      const config = await prisma.systemConfig.findUnique({ where: { key } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          return {
            apiBaseUrl: v.apiBaseUrl || '',
            apiKey: v.apiKey,
            modelName: v.modelName,
            timeout: (v.timeout || 120) * 1000,
          };
        }
      }
    }
    throw new Error('视觉模型未配置，请在系统管理 → AI配置中设置视觉模型');
  }

  /**
   * 调用 Vision LLM API
   */
  private static async callVisionApi(
    imageBase64: string,
    systemPrompt: string,
    userPrompt: string,
    config: VisionConfig,
  ): Promise<string> {
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;

    const payload = {
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
      max_tokens: 4096,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vision API 错误 (${response.status}): ${errorText.substring(0, 300)}`);
      }

      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Vision API 调用超时');
      }
      throw err;
    }
  }

  /**
   * 解析 JSON 响应（容错处理）
   */
  private static parseJsonResponse(raw: string): any {
    try {
      // 尝试直接解析
      return JSON.parse(raw);
    } catch {
      // 尝试提取 JSON 块
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      return null;
    }
  }

  /**
   * 标题栏/图签识别
   */
  static async analyzeTitleBlock(imageBase64: string, config: VisionConfig): Promise<TitleBlockResult | null> {
    const raw = await this.callVisionApi(imageBase64, TITLE_BLOCK_SYSTEM_PROMPT, TITLE_BLOCK_USER_PROMPT, config);
    const parsed = this.parseJsonResponse(raw);
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
      raw: parsed,
    };
  }

  /**
   * 图例符号识别
   */
  static async analyzeSymbols(imageBase64: string, config: VisionConfig): Promise<SymbolListResult | null> {
    const raw = await this.callVisionApi(imageBase64, SYMBOLS_SYSTEM_PROMPT, SYMBOLS_USER_PROMPT, config);
    const parsed = this.parseJsonResponse(raw);
    if (!parsed) return null;

    const symbols: SymbolItem[] = (parsed.symbols || []).map((s: any) => ({
      type: s.type || 'other',
      tag: s.tag || '',
      description: s.description || '',
      position: s.position || '',
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
    const raw = await this.callVisionApi(imageBase64, ANNOTATIONS_SYSTEM_PROMPT, ANNOTATIONS_USER_PROMPT, config);
    const parsed = this.parseJsonResponse(raw);
    if (!parsed) return null;

    const missingItems: AnnotationIssue[] = (parsed.missingItems || []).map((item: any) => ({
      item: item.item || '',
      location: item.location || '',
      severity: (['error', 'warning', 'info'].includes(item.severity) ? item.severity : 'warning') as any,
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
    const raw = await this.callVisionApi(imageBase64, COMPLIANCE_SYSTEM_PROMPT, userPrompt, config);
    const parsed = this.parseJsonResponse(raw);
    if (!parsed) return null;

    const issues: ComplianceIssue[] = (parsed.issues || []).map((issue: any) => ({
      note: issue.note || '',
      violation: issue.violation || '',
      suggestion: issue.suggestion || '',
      severity: (['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning') as any,
    }));

    return {
      designNotes: parsed.designNotes || [],
      issues,
      summary: parsed.summary || '',
    };
  }

  /**
   * 统一分析入口（并行执行所选分析项）
   */
  static async analyze(
    imageBase64: string,
    analyses: string[],
    refText?: string,
  ): Promise<VisionAnalyzeResult> {
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

    result.duration_ms = Date.now() - startTime;
    return result;
  }
}
