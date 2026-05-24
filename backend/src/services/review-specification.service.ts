/**
 * 审查规范集管理服务
 *
 * 一期目标：
 * - 规范集可发布/撤回/归档
 * - 规范集可作为任务规则来源参与审查
 * - AI 解析支持预览后导入
 *
 * 二期字段先落库，执行能力一期仅实现 BUILTIN_PREFIX 映射。
 */

import prisma from '../config/db';
import { LlmService } from './llm.service';

export type RuleSourceType = 'STANDARD' | 'REVIEW_SPECIFICATION';
export type RuleExecutionType = 'BUILTIN_PREFIX' | 'REGEX' | 'KEYWORD_REQUIRED' | 'KEYWORD_FORBIDDEN' | 'MANUAL';
export type RuleTargetScope = 'FILE_NAME' | 'TEXT' | 'HEADER' | 'TABLE' | 'DWG';

export interface RulePlan {
  specificationId: string;
  enabledPrefixes: string[];
  executableItems: Array<{
    id: string;
    ruleCode?: string | null;
    ruleName?: string | null;
    category?: string | null;
    severity?: string | null;
    executionType: RuleExecutionType;
    builtinPrefix?: string | null;
    targetScope?: RuleTargetScope | null;
  }>;
}

export interface SpecificationPreviewItem {
  ruleCode?: string | null;
  ruleName: string;
  category?: string | null;
  description?: string | null;
  checkMethod?: string | null;
  severity?: string | null;
  executionType: RuleExecutionType;
  builtinPrefix?: string | null;
  targetScope: RuleTargetScope;
  params?: any;
  messageTemplate?: string | null;
  sourceQuote?: string | null;
  sourceLocation?: string | null;
  executable: boolean;
  duplicate: boolean;
}

const CATEGORY_PREFIX_MAP: Record<string, string[]> = {
  NAMING: ['NAME'],
  ENCODING: ['CODE', 'UNIT'],
  ATTRIBUTE: ['ATTR'],
  HEADER: ['HEADER'],
  PAGE: ['PAGE'],
  FORMAT: ['FORMAT', 'LAYOUT'],
  CONSISTENCY: ['CONSIST'],
  COMPLETENESS: ['COMPL'],
  TYPO: ['TYPO'],
  DRAWING: ['DWG'],
  DWG: ['DWG'],
};

function normalizeString(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function normalizeSeverity(value?: string | null): string {
  return ['error', 'warning', 'info'].includes((value || '').toLowerCase())
    ? (value as string).toLowerCase()
    : 'warning';
}

function resolveBuiltinPrefixes(input: {
  category?: string | null;
  ruleCode?: string | null;
  builtinPrefix?: string | null;
}): string[] {
  if (input.builtinPrefix?.trim()) {
    return uniqueStrings([input.builtinPrefix.toUpperCase()]);
  }

  const normalizedCategory = normalizeString(input.category).toUpperCase();
  if (normalizedCategory && CATEGORY_PREFIX_MAP[normalizedCategory]) {
    return CATEGORY_PREFIX_MAP[normalizedCategory];
  }

  const ruleCode = (input.ruleCode || '').toUpperCase();
  const prefix = ruleCode.split('_')[0];
  return CATEGORY_PREFIX_MAP[prefix] || (prefix ? [prefix] : []);
}

function inferExecutionFields(rule: {
  category?: string | null;
  ruleCode?: string | null;
  checkMethod?: string | null;
}): { executionType: RuleExecutionType; builtinPrefix?: string | null; targetScope: RuleTargetScope; executable: boolean } {
  const prefixes = resolveBuiltinPrefixes(rule);
  if (prefixes.length > 0) {
    return {
      executionType: 'BUILTIN_PREFIX',
      builtinPrefix: prefixes[0],
      targetScope: prefixes[0] === 'DWG' ? 'DWG' : 'TEXT',
      executable: true,
    };
  }

  return {
    executionType: 'MANUAL',
    builtinPrefix: null,
    targetScope: 'TEXT',
    executable: false,
  };
}

function buildFallbackPreviewItems(text: string, sourceFileName?: string): SpecificationPreviewItem[] {
  const lower = text.toLowerCase();
  const candidates: SpecificationPreviewItem[] = [];

  const pushCandidate = (item: Partial<SpecificationPreviewItem> & { ruleName: string; ruleCode: string }) => {
    const inferred = inferExecutionFields({
      category: item.category,
      ruleCode: item.ruleCode,
      checkMethod: item.checkMethod,
    });
    candidates.push({
      ruleCode: item.ruleCode,
      ruleName: item.ruleName,
      category: item.category || null,
      description: item.description || null,
      checkMethod: item.checkMethod || null,
      severity: normalizeSeverity(item.severity),
      executionType: inferred.executionType,
      builtinPrefix: item.builtinPrefix || inferred.builtinPrefix || null,
      targetScope: item.targetScope || inferred.targetScope,
      params: null,
      messageTemplate: null,
      sourceQuote: null,
      sourceLocation: sourceFileName || null,
      executable: inferred.executable,
      duplicate: false,
    });
  };

  if (/[命名]|file name|文件名/.test(text) || /naming/.test(lower)) {
    pushCandidate({
      ruleCode: 'NAME_001',
      ruleName: '文件命名规范检查',
      category: 'NAMING',
      description: '根据内置命名规范规则检查文件名格式、字符和版本号。',
      checkMethod: '使用 NAME 前缀规则引擎执行命名检查',
      severity: 'warning',
    });
  }
  if (/[格式]|排版|format/.test(text) || /layout/.test(lower)) {
    pushCandidate({
      ruleCode: 'FORMAT_001',
      ruleName: '格式规范检查',
      category: 'FORMAT',
      description: '根据内置格式规则检查文档结构、版式和常见格式问题。',
      checkMethod: '使用 FORMAT / LAYOUT 前缀规则引擎执行格式检查',
      severity: 'warning',
    });
  }
  if (/[完整]|完整性|缺失|completeness/.test(text) || /complete/.test(lower)) {
    pushCandidate({
      ruleCode: 'COMPL_001',
      ruleName: '完整性检查',
      category: 'COMPLETENESS',
      description: '根据内置完整性规则检查文档中是否存在缺失项或空白内容。',
      checkMethod: '使用 COMPL 前缀规则引擎执行完整性检查',
      severity: 'warning',
    });
  }
  if (/[一致]|统一|consisten/.test(text) || /consistency/.test(lower)) {
    pushCandidate({
      ruleCode: 'CONSIST_001',
      ruleName: '一致性检查',
      category: 'CONSISTENCY',
      description: '根据内置一致性规则检查术语、参数或表述前后一致性。',
      checkMethod: '使用 CONSIST 前缀规则引擎执行一致性检查',
      severity: 'warning',
    });
  }
  if (/[图纸]|dwg|图层|尺寸/.test(text) || /drawing/.test(lower)) {
    pushCandidate({
      ruleCode: 'DWG_TITLE_001',
      ruleName: '图纸规范检查',
      category: 'DWG',
      description: '根据内置图纸规则检查标题栏、图层、尺寸和标准引用。',
      checkMethod: '使用 DWG 前缀规则引擎执行图纸检查',
      severity: 'warning',
      targetScope: 'DWG',
    });
  }

  if (candidates.length === 0) {
    pushCandidate({
      ruleCode: 'NAME_001',
      ruleName: '文件命名规范检查',
      category: 'NAMING',
      description: '未从文档中提取到明确条文，先生成一条可执行的基础命名规则供管理员确认。',
      checkMethod: '使用 NAME 前缀规则引擎执行命名检查',
      severity: 'warning',
    });
  }

  return candidates;
}

export class ReviewSpecificationService {
  static async list(options?: { selectableOnly?: boolean; folderId?: string; keyword?: string; status?: string }) {
    const selectableOnly = !!options?.selectableOnly;
    const where: any = selectableOnly ? { status: 'PUBLISHED' } : {};
    if (options?.folderId) {
      where.folderId = options.folderId;
    }
    if (options?.status && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(options.status)) {
      where.status = options.status;
    }
    if (options?.keyword?.trim()) {
      const kw = options.keyword.trim();
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { description: { contains: kw, mode: 'insensitive' } },
      ];
    }
    const specifications = await prisma.reviewSpecification.findMany({
      where,
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return specifications
      .map((specification) => {
        const executableItems = specification.items.filter((item) => this.isExecutableItem(item));
        return {
          ...specification,
          executableItemCount: executableItems.length,
          enabledExecutableItemCount: executableItems.filter((item) => item.enabled).length,
          pendingStructuredItemCount: specification.items.filter((item) => !this.isExecutableItem(item)).length,
        };
      })
      .filter((specification) => {
        if (!selectableOnly) return true;
        return specification.enabledExecutableItemCount > 0;
      });
  }

  static async getById(id: string) {
    const specification = await prisma.reviewSpecification.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!specification) return null;

    return {
      ...specification,
      executableItemCount: specification.items.filter((item) => this.isExecutableItem(item)).length,
      enabledExecutableItemCount: specification.items.filter((item) => this.isExecutableItem(item) && item.enabled).length,
      pendingStructuredItemCount: specification.items.filter((item) => !this.isExecutableItem(item)).length,
    };
  }

  static async create(data: { name: string; description?: string; folderId?: string | null; createdBy: string }) {
    return prisma.reviewSpecification.create({
      data: {
        name: data.name,
        description: data.description,
        folderId: data.folderId ?? null,
        createdBy: data.createdBy,
      },
    });
  }

  static async update(id: string, data: { name?: string; description?: string; folderId?: string | null; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
    if (data.status === 'PUBLISHED') {
      await this.assertPublishable(id);
    }
    return prisma.reviewSpecification.update({ where: { id }, data });
  }

  static async delete(id: string) {
    return prisma.reviewSpecification.delete({ where: { id } });
  }

  static async getExecutionPlan(specificationId: string): Promise<RulePlan> {
    const specification = await prisma.reviewSpecification.findUnique({
      where: { id: specificationId },
      include: {
        items: {
          where: { enabled: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!specification) throw new Error('审查规范集不存在');

    const executableItems = (specification.items as any[]).filter((item) => this.isExecutableItem(item));
    const enabledPrefixes = uniqueStrings(executableItems.flatMap((item) => resolveBuiltinPrefixes({
      category: item.category,
      ruleCode: item.ruleCode,
      builtinPrefix: item.builtinPrefix,
    })));

    return {
      specificationId: specification.id,
      enabledPrefixes,
      executableItems: executableItems.map((item) => ({
        id: item.id,
        ruleCode: item.ruleCode,
        ruleName: item.ruleName,
        category: item.category,
        severity: item.severity,
        executionType: (item.executionType as RuleExecutionType) || 'BUILTIN_PREFIX',
        builtinPrefix: item.builtinPrefix,
        targetScope: (item.targetScope as RuleTargetScope) || 'TEXT',
      })),
    };
  }

  static isExecutableItem(item: any): boolean {
    const executionType = (item.executionType as RuleExecutionType) || inferExecutionFields(item).executionType;
    if (executionType === 'MANUAL') return false;
    if (executionType === 'BUILTIN_PREFIX') {
      return resolveBuiltinPrefixes({
        category: item.category,
        ruleCode: item.ruleCode,
        builtinPrefix: item.builtinPrefix,
      }).length > 0;
    }
    return true;
  }

  static async assertPublishable(specificationId: string): Promise<void> {
    const specification = await prisma.reviewSpecification.findUnique({
      where: { id: specificationId },
      include: { items: true },
    });
    if (!specification) throw new Error('审查规范集不存在');

    const enabledExecutableCount = specification.items.filter((item) => item.enabled && this.isExecutableItem(item)).length;
    if (enabledExecutableCount <= 0) {
      throw new Error('审查规范集至少需要 1 条启用且可执行的规则后才能发布');
    }
  }

  static async parseRulesFromText(specificationId: string, text: string, sourceFileName?: string): Promise<number> {
    const preview = await this.previewRulesFromText(specificationId, text, sourceFileName);
    if (preview.items.length === 0) return 0;
    const result = await this.importPreviewItems(specificationId, preview.items, 'merge', sourceFileName);
    return result.count;
  }

  static async previewRulesFromText(specificationId: string, text: string, sourceFileName?: string): Promise<{ items: SpecificationPreviewItem[]; sourceFileName?: string }> {
    const specification = await prisma.reviewSpecification.findUnique({
      where: { id: specificationId },
      include: { items: true },
    });
    if (!specification) throw new Error('审查规范集不存在');

    const truncatedText = text.slice(0, 20000);
    const systemPrompt = `你是规范标准解析专家。请从以下规范文档中提取结构化的审查规则。
每个规则输出一个 JSON 数组元素，格式如下：
{
  "rule_code": "规则代码（如 NAMING_001）",
  "rule_name": "规则名称",
  "category": "分类（NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/CONSISTENCY/COMPLETENESS/DWG）",
  "description": "规则描述",
  "check_method": "检查方法说明",
  "severity": "严重程度（error/warning/info）"
}

只输出 JSON 数组，不要输出其他内容。如果文本中没有明确的规则，返回空数组 []。`;
    const userPrompt = `请从以下规范文档中提取审查规则：\n\n${truncatedText}`;
    const result = await LlmService.chat(userPrompt, { systemPrompt, maxTokens: 4096, timeout: 120 });
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    let parsed: any[] = [];
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (Array.isArray(data)) parsed = data;
      } catch {
        parsed = [];
      }
    }

    const existingKeys = new Set(
      specification.items.map((item) => this.buildDuplicateKey(item.ruleCode, item.ruleName)),
    );

    const itemsFromModel: SpecificationPreviewItem[] = parsed
      .filter((rule) => rule && typeof rule === 'object' && rule.rule_name)
      .map((rule) => {
        const inferred = inferExecutionFields({
          category: rule.category,
          ruleCode: rule.rule_code,
          checkMethod: rule.check_method,
        });
        const duplicateKey = this.buildDuplicateKey(rule.rule_code, rule.rule_name);
        return {
          ruleCode: rule.rule_code || null,
          ruleName: rule.rule_name,
          category: rule.category || null,
          description: rule.description || null,
          checkMethod: rule.check_method || null,
          severity: normalizeSeverity(rule.severity),
          executionType: inferred.executionType,
          builtinPrefix: inferred.builtinPrefix || null,
          targetScope: inferred.targetScope,
          params: null,
          messageTemplate: null,
          sourceQuote: null,
          sourceLocation: sourceFileName || null,
          executable: inferred.executable,
          duplicate: existingKeys.has(duplicateKey),
        };
      });

    const items = itemsFromModel.length > 0 ? itemsFromModel : buildFallbackPreviewItems(truncatedText, sourceFileName)
      .map((item) => ({
        ...item,
        duplicate: existingKeys.has(this.buildDuplicateKey(item.ruleCode, item.ruleName)),
      }));

    return { items, sourceFileName };
  }

  static async importPreviewItems(
    specificationId: string,
    items: SpecificationPreviewItem[],
    mode: 'merge' | 'replace' = 'merge',
    sourceFileName?: string,
  ): Promise<{ count: number }> {
    const specification = await prisma.reviewSpecification.findUnique({ where: { id: specificationId } });
    if (!specification) throw new Error('审查规范集不存在');

    return prisma.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.reviewSpecificationItem.deleteMany({ where: { specificationId } });
      }

      const existingItems = mode === 'merge'
        ? await tx.reviewSpecificationItem.findMany({ where: { specificationId } })
        : [];
      const existingByKey = new Map(
        existingItems.map((item) => [this.buildDuplicateKey(item.ruleCode, item.ruleName), item]),
      );

      let count = 0;
      for (const item of items) {
        if (!item.ruleName?.trim()) continue;
        const duplicateKey = this.buildDuplicateKey(item.ruleCode, item.ruleName);
        const existing = existingByKey.get(duplicateKey) || null;

        const data = {
          specificationId,
          ruleCode: item.ruleCode || null,
          ruleName: item.ruleName,
          category: item.category || null,
          description: item.description || null,
          checkMethod: item.checkMethod || null,
          severity: normalizeSeverity(item.severity),
          executionType: item.executionType,
          builtinPrefix: item.builtinPrefix || null,
          targetScope: item.targetScope || 'TEXT',
          params: item.params || undefined,
          messageTemplate: item.messageTemplate || null,
          sourceQuote: item.sourceQuote || null,
          sourceLocation: item.sourceLocation || sourceFileName || null,
        } as any;

        if (existing && this.buildDuplicateKey(existing.ruleCode, existing.ruleName) === duplicateKey) {
          await tx.reviewSpecificationItem.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.reviewSpecificationItem.create({ data });
        }
        count++;
      }

      await tx.reviewSpecification.update({
        where: { id: specificationId },
        data: { sourceFileName: sourceFileName || specification.sourceFileName || null },
      });

      return { count };
    });
  }

  static async addItem(specificationId: string, data: {
    ruleCode?: string;
    ruleName: string;
    category?: string;
    description?: string;
    checkMethod?: string;
    severity?: string;
    executionType?: RuleExecutionType;
    builtinPrefix?: string;
    targetScope?: RuleTargetScope;
    params?: any;
    messageTemplate?: string;
    sourceQuote?: string;
    sourceLocation?: string;
  }) {
    const inferred = inferExecutionFields({
      category: data.category,
      ruleCode: data.ruleCode,
      checkMethod: data.checkMethod,
    });
    return prisma.reviewSpecificationItem.create({
      data: {
        specificationId,
        ruleCode: data.ruleCode,
        ruleName: data.ruleName,
        category: data.category,
        description: data.description,
        checkMethod: data.checkMethod,
        severity: normalizeSeverity(data.severity),
        executionType: data.executionType || inferred.executionType,
        builtinPrefix: data.builtinPrefix || inferred.builtinPrefix || null,
        targetScope: data.targetScope || inferred.targetScope,
        params: data.params || undefined,
        messageTemplate: data.messageTemplate || null,
        sourceQuote: data.sourceQuote || null,
        sourceLocation: data.sourceLocation || null,
      } as any,
    });
  }

  static async updateItem(itemId: string, data: {
    ruleCode?: string;
    ruleName?: string;
    category?: string;
    description?: string;
    checkMethod?: string;
    severity?: string;
    enabled?: boolean;
    executionType?: RuleExecutionType;
    builtinPrefix?: string | null;
    targetScope?: RuleTargetScope;
    params?: any;
    messageTemplate?: string | null;
    sourceQuote?: string | null;
    sourceLocation?: string | null;
  }) {
    const current = await prisma.reviewSpecificationItem.findUnique({ where: { id: itemId } }) as any;
    if (!current) throw new Error('规则条目不存在');

    const merged = {
      category: data.category ?? current.category,
      ruleCode: data.ruleCode ?? current.ruleCode,
      checkMethod: data.checkMethod ?? current.checkMethod,
    };
    const inferred = inferExecutionFields(merged);

    return prisma.reviewSpecificationItem.update({
      where: { id: itemId },
      data: {
        ...data,
        severity: data.severity ? normalizeSeverity(data.severity) : undefined,
        executionType: data.executionType || inferred.executionType,
        builtinPrefix: data.builtinPrefix === undefined ? (current.builtinPrefix || inferred.builtinPrefix || null) : data.builtinPrefix,
        targetScope: data.targetScope || current.targetScope || inferred.targetScope,
      } as any,
    });
  }

  static async deleteItem(itemId: string) {
    return prisma.reviewSpecificationItem.delete({ where: { id: itemId } });
  }

  private static buildDuplicateKey(ruleCode?: string | null, ruleName?: string | null): string {
    return `${normalizeString(ruleCode)}::${normalizeString(ruleName)}`;
  }
}