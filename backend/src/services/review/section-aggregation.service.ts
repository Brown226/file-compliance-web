/**
 * 章节级语义聚合服务（OPT-024）
 *
 * 解决问题：
 *  - 现有 CrossFileConsistencyService / IntraFileConsistencyService 基于正则抽取"参数名=参数值"，
 *    无法识别"文字不一致但语义一致"的情况（如"设计温度350°C" vs "反应堆工作温度为350摄氏度"），导致漏报；
 *  - 也无法识别"文字一致但语义不一致"的情况（如同一参数名在不同上下文指代不同概念），导致误报。
 *
 * 方案：
 *  1. 使用 LLM 从文本中提取"系统描述"结构化实体（系统名/参数/取值/上下文）
 *  2. 跨文件聚合：将不同文件中对同一系统的描述分组
 *  3. 语义比对：对同一系统的多份描述做一致性判断，生成 SEMANTIC_INCONSIST 问题
 *
 * 规则代码: SEMANTIC_INCONSIST_001（语义层不一致）
 */

import prisma from '../../config/db';
import { LlmService } from '../llm/llm.service';
import { TextExtractionService } from '../review-pipeline/text-extraction.service';
import { resolveFilePath } from '../../config/upload';

/** LLM 提取出的系统描述实体 */
interface SystemEntity {
  /** 系统/设备名称，如 "反应堆冷却剂系统"、"主泵" */
  systemName: string;
  /** 参数名（规范化后），如 "设计温度"、"额定流量" */
  paramName: string;
  /** 参数值（含单位），如 "350°C"、"17500 m³/h" */
  value: string;
  /** 原文片段（用于精确定位和回显） */
  context: string;
  /** 来源文件名 */
  fileName: string;
  /** 来源文件 ID */
  fileId: string;
}

/** 语义不一致问题 */
interface SemanticInconsistency {
  systemName: string;
  paramName: string;
  entries: Array<{
    fileName: string;
    fileId: string;
    value: string;
    context: string;
  }>;
  /** LLM 给出的判定理由 */
  reason: string;
}

/** 单个文件的最大字符数（避免 LLM 输入过长） */
const MAX_CHARS_PER_FILE = 12000;
/** 单次 LLM 比对的最大实体对数 */
const MAX_PAIRS_PER_LLM_CALL = 20;

export class SectionAggregationService {
  /**
   * 执行章节级语义聚合检查
   * @param taskId 任务 ID
   * @param files 任务文件列表
   * @returns 发现的语义不一致问题数
   */
  static async check(
    taskId: string,
    files: Array<{ id: string; fileName: string; filePath: string; fileType: string }>,
  ): Promise<number> {
    if (!files || files.length < 2) {
      console.log('[SemanticAgg] 文件数不足2，跳过');
      return 0;
    }

    console.log(`[SemanticAgg] 开始语义聚合检查，共 ${files.length} 个文件`);

    // 1. 提取每个文件的文本
    const fileTexts = await this.extractAllTexts(files);
    if (fileTexts.length < 2) {
      console.log('[SemanticAgg] 有效文本文件不足2，跳过');
      return 0;
    }

    // 2. 阶段 A：LLM 提取所有文件中的系统描述实体
    const allEntities = await this.extractSystemEntities(fileTexts);
    if (allEntities.length < 2) {
      console.log('[SemanticAgg] 提取到的系统实体不足2，跳过');
      return 0;
    }
    console.log(`[SemanticAgg] 共提取 ${allEntities.length} 个系统实体`);

    // 3. 按系统名+参数名分组
    const groups = this.groupBySystemParam(allEntities);

    // 4. 阶段 B：对每组做语义比对，找出不一致
    const inconsistencies = await this.findSemanticInconsistencies(groups);
    if (inconsistencies.length === 0) {
      console.log('[SemanticAgg] 未发现语义不一致');
      return 0;
    }

    console.log(`[SemanticAgg] 发现 ${inconsistencies.length} 个语义不一致`);

    // 5. 写入 TaskDetail（每个相关文件写一条）
    const details = inconsistencies.flatMap((inc) => {
      const valuesDesc = inc.entries
        .map((e) => `${e.fileName}: "${e.value}"`)
        .join('; ');
      return inc.entries.map((entry) => ({
        taskId,
        fileId: entry.fileId,
        issueType: 'CONSISTENCY' as const,
        ruleCode: 'SEMANTIC_INCONSIST_001',
        severity: 'warning' as const,
        reviewSource: 'AI_REVIEW' as const,
        originalText: entry.context || `${inc.systemName}.${inc.paramName}=${entry.value}`,
        suggestedText: null as string | null,
        description: `[语义] 系统"${inc.systemName}"的参数"${inc.paramName}"在不同文件中描述不一致: ${valuesDesc}。判定理由: ${inc.reason}`,
      }));
    });

    if (details.length > 0) {
      await prisma.taskDetail.createMany({ data: details });
    }

    // 更新相关文件错误计数
    const affectedFileIds = new Set(inconsistencies.flatMap((inc) => inc.entries.map((e) => e.fileId)));
    for (const fileId of affectedFileIds) {
      await this.updateFileErrorCount(fileId);
    }

    return details.length;
  }

  /**
   * 批量提取文件文本
   */
  private static async extractAllTexts(
    files: Array<{ id: string; fileName: string; filePath: string; fileType: string }>,
  ): Promise<Array<{ fileId: string; fileName: string; text: string }>> {
    const results: Array<{ fileId: string; fileName: string; text: string }> = [];

    for (const file of files) {
      try {
        const absolutePath = resolveFilePath(file.filePath);
        const text = await TextExtractionService.extractFileText(absolutePath, file.fileType, file.fileName);
        if (text && text.trim().length > 100) {
          // 截断过长文本，保留前 MAX_CHARS_PER_FILE 字符（通常是封面+目录+前几章，包含主要系统描述）
          const truncated = text.length > MAX_CHARS_PER_FILE
            ? text.substring(0, MAX_CHARS_PER_FILE)
            : text;
          results.push({ fileId: file.id, fileName: file.fileName, text: truncated });
        }
      } catch (e) {
        console.warn(`[SemanticAgg] 文件文本提取失败: ${file.fileName}`, e);
      }
    }

    return results;
  }

  /**
   * 阶段 A：使用 LLM 从文本中提取系统描述实体
   * 单文件单次调用，避免上下文过长
   */
  private static async extractSystemEntities(
    fileTexts: Array<{ fileId: string; fileName: string; text: string }>,
  ): Promise<SystemEntity[]> {
    const allEntities: SystemEntity[] = [];

    // 并发提取每个文件的实体（限制并发数避免 LLM 限流）
    const CONCURRENCY = 3;
    for (let i = 0; i < fileTexts.length; i += CONCURRENCY) {
      const batch = fileTexts.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((ft) => this.extractEntitiesFromFile(ft)),
      );
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allEntities.push(...result.value);
        }
      }
    }

    return allEntities;
  }

  /**
   * 单文件提取系统实体
   */
  private static async extractEntitiesFromFile(
    file: { fileId: string; fileName: string; text: string },
  ): Promise<SystemEntity[]> {
    const prompt = `你是核电站技术文档审查助手。请从以下文档片段中提取"系统描述实体"。

系统描述实体是指文档中对某个系统、设备或参数的技术性描述，包括：
- systemName: 系统/设备名称（如"反应堆冷却剂系统"、"主泵"、"蒸汽发生器"）
- paramName: 参数名（如"设计温度"、"额定流量"、"工作压力"）
- value: 参数值含单位（如"350°C"、"17500 m³/h"、"17.5 MPa"）
- context: 原文片段（参数出现的整句话或前后30字，用于回显定位）

要求：
1. 只提取明确的技术参数描述，不要提取无关文字
2. systemName 和 paramName 需规范化（去空格、统一全半角）
3. value 保留原始单位
4. 返回 JSON 数组，每项含 systemName/paramName/value/context 四个字段
5. 如果没有提取到任何实体，返回空数组 []
6. 最多提取 30 个实体

文档名: ${file.fileName}
文档片段:
"""
${file.text}
"""

只返回 JSON 数组，不要任何解释文字。`;

    try {
      const response = await LlmService.chat(prompt, {
        temperature: 0,
        maxTokens: 4000,
        timeout: 60000,
      });
      const entities = this.parseLlmEntities(response, file.fileId, file.fileName);
      console.log(`[SemanticAgg] ${file.fileName}: 提取到 ${entities.length} 个实体`);
      return entities;
    } catch (e) {
      console.warn(`[SemanticAgg] ${file.fileName}: LLM 提取失败`, e);
      return [];
    }
  }

  /**
   * 解析 LLM 返回的实体 JSON
   */
  private static parseLlmEntities(
    response: string,
    fileId: string,
    fileName: string,
  ): SystemEntity[] {
    if (!response) return [];

    try {
      // 提取 JSON 数组（LLM 可能包裹在 markdown 代码块中）
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as any[];
      if (!Array.isArray(parsed)) return [];

      const entities: SystemEntity[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const systemName = String(item.systemName || item.system || '').trim();
        const paramName = String(item.paramName || item.parameter || item.param || '').trim();
        const value = String(item.value || '').trim();
        const context = String(item.context || '').trim();
        if (!systemName || !paramName || !value) continue;
        entities.push({
          systemName,
          paramName: this.normalizeParamName(paramName),
          value,
          context: context || `${systemName}.${paramName}=${value}`,
          fileName,
          fileId,
        });
      }
      return entities;
    } catch {
      return [];
    }
  }

  /**
   * 规范化参数名
   */
  private static normalizeParamName(name: string): string {
    return name
      .replace(/\s+/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .toLowerCase();
  }

  /**
   * 按 systemName + paramName 分组
   */
  private static groupBySystemParam(
    entities: SystemEntity[],
  ): Map<string, SystemEntity[]> {
    const groups = new Map<string, SystemEntity[]>();
    for (const entity of entities) {
      const key = `${entity.systemName}::${entity.paramName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entity);
    }
    // 只保留出现在 2 个以上文件的组
    const filtered = new Map<string, SystemEntity[]>();
    for (const [key, list] of groups) {
      const fileIds = new Set(list.map((e) => e.fileId));
      if (fileIds.size >= 2) {
        filtered.set(key, list);
      }
    }
    return filtered;
  }

  /**
   * 阶段 B：对每组做语义比对
   * 使用 LLM 判断多份描述是否语义一致
   */
  private static async findSemanticInconsistencies(
    groups: Map<string, SystemEntity[]>,
  ): Promise<SemanticInconsistency[]> {
    const results: SemanticInconsistency[] = [];

    for (const [key, entries] of groups) {
      // 快速预过滤：如果所有值完全相同（含单位），跳过
      const distinctValues = new Set(entries.map((e) => e.value.trim().toLowerCase()));
      if (distinctValues.size <= 1) continue;

      const [systemName, paramName] = key.split('::');

      // 数值预检：如果能解析为数值且差异 <1%，跳过
      if (this.allValuesNumericClose(entries)) continue;

      // LLM 语义判断
      const reason = await this.judgeSemanticConsistency(systemName, paramName, entries);
      if (reason) {
        results.push({ systemName, paramName, entries, reason });
      }
    }

    return results;
  }

  /**
   * 判断所有值是否在数值上接近（差异<1%）
   */
  private static allValuesNumericClose(entries: SystemEntity[]): boolean {
    const nums: number[] = [];
    for (const e of entries) {
      const m = e.value.match(/([+-]?\d+\.?\d*)/);
      if (m) {
        const n = parseFloat(m[1]);
        if (!isNaN(n)) nums.push(n);
      } else {
        return false; // 有非数值，不能跳过
      }
    }
    if (nums.length < 2) return false;
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    if (max === 0 && min === 0) return true;
    const avg = (Math.abs(max) + Math.abs(min)) / 2;
    return avg > 0 && (max - min) / avg < 0.01;
  }

  /**
   * LLM 判断语义一致性
   * @returns 不一致理由；空字符串表示一致
   */
  private static async judgeSemanticConsistency(
    systemName: string,
    paramName: string,
    entries: SystemEntity[],
  ): Promise<string> {
    // 限制单次比对数量
    const limited = entries.slice(0, MAX_PAIRS_PER_LLM_CALL);

    const valuesList = limited
      .map((e, i) => `${i + 1}. 文件"${e.fileName}": 值="${e.value}"，上下文="${e.context}"`)
      .join('\n');

    const prompt = `你是技术文档审查专家。请判断以下关于同一系统同一参数的多份描述是否语义一致。

系统名: ${systemName}
参数名: ${paramName}

各文件描述:
${valuesList}

判断规则：
1. 数值相同但单位不同（如 350°C vs 350摄氏度）→ 一致
2. 数值经单位换算后相同（如 17.5 MPa vs 175 bar）→ 一致
3. 文字表述不同但表达同一物理量且数值相同 → 一致
4. 数值不同（如 350°C vs 360°C）→ 不一致
5. 单位不同且换算后数值不同 → 不一致
6. 描述的物理量不同（如"温度"vs"压力"）→ 不一致

如果一致，返回: CONSISTENT
如果不一致，返回一行 JSON: {"reason":"简短说明不一致的原因（30字内）"}`;

    try {
      const response = await LlmService.chat(prompt, {
        temperature: 0,
        maxTokens: 200,
        timeout: 30000,
      });
      const trimmed = (response || '').trim();
      if (trimmed === 'CONSISTENT' || trimmed.includes('CONSISTENT')) {
        return '';
      }
      // 尝试解析 JSON
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[0]) as { reason?: string };
          return obj.reason || '语义不一致';
        } catch {
          return '语义不一致';
        }
      }
      return trimmed ? '语义不一致' : '';
    } catch (e) {
      console.warn(`[SemanticAgg] LLM 判断失败: ${systemName}.${paramName}`, e);
      return '';
    }
  }

  /**
   * 更新文件错误计数
   */
  private static async updateFileErrorCount(fileId: string): Promise<void> {
    const count = await prisma.taskDetail.count({
      where: {
        fileId,
        ruleCode: { not: 'NO_RESULT' },
      },
    });
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { errorCount: count },
    });
  }
}
