// backend/src/services/standard/checkpoint/checkpoint-binder.service.ts
/**
 * 设计 chunk ↔ 审点预绑定服务
 *
 * 因审点存在 PG 不在 MaxKB，hit_test 检索不到，用 LLM 判定关联性。
 * 每个设计 chunk 调一次 LLM，从审点清单中选出关联审点。
 * 成本敏感，用便宜模型。
 */

import prisma from '../../../config/db';
import { LlmService } from '../../llm/llm.service';
import { PromptTemplateService } from '../../llm/prompt-template.service';

export interface DesignChunk {
  index: number;
  text: string;
}

export class CheckpointBinderService {
  /**
   * 对一个任务文件的设计 chunks 做预绑定
   */
  static async bindTaskFileCheckpoints(
    taskFileId: string,
    designChunks: DesignChunk[],
    standardIds: string[],
    options?: { concurrency?: number; maxCheckpointsPerChunk?: number },
  ): Promise<{ bound: number; total: number }> {
    const concurrency = options?.concurrency ?? 3;
    const maxPerChunk = options?.maxCheckpointsPerChunk ?? 5;

    // 加载这些标准下的所有审点
    const checkpoints = await prisma.standardCheckpoint.findMany({
      where: { standardId: { in: standardIds } },
      select: { id: true, clauseCode: true, clauseText: true, checkPrompt: true },
    });

    if (checkpoints.length === 0) {
      console.warn(`[CheckpointBinder] 标准 ${standardIds.join(',')} 无审点，跳过预绑定`);
      return { bound: 0, total: 0 };
    }

    let bound = 0;
    let total = 0;

    for (let i = 0; i < designChunks.length; i += concurrency) {
      const batch = designChunks.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async chunk => {
          try {
            const bindings = await this.bindSingleChunk(chunk, checkpoints, maxPerChunk);
            if (bindings.length > 0) {
              await prisma.designChunkCheckpoint.createMany({
                data: bindings.map(b => ({
                  taskFileId,
                  chunkIndex: chunk.index,
                  chunkText: chunk.text.substring(0, 2000),
                  checkpointId: b.checkpointId,
                  bindType: 'prebind',
                  similarity: b.similarity,
                })),
                skipDuplicates: true,
              });
              bound += bindings.length;
              total++;
            }
          } catch (e) {
            console.warn(`[CheckpointBinder] chunk ${chunk.index} 绑定失败:`, (e as Error).message);
          }
        }),
      );
      console.log(`[CheckpointBinder] 进度: ${Math.min(i + concurrency, designChunks.length)}/${designChunks.length}`);
    }

    return { bound, total };
  }

  /**
   * 单个 chunk 绑定审点（LLM 判定）
   */
  private static async bindSingleChunk(
    chunk: DesignChunk,
    checkpoints: Array<{ id: string; clauseCode: string | null; clauseText: string; checkPrompt: string | null }>,
    maxPerChunk: number,
  ): Promise<Array<{ checkpointId: string; similarity: number }>> {
    const systemPrompt = await PromptTemplateService.getPromptByScene(
      'checkpoint_bind', 'system', 'default',
      '你是审点关联判定专家。判断给定设计内容需要遵守哪些审点。只选出相关度高的审点，避免误选。',
    );

    const checkpointsList = checkpoints.map((c, i) =>
      `${i + 1}. [${c.clauseCode || '无编号'}] ${c.clauseText.substring(0, 200)}`
    ).join('\n');

    const userPrompt = `## 设计内容\n\n${chunk.text.substring(0, 2000)}\n\n## 审点清单\n\n${checkpointsList}\n\n请选出该设计内容需要遵守的审点（最多 ${maxPerChunk} 个），输出 JSON 数组：\n[{"index": 1, "relevance": 0.9}]\n其中 index 是审点清单中的序号，relevance 是相关度 0-1。`;

    const result = await LlmService.chat(userPrompt, {
      systemPrompt,
      temperature: 0.1,
      timeout: 60,
    });

    try {
      // 提取 JSON 数组（兼容 ```json 包裹）
      const jsonStr = this.extractJsonArray(result);
      const parsed = JSON.parse(jsonStr) as Array<{ index: number; relevance: number }>;
      return parsed
        .filter(item => item.index >= 1 && item.index <= checkpoints.length && item.relevance >= 0.5)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, maxPerChunk)
        .map(item => ({
          checkpointId: checkpoints[item.index - 1].id,
          similarity: item.relevance,
        }));
    } catch (e) {
      console.warn(`[CheckpointBinder] chunk ${chunk.index} LLM 响应解析失败:`, (e as Error).message);
      return [];
    }
  }

  /**
   * 从 LLM 响应中提取 JSON 数组（兼容 ```json 包裹）
   */
  private static extractJsonArray(text: string): string {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    // 尝试直接找第一个 [ ... ] 数组
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return arrayMatch[0];
    return text.trim();
  }

  /**
   * 查询任务文件的预绑定结果
   */
  static async getBindings(taskFileId: string) {
    return prisma.designChunkCheckpoint.findMany({
      where: { taskFileId },
      include: { checkpoint: true },
      orderBy: { chunkIndex: 'asc' },
    });
  }
}
