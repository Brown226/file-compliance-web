/**
 * 规则库管理服务
 *
 * 管理自定义规则库：上传规范文档 → LLM 解析为结构化规则 → 管理员审核
 */

import prisma from '../config/db';
import { LlmService } from './llm.service';

export class RuleLibraryService {

  static async list() {
    return prisma.ruleLibrary.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getById(id: string) {
    return prisma.ruleLibrary.findUnique({
      where: { id },
      include: { items: { orderBy: { ruleCode: 'asc' } } },
    });
  }

  static async create(data: { name: string; description?: string; createdBy: string }) {
    return prisma.ruleLibrary.create({
      data: {
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
      },
    });
  }

  static async update(id: string, data: { name?: string; description?: string; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
    return prisma.ruleLibrary.update({ where: { id }, data });
  }

  static async delete(id: string) {
    return prisma.ruleLibrary.delete({ where: { id } });
  }

  /**
   * 从文本内容中用 LLM 解析出结构化规则
   */
  static async parseRulesFromText(libraryId: string, text: string, sourceFileName?: string): Promise<number> {
    const library = await prisma.ruleLibrary.findUnique({ where: { id: libraryId } });
    if (!library) throw new Error('规则库不存在');

    // 截取前 20000 字符避免 token 超限
    const truncatedText = text.slice(0, 20000);

    const systemPrompt = `你是规范标准解析专家。请从以下规范文档中提取结构化的审查规则。

每个规则输出为 JSON 数组元素，格式如下：
{
  "rule_code": "规则代码（如 NAMING_001）",
  "rule_name": "规则名称",
  "category": "分类（NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE/FORMAT/CONSISTENCY/COMPLETENESS）",
  "description": "规则描述",
  "check_method": "检查方法说明",
  "severity": "严重程度（error/warning/info）"
}

只输出 JSON 数组，不要输出其他内容。如果文本中没有明确的规则，返回空数组 []。`;

    const userPrompt = `请从以下规范文档中提取审查规则：\n\n${truncatedText}`;

    try {
      const result = await LlmService.chat(userPrompt, { systemPrompt, maxTokens: 4096, timeout: 120 });

      // 解析 JSON 数组
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return 0;

      const rules = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(rules)) return 0;

      // 批量入库
      let count = 0;
      for (const rule of rules) {
        if (!rule.rule_name) continue;
        await prisma.ruleLibraryItem.create({
          data: {
            libraryId,
            ruleCode: rule.rule_code || null,
            ruleName: rule.rule_name,
            category: rule.category || null,
            description: rule.description || null,
            checkMethod: rule.check_method || null,
            severity: rule.severity || 'warning',
          },
        });
        count++;
      }

      // 更新规则库源文件名
      if (sourceFileName && count > 0) {
        await prisma.ruleLibrary.update({
          where: { id: libraryId },
          data: { sourceFileName },
        });
      }

      return count;
    } catch (e: any) {
      console.error('[RuleLibrary] LLM 解析规则失败:', e.message);
      throw new Error(`规则解析失败: ${e.message}`);
    }
  }

  static async addItem(libraryId: string, data: {
    ruleCode?: string;
    ruleName: string;
    category?: string;
    description?: string;
    checkMethod?: string;
    severity?: string;
  }) {
    return prisma.ruleLibraryItem.create({
      data: {
        libraryId,
        ruleCode: data.ruleCode,
        ruleName: data.ruleName,
        category: data.category,
        description: data.description,
        checkMethod: data.checkMethod,
        severity: data.severity || 'warning',
      },
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
  }) {
    return prisma.ruleLibraryItem.update({ where: { id: itemId }, data });
  }

  static async deleteItem(itemId: string) {
    return prisma.ruleLibraryItem.delete({ where: { id: itemId } });
  }
}
