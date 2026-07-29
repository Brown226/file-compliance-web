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

import prisma from '../../config/db';
import { BUILTIN_TEMPLATES, getPromptFallback } from '../prompts';

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
  typo_grammar: '基础校对',
  doc_review: '以文审文',
  multimodal: '结构化审查',
  ocr: 'OCR文字识别',
  rule_library: '规则库AI解析',
  review_specification: '规范集AI解析',
  pre_analysis: '文件预分析',
  contextual_retrieval: '上下文检索增强',
  polish: 'AI润色',
  semantic_spec: '语义规范库审查',
  dwg_vision: 'DWG视觉审查',
};

// ==================== 服务类 ====================

export class PromptTemplateService {

  /**
   * 初始化内置模板（upsert，不会覆盖已有自定义内容）
   */
  static async seedBuiltinTemplates(): Promise<{ created: number; updated: number }> {
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

    console.log(`[PromptTemplate] 内置模板初始化完成: ${BUILTIN_TEMPLATES.length} 个模板`);

    await this.cleanupDeprecatedModules();

    return { created: BUILTIN_TEMPLATES.length, updated: 0 };
  }

  private static async cleanupDeprecatedModules(): Promise<void> {
    const deprecatedModules = ['llm_direct', 'rag_review', 'legacy_maxkb', 'maxkb_rag', 'maxkb_app', 'qa', 'langchain_qa'];

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

    // 从 registry 获取最新默认值（而非 DB 中可能已过期的 defaultValue）
    const latestDefault = getPromptFallback(tpl.module, tpl.role, tpl.variant) || (tpl as any).defaultValue || '';
    if (!latestDefault) throw new Error(`模板没有默认值: ${key}`);

    return prisma.promptTemplate.update({
      where: { key },
      data: { content: latestDefault, defaultValue: latestDefault },
    }) as any;
  }

  static async resetAllToDefault(): Promise<{ count: number }> {
    const templates = await prisma.promptTemplate.findMany({
      where: { isBuiltin: true },
    });

    let count = 0;
    for (const tpl of templates) {
      // 从 registry 获取最新默认值
      const latestDefault = getPromptFallback(tpl.module, tpl.role, tpl.variant);
      if (latestDefault) {
        await prisma.promptTemplate.update({
          where: { key: tpl.key },
          data: { content: latestDefault, defaultValue: latestDefault },
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

  /**
   * 按场景获取提示词（含元数据），供 PromptLoader 判断用户是否修改过
   */
  static async getPromptBySceneWithMeta(
    module: string,
    role: 'system' | 'user',
    variant: string = 'default',
  ): Promise<{ content: string; defaultValue: string } | null> {
    try {
      const tpl = await prisma.promptTemplate.findFirst({
        where: { module, role, variant, enabled: true },
      });
      if (tpl && tpl.content) {
        return {
          content: tpl.content,
          defaultValue: (tpl as any).defaultValue || '',
        };
      }
      if (variant !== 'default') {
        const defaultTpl = await prisma.promptTemplate.findFirst({
          where: { module, role, variant: 'default', enabled: true },
        });
        if (defaultTpl && defaultTpl.content) {
          return {
            content: defaultTpl.content,
            defaultValue: (defaultTpl as any).defaultValue || '',
          };
        }
      }
    } catch (e) {
      console.warn(`[PromptTemplate] 读取场景模板元数据 ${module}/${role}/${variant} 失败:`, e);
    }
    return null;
  }

  private static _promptCache = new Map<string, { content: string; timestamp: number }>();
  private static readonly PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  static async getPromptByScene(
    module: string,
    role: 'system' | 'user',
    variant: string = 'default',
    fallback?: string,
  ): Promise<string> {
    const cacheKey = `${module}/${role}/${variant}`;

    // 检查缓存
    const cached = this._promptCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.PROMPT_CACHE_TTL) {
      return cached.content;
    }

    try {
      const tpl = await prisma.promptTemplate.findFirst({
        where: { module, role, variant, enabled: true },
      });
      if (tpl && tpl.content) {
        this._promptCache.set(cacheKey, { content: tpl.content, timestamp: Date.now() });
        return tpl.content;
      }
      if (variant !== 'default') {
        const defaultTpl = await prisma.promptTemplate.findFirst({
          where: { module, role, variant: 'default', enabled: true },
        });
        if (defaultTpl && defaultTpl.content) {
          const defaultCacheKey = `${module}/${role}/default`;
          this._promptCache.set(defaultCacheKey, { content: defaultTpl.content, timestamp: Date.now() });
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
