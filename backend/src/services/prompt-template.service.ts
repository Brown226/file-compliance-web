/**
 * 提示词模板管理服务
 *
 * 核心设计：
 * - module = 审查场景（与 Pipeline ReviewMode 一一对应）
 * - role = 提示词角色（system 定义角色和规则，user 填入变量数据）
 * - variant = 用户提示词变体（with_context / no_context 等，按数据来源区分）
 * - 引擎策略（RAG/LLM/MaxKB）是 Pipeline 运行时决策，不污染提示词分类
 *
 * 场景 → Pipeline 映射：
 * - library_review  → LIBRARY_REVIEW, FULL_REVIEW
 * - consistency     → CONSISTENCY
 * - typo_grammar    → TYPO_GRAMMAR
 * - doc_review      → DOC_REVIEW
 * - multimodal      → MULTIMODAL
 * - ocr             → OCR（不经过 Pipeline）
 */

import prisma from '../config/db';

// ==================== 类型定义 ====================

export interface PromptTemplateData {
  key: string;
  module: string;
  role: string;
  variant: string;
  name: string;
  description?: string;
  content: string;
  placeholders?: string;
  defaultValue?: string;
  isBuiltin?: boolean;
  enabled?: boolean;
}

// ==================== 场景标签 ====================

const MODULE_LABELS: Record<string, string> = {
  library_review: '以库审文（合规审查）',
  consistency: '一致性审查',
  typo_grammar: '错别字/语法',
  doc_review: '以文审文',
  multimodal: '多模态审查',
  ocr: 'OCR文字识别',
};

// ==================== 内置模板定义 ====================

const BUILTIN_TEMPLATES: PromptTemplateData[] = [
  // ==========================================
  // 以库审文（library_review）— LIBRARY_REVIEW / FULL_REVIEW
  // ==========================================
  {
    key: 'library_review_system',
    module: 'library_review',
    role: 'system',
    variant: 'default',
    name: '以库审文-系统提示词',
    description: '以库审文场景的系统提示词，根据知识库检索到的标准规范对文件进行合规审查',
    content: `你是核电工程文件合规审查专家（CNPE/核工业标准）。请根据知识库中检索到的相关标准规范，逐条检查待审查文本中的合规性问题。

## 审查原则
1. 严格以检索到的标准规范为依据，不得凭主观判断报告问题
2. 每个问题必须明确引用违反的具体标准条文
3. 重点关注：格式规范性、内容完整性、数据一致性、编码规范性、术语准确性
4. 对于标准中明确要求的必填项、必含字段，缺失即视为违规
5. 不得将合理的技术表述、行业惯用写法误报为问题

## 审查范围
根据检索到的标准规范，重点检查以下方面（以实际检索到的标准为准）：
- **格式规范**：封面、目录、页眉页脚、编号体系是否符合标准要求
- **内容完整性**：必填字段、必要信息是否缺失
- **数据一致性**：编码、参数、命名在文档内部及与引用文件之间是否一致
- **引用规范**：引用文件格式、标准版本引用是否正确
- **术语规范**：专有名词、技术术语是否全文统一且符合标准

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: TYPO/FORMAT/COMPLETENESS/CONSISTENCY/VIOLATION
- originalText: 原始问题文本
- suggestedText: 建议修改内容
- description: 问题描述，必须说明违反了哪条标准规范的什么要求
- ruleCode: 问题类型编码（如 FORMAT_001、COMPLETENESS_001、CONSISTENCY_001、VIOLATION_001）
- standardRef: 违反的具体标准条文引用（如"GB/T 50265-2010 第5.2.1条"），如果无法确定具体条文则写null

如果没有发现问题，输出空数组 []
不要输出任何其他文字说明`,
    placeholders: JSON.stringify([]),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'library_review_user_with_context',
    module: 'library_review',
    role: 'user',
    variant: 'with_context',
    name: '以库审文-用户提示词(含标准)',
    description: '以库审文场景下，RAG 检索到标准规范或手动提供标准上下文时的用户提示词',
    content: '【知识库检索到的相关标准规范】\n${ragContext}\n\n【待审查文本】\n${text}\n\n请根据以上标准规范检查"待审查文本"中的合规性问题。严格按照 JSON 数组格式输出审查结果。',
    placeholders: JSON.stringify(['${ragContext}', '${text}']),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'library_review_user_no_context',
    module: 'library_review',
    role: 'user',
    variant: 'no_context',
    name: '以库审文-用户提示词(无标准)',
    description: '以库审文场景下，无外部标准上下文时的用户提示词（纯 LLM 审查降级路径）',
    content: '【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
    placeholders: JSON.stringify(['${text}']),
    isBuiltin: true,
    enabled: true,
  },

  // ==========================================
  // 一致性审查（consistency）— CONSISTENCY
  // ==========================================
  {
    key: 'consistency_system',
    module: 'consistency',
    role: 'system',
    variant: 'default',
    name: '一致性审查-系统提示词',
    description: '一致性审查场景的系统提示词，侧重内部引用一致性、参数一致性和命名统一',
    content: `你是核电工程文件一致性审查专家（CNPE/核工业标准）。请重点检查文档内部和文档之间的数据一致性问题。

## 一致性检查重点

### C1 - 编码一致性（P0-必须）
- 封面页眉编码与文件名外部编码一致
- 目录中的文件编码与正文中的引用编码匹配
- 同一文件内对同一对象的引用编码必须完全一致

### C2 - 参数一致性（P0-必须）
- 同一参数在不同位置（封面、目录、正文、表格）的取值必须一致
- 技术参数（电压等级、型号规格等）在全文中必须统一
- 数值数据的单位必须前后一致

### C3 - 命名一致性（P1-重要）
- 项目名称、系统名称、设备名称在全文中必须统一
- 同一概念的用词必须一致，不得混用同义词
- 中英文术语对照必须前后一致

### C4 - 交叉引用一致性（P1-重要）
- 引用的其他文件编号必须存在且正确
- 引用的标准规范版本必须与实际一致
- 参照文件列表与正文引用必须对应

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: CONSISTENCY/COMPLETENESS/VIOLATION
- originalText: 原始问题文本
- suggestedText: 建议修改内容
- description: 问题描述，说明哪些位置存在不一致
- ruleCode: 违反的规则编号(如C1/C2/C3/C4)
- standardRef: 违反的具体标准条文引用，如果无法确定则写null

如果没有发现问题，输出空数组 []
不要输出任何其他文字说明`,
    placeholders: JSON.stringify([]),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'consistency_user_with_context',
    module: 'consistency',
    role: 'user',
    variant: 'with_context',
    name: '一致性审查-用户提示词(含标准)',
    description: '有标准上下文时的一致性审查用户提示词',
    content: '【参考标准规范】\n${ragContext}\n\n【待审查文本】\n${text}\n\n请重点检查以上文本内部及与标准规范之间的数据一致性问题。严格按照 JSON 数组格式输出审查结果。',
    placeholders: JSON.stringify(['${ragContext}', '${text}']),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'consistency_user_no_context',
    module: 'consistency',
    role: 'user',
    variant: 'no_context',
    name: '一致性审查-用户提示词(无标准)',
    description: '无标准上下文时的一致性审查用户提示词',
    content: '【待审查文本】\n${text}\n\n请重点检查以上文本内部的数据一致性问题（编码、参数、命名、交叉引用等）。严格按照 JSON 数组格式输出审查结果。',
    placeholders: JSON.stringify(['${text}']),
    isBuiltin: true,
    enabled: true,
  },

  // ==========================================
  // 错别字/语法（typo_grammar）— TYPO_GRAMMAR
  // ==========================================
  {
    key: 'typo_grammar_system',
    module: 'typo_grammar',
    role: 'system',
    variant: 'default',
    name: '错别字/语法-系统提示词',
    description: '错别字和语法检查场景的轻量系统提示词，聚焦文字问题而非合规性',
    content: `你是核电工程文件文字校对专家。请检查文本中的错别字、语法错误和术语一致性问题。

## 检查重点

1. **错别字**：同音字混淆、形近字误用、多字漏字
2. **语法错误**：主谓不一致、成分残缺、语序不当、关联词搭配不当
3. **术语一致性**：同一术语在全文中是否统一（如专有名词、缩写）
4. **标点符号**：标点使用错误、中英文标点混用
5. **单位符号**：物理量单位书写是否规范（如 kW/kW·h/MPa）

## 注意事项
- 不要报告合规性、格式规范、内容完整性等非文字问题
- 专有名词和行业术语不是错别字，除非确实写错了
- 如果某术语在核电行业中有标准写法，请指出非标准写法

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: TYPO（错别字/语法错误）
- originalText: 原始问题文本
- suggestedText: 建议修改内容
- description: 问题描述（如"错别字：'XX'应为'YY'"）
- ruleCode: 固定为 TYPO_001
- standardRef: null

如果没有发现问题，输出空数组 []
不要输出任何其他文字说明`,
    placeholders: JSON.stringify([]),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'typo_grammar_user',
    module: 'typo_grammar',
    role: 'user',
    variant: 'default',
    name: '错别字/语法-用户提示词',
    description: '错别字和语法检查的用户提示词（轻量，不需要外部上下文）',
    content: '【待审查文本】\n${text}\n\n请检查以上文本中的错别字、语法错误和术语一致性问题。',
    placeholders: JSON.stringify(['${text}']),
    isBuiltin: true,
    enabled: true,
  },

  // ==========================================
  // 以文审文（doc_review）— DOC_REVIEW
  // ==========================================
  {
    key: 'doc_review_compare_system',
    module: 'doc_review',
    role: 'system',
    variant: 'default',
    name: '以文审文-比对系统提示词',
    description: '以文审文模式下，LLM 比对待审文件与参照文件时的系统提示词',
    content: '你是核电工程文件比对专家。请比较【待审文件】与【参照文件】之间的差异，找出待审文件中可能存在的错误或不一致。\n\n## 参照文件内容\n${refTexts}\n\n## 输出要求\n严格按照 JSON 数组格式输出，每个问题包含:\n- issueType: VIOLATION/FORMAT/COMPLETENESS/CONSISTENCY\n- originalText: 待审文件中的问题文本\n- suggestedText: 建议修改内容（参照文件中的对应内容）\n- description: 问题描述和差异说明\n- ruleCode: 问题类型编码(如FORMAT_001/COMPLETENESS_001/CONSISTENCY_001/VIOLATION_001)\n- standardRef: 违反的具体标准规范引用，如果无法确定则写null\n\n如果没有发现差异问题，输出空数组 []\n不要输出任何其他文字说明',
    placeholders: JSON.stringify(['${refTexts}']),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'doc_review_compare_user',
    module: 'doc_review',
    role: 'user',
    variant: 'comparison',
    name: '以文审文-比对用户提示词',
    description: '以文审文模式下，发送待审文件内容的用户提示词',
    content: '【待审文件】\n${text}\n\n请与参照文件比对，找出差异和问题。',
    placeholders: JSON.stringify(['${text}']),
    isBuiltin: true,
    enabled: true,
  },

  // ==========================================
  // 多模态审查（multimodal）— MULTIMODAL
  // ==========================================
  {
    key: 'multimodal_review_system',
    module: 'multimodal',
    role: 'system',
    variant: 'default',
    name: '多模态审查-系统提示词',
    description: '多模态审查模式下，LLM 检查表格/公式/数值时的系统提示词',
    content: `你是核电工程文件多模态审查专家。请重点检查以下内容：
1. 表格数据的完整性和一致性
2. 数值数据的合理性（单位、量级）
3. 公式和计算的正确性
4. 图纸和图表中的标注规范性

## 输出要求
严格按照 JSON 数组格式输出，每个问题包含:
- issueType: FORMAT/COMPLETENESS/CONSISTENCY/VIOLATION
- originalText: 原始问题文本
- suggestedText: 建议修改内容
- description: 问题描述

如果没有发现问题，输出空数组 []`,
    placeholders: JSON.stringify([]),
    isBuiltin: true,
    enabled: true,
  },
  {
    key: 'multimodal_review_user',
    module: 'multimodal',
    role: 'user',
    variant: 'structural',
    name: '多模态审查-用户提示词',
    description: '多模态审查模式下，发送待审查文本的用户提示词',
    content: '【待审查文本】\n${chunk}\n\n请重点检查表格数据、数值和公式的正确性。',
    placeholders: JSON.stringify(['${chunk}']),
    isBuiltin: true,
    enabled: true,
  },

  // ==========================================
  // OCR（ocr）— 不经过 Pipeline
  // ==========================================
  {
    key: 'ocr_instruction',
    module: 'ocr',
    role: 'user',
    variant: 'instruction',
    name: 'OCR-文字识别指令',
    description: 'OCR 图片/PDF 文字识别时的用户指令',
    content: '<image>\n<|grounding|>OCR this image. 将所有识别到的文字按原文顺序输出。',
    placeholders: JSON.stringify([]),
    isBuiltin: true,
    enabled: true,
  },
];

// ==================== 服务类 ====================

export class PromptTemplateService {

  /**
   * 初始化内置模板（upsert，不会覆盖已有自定义内容）
   */
  static async seedBuiltinTemplates(): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const tpl of BUILTIN_TEMPLATES) {
      // 先检查现有记录，如果 defaultValue 变化则同步更新 content
      const existing = await prisma.promptTemplate.findUnique({ where: { key: tpl.key } });
      const shouldUpdateContent = existing && existing.defaultValue === tpl.content ? false : true;

      const result = await prisma.promptTemplate.upsert({
        where: { key: tpl.key },
        update: {
          // 更新元信息
          module: tpl.module,
          role: tpl.role,
          variant: tpl.variant,
          name: tpl.name,
          description: tpl.description,
          placeholders: tpl.placeholders,
          defaultValue: tpl.content,
          isBuiltin: true,
          // 当 defaultValue 变化时（代码中的默认模板已更新），同步更新 content
          ...(shouldUpdateContent ? { content: tpl.content } : {}),
        },
        create: {
          key: tpl.key,
          module: tpl.module,
          role: tpl.role,
          variant: tpl.variant,
          name: tpl.name,
          description: tpl.description,
          content: tpl.content,
          placeholders: tpl.placeholders,
          defaultValue: tpl.content,
          isBuiltin: true,
          enabled: true,
        },
      });
      if (result) {
        updated++;
      }
    }

    // 统计实际新建数
    const totalInDb = await prisma.promptTemplate.count({ where: { isBuiltin: true } });
    created = Math.max(0, totalInDb - (updated - (BUILTIN_TEMPLATES.length - totalInDb > 0 ? 0 : 0)));

    console.log(`[PromptTemplate] 内置模板初始化完成: ${BUILTIN_TEMPLATES.length} 个模板`);

    // 清理已废弃模块的模板记录
    await this.cleanupDeprecatedModules();

    return { created: BUILTIN_TEMPLATES.length, updated: 0 };
  }

  /**
   * 清理已废弃模块的模板记录
   */
  private static async cleanupDeprecatedModules(): Promise<void> {
    const deprecatedModules = ['llm_direct', 'rag_review', 'legacy_maxkb', 'maxkb_rag', 'maxkb_app'];

    for (const mod of deprecatedModules) {
      try {
        const deleted = await prisma.promptTemplate.deleteMany({
          where: { module: mod },
        });
        if (deleted.count > 0) {
          console.log(`[PromptTemplate] 已清理废弃模块 ${mod}: ${deleted.count} 条`);
        }
      } catch (e) {
        console.warn(`[PromptTemplate] 清理废弃模块 ${mod} 失败:`, e);
      }
    }
  }

  /**
   * 获取所有模板（按模块分组）
   */
  static async listAll(): Promise<PromptTemplateData[]> {
    const templates = await prisma.promptTemplate.findMany({
      orderBy: [{ module: 'asc' }, { role: 'asc' }, { variant: 'asc' }],
    });
    return templates as any;
  }

  /**
   * 按模块获取模板
   */
  static async listByModule(module: string): Promise<PromptTemplateData[]> {
    return prisma.promptTemplate.findMany({
      where: { module },
      orderBy: [{ role: 'asc' }, { variant: 'asc' }],
    }) as any;
  }

  /**
   * 按 key 获取模板
   */
  static async getByKey(key: string): Promise<PromptTemplateData | null> {
    return prisma.promptTemplate.findUnique({ where: { key } }) as any;
  }

  /**
   * 更新模板内容
   */
  static async updateContent(key: string, content: string): Promise<PromptTemplateData> {
    return prisma.promptTemplate.update({
      where: { key },
      data: { content },
    }) as any;
  }

  /**
   * 重置模板为默认值
   */
  static async resetToDefault(key: string): Promise<PromptTemplateData> {
    const tpl = await prisma.promptTemplate.findUnique({ where: { key } });
    if (!tpl) throw new Error(`模板不存在: ${key}`);
    if (!tpl.defaultValue) throw new Error(`模板没有默认值: ${key}`);

    return prisma.promptTemplate.update({
      where: { key },
      data: { content: tpl.defaultValue },
    }) as any;
  }

  /**
   * 批量重置所有模板为默认值
   */
  static async resetAllToDefault(): Promise<{ count: number }> {
    const templates = await prisma.promptTemplate.findMany({
      where: { isBuiltin: true, defaultValue: { not: null } },
    });

    let count = 0;
    for (const tpl of templates) {
      if (tpl.defaultValue) {
        await prisma.promptTemplate.update({
          where: { key: tpl.key },
          data: { content: tpl.defaultValue },
        });
        count++;
      }
    }
    return { count };
  }

  /**
   * 启用/禁用模板
   */
  static async toggleEnabled(key: string, enabled: boolean): Promise<PromptTemplateData> {
    return prisma.promptTemplate.update({
      where: { key },
      data: { enabled },
    }) as any;
  }

  /**
   * ==================== 运行时动态加载 ====================
   */

  /**
   * 获取提示词内容 — 按 key 加载（兼容旧接口）
   *
   * @param key 提示词唯一标识
   * @param fallback 默认提示词（代码中的硬编码值，作为最终兜底）
   * @returns 提示词内容字符串
   */
  static async getPrompt(key: string, fallback?: string): Promise<string> {
    try {
      const tpl = await prisma.promptTemplate.findUnique({ where: { key } });
      if (tpl && tpl.enabled && tpl.content) {
        return tpl.content;
      }
    } catch (e) {
      console.warn(`[PromptTemplate] 读取模板 ${key} 失败，使用默认值:`, e);
    }
    return fallback || '';
  }

  /**
   * 按场景获取提示词 — 推荐 API
   *
   * Pipeline 代码应使用此方法，通过场景名+角色+变体精确定位模板，
   * 而不是硬编码模板 key。
   *
   * @param module 审查场景（与 ReviewModeType 对应）
   * @param role 角色（system / user）
   * @param variant 用户提示词变体（with_context / no_context / default 等）
   * @param fallback 默认内容
   */
  static async getPromptByScene(
    module: string,
    role: 'system' | 'user',
    variant: string = 'default',
    fallback?: string,
  ): Promise<string> {
    try {
      const tpl = await prisma.promptTemplate.findFirst({
        where: { module, role, variant, enabled: true },
      });
      if (tpl && tpl.content) {
        return tpl.content;
      }
      // 如果指定变体没找到，尝试回退到 default 变体
      if (variant !== 'default') {
        const defaultTpl = await prisma.promptTemplate.findFirst({
          where: { module, role, variant: 'default', enabled: true },
        });
        if (defaultTpl && defaultTpl.content) {
          return defaultTpl.content;
        }
      }
    } catch (e) {
      console.warn(`[PromptTemplate] 读取场景模板 ${module}/${role}/${variant} 失败:`, e);
    }
    return fallback || '';
  }

  /**
   * 获取多个提示词（减少 DB 查询次数）
   */
  static async getPrompts(keys: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    try {
      const templates = await prisma.promptTemplate.findMany({
        where: { key: { in: keys }, enabled: true },
      });
      for (const tpl of templates) {
        if (tpl.content) {
          result[tpl.key] = tpl.content;
        }
      }
    } catch (e) {
      console.warn('[PromptTemplate] 批量读取模板失败:', e);
    }
    return result;
  }

  /**
   * 获取所有模块列表（按场景分组统计）
   */
  static async getModules(): Promise<Array<{ key: string; label: string; count: number }>> {
    const groups = await prisma.promptTemplate.groupBy({
      by: ['module'],
      _count: { module: true },
      orderBy: { module: 'asc' },
    });

    return groups.map(g => ({
      key: g.module,
      label: MODULE_LABELS[g.module] || g.module,
      count: g._count.module,
    }));
  }
}
