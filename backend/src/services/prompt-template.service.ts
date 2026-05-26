/**
 * 提示词模板管理服务
 *
 * 核心设计：
 * - module = 审查场景（与 Pipeline ReviewMode 一一对应）
 * - role = 提示词角色（system 定义角色和规则，user 填入变量数据）
 * - variant = 用户提示词变体（with_context / no_context 等，按数据来源区分）
 * - 引擎策略（RAG/LLM）是 Pipeline 运行时决策，不污染提示词分类
 *
 * 场景 → Pipeline 映射：
 * - library_review  → LIBRARY_REVIEW, CONSISTENCY
 * - consistency     → CONSISTENCY
 * - typo_grammar    → TYPO_GRAMMAR
 * - doc_review      → DOC_REVIEW
 * - multimodal      → MULTIMODAL
 * - ocr             → OCR（不经过 Pipeline）
 *
 * ⚠️ 提示词内容唯一数据源：services/prompts/registry.ts
 *    本文件仅负责 DB CRUD 操作，不再内联模板内容。
 */

import prisma from '../config/db';
import { BUILTIN_TEMPLATES } from './prompts';

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
  library_review: '以库审文',
  consistency: '一致性审查',
  typo_grammar: '错别字/语法',
  doc_review: '以文审文',
  multimodal: '多模态审查',
  ocr: 'OCR文字识别',
  rule_library: '规则库AI解析',
  review_specification: '规范集AI解析',
  pre_analysis: '文件预分析',
  contextual_retrieval: '上下文检索增强',
  qa: '智能问答',
  langchain_qa: 'LangChain问答',
  semantic_spec: '语义规范库审查',
};

// ==================== 服务类 ====================

export class PromptTemplateService {

  /**
   * 初始化内置模板（upsert，不会覆盖已有自定义内容）
   */
  static async seedBuiltinTemplates(): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const tpl of BUILTIN_TEMPLATES) {
      const existing = await prisma.promptTemplate.findUnique({ where: { key: tpl.key } });
      const shouldUpdateContent = existing && existing.defaultValue === tpl.content ? false : true;

      const result = await prisma.promptTemplate.upsert({
        where: { key: tpl.key },
        update: {
          module: tpl.module,
          role: tpl.role,
          variant: tpl.variant,
          name: tpl.name,
          description: tpl.description,
          placeholders: tpl.placeholders,
          defaultValue: tpl.content,
          isBuiltin: true,
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

    const totalInDb = await prisma.promptTemplate.count({ where: { isBuiltin: true } });
    created = Math.max(0, totalInDb - (updated - (BUILTIN_TEMPLATES.length - totalInDb > 0 ? 0 : 0)));

    console.log(`[PromptTemplate] 内置模板初始化完成: ${BUILTIN_TEMPLATES.length} 个模板`);

    await this.cleanupDeprecatedModules();

    return { created: BUILTIN_TEMPLATES.length, updated: 0 };
  }

  private static async cleanupDeprecatedModules(): Promise<void> {
    const deprecatedModules = ['llm_direct', 'rag_review', 'legacy_maxkb', 'maxkb_rag', 'maxkb_app'];

    for (const mod of deprecatedModules) {
      try {
        const deleted = await prisma.promptTemplate.deleteMany({ where: { module: mod } });
        if (deleted.count > 0) {
          console.log(`[PromptTemplate] 已清理废弃模块 ${mod}: ${deleted.count} 条`);
        }
      } catch (e) {
        console.warn(`[PromptTemplate] 清理废弃模块 ${mod} 失败:`, e);
      }
    }
  }

  static async listAll(): Promise<PromptTemplateData[]> {
    const templates = await prisma.promptTemplate.findMany({
      orderBy: [{ module: 'asc' }, { role: 'asc' }, { variant: 'asc' }],
    });
    return templates as any;
  }

  static async listByModule(module: string): Promise<PromptTemplateData[]> {
    return prisma.promptTemplate.findMany({
      where: { module },
      orderBy: [{ role: 'asc' }, { variant: 'asc' }],
    }) as any;
  }

  static async getByKey(key: string): Promise<PromptTemplateData | null> {
    return prisma.promptTemplate.findUnique({ where: { key } }) as any;
  }

  static async updateContent(key: string, content: string): Promise<PromptTemplateData> {
    return prisma.promptTemplate.update({
      where: { key },
      data: { content },
    }) as any;
  }

  static async resetToDefault(key: string): Promise<PromptTemplateData> {
    const tpl = await prisma.promptTemplate.findUnique({ where: { key } });
    if (!tpl) throw new Error(`模板不存在: ${key}`);
    if (!tpl.defaultValue) throw new Error(`模板没有默认值: ${key}`);

    return prisma.promptTemplate.update({
      where: { key },
      data: { content: tpl.defaultValue },
    }) as any;
  }

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

  static async toggleEnabled(key: string, enabled: boolean): Promise<PromptTemplateData> {
    return prisma.promptTemplate.update({
      where: { key },
      data: { enabled },
    }) as any;
  }

  // ==================== 运行时动态加载 ====================

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
