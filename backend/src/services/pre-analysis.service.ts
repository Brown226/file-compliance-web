import prisma from '../config/db';
import { ParserService } from './parser.service';
import { LlmService } from './llm.service';

export interface PreAnalysisResult {
  documentType: string;
  documentTypeLabel: string;
  contractType?: string;
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
}

const DOC_TYPE_RULES: Array<{
  keywords: string[];
  extensions: string[];
  type: string;
  label: string;
  perspective?: string;
}> = [
  { keywords: ['合同', '协议', 'contract'], extensions: ['doc', 'docx'], type: 'contract', label: '合同文档', perspective: 'builder' },
  { keywords: ['新闻', '通讯', '报道', '稿'], extensions: ['doc', 'docx'], type: 'news', label: '新闻稿' },
  { keywords: ['申报', '申请', '立项'], extensions: ['doc', 'docx', 'pdf'], type: 'declaration', label: '申报书' },
  { keywords: ['规格', 'spec', 'specification'], extensions: ['doc', 'docx', 'pdf'], type: 'specification', label: '规格书', perspective: 'designer' },
  { keywords: ['周报', '日报', '月报', '汇报', '总结'], extensions: ['doc', 'docx'], type: 'report', label: '工作报告' },
  { keywords: ['规划', '方案', '计划'], extensions: ['doc', 'docx', 'pdf'], type: 'plan', label: '规划方案' },
  { keywords: ['标准', '规范', 'gb', 'gbt', 'code'], extensions: ['doc', 'docx', 'pdf'], type: 'standard', label: '标准规范' },
  { keywords: ['图纸', 'drawing', 'dwg', 'dxf'], extensions: ['dwg', 'dxf'], type: 'drawing', label: '工程图纸', perspective: 'designer' },
];

/**
 * 预分析服务 — 分析文件元信息，推荐审查方案
 */
export class PreAnalysisService {

  /**
   * 分析上传的文件列表，返回智能推荐
   */
  static async analyzeFiles(files: Array<{ name: string; size: number }>): Promise<PreAnalysisResult> {
    const fileNames = files.map(f => f.name);
    const extensions = fileNames.map(n => n.split('.').pop()?.toLowerCase() || '');
    const hasMultipleFiles = files.length > 1;
    const hasDwg = extensions.some(e => ['dwg', 'dxf'].includes(e));

    // 1. 识别文档类型
    const docType = this.detectDocType(fileNames, extensions);

    // 2. 查询可用的知识库子库和规则库
    const [categories, ruleLibs] = await Promise.all([
      prisma.knowledgeCategory.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, description: true } }),
      prisma.ruleLibrary.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, name: true, description: true } }),
    ]);

    // 3. 匹配推荐的知识库子库
    const matchedCategory = this.matchCategory(categories, docType.type, fileNames);

    // 4. 匹配推荐的规则库
    const matchedRuleLib = this.matchRuleLibrary(ruleLibs, docType.type);

    // 5. 尝试调用LLM进行智能预分析（提取审查点和核心目的）
    let llmAnalysis: { contractType?: string; suggestedReviewPoints?: string[]; suggestedCorePurposes?: string[]; potentialParties?: string[] } = {};
    try {
      console.log('[PreAnalysis] 开始LLM智能分析...');
      // 只分析第一个文件（避免过长）
      const firstFile = files[0];
      const fileType = firstFile.name.split('.').pop()?.toLowerCase() || '';
      const filePath = `uploads/${firstFile.name}`;
      
      console.log(`[PreAnalysis] 文件: ${firstFile.name}, 类型: ${fileType}, 路径: ${filePath}`);
      
      // 只处理支持的文件类型
      if (['doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx'].includes(fileType)) {
        const fileText = await ParserService.parseFile(filePath, fileType);
        
        if (fileText && fileText.length > 100) {
          console.log(`[PreAnalysis] 文件文本长度: ${fileText.length} 字符`);
          
          const prompt = `你是专业的文档审查助手。请分析以下文档内容，返回JSON格式的结果：
{
  "contractType": "文档类型",
  "potentialParties": ["可能的审查立场/角色"],
  "suggestedReviewPoints": ["关键审查点（至少5个，要具体且贴合文档类型）"],
  "suggestedCorePurposes": ["核心审查目的（至少3个，要具体明确）"]
}

要求：
- 审查点必须具体，优先贴合文档类型和内容
- 核心审查目的要明确、可操作
- 不要输出自然语言解释，只输出JSON

文档内容：
---
${fileText.substring(0, 3000)}
---`;

          console.log('[PreAnalysis] 调用LLM API...');
          const startTime = Date.now();
          const llmResponse = await LlmService.chat(prompt, { maxTokens: 2048, timeout: 30 }); // 30秒超时
          const elapsed = Date.now() - startTime;
          console.log(`[PreAnalysis] LLM响应完成，耗时: ${elapsed}ms`);
          
          // 尝试解析JSON响应
          const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            llmAnalysis = JSON.parse(jsonMatch[0]);
            console.log('[PreAnalysis] LLM分析成功:', {
              contractType: llmAnalysis.contractType,
              reviewPoints: llmAnalysis.suggestedReviewPoints?.length || 0,
              corePurposes: llmAnalysis.suggestedCorePurposes?.length || 0
            });
          } else {
            console.warn('[PreAnalysis] LLM响应中未找到JSON');
          }
        } else {
          console.warn('[PreAnalysis] 文件文本过短，跳过LLM分析');
        }
      } else {
        console.warn(`[PreAnalysis] 不支持的文件类型: ${fileType}`);
      }
    } catch (error) {
      console.warn('[PreAnalysis] LLM分析失败，使用默认配置:', error);
    }

    // 6. 组装推荐结果
    return {
      documentType: docType.type,
      documentTypeLabel: docType.label,
      contractType: llmAnalysis.contractType || docType.label,
      potentialParties: llmAnalysis.potentialParties || [],
      suggestedReviewPoints: llmAnalysis.suggestedReviewPoints || this.getDefaultReviewPoints(docType.type),
      suggestedCorePurposes: llmAnalysis.suggestedCorePurposes || this.getDefaultCorePurposes(docType.type),
      suggestedPerspective: docType.perspective,
      recommendations: {
        libraryReview: {
          enabled: !!matchedCategory,
          categoryId: matchedCategory?.id,
          reason: matchedCategory
            ? `识别为"${docType.label}"，推荐使用"${matchedCategory.name}"知识库`
            : '未匹配到适合的知识库子库',
        },
        docReview: {
          enabled: false,
          reason: '上传参照文件后自动启用',
        },
        ruleLibrary: {
          enabled: !!matchedRuleLib,
          libraryId: matchedRuleLib?.id,
          reason: matchedRuleLib
            ? `识别为"${docType.label}"，推荐使用"${matchedRuleLib.name}"规则库`
            : '未匹配到适合的规则库',
        },
        generalChecks: {
          ruleCheck: { enabled: true, reason: '格式、命名、编码等基础规则检查' },
          typoCheck: {
            enabled: docType.type !== 'standard' && docType.type !== 'drawing',
            reason: docType.type === 'standard' || docType.type === 'drawing'
              ? '专业术语较多，不推荐错别字检查'
              : '检查错别字、语法错误、术语一致性',
          },
          crossFileCheck: {
            enabled: hasMultipleFiles,
            reason: hasMultipleFiles
              ? `已上传 ${files.length} 个文件，可检查跨文件参数和语义一致性`
              : '需上传 2 个以上文件才能启用',
          },
        },
      },
    };
  }

  /**
   * 获取默认的审查点（当LLM分析失败时使用）
   */
  private static getDefaultReviewPoints(docType: string): string[] {
    const defaults: Record<string, string[]> = {
      contract: [
        '合同主体资格和履约能力',
        '权利义务对等性',
        '违约责任条款',
        '争议解决机制',
        '合同变更和解除条件',
        '付款条款和节点',
      ],
      specification: [
        '技术参数完整性',
        '标准规范符合性',
        '材料规格一致性',
        '测试检验要求',
        '质量保证条款',
      ],
      drawing: [
        '图纸完整性',
        '尺寸标注准确性',
        '材料规格标注',
        '技术标准引用',
        '设计变更说明',
      ],
      standard: [
        '标准适用性',
        '条款完整性',
        '引用标准有效性',
        '技术要求合理性',
      ],
    };
    return defaults[docType] || [
      '文档结构完整性',
      '内容逻辑一致性',
      '关键信息准确性',
      '格式规范符合性',
    ];
  }

  /**
   * 获取默认的核心审查目的（当LLM分析失败时使用）
   */
  private static getDefaultCorePurposes(docType: string): string[] {
    const defaults: Record<string, string[]> = {
      contract: [
        '确保合同条款合法合规',
        '防范法律风险和纠纷',
        '保障双方权利义务对等',
        '明确违约责任和赔偿机制',
      ],
      specification: [
        '确保技术参数满足项目需求',
        '验证标准规范的适用性',
        '保证材料质量和性能指标',
      ],
      drawing: [
        '确保设计符合规范要求',
        '验证技术方案的可行性',
        '检查设计文件的完整性',
      ],
      standard: [
        '确保标准条款的科学性',
        '验证技术指标的合理性',
        '保证标准的可操作性',
      ],
    };
    return defaults[docType] || [
      '确保文档内容完整准确',
      '符合相关法规标准要求',
      '降低潜在风险和纠纷',
    ];
  }

  /**
   * 基于文件名关键词和扩展名识别文档类型
   */
  private static detectDocType(
    fileNames: string[],
    extensions: string[],
  ): { type: string; label: string; perspective?: string } {
    const combined = fileNames.join(' ').toLowerCase();

    for (const rule of DOC_TYPE_RULES) {
      const keywordHit = rule.keywords.some(kw => combined.includes(kw));
      const extHit = extensions.some(ext => rule.extensions.includes(ext));
      if (keywordHit || (extHit && rule.extensions.length <= 2)) {
        return { type: rule.type, label: rule.label, perspective: rule.perspective };
      }
    }

    // 默认
    if (extensions.includes('dwg') || extensions.includes('dxf')) {
      return { type: 'drawing', label: '工程图纸', perspective: 'designer' };
    }
    return { type: 'general', label: '通用文档' };
  }

  /**
   * 匹配最相关的知识库子库
   */
  private static matchCategory(
    categories: Array<{ id: string; name: string; description: string | null }>,
    docType: string,
    fileNames: string[],
  ): { id: string; name: string } | null {
    if (categories.length === 0) return null;

    const combined = fileNames.join(' ').toLowerCase();

    // 按名称关键词匹配
    for (const cat of categories) {
      const name = cat.name.toLowerCase();
      if (docType === 'standard' && (name.includes('标准') || name.includes('规范'))) return cat;
      if (docType === 'contract' && name.includes('合同')) return cat;
      if (docType === 'news' && name.includes('新闻')) return cat;
      if (docType === 'declaration' && (name.includes('申报') || name.includes('模板'))) return cat;
      if (docType === 'specification' && name.includes('规格')) return cat;
      if (combined.includes(name.slice(0, 2))) return cat;
    }

    // 默认返回第一个
    return categories[0];
  }

  /**
   * 匹配最相关的规则库
   */
  private static matchRuleLibrary(
    libraries: Array<{ id: string; name: string; description: string | null }>,
    docType: string,
  ): { id: string; name: string } | null {
    if (libraries.length === 0) return null;

    for (const lib of libraries) {
      const name = lib.name.toLowerCase();
      if (docType === 'news' && name.includes('新闻')) return lib;
      if (docType === 'contract' && name.includes('合同')) return lib;
      if (docType === 'declaration' && name.includes('申报')) return lib;
    }

    return null;
  }
}
