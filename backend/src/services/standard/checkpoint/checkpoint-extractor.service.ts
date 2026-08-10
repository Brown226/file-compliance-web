// backend/src/services/standard/checkpoint/checkpoint-extractor.service.ts
/**
 * 审点加工服务 — 把切分后的条文用 LLM 加工成 DEC 风格审点
 *
 * 流程（路线 2）：
 * 1. 调 ClauseSplitterService 从 Standard.content 切分条文
 * 2. 对每个条文调 LLM 加工（clauseCode/mandatory/auditDimension/checkPrompt）
 * 3. 落库 rule_library_items（V3.2 合并：审点统一落在 rule_library_items，
 *    标准 → 审点库 的关联在 rule_libraries.standardId，无库时自动创建）
 * 4. 幂等：同一审点库内 clauseHash 已存在则跳过
 *
 * 不依赖 MaxKB，数据全部来自本地 Standard.content + LLM 加工。
 */

import prisma from '../../../config/db';
import { LlmService } from '../../llm/llm.service';
import { PromptTemplateService } from '../../llm/prompt-template.service';
import { ClauseSplitterService, SplitClause } from './clause-splitter.service';

export interface ExtractedCheckpoint {
  clauseCode: string | null;
  clauseText: string;
  clauseHash: string;
  mandatory: 'mandatory' | 'guidance';
  auditDimension: 'compliance' | 'fact' | 'text';
  checkPrompt: string;
}

export class CheckpointExtractorService {
  /**
   * 切分 + 加工 + 落库（一站式）
   */
  static async extractAndSave(standardId: string, options?: { concurrency?: number; createdBy?: string }): Promise<{
    total: number;
    extracted: number;
    skipped: number;
    failed: number;
  }> {
    const concurrency = options?.concurrency ?? 3;
    const createdBy = options?.createdBy || 'system';

    // 1. 切分条文
    const { clauses } = await ClauseSplitterService.splitStandard(standardId);
    console.log(`[CheckpointExtractor] 标准 ${standardId} 切分出 ${clauses.length} 条条文`);

    if (clauses.length === 0) {
      return { total: 0, extracted: 0, skipped: 0, failed: 0 };
    }

    // 1.5 找/创建该标准关联的审点库（V3.2 合并：审点统一落在 rule_libraries.standardId → rule_library_items）
    const standard = await prisma.standard.findUnique({
      where: { id: standardId },
      select: { title: true, standardNo: true },
    });
    let library = await prisma.ruleLibrary.findFirst({ where: { standardId } });
    if (!library) {
      library = await prisma.ruleLibrary.create({
        data: {
          name: `${standard?.title || '未命名标准'}审点库`,
          description: '由「标准全文切分 + LLM 加工」自动生成（V3.2 条文库合并载体）',
          standardId,
          createdBy,
          status: 'DRAFT',
        },
      });
      console.log(`[CheckpointExtractor] 标准 ${standardId} 无关联审点库，已自动创建 ${library.id}`);
    }

    // 2. 查已存在的 clauseHash（幂等，在同一审点库内查重）
    const existing = await prisma.ruleLibraryItem.findMany({
      where: { libraryId: library.id, clauseHash: { in: clauses.map(c => c.clauseHash) } },
      select: { clauseHash: true },
    });
    const existingHashes = new Set(existing.map(e => e.clauseHash));

    const toProcess = clauses.filter(c => !existingHashes.has(c.clauseHash));
    console.log(`[CheckpointExtractor] 跳过已存在 ${existingHashes.size} 条，待加工 ${toProcess.length} 条`);

    let extracted = 0;
    let failed = 0;

    // 3. 并发 LLM 加工
    for (let i = 0; i < toProcess.length; i += concurrency) {
      const batch = toProcess.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async clause => {
          try {
            const checkpoint = await this.extractCheckpoint(clause);
            if (!checkpoint) {
              failed++;
              return;
            }
            await prisma.ruleLibraryItem.create({
              data: {
                libraryId: library.id,
                ruleCode: checkpoint.clauseCode,
                ruleName: checkpoint.clauseCode,
                description: checkpoint.clauseText,
                clauseText: checkpoint.clauseText,
                checkPrompt: checkpoint.checkPrompt,
                auditDimension: checkpoint.auditDimension,
                mandatory: checkpoint.mandatory,
                clauseHash: checkpoint.clauseHash,
                severity: checkpoint.mandatory === 'mandatory' ? 'error' : 'warning',
                sourceLocation: standard?.standardNo || null,
                enabled: true,
              },
            });
            extracted++;
          } catch (e) {
            console.warn(`[CheckpointExtractor] 条文 ${clause.clauseCode || clause.clauseHash} 加工失败:`, (e as Error).message);
            failed++;
          }
        }),
      );
      console.log(`[CheckpointExtractor] 进度: ${Math.min(i + concurrency, toProcess.length)}/${toProcess.length}`);
    }

    return {
      total: clauses.length,
      extracted,
      skipped: existingHashes.size,
      failed,
    };
  }

  /**
   * 单条条文 LLM 加工
   */
  static async extractCheckpoint(clause: SplitClause): Promise<ExtractedCheckpoint | null> {
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      'checkpoint_extract', 'system', 'default',
      '你是规范审点工程化专家。把给定的规范条文转成机器可执行的审点。',
    );

    const userPrompt = await PromptTemplateService.getPromptByScene(
      'checkpoint_extract', 'user', 'default',
      '## 规范条文\n\n${clauseContent}\n\n请把以上条文转成审点，输出 JSON。',
    );

    const userContent = userPrompt.replace(/\$\{clauseContent\}/g, clause.clauseText);

    const result = await LlmService.chat(userContent, {
      systemPrompt,
      temperature: 0.1,
      timeout: 60,
    });

    try {
      // LLM 可能返回 ```json ... ``` 包裹，提取其中的 JSON
      const jsonStr = this.extractJson(result);
      const parsed = JSON.parse(jsonStr);
      return {
        clauseCode: parsed.clauseCode || clause.clauseCode || null,
        clauseText: clause.clauseText,
        clauseHash: clause.clauseHash,
        mandatory: parsed.mandatory === 'guidance' ? 'guidance' : 'mandatory',
        auditDimension: ['compliance', 'fact', 'text'].includes(parsed.auditDimension) ? parsed.auditDimension : 'compliance',
        checkPrompt: parsed.checkPrompt || '',
      };
    } catch (e) {
      console.warn(`[CheckpointExtractor] 条文 ${clause.clauseCode || clause.clauseHash} LLM 响应解析失败:`, (e as Error).message);
      return null;
    }
  }

  /**
   * 从 LLM 响应中提取 JSON（兼容 ```json 包裹）
   */
  private static extractJson(text: string): string {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    // 尝试直接找第一个 { ... } 块
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return text.trim();
  }
}
