import prisma from '../config/db';
import { ParserService } from './parser.service';
import { LlmService } from './llm.service';

export interface PreAnalysisInput {
  name: string;
  size: number;
  filePath?: string;  // 新增：可选的实际文件路径
}

export interface PreAnalysisResult {
  documentType: string;
  documentTypeLabel: string;
  contractType?: string;
  noResultReason?: string;
  potentialParties?: string[];
  suggestedReviewPoints?: string[];
  suggestedCorePurposes?: string[];
  recommendations: {
    libraryReview: { enabled: boolean; categoryId?: string; reason: string };
    docReview: { enabled: boolean; reason: string };
    ruleLibrary: { enabled: boolean; libraryId?: string; reason: string };
    generalChecks: {
      ruleCheck: { enabled: boolean; reason: string };
      typoCheck: { enabled: boolean; reason: string };
      crossFileCheck: { enabled: boolean; reason: string };
    };
  };
  suggestedPerspective?: string;
  llmAnalyzed?: boolean;  // 新增：标记是否经过真实AI分析
}

interface LlmPreAnalysis {
  contractType?: string;
  suggestedReviewPoints?: string[];
  suggestedCorePurposes?: string[];
  potentialParties?: string[];
  __llmAnalyzed?: boolean;
}

type DocTypeRule = {
  keywords: string[];
  extensions: string[];
  type: string;
  label: string;
  perspective?: string;
};

const DOC_TYPE_RULES: DocTypeRule[] = [
  { keywords: ['合同', '协议', 'contract'], extensions: ['doc', 'docx'], type: 'contract', label: '合同文档', perspective: 'builder' },
  { keywords: ['新闻', '通讯', '报道', '稿'], extensions: ['doc', 'docx'], type: 'news', label: '新闻稿' },
  { keywords: ['申报', '申请', '立项'], extensions: ['doc', 'docx', 'pdf'], type: 'declaration', label: '申报书' },
  { keywords: ['规格', 'spec', 'specification'], extensions: ['doc', 'docx', 'pdf'], type: 'specification', label: '规格书', perspective: 'designer' },
  { keywords: ['周报', '日报', '月报', '汇报', '总结'], extensions: ['doc', 'docx'], type: 'report', label: '工作报告' },
  { keywords: ['规划', '方案', '计划'], extensions: ['doc', 'docx', 'pdf'], type: 'plan', label: '规划方案' },
  { keywords: ['标准', '规范', 'gb', 'gbt', 'code'], extensions: ['doc', 'docx', 'pdf'], type: 'standard', label: '标准规范' },
  { keywords: ['设备材料表', '材料表', 'bom', '清单'], extensions: ['xls', 'xlsx', 'csv'], type: 'bom', label: '设备材料清单（BOM）', perspective: 'builder' },
  { keywords: ['给排水', '消防', '设计说明', '施工图'], extensions: ['doc', 'docx', 'pdf'], type: 'engineering_design', label: '工程设计文档', perspective: 'designer' },
  { keywords: ['图纸', 'drawing', 'dwg', 'dxf'], extensions: ['dwg', 'dxf'], type: 'drawing', label: '工程图纸', perspective: 'designer' },
];

export class PreAnalysisService {
  static async analyzeFiles(files: PreAnalysisInput[]): Promise<PreAnalysisResult> {
    const fileNames = files.map(f => f.name);
    const extensions = fileNames.map(name => name.split('.').pop()?.toLowerCase() || '');
    const hasMultipleFiles = files.length > 1;
    const docType = this.detectDocType(fileNames, extensions);

    const [categories, ruleLibs] = await Promise.all([
      prisma.knowledgeCategory.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, description: true },
      }),
      prisma.ruleLibrary.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true, name: true, description: true },
      }),
    ]);

    const matchedCategory = this.matchCategory(categories, docType.type, fileNames);
    const matchedRuleLib = this.matchRuleLibrary(ruleLibs, docType.type);

    const llmAnalysis: LlmPreAnalysis = await this.runLlmPreAnalysis(files).catch(() => ({} as LlmPreAnalysis));

    const llmAnalyzed = llmAnalysis.__llmAnalyzed === true;

    return {
      documentType: docType.type,
      documentTypeLabel: docType.label,
      contractType: llmAnalyzed && typeof llmAnalysis.contractType === 'string' && llmAnalysis.contractType.trim()
        ? llmAnalysis.contractType.trim()
        : docType.label,
      noResultReason: matchedCategory
        ? undefined
        : '当前未匹配到更合适的知识库，审查将以通用规则和 AI 推断为主。',
      potentialParties: llmAnalyzed && Array.isArray(llmAnalysis.potentialParties) ? llmAnalysis.potentialParties : [],
      suggestedReviewPoints: llmAnalyzed && llmAnalysis.suggestedReviewPoints?.length > 0
        ? llmAnalysis.suggestedReviewPoints
        : this.getDefaultReviewPoints(docType.type),
      suggestedCorePurposes: llmAnalyzed && llmAnalysis.suggestedCorePurposes?.length > 0
        ? llmAnalysis.suggestedCorePurposes
        : this.getDefaultCorePurposes(docType.type),
      suggestedPerspective: docType.perspective || 'general',
      llmAnalyzed,
      recommendations: {
        libraryReview: {
          enabled: !!matchedCategory,
          categoryId: matchedCategory?.id,
          reason: matchedCategory
            ? `识别为“${docType.label}”，建议优先使用知识库“${matchedCategory.name}”。`
            : '未匹配到合适的知识库，将使用通用规则和 AI 审查。',
        },
        docReview: {
          enabled: false,
          reason: '仅在上传参考文件后启用以文审文模式。',
        },
        ruleLibrary: {
          enabled: !!matchedRuleLib,
          libraryId: matchedRuleLib?.id,
          reason: matchedRuleLib
            ? `识别为“${docType.label}”，建议使用规则库“${matchedRuleLib.name}”。`
            : '未匹配到专用规则库，将回退到平台通用规则。',
        },
        generalChecks: {
          ruleCheck: {
            enabled: true,
            reason: '启用基础规则审查，用于检查格式、命名、编码和结构问题。',
          },
          typoCheck: {
            enabled: docType.type !== 'drawing',
            reason: docType.type === 'drawing'
              ? '图纸类文件术语密集，默认不优先启用错别字审查。'
              : '启用术语一致性、错别字和表述问题检查。',
          },
          crossFileCheck: {
            enabled: hasMultipleFiles,
            reason: hasMultipleFiles
              ? `已上传 ${files.length} 个文件，建议启用跨文件一致性检查。`
              : '当前仅有 1 个文件，不启用跨文件一致性检查。',
          },
        },
      },
    };
  }

  private static async runLlmPreAnalysis(files: PreAnalysisInput[]): Promise<LlmPreAnalysis> {
    const firstFile = files[0];
    if (!firstFile) return {};

    const fileType = firstFile.name.split('.').pop()?.toLowerCase() || '';
    if (!['doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx'].includes(fileType)) {
      return {};
    }

    let filePath = firstFile.filePath;
    if (!filePath) {
      filePath = `uploads/${firstFile.name}`;
    }

    const path = await import('path');
    const absolutePath = path.resolve(filePath);
    const fs = await import('fs');
    
    if (!fs.existsSync(absolutePath)) {
      return {};
    }

    const fileText = await ParserService.parseFile(absolutePath, fileType);
    if (!fileText || fileText.trim().length < 100) {
      return {};
    }

    const llmConfig = await LlmService.getLlmConfig();
    if (!llmConfig) {
      return {};
    }

    const prompt = `你是文件审查预分析助手。请阅读下面的文件内容，并只输出 JSON：
{
  "contractType": "文档类型中文名称",
  "potentialParties": ["建议的审查立场，可选值：builder, contractor, supervisor, designer, general"],
  "suggestedReviewPoints": ["关键审查点1", "关键审查点2"],
  "suggestedCorePurposes": ["核心目的1", "核心目的2"]
}

要求：
- 只输出 JSON，不要解释
- 审查点和目的必须具体、可执行
- 如果无法判断立场，返回 general

文件内容：
---
${fileText.substring(0, 3000)}
---`;

    let llmResponse: string;
    try {
      llmResponse = await LlmService.chat(prompt, { 
        maxTokens: llmConfig.maxTokens, 
        timeout: llmConfig.timeout 
      });
    } catch {
      return {};
    }

    const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {};
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return typeof parsed === 'object' && parsed ? { ...parsed, __llmAnalyzed: true } : {};
    } catch {
      return {};
    }
  }

  private static normalizeSuggestions(input: unknown, fallback: string[]): string[] {
    if (!Array.isArray(input)) return fallback;
    const normalized = input
      .map(item => String(item || '').trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }

  private static getDefaultReviewPoints(docType: string): string[] {
    const defaults: Record<string, string[]> = {
      contract: [
        '核对合同主体资格与履约责任',
        '检查付款、违约和争议解决条款',
        '核查变更、解除和验收条件',
      ],
      specification: [
        '核对关键技术参数与约束条件',
        '检查规范引用与适用范围',
        '核查验收、测试和质量要求',
      ],
      bom: [
        '核对设备材料规格、数量和单位',
        '检查标准引用、型号和材质一致性',
        '核查清单完整性与特殊说明',
      ],
      engineering_design: [
        '核对设计参数、系统配置与规范引用',
        '检查关键安全要求和控制逻辑',
        '核查文档完整性与前后一致性',
      ],
      drawing: [
        '检查图纸完整性与标注准确性',
        '核对尺寸、图层和标准引用',
        '检查设计变更说明与图签信息',
      ],
      standard: [
        '检查标准条款完整性与有效性',
        '核对标准编号、名称和版本状态',
        '识别引用标准之间的冲突与废止项',
      ],
    };

    return defaults[docType] || [
      '检查文档结构与关键字段完整性',
      '检查专业术语、参数和描述一致性',
      '检查规范引用和潜在合规风险',
    ];
  }

  private static getDefaultCorePurposes(docType: string): string[] {
    const defaults: Record<string, string[]> = {
      contract: [
        '降低合同履约与法律争议风险',
        '确保条款合法、明确且责任对等',
      ],
      specification: [
        '确保技术要求可执行且满足标准',
        '避免参数缺失或约束不明确',
      ],
      bom: [
        '确保设备材料清单准确可采购',
        '避免规格、数量和标准引用错误',
      ],
      engineering_design: [
        '确保设计说明满足规范和安全要求',
        '降低设计参数冲突和遗漏风险',
      ],
      drawing: [
        '确保图纸表达准确完整',
        '降低施工和交付阶段误解风险',
      ],
      standard: [
        '确保标准引用有效且适用',
        '避免引用废止或错误版本标准',
      ],
    };

    return defaults[docType] || [
      '确保文档内容准确、完整、可审查',
      '降低规范遗漏和理解偏差风险',
    ];
  }

  private static detectDocType(
    fileNames: string[],
    extensions: string[],
  ): { type: string; label: string; perspective?: string } {
    const combined = fileNames.join(' ').toLowerCase();

    for (const rule of DOC_TYPE_RULES) {
      const keywordHit = rule.keywords.some(keyword => combined.includes(keyword));
      const extHit = extensions.some(ext => rule.extensions.includes(ext));
      if (keywordHit || (extHit && rule.extensions.length <= 3)) {
        return { type: rule.type, label: rule.label, perspective: rule.perspective };
      }
    }

    if (extensions.includes('dwg') || extensions.includes('dxf')) {
      return { type: 'drawing', label: '工程图纸', perspective: 'designer' };
    }
    if (extensions.includes('xls') || extensions.includes('xlsx') || extensions.includes('csv')) {
      return { type: 'bom', label: '设备材料清单（BOM）', perspective: 'builder' };
    }
    if (extensions.includes('pdf') || extensions.includes('doc') || extensions.includes('docx')) {
      return { type: 'general', label: '通用文档', perspective: 'general' };
    }

    return { type: 'general', label: '通用文档', perspective: 'general' };
  }

  private static matchCategory(
    categories: Array<{ id: string; name: string; description: string | null }>,
    docType: string,
    fileNames: string[],
  ): { id: string; name: string } | null {
    if (categories.length === 0) return null;

    const combined = fileNames.join(' ').toLowerCase();
    for (const category of categories) {
      const name = category.name.toLowerCase();
      if (docType === 'standard' && (name.includes('标准') || name.includes('规范'))) return category;
      if (docType === 'contract' && name.includes('合同')) return category;
      if (docType === 'bom' && (name.includes('材料') || name.includes('设备'))) return category;
      if (docType === 'engineering_design' && (name.includes('设计') || name.includes('说明'))) return category;
      if (combined.includes(name.slice(0, 2))) return category;
    }
    return categories[0];
  }

  private static matchRuleLibrary(
    libraries: Array<{ id: string; name: string; description: string | null }>,
    docType: string,
  ): { id: string; name: string } | null {
    if (libraries.length === 0) return null;

    for (const library of libraries) {
      const name = library.name.toLowerCase();
      if (docType === 'contract' && name.includes('合同')) return library;
      if (docType === 'bom' && (name.includes('材料') || name.includes('清单'))) return library;
      if (docType === 'engineering_design' && (name.includes('设计') || name.includes('规范'))) return library;
      if (docType === 'standard' && name.includes('标准')) return library;
    }

    return null;
  }
}
