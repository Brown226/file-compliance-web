import prisma from '../config/db';
import { ParserService } from './parser.service';
import { LlmService, ReviewIssue } from './llm.service';
import { createPipelineAsync, PipelineContext } from './review-pipeline';
import { CrossFileConsistencyService } from './cross-file-consistency.service';
import { WebSocketService } from './websocket.service';
import path from 'path';

/**
 * 审查编排服务 - 两阶段分批并发编排
 * 阶段1（规则审查）：分批并行规则审查 → 立即入库推送
 * 阶段2（AI审查）：规则全部完成后，分批并行 AI 审查 → 批量入库推送
 * 并发数由 pipelineConfig.maxConcurrentReviews 控制（用户级别限制）
 *
 * 【用户级别并发控制机制】
 * - 每个用户同时最多处理 maxConcurrentReviews 个文件的 AI 审查
 * - 不同用户之间互不影响，实现多用户公平的资源分配
 * - 使用内存 Map 追踪：Map<userId, { processingCount, pendingQueue }>
 */
export class ReviewService {
  // 用户级别并发控制：追踪每个用户正在进行的 AI 审查文件数量
  private static userConcurrencyMap = new Map<string, number>();

  /**
   * 获取用户当前正在进行的 AI 审查文件数量
   */
  static getUserProcessingCount(userId: string): number {
    return this.userConcurrencyMap.get(userId) || 0;
  }

  /**
   * 等待用户可用配额
   * @param userId 用户ID
   * @param maxConcurrent 最大并发数
   * @param checkIntervalMs 检查间隔（毫秒）
   */
  private static async waitForUserQuota(
    userId: string,
    maxConcurrent: number,
    checkIntervalMs: number = 1000
  ): Promise<void> {
    while (this.getUserProcessingCount(userId) >= maxConcurrent) {
      console.log(`[Review] 用户 ${userId} 并发配额已满 (${this.getUserProcessingCount(userId)}/${maxConcurrent})，等待中...`);
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }

  /**
   * 递增用户处理计数
   */
  private static incrementUserCount(userId: string): void {
    const current = this.userConcurrencyMap.get(userId) || 0;
    this.userConcurrencyMap.set(userId, current + 1);
    console.log(`[Review] 用户 ${userId} 并发计数: ${current + 1}`);
  }

  /**
   * 递减用户处理计数
   */
  private static decrementUserCount(userId: string): void {
    const current = this.userConcurrencyMap.get(userId) || 0;
    if (current > 0) {
      this.userConcurrencyMap.set(userId, current - 1);
      console.log(`[Review] 用户 ${userId} 并发计数: ${current - 1}`);
    }
  }

  /**
   * 用户级别并发控制执行
   * - 每个用户同时最多处理 limit 个文件
   * - 不同用户之间互不影响
   *
   * @param userId 用户ID
   * @param items 待处理项列表
   * @param limit 单用户最大并发数
   * @param fn 处理函数
   */
  private static async runUserLevelConcurrency<T, R>(
    userId: string,
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];

    // 按用户分组控制并发
    for (let i = 0; i < items.length; i++) {
      // 等待该用户获得配额
      await this.waitForUserQuota(userId, limit);

      // 启动任务（不等待完成）
      const promise = fn(items[i], i).finally(() => {
        // 任务完成后递减计数
        this.decrementUserCount(userId);
      });

      // 递增计数
      this.incrementUserCount(userId);

      // 等待该任务完成
      const result = await promise;
      results.push(result);
    }

    return results;
  }

  /**
   * 主入口: 两阶段分批并发处理任务
   *
   * 流程:
   *  1. 加载任务/文件/配置（一次性）
   *  2. 阶段1: 分批并发规则审查（受 maxConcurrentReviews 限制）
   *  3. 批量入库: 所有规则结果 + WebSocket 推送
   *  4. 阶段2: 分批并发 AI 审查（受 maxConcurrentReviews 限制）
   *  5. 批量入库: 所有 AI 结果 + WebSocket 推送
   *  6. 跨文件一致性检查（CONSISTENCY / FULL_REVIEW）
   *  7. 更新任务状态 + 最终推送
   */
  static async processTask(taskId: string): Promise<void> {
    console.log(`[Review] 开始处理任务: ${taskId}`);

    try {
      // ===== 一次性加载所有数据 =====
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          files: { orderBy: { createdAt: 'asc' } },
          standard: true,
          taskStandards: { include: { standard: true } },
          creator: true,
        },
      });

      if (!task) {
        console.error(`[Review] 任务不存在: ${taskId}`);
        return;
      }

      const totalFiles = task.files.length;

      // 推送任务开始
      WebSocketService.emitTaskProgress(taskId, {
        type: 'started',
        step: '初始化',
        progress: 0,
        message: '任务开始处理',
        timestamp: Date.now(),
      });

      const reviewMode = (task as any).reviewMode || 'FULL_REVIEW';
      const maxkbKnowledgeId = (task as any).maxkbKnowledgeId || undefined;

      // 解析多知识库 ID
      let maxkbKnowledgeIds: string[] | undefined;
      if (maxkbKnowledgeId) {
        try {
          const parsed = JSON.parse(maxkbKnowledgeId);
          maxkbKnowledgeIds = Array.isArray(parsed) ? parsed : [maxkbKnowledgeId];
        } catch {
          maxkbKnowledgeIds = [maxkbKnowledgeId];
        }
      }

      // 标记所有文件为 PENDING
      await prisma.taskFile.updateMany({
        where: { taskId },
        data: { status: 'PENDING' },
      });

      // ===== 一次性加载 pipeline 配置 =====
      let pipelineConfig: any = {};
      try {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
        if (cfg?.value) pipelineConfig = cfg.value;
      } catch (e) { /* 使用默认值 */ }

      // ===== 一次性加载参照文件（以文审文模式） =====
      let refFileGroupCtx: PipelineContext['refFileGroup'] | undefined;
      if (reviewMode === 'DOC_REVIEW') {
        const groups = await prisma.refFileGroup.findMany({
          where: { taskId },
          include: { refFiles: true },
        });
        if (groups.length > 0) {
          const uploadsDir = path.join(__dirname, '../../uploads');
          refFileGroupCtx = {
            groupId: groups[0].id,
            groupName: groups[0].groupName,
            refFiles: groups[0].refFiles.map((rf: any) => ({
              id: rf.id,
              fileName: rf.fileName,
              filePath: path.join(uploadsDir, path.basename(rf.filePath)),
              fileType: rf.fileType,
              extractedText: rf.extractedText || undefined,
            })),
          };
        }
      }

      // ===== 为每个文件构建 PipelineContext（不含阶段结果） =====
      const fileContexts = task.files.map(file => {
        const uploadsDir = path.join(__dirname, '../../uploads');
        const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

        const ctx: PipelineContext = {
          taskId,
          fileId: file.id,
          fileName: file.fileName,
          filePath: absolutePath,
          fileType: file.fileType,
          extractedText: '',
          reviewMode: reviewMode as any,
          maxkbKnowledgeId: maxkbKnowledgeId || undefined,
          maxkbKnowledgeIds: maxkbKnowledgeIds || undefined,
          pipelineConfig,
          refFileGroup: refFileGroupCtx,
        };

        // ★ DWG 前端 WASM 数据：如果 taskFile 已有 dwg_wasm_parsed 标记，
        //   直接填充 ctx.extractedText 和 ctx.parseResult，跳过后端 Python 解析
        const dwgMeta = (file as any).dwgMetadata as any;
        const wasmText = ((file as any).extractedText || '').trim();
        if (file.fileType.toLowerCase() === 'dwg' && dwgMeta?.dwg_wasm_parsed && wasmText.length > 0) {
          // 用前端 WASM 提取的文本预填充
          ctx.extractedText = wasmText;

          // ★ 从 WASM 数据动态计算 layer_stats（解锁 DWG_DIM_001 / DWG_OVERLAP_001 规则）
          const textEntities: any[] = dwgMeta.dwg_text_entities || [];
          const dimEntities: any[] = dwgMeta.dwg_dimensions || [];
          const allLayers: string[] = dwgMeta.dwg_layers || [];
          const totalEntityCount: number = dwgMeta.dwg_entity_count || 0;
          const layerStatsMap: Record<string, { text: number; dimension: number; other: number }> = {};
          for (const layer of allLayers) {
            layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
          }
          for (const e of textEntities) {
            const layer = e.layer || '0';
            if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
            layerStatsMap[layer].text++;
          }
          for (const d of dimEntities) {
            const layer = d.layer || '0';
            if (!layerStatsMap[layer]) layerStatsMap[layer] = { text: 0, dimension: 0, other: 0 };
            layerStatsMap[layer].dimension++;
          }
          // other = 总图元 - text - dimension（按比例分配到各层）
          const countedEntities = textEntities.length + dimEntities.length;
          const otherTotal = Math.max(0, totalEntityCount - countedEntities);
          if (allLayers.length > 0 && otherTotal > 0) {
            const otherPerLayer = Math.ceil(otherTotal / allLayers.length);
            for (const layer of allLayers) {
              layerStatsMap[layer].other = otherPerLayer;
            }
          }

          // ★ 从文本实体中尝试提取标题栏信息（解锁 DWG_TITLE_001 / DWG_SCALE_001）
          let titleBlock: any = undefined;
          const titleKeywords = ['图名', '图号', '比例', '设计', '审核', '校对', '批准'];
          const titleRelatedEntities = textEntities.filter(e =>
            titleKeywords.some(kw => e.text?.includes(kw))
          );
          if (titleRelatedEntities.length > 0) {
            titleBlock = { found: true };
            // 尝试从标题栏相关实体中提取字段值
            for (const e of titleRelatedEntities) {
              const t = e.text || '';
              if (t.includes('图名')) titleBlock.drawingName = t.replace(/图名[：:]\s*/, '').trim() || null;
              if (t.includes('图号')) titleBlock.drawingNo = t.replace(/图号[：:]\s*/, '').trim() || null;
              if (t.includes('设计')) titleBlock.designer = t.replace(/设计[：:]\s*/, '').trim() || null;
              if (t.includes('校对')) titleBlock.checker = t.replace(/校对[：:]\s*/, '').trim() || null;
              if (t.includes('审核') || t.includes('批准')) titleBlock.approver = t.replace(/[审核批准][：:]\s*/, '').trim() || null;
              if (t.includes('比例')) {
                const scaleMatch = t.match(/1\s*[:：]\s*\d+|\d+\s*[:：]\s*1/i);
                titleBlock.scale = scaleMatch ? scaleMatch[0] : t.replace(/比例[：:]\s*/, '').trim() || null;
              }
            }
          }

          // 构建 parseResult 供 Pipeline 消费
          ctx.parseResult = {
            text: ctx.extractedText,
            pages: [],
            metadata: {
              page_count: 0,
              has_tables: false,
              has_images: false,
              dwg_layers: allLayers,
              dwg_text_count: dwgMeta.dwg_text_count || 0,
              dwg_dimension_count: dwgMeta.dwg_dimension_count || 0,
              dwg_entity_count: totalEntityCount,
              dwg_converted: dwgMeta.dwg_converted ?? true,
              layer_stats: layerStatsMap,
              title_block: titleBlock,
            } as any,
            structure: {
              paragraphs: textEntities.map((e: any) => ({
                text: e.text,
                style: e.layer,
                page: null,
                handle: e.handle,
                entityType: e.entityType,  // ★ 修复: 传递 entityType 以正确区分 TEXT/MTEXT
              })),
              tables: [],
              headers: [],
              dimensions: dimEntities,
              standardRefs: dwgMeta.dwg_standard_refs || [],
            },
            markdown: ctx.extractedText,
          };
          console.log(`[Review] DWG WASM 数据已预填充: ${file.fileName}, 文本${ctx.extractedText.length}字符, 标注${dwgMeta.dwg_dimension_count || 0}个, 图层统计${Object.keys(layerStatsMap).length}层${titleBlock ? ', 标题栏已识别' : ''}`);
        }

        return { file, ctx };
      });

      // ===== 阶段1: 所有文件并行规则审查（快速，毫秒~秒级，无需限流） =====
      console.log(`[Review] 阶段1开始: ${totalFiles} 个文件并行规则审查`);
      WebSocketService.emitTaskProgress(taskId, {
        type: 'phase1_start',
        step: '规则审查',
        progress: 5,
        message: `开始并行规则审查（${totalFiles} 个文件）`,
        timestamp: Date.now(),
      });

      // 阶段1：规则审查全部并行（资源消耗低，快速响应）
      const fastPhasePromises = fileContexts.map(({ file, ctx }, index) =>
        this.runFileFastPhase(taskId, file, ctx, index, totalFiles)
          .then(res => ({ ...res, fileId: file.id, fileName: file.fileName }))
          .catch(error => ({ error, fileId: file.id, fileName: file.fileName, ruleIssues: [] as any[], stdRefIssues: [] as any[] }))
      );
      const fastPhaseResults = await Promise.all(fastPhasePromises);

      // 获取阶段2的并发限制（默认 3，AI审查耗资源，需要限流）
      const maxConcurrent = pipelineConfig.maxConcurrentReviews || 3;

      // ===== 批量入库: 阶段1结果 =====
      let fastSuccessCount = 0;
      let fastFailedCount = 0;
      for (const result of fastPhaseResults) {
        if ('error' in result) {
          fastFailedCount++;
          console.error(`[Review] 文件 ${result.fileName} 阶段1失败:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          fastSuccessCount++;
          // 阶段1结果已在 runFileFastPhase 中入库，此处仅推送 WebSocket
          WebSocketService.emitTaskProgress(taskId, {
            type: 'fast_phase_complete',
            step: '规则审查完成',
            progress: 40,
            message: `规则审查完成: ${result.ruleIssues.length} 个规则问题, ${result.stdRefIssues.length} 个标准引用问题`,
            fileName: result.fileName,
            phase: 'phase1',
            ruleCount: result.ruleIssues.length,
            stdRefCount: result.stdRefIssues.length,
            timestamp: Date.now(),
          });
        }
      }

      console.log(`[Review] 阶段1完成: 成功 ${fastSuccessCount}, 失败 ${fastFailedCount}`);

      // ===== 阶段2: 用户级别并发 AI 审查 =====
      // 使用 capabilities.ai 判断是否需要 AI 审查（能力驱动，替代原先硬编码 needsAI）
      const pipeline = await createPipelineAsync(reviewMode as any);
      const needsAI = pipeline.capabilities.ai;

      let slowPhaseResults: any[] = [];
      if (!needsAI) {
        // 不需要 AI 审查的模式，直接标记文件完成
        console.log(`[Review] 阶段2跳过: ${reviewMode} 模式不需要 AI 审查`);
        for (const { file } of fileContexts) {
          await prisma.taskFile.update({
            where: { id: file.id },
            data: { status: 'COMPLETED' },
          }).catch(() => { /* ignore */ });
        }
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI 深度审查',
          progress: 45,
          message: `${pipeline.displayName}模式无需 AI 审查，直接完成`,
          timestamp: Date.now(),
        });
      } else {
        // 注意：阶段2使用 ctx 中已填充的 extractedText 和 pdfPages
        console.log(`[Review] 阶段2开始: ${totalFiles} 个文件 AI 审查 (用户 ${task.creatorId} 并发上限 ${maxConcurrent})`);
        console.log(`[Review] 用户 ${task.creatorId} 当前并发数: ${this.getUserProcessingCount(task.creatorId)}`);
        WebSocketService.emitTaskProgress(taskId, {
          type: 'phase2_start',
          step: 'AI 深度审查',
          progress: 45,
          message: `开始 AI 审查（${totalFiles} 个文件，用户并发上限 ${maxConcurrent}）`,
          timestamp: Date.now(),
        });

        // 用户级别并发执行阶段2（每个用户独立限流）
        slowPhaseResults = await this.runUserLevelConcurrency(
          task.creatorId,
          fileContexts,
          maxConcurrent,
          ({ file, ctx }, index) =>
            this.runFileSlowPhase(taskId, file, ctx, index, totalFiles)
              .then(res => ({ ...res, fileId: file.id, fileName: file.fileName }))
              .catch(error => ({ error, fileId: file.id, fileName: file.fileName, aiIssues: [] as any[] }))
        );
      } // end of needsAI else

      // ===== 批量入库: 阶段2结果 =====
      let slowSuccessCount = 0;
      let slowFailedCount = 0;
      for (const result of slowPhaseResults) {
        const isError = 'error' in result;
        if (isError) {
          slowFailedCount++;
          console.error(`[Review] 文件 ${result.fileName} 阶段2失败:`, result.error);
          await this.createErrorDetail(taskId, result.fileId, result.fileName, result.error);
        } else {
          slowSuccessCount++;
          // 推送阶段2完成事件
          WebSocketService.emitTaskProgress(taskId, {
            type: 'slow_phase_complete',
            step: 'AI审查完成',
            progress: 80,
            message: `AI审查完成: ${result.aiIssues.length} 个问题 (${result.usedEngine || 'unknown'})`,
            fileName: result.fileName,
            phase: 'phase2',
            aiCount: result.aiIssues.length,
            usedEngine: result.usedEngine,
            timestamp: Date.now(),
          });
        }
        // 更新文件状态
        const fileStatus = isError ? 'FAILED' : 'COMPLETED';
        await prisma.taskFile.update({
          where: { id: result.fileId },
          data: { status: fileStatus },
        }).catch(() => { /* ignore */ });
      }

      console.log(`[Review] 阶段2完成: 成功 ${slowSuccessCount}, 失败 ${slowFailedCount}`);

      // ===== 跨文件一致性检查 =====
      // 使用 capabilities.crossFile 判断（能力驱动，替代原先硬编码模式列表）
      const crossFileNeeded = pipeline.capabilities.crossFile && totalFiles >= 2;
      if (crossFileNeeded) {
        WebSocketService.emitTaskProgress(taskId, {
          type: 'cross_file_check',
          step: '跨文件一致性检查',
          progress: 90,
          message: '正在进行跨文件一致性检查...',
          timestamp: Date.now(),
        });

        try {
          const crossIssueCount = await CrossFileConsistencyService.check(taskId, task.files);
          console.log(`[Review] 跨文件一致性检查完成: 发现 ${crossIssueCount} 个不一致`);
          WebSocketService.emitTaskProgress(taskId, {
            type: 'cross_file_done',
            step: '一致性检查完成',
            progress: 95,
            message: `发现 ${crossIssueCount} 个不一致问题`,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error(`[Review] 跨文件一致性检查失败: ${taskId}`, error);
        }
      }

      // ===== 更新任务状态 =====
      const successCount = slowSuccessCount;
      const failedCount = slowFailedCount;
      const newStatus = failedCount === totalFiles ? 'FAILED' : 'COMPLETED';

      await prisma.task.update({
        where: { id: taskId },
        data: { status: newStatus },
      });

      // ===== 最终推送 =====
      WebSocketService.emitTaskProgress(taskId, {
        type: newStatus === 'COMPLETED' ? 'completed' : 'failed',
        step: newStatus === 'COMPLETED' ? '全部完成' : '任务失败',
        progress: 100,
        message: newStatus === 'COMPLETED'
          ? `审查完成，成功 ${successCount} 个文件，失败 ${failedCount} 个`
          : `所有 ${failedCount} 个文件审查失败`,
        result: { successCount, failedCount, fastSuccessCount, fastFailedCount },
        timestamp: Date.now(),
      });

      WebSocketService.emitToUser(task.creatorId, {
        type: 'task_complete',
        title: newStatus === 'COMPLETED' ? '审查任务完成' : '审查任务失败',
        message: newStatus === 'COMPLETED'
          ? `任务「${task.title}」已完成，${successCount} 个文件审查完成`
          : `任务「${task.title}」审查失败，所有文件处理均未成功`,
        taskId,
        status: newStatus,
      });

      console.log(`[Review] 任务处理完成: ${taskId}, 阶段1成功=${fastSuccessCount}, 阶段2成功=${successCount}, 失败=${failedCount}`);
    } catch (error) {
      console.error(`[Review] 任务处理异常: ${taskId}`, error);
      try {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
        WebSocketService.emitTaskProgress(taskId, {
          type: 'error',
          step: '任务异常',
          progress: 0,
          message: `任务处理异常: ${error instanceof Error ? error.message : '未知错误'}`,
          timestamp: Date.now(),
        });
      } catch (e) { /* ignore */ }
    }
  }

  // ==================== 两阶段文件处理方法 ====================

  /**
   * 阶段1: 规则审查 + 标准引用检查
   * - 文本提取（Parser + OCR）
   * - PDF 逐页解析 / Word 结构化
   * - 规则引擎检查
   * - 标准引用规范性检查
   *
   * 完成后立即入库并返回结果（不含 AI 结果）
   */
  static async runFileFastPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ ruleIssues: any[]; stdRefIssues: any[] }> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

    // 推送文件阶段1开始
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_fast_start',
      step: `规则审查 ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `开始规则审查: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase1',
      timestamp: Date.now(),
    });

    // 标记文件为处理中
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { status: 'PROCESSING' },
    }).catch(() => { /* ignore */ });

    // 选择 Pipeline 并执行阶段1
    const pipeline = await createPipelineAsync(ctx.reviewMode);

    // 预提取文本（用于进度分母计算）
    // ★ 如果 ctx.extractedText 已有前端 WASM 数据，跳过 Python 解析
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const preText = await ParserService.parseFile(absolutePath, file.fileType);
        if (preText && preText.trim().length > 0) {
          ctx.extractedText = preText;
        }
      } catch (e) { /* 预提取失败不影响 pipeline */ }
    }

    const textLength = ctx.extractedText?.length || 0;
    // WASM 路径下 extractedMarkdown 使用 ctx.extractedText；其他路径使用 ParserService 的结果
    const extractedMarkdown = (ctx.fileType.toLowerCase() === 'dwg' && ctx.extractedText)
      ? ctx.extractedText
      : (ParserService.getLastMarkdown() || null);
    // DWG 元数据：保存图层、图元统计等
    const dwgMetadata = (ctx.parseResult?.metadata && ctx.fileType.toLowerCase() === 'dwg')
      ? {
          dwg_layers: ctx.parseResult.metadata.dwg_layers,
          dwg_text_count: ctx.parseResult.metadata.dwg_text_count,
          dwg_dimension_count: ctx.parseResult.metadata.dwg_dimension_count,
          dwg_entity_count: ctx.parseResult.metadata.dwg_entity_count,
          dwg_converted: ctx.parseResult.metadata.dwg_converted,
          title_block: ctx.parseResult.metadata.title_block,
          layer_stats: ctx.parseResult.metadata.layer_stats,
        }
      : undefined;
    await prisma.taskFile.update({
      where: { id: file.id },
      data: {
        textLength, processedLength: 0,
        extractedText: ctx.extractedText || null,
        extractedMarkdown,
        ...(dwgMetadata ? { dwgMetadata } : {}),
      },
    }).catch(() => { /* ignore */ });

    // 执行阶段1
    const fastResult = await pipeline.runFastPhase(ctx);

    // 批量写入规则结果
    const allFastIssues: any[] = [];

    if (fastResult.ruleIssues.length > 0) {
      const ruleData = fastResult.ruleIssues.map((issue) => ({
        taskId, fileId: file.id,
        issueType: issue.issueType, ruleCode: issue.ruleCode,
        severity: issue.severity,
        originalText: issue.originalText,
        suggestedText: issue.suggestedText || null,
        description: issue.description,
        cadHandleId: (issue as any).cadHandleId || null,
        textPosition: (issue.originalText && ctx.extractedText)
          ? LlmService.findTextPosition(ctx.extractedText, issue.originalText)
          : null,
      }));
      await prisma.taskDetail.createMany({ data: ruleData }).catch(() => { /* ignore */ });
      allFastIssues.push(...ruleData);
    }

    if (fastResult.stdRefIssues.length > 0) {
      const stdRefData = fastResult.stdRefIssues.map((issue) => ({
        taskId, fileId: file.id,
        issueType: issue.issueType,
        ruleCode: issue.ruleCode || null,
        severity: issue.severity || 'warning',
        originalText: issue.originalText,
        suggestedText: issue.suggestedText || null,
        description: issue.description || null,
        matchLevel: (issue as any).matchLevel || null,
        similarity: (issue as any).similarity || null,
        diffRanges: issue.diffRanges || null,
        textPosition: (issue.originalText && ctx.extractedText)
          ? LlmService.findTextPosition(ctx.extractedText, issue.originalText)
          : null,
      }));
      await prisma.taskDetail.createMany({ data: stdRefData }).catch(() => { /* ignore */ });
      allFastIssues.push(...stdRefData);
    }

    // 无文本时写入警告
    if (!fastResult.textLength && allFastIssues.length === 0) {
      const isDwg = file.fileType.toLowerCase() === 'dwg';
      await prisma.taskDetail.create({
        data: {
          taskId, fileId: file.id,
          issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
          originalText: file.fileName,
          description: isDwg
            ? 'DWG 文件未能提取文本内容（前端 WASM 解析可能未成功）。图纸审查可能不完整，建议人工检查。'
            : '文件内容无法提取。可能是扫描件或图片型 PDF，且 OCR 识别未能成功获取文字。建议人工审查。',
        },
      }).catch(() => { /* ignore */ });
    }

    // DWG 文件特殊处理：保存尺寸标注和标准引用（含 cadHandleId）
    if (file.fileType.toLowerCase() === 'dwg') {
      // 优先使用 ctx.parseResult（WASM 或 Python 解析的结果）
      const parseResult = ctx.parseResult || ParserService.getLastParseResult();
      if (parseResult && ctx.extractedText && ctx.extractedText.trim().length > 0) {
        const dwgDetails: any[] = [];

        // 尺寸标注
        if (parseResult.structure.dimensions && parseResult.structure.dimensions.length > 0) {
          for (const dim of parseResult.structure.dimensions) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: null, severity: 'info' as const,
              originalText: dim.text || dim.measurement || '',
              suggestedText: null,
              description: `图层: ${dim.layer}, 类型: ${dim.entity_type}`,
              cadHandleId: dim.handle || null,
            });
          }
        }

        // 标准引用（从 DWG 解析器提取，含 cadHandleId）
        if ((parseResult.structure as any).standardRefs && (parseResult.structure as any).standardRefs.length > 0) {
          for (const ref of (parseResult.structure as any).standardRefs) {
            dwgDetails.push({
              taskId, fileId: file.id,
              issueType: 'VIOLATION' as const,
              ruleCode: 'DWG_STDREF_001' as const,
              severity: 'info' as const,
              originalText: ref.fullMatch || ref.standardNo,
              suggestedText: null,
              description: `DWG 标准引用: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
              cadHandleId: ref.cadHandleId || null,
            });
          }
        }

        if (dwgDetails.length > 0) {
          await prisma.taskDetail.createMany({ data: dwgDetails }).catch(() => { /* ignore */ });
        }
      }
    }

    // 更新错误计数
    await this.updateFileErrorCount(file.id).catch(() => { /* ignore */ });

    console.log(`[Review] 文件 ${file.fileName} 阶段1完成: 规则=${fastResult.ruleIssues.length}, 标准引用=${fastResult.stdRefIssues.length}`);

    return { ruleIssues: fastResult.ruleIssues, stdRefIssues: fastResult.stdRefIssues };
  }

  /**
   * 阶段2: AI 深度审查
   * - 使用阶段1已提取的 ctx.extractedText 和 ctx.pdfPages
   * - 执行 AI/MaxKB/LLM 审查
   * - 完成后写入数据库并返回结果
   */
  static async runFileSlowPhase(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    ctx: PipelineContext,
    fileIndex: number,
    totalFiles: number,
  ): Promise<{ aiIssues: any[]; usedEngine?: string }> {
    const fileProgress = Math.round((fileIndex / totalFiles) * 100);

    // 推送文件阶段2开始
    WebSocketService.emitTaskProgress(taskId, {
      type: 'file_slow_start',
      step: `AI 审查 ${fileIndex + 1}/${totalFiles}`,
      progress: fileProgress,
      message: `开始 AI 深度审查: ${file.fileName}`,
      fileName: file.fileName,
      phase: 'phase2',
      timestamp: Date.now(),
    });

    // 进度回调（每个 AI 分片审查完成后立即写入 DB 并推送 WebSocket）
    ctx.onChunkProgress = async (chunkLength: number, issues: any[], chunkIndex: number, totalChunks: number, engine: string) => {
      // 1. 更新已处理字符数
      try {
        await prisma.taskFile.update({
          where: { id: file.id },
          data: { processedLength: { increment: chunkLength } },
        });
      } catch (e) { /* 忽略进度更新失败 */ }

      // 2. 该分片有问题时立即写入 DB
      if (issues && issues.length > 0) {
        const aiData = issues.map((issue) => ({
          taskId,
          fileId: file.id,
          issueType: issue.issueType,
          ruleCode: issue.ruleCode || null,
          severity: issue.severity || (['TYPO', 'FORMAT', 'NAMING', 'ENCODING', 'HEADER', 'PAGE'].includes(issue.issueType) ? 'warning' : 'error'),
          originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description || null,
          cadHandleId: issue.cadHandleId || null,
          standardRef: issue.standardRef || null,
          sourceReferences: issue.sourceReferences || null,
          matchLevel: issue.matchLevel || null,
          similarity: issue.similarity || null,
          diffRanges: issue.diffRanges || null,
          textPosition: issue.textPosition
            || (issue.originalText && ctx.extractedText
              ? LlmService.findTextPosition(ctx.extractedText, issue.originalText)
              : null),
        }));

        try {
          await prisma.taskDetail.createMany({ data: aiData });
          console.log(`[Review] 分片 ${chunkIndex}/${totalChunks} 写入 ${aiData.length} 条`);
        } catch (e) {
          console.error(`[Review] 分片写入失败:`, e);
        }

        // 3. 立即推送该分片结果到前端（用于实时追加展示）
        WebSocketService.emitChunkResult(taskId, {
          fileId: file.id,
          fileName: file.fileName,
          chunkIndex,
          totalChunks,
          issueCount: issues.length,
          issues: aiData,
          engine,
        });

        // 4. 更新文件错误计数
        this.updateFileErrorCount(file.id).catch(() => { /* ignore */ });
      }

      // 5. 所有分片完成后更新错误计数（包含0问题的情况）
      if (chunkIndex === totalChunks - 1) {
        this.updateFileErrorCount(file.id).catch(() => { /* ignore */ });
      }
    };

    // 执行阶段2
    const pipeline = await createPipelineAsync(ctx.reviewMode);
    const slowResult = await pipeline.runSlowPhase(ctx);

    // AI 结果已通过 ctx.onChunkProgress 增量写入（每个分片审查完成后立即入库 + 推送 WebSocket）
    // 此处仅做兜底：检查是否有 AI 结果记录，若无则一次性写入（极端情况下 onChunkProgress 全部失败时的保底）
    console.log(`[Review] AI 审查完成，slowResult.aiIssues.length=${slowResult.aiIssues.length}`);
    if (slowResult.aiIssues.length > 0) {
      try {
        const existing = await prisma.taskDetail.count({
          where: { taskId, fileId: file.id },
        });
        if (existing === 0) {
          // 极端保底：从未写入过，一次性写入全部
          const aiData = slowResult.aiIssues.map((issue) => ({
            taskId,
            fileId: file.id,
            issueType: issue.issueType,
            ruleCode: issue.ruleCode || null,
            severity: issue.severity || (['TYPO', 'FORMAT', 'NAMING', 'ENCODING', 'HEADER', 'PAGE'].includes(issue.issueType) ? 'warning' : 'error'),
            originalText: issue.originalText,
            suggestedText: issue.suggestedText || null,
            description: issue.description || null,
            cadHandleId: issue.cadHandleId || null,
            standardRef: issue.standardRef || null,
            sourceReferences: issue.sourceReferences || null,
            matchLevel: (issue as any).matchLevel || null,
            similarity: (issue as any).similarity || null,
            diffRanges: issue.diffRanges || null,
            textPosition: issue.textPosition
              || (issue.originalText && ctx.extractedText
                ? LlmService.findTextPosition(ctx.extractedText, issue.originalText)
                : null),
          }));
          await prisma.taskDetail.createMany({ data: aiData });
          console.log(`[Review] 兜底写入 ${aiData.length} 条`);
        }
      } catch (e) {
        console.error(`[Review] 兜底写入失败:`, e);
      }
    }

    // 推送文件阶段2完成
    WebSocketService.emitTaskProgress(taskId, {
      type: 'slow_phase_complete',
      step: 'AI 审查完成',
      progress: fileProgress + Math.round(50 / totalFiles),
      message: `AI 审查完成: ${slowResult.aiIssues.length} 个问题 (engine: ${slowResult.usedEngine || 'none'})`,
      fileName: file.fileName,
      phase: 'phase2',
      aiCount: slowResult.aiIssues.length,
      usedEngine: slowResult.usedEngine,
      timestamp: Date.now(),
    });

    console.log(`[Review] 文件 ${file.fileName} 阶段2完成: AI=${slowResult.aiIssues.length}, engine=${slowResult.usedEngine}`);

    return { aiIssues: slowResult.aiIssues, usedEngine: slowResult.usedEngine };
  }

  /**
   * 创建错误详情记录
   */
  private static async createErrorDetail(
    taskId: string,
    fileId: string,
    fileName: string,
    error: any,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await prisma.taskDetail.create({
        data: {
          taskId, fileId,
          issueType: 'VIOLATION', ruleCode: null, severity: 'error',
          originalText: fileName,
          description: `审查过程中发生错误: ${errorMessage}`,
        },
      });
      await this.updateFileErrorCount(fileId);
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 更新文件的错误计数
   */
  private static async updateFileErrorCount(fileId: string): Promise<void> {
    const count = await prisma.taskDetail.count({ where: { fileId } });
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { errorCount: count },
    });
  }

  // ==================== 以下为遗留方法（保留兼容性） ====================

  /**
   * @deprecated 使用 runFileFastPhase + runFileSlowPhase 替代
   */
  static async processFile(
    taskId: string,
    file: { id: string; fileName: string; filePath: string; fileType: string },
    reviewMode: string = 'FULL_REVIEW',
    maxkbKnowledgeId?: string,
    maxkbKnowledgeIds?: string[],
    onProgress?: (chunkProgress: number) => void,
  ): Promise<void> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

    const ctx: PipelineContext = {
      taskId,
      fileId: file.id,
      fileName: file.fileName,
      filePath: absolutePath,
      fileType: file.fileType,
      extractedText: '',
      reviewMode: reviewMode as any,
      maxkbKnowledgeId: maxkbKnowledgeId || undefined,
      maxkbKnowledgeIds: maxkbKnowledgeIds || undefined,
      onChunkProgress: onProgress,
    };

    // 预提取文本（如果已有 WASM 数据则跳过）
    if (!ctx.extractedText || ctx.extractedText.trim().length === 0) {
      try {
        const preText = await ParserService.parseFile(absolutePath, file.fileType);
        if (preText?.trim()) ctx.extractedText = preText;
      } catch (e) { /* ignore */ }
    }

    // 加载配置
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'pipeline_review_config' } });
      if (cfg?.value) ctx.pipelineConfig = cfg.value;
    } catch (e) { /* ignore */ }

    // 加载参照文件
    if (reviewMode === 'DOC_REVIEW') {
      const groups = await prisma.refFileGroup.findMany({ where: { taskId }, include: { refFiles: true } });
      if (groups.length > 0) {
        ctx.refFileGroup = {
          groupId: groups[0].id,
          groupName: groups[0].groupName,
          refFiles: groups[0].refFiles.map((rf: any) => ({
            id: rf.id,
            fileName: rf.fileName,
            filePath: path.join(uploadsDir, path.basename(rf.filePath)),
            fileType: rf.fileType,
            extractedText: rf.extractedText || undefined,
          })),
        };
      }
    }

    // 写入文本长度
    await prisma.taskFile.update({
      where: { id: file.id },
      data: { textLength: ctx.extractedText?.length || 0, processedLength: 0 },
    }).catch(() => { /* ignore */ });

    // 使用 pipeline（等同于原有逻辑）
    try {
      const pipeline = await createPipelineAsync(reviewMode as any);
      const result = await pipeline.execute(ctx);

      // 写 AI 结果
      if (result.aiIssues.length > 0) {
        await prisma.taskDetail.createMany({
          data: result.aiIssues.map((issue) => ({
            taskId, fileId: file.id,
            issueType: issue.issueType,
            ruleCode: issue.ruleCode || null,
            severity: issue.severity || 'warning',
            originalText: issue.originalText,
            suggestedText: issue.suggestedText || null,
            description: issue.description || null,
            cadHandleId: issue.cadHandleId || null,
            standardRef: issue.standardRef || null,
            sourceReferences: issue.sourceReferences || null,
            matchLevel: (issue as any).matchLevel || null,
            similarity: (issue as any).similarity || null,
            diffRanges: issue.diffRanges || null,
          })),
        });
      }

      // 无文本警告
      if (!ctx.extractedText && result.ruleIssues.length === 0 && result.aiIssues.length === 0) {
        await prisma.taskDetail.create({
          data: {
            taskId, fileId: file.id,
            issueType: 'VIOLATION', ruleCode: null, severity: 'warning',
            originalText: file.fileName,
            description: '文件内容无法提取。可能是扫描件或图片型 PDF，建议人工审查。',
          },
        });
      }

      // DWG 处理：保存尺寸标注和标准引用（含 cadHandleId）
      if (file.fileType.toLowerCase() === 'dwg') {
        const parseResult = ParserService.getLastParseResult();
        if (parseResult && ctx.extractedText?.trim()) {
          const dwgDetails: any[] = [];

          if (parseResult.structure.dimensions?.length) {
            for (const dim of parseResult.structure.dimensions) {
              dwgDetails.push({
                taskId, fileId: file.id,
                issueType: 'VIOLATION' as const,
                ruleCode: null, severity: 'info' as const,
                originalText: dim.text || dim.measurement || '',
                suggestedText: null,
                description: `图层: ${dim.layer}, 类型: ${dim.entity_type}`,
                cadHandleId: dim.handle || null,
              });
            }
          }

          if ((parseResult.structure as any).standardRefs?.length) {
            for (const ref of (parseResult.structure as any).standardRefs) {
              dwgDetails.push({
                taskId, fileId: file.id,
                issueType: 'VIOLATION' as const,
                ruleCode: 'DWG_STDREF_001' as const,
                severity: 'info' as const,
                originalText: ref.fullMatch || ref.standardNo,
                suggestedText: null,
                description: `DWG 标准引用: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
                cadHandleId: ref.cadHandleId || null,
              });
            }
          }

          if (dwgDetails.length > 0) {
            await prisma.taskDetail.createMany({ data: dwgDetails });
          }
        }
      }

      await this.updateFileErrorCount(file.id);
    } catch (error) {
      console.error(`[Review] Pipeline 执行失败: ${file.fileName}`, error);
      await this.createErrorDetail(taskId, file.id, file.fileName, error);
    }
  }
}
