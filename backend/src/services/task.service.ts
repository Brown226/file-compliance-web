import prisma from '../config/db';
import { Task, TaskDetail, TaskFile, TaskStatus } from '@prisma/client';
import path from 'path';
import ExcelJS from 'exceljs';
import { ReviewService } from './review.service';
import { addReviewJob } from './queue.service';
import FalsePositiveLibraryService from './falsePositiveLibrary.service';
import { ParserService } from './parser.service';
import { ReviewPlan, ReviewEvidenceSource, normalizeEvidenceSources, isReviewObjective } from '../types/review-plan';
import { ReviewModeType } from './review-pipeline/types';

export class TaskService {
  /** 从 ReviewPlan 推导 Pipeline 需要的模式标识（内部分发用，不暴露给前端） */
  static resolvePipelineSelector(plan: ReviewPlan): ReviewModeType {
    if (plan.objective === 'COMPARE') return 'DOC_REVIEW';
    if (plan.objective === 'PROOFREAD') return 'TYPO_GRAMMAR';
    if (plan.objective === 'STRUCTURED') return 'MULTIMODAL';
    if (plan.execution.profile === 'RULE_ONLY' && plan.evidence.sources.includes('REVIEW_SPECIFICATION')) {
      return 'CUSTOM_RULE';
    }
    // crossFile 由 enhancements 动态控制，模式本身用 LIBRARY_REVIEW
    return 'LIBRARY_REVIEW';
  }

  static normalizeReviewPlan(input: any): ReviewPlan {
    if (input && isReviewObjective(input.objective)) {
      const objective = input.objective;
      const sources = normalizeEvidenceSources(input?.evidence?.sources);
      const normalizedSources: ReviewEvidenceSource[] = sources.length > 0
        ? sources
        : (objective === 'COMPARE' ? ['REFERENCE'] as ReviewEvidenceSource[] : objective === 'PROOFREAD' ? [] : ['STANDARD'] as ReviewEvidenceSource[]);

      return {
        objective,
        evidence: {
          sources: objective === 'COMPARE'
            ? (normalizedSources.includes('REFERENCE') ? normalizedSources : ['REFERENCE'] as ReviewEvidenceSource[])
            : normalizedSources,
          knowledgeCategoryIds: Array.isArray(input?.evidence?.knowledgeCategoryIds) ? input.evidence.knowledgeCategoryIds : [],
          reviewSpecificationId: typeof input?.evidence?.reviewSpecificationId === 'string' && input.evidence.reviewSpecificationId.trim()
            ? input.evidence.reviewSpecificationId.trim()
            : null,
          ruleLibraryId: typeof input?.evidence?.ruleLibraryId === 'string' && input.evidence.ruleLibraryId.trim()
            ? input.evidence.ruleLibraryId.trim()
            : null,
          refFileGroupId: typeof input?.evidence?.refFileGroupId === 'string' && input.evidence.refFileGroupId.trim()
            ? input.evidence.refFileGroupId.trim()
            : null,
          enabledPrefixes: Array.isArray(input?.evidence?.enabledPrefixes) ? input.evidence.enabledPrefixes.filter((p: any) => typeof p === 'string') : undefined,
        },
        enhancements: {
          intraFileConsistency: !!input?.enhancements?.intraFileConsistency,
          crossFileConsistency: !!input?.enhancements?.crossFileConsistency,
        },
        execution: {
          profile: input?.execution?.profile === 'RULE_ONLY' ? 'RULE_ONLY' : 'HYBRID',
        },
        templateId: typeof input?.templateId === 'string' && input.templateId.trim() ? input.templateId.trim() : undefined,
      };
    }
    // 兜底：无有效 plan 时默认合规审查 + 标准依据
    return {
      objective: 'COMPLIANCE',
      evidence: { sources: ['STANDARD'], knowledgeCategoryIds: [], reviewSpecificationId: null, refFileGroupId: null },
      enhancements: { intraFileConsistency: false, crossFileConsistency: false },
      execution: { profile: 'HYBRID' },
    };
  }

  /**
   * 解码文件名：处理浏览器传输中文文件名时的编码问题
   * 某些浏览器（如 Chrome）会将非 ASCII 字符以 latin1 编码传输
   */
  static decodeFileName(originalName: string): string {
    // 尝试从 latin1 解码为 utf8
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
      // 验证解码结果是否包含有效中文字符且不含乱码特征字符
      if (/[\u4e00-\u9fff\u3000-\u303f]/.test(decoded) && !/[�]/.test(decoded)) {
        return decoded;
      }
    } catch (e) {
      // 解码失败则返回原始名称
    }
    return originalName;
  }

  static async createTask(data: {
    title: string;
    description?: string;
    creatorId: string;
    standardId?: string;
    standardIds?: string[];  // 多标准关联
    knowledgeCategoryId?: string;  // 用户选择的知识库ID
    knowledgeCategoryIds?: string[];  // 用户选择的多个知识库ID
    reviewSpecificationId?: string;
    ruleLibraryId?: string;  // 关联的规则库 ID
    perspective?: string;  // 审查立场
    preAnalysisData?: any;  // 预分析完整数据
    reviewPlan?: any;       // 审查方案
    reviewPoints?: string[];  // 用户选中的审查点
    corePurposes?: string[];  // 用户自定义的核心目的
    selectedTemplateId?: string;  // 选择的审查模板ID
    intraFileConsistency?: boolean;  // 文件内一致性检查
    files?: Express.Multer.File[];
    dwgParsedData?: Record<string, any>;  // 前端 WASM 解析的 DWG 数据（按文件名映射）
  }): Promise<Task> {
    const { title, description, creatorId, standardId, standardIds = [], knowledgeCategoryId, knowledgeCategoryIds,
      reviewSpecificationId, ruleLibraryId, perspective, preAnalysisData, reviewPlan, reviewPoints, corePurposes, selectedTemplateId, intraFileConsistency,
      files = [], dwgParsedData } = data;

    // 合并标准 ID：保留单选兼容，同时写入多选
    const allStandardIds = [...new Set([standardId, ...standardIds].filter((id): id is string => Boolean(id)))];
    const normalizedReviewPlan = this.normalizeReviewPlan(reviewPlan);

    // 服务端兜底校验：防止前端绕过约束
    if (normalizedReviewPlan.objective === 'COMPARE' && files.length > 0 && !data.files?.length) {
      throw new Error('参照比对模式缺少待审文件');
    }
    if (normalizedReviewPlan.objective === 'COMPARE' && !normalizedReviewPlan.evidence.sources.includes('REFERENCE')) {
      throw new Error('参照比对模式必须使用参考文件作为审查依据');
    }
    if (normalizedReviewPlan.execution.profile === 'RULE_ONLY') {
      const hasDirectPrefixes = Array.isArray(normalizedReviewPlan.evidence.enabledPrefixes) && normalizedReviewPlan.evidence.enabledPrefixes.length > 0;
      if (!hasDirectPrefixes && !normalizedReviewPlan.evidence.reviewSpecificationId && !normalizedReviewPlan.evidence.ruleLibraryId && !reviewSpecificationId && !ruleLibraryId) {
        throw new Error('仅规则执行模式必须指定审查规范集或启用的规则前缀');
      }
    }
    const resolvedReviewMode = this.resolvePipelineSelector(normalizedReviewPlan);
    const shouldDelayReview = normalizedReviewPlan.objective === 'COMPARE';

    // 知识库 ID：多选优先，回退到单选
    // 存储策略：将多个知识库 ID 存为 JSON 字符串到 knowledgeCategoryId 字段
    let knowledgeIdForDb: string | null = null;
    if (knowledgeCategoryIds && knowledgeCategoryIds.length > 0) {
      knowledgeIdForDb = JSON.stringify(knowledgeCategoryIds);
    } else if (knowledgeCategoryId) {
      knowledgeIdForDb = knowledgeCategoryId;
    }

    // 构建 preAnalysisData JSON（合并预分析结果和用户选择）
    const preAnalysisJson = preAnalysisData
      ? {
          ...(typeof preAnalysisData === 'string' ? JSON.parse(preAnalysisData) : preAnalysisData),
          reviewPoints: reviewPoints || [],
          corePurposes: corePurposes || [],
          selectedTemplateId: selectedTemplateId || 'general',
          intraFileConsistency: !!intraFileConsistency,
        }
      : (reviewPoints || corePurposes || selectedTemplateId || intraFileConsistency) ? {
          reviewPoints: reviewPoints || [],
          corePurposes: corePurposes || [],
          selectedTemplateId: selectedTemplateId || 'general',
          intraFileConsistency: !!intraFileConsistency,
        } : undefined;

    normalizedReviewPlan.evidence.knowledgeCategoryIds = knowledgeCategoryIds || normalizedReviewPlan.evidence.knowledgeCategoryIds || [];
    if (reviewSpecificationId) normalizedReviewPlan.evidence.reviewSpecificationId = reviewSpecificationId;
    if (ruleLibraryId) normalizedReviewPlan.evidence.ruleLibraryId = ruleLibraryId;
    if (intraFileConsistency !== undefined) normalizedReviewPlan.enhancements.intraFileConsistency = !!intraFileConsistency;

    const hasRuleSource = (normalizedReviewPlan.evidence.sources.includes('REVIEW_SPECIFICATION') || normalizedReviewPlan.evidence.sources.includes('RULE_LIBRARY'))
      && (!!(normalizedReviewPlan.evidence.reviewSpecificationId || normalizedReviewPlan.evidence.ruleLibraryId));
    const effectiveStandardIds = hasRuleSource ? [] : allStandardIds;

    // 创建任务
    const task = await prisma.task.create({
      data: {
        title,
        description,
        creatorId,
        standardId: hasRuleSource ? null : (standardId || effectiveStandardIds[0] || null),
        reviewMode: resolvedReviewMode as any,
        knowledgeCategoryId: knowledgeIdForDb,
        reviewSpecificationId: normalizedReviewPlan.evidence.reviewSpecificationId || null,
        ruleLibraryId: normalizedReviewPlan.evidence.ruleLibraryId || null,
        perspective: perspective || null,
        preAnalysisData: preAnalysisJson || undefined,
        reviewPlan: normalizedReviewPlan as any,
        // DOC_REVIEW 需要先上传参照文件，创建时先保持 PENDING，待 ref-files 上传后再触发
        status: files.length > 0 && !shouldDelayReview ? 'PROCESSING' : 'PENDING',
      },
    });

    // 创建多标准关联
    if (effectiveStandardIds.length > 0) {
      await prisma.taskStandard.createMany({
        data: effectiveStandardIds.map(sid => ({
          taskId: task.id,
          standardId: sid,
        })),
      });
    }

    // 创建文件记录
    if (files.length > 0) {
      // ★ 预处理 dwgParsedData：支持按索引("idx_N")和按文件名两种映射方式
      // 新版前端使用 idx_N 格式（避免同名文件覆盖），旧版使用文件名
      const dwgByIdx: Record<number, any> = {};
      const dwgByName: Record<string, any> = {};
      if (dwgParsedData) {
        for (const [key, val] of Object.entries(dwgParsedData)) {
          const idxMatch = key.match(/^idx_(\d+)$/);
          if (idxMatch) {
            dwgByIdx[parseInt(idxMatch[1])] = val;
          } else {
            dwgByName[key] = val;
          }
        }
      }

      // 构建按文件索引的 DWG 匹配表（仅对 DWG 文件计数）
      let dwgFileIndex = 0;

      await prisma.taskFile.createMany({
        data: files.map((file) => {
          const decodedName = TaskService.decodeFileName(file.originalname);
          const fileType = path.extname(file.originalname).toLowerCase().replace('.', '');
          // 匹配前端 WASM 解析数据：优先按 idx 索引匹配，其次按文件名匹配（兼容旧版）
          let wasmData = dwgByIdx[dwgFileIndex];
          if (!wasmData) {
            wasmData = dwgByName[decodedName] || dwgByName[file.originalname];
          }
          if (fileType.toLowerCase() === 'dwg') {
            dwgFileIndex++;  // 仅 DWG 文件递增索引
          }
          return {
            taskId: task.id,
            fileName: decodedName,
            filePath: `/uploads/${file.filename}`,
            fileSize: file.size,
            fileType,
            // DWG WASM 数据：提取文本 + 元数据存储到 dwgMetadata
            ...(wasmData && fileType === 'dwg' ? {
              extractedText: wasmData.text || '',
              dwgMetadata: {
                dwg_layers: wasmData.layers || [],
                dwg_text_count: wasmData.metadata?.textCount || 0,
                dwg_dimension_count: wasmData.metadata?.dimensionCount || 0,
                dwg_entity_count: wasmData.metadata?.entityCount || 0,
                dwg_converted: wasmData.metadata?.converted || false,
                dwg_text_entities: wasmData.textEntities || [],
                dwg_dimensions: wasmData.dimensions || [],
                dwg_standard_refs: wasmData.standardRefs || [],
                dwg_wasm_parsed: true,  // 标记为前端 WASM 解析
              },
            } : {}),
          };
        }),
      });
    }

    // 返回带文件的任务
    const result = await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        files: true,
        creator: {
          select: { id: true, username: true, name: true },
        },
      },
    }) as Task;

    // 异步触发审查流程（增强版：带错误处理和状态保护）
    if (files.length > 0 && !shouldDelayReview) {
      try {
        const job = await addReviewJob(task.id);
        console.log(`[TaskService] ✅ 任务入队成功: ${task.id}, jobId=${job.id}, state=waiting`);

        // 8秒后检查job是否开始执行（防止队列处理器未启动）
        setTimeout(async () => {
          try {
            const jobState = await job.getState();
            if (jobState === 'waiting' || jobState === 'delayed') {
              console.warn(`[TaskService] ⚠️ 任务仍在等待执行: ${task.id}, state=${jobState}, 可能队列处理器未启动或Redis连接异常`);

              // 可选：更新任务状态提示用户（不强制改为PENDING，避免影响正在排队的任务）
              // await prisma.task.update({ where: { id: task.id }, data: { status: 'PENDING' } });
            }
          } catch (checkErr) {
            console.warn(`[TaskService] 任务状态检查失败: ${task.id}`, checkErr);
          }
        }, 8000);
      } catch (queueError) {
        console.error(`[TaskService] ❌ 任务入队失败: ${task.id}`, queueError);

        // 回滚任务状态为PENDING，让用户知道需要手动重试或联系管理员
        try {
          await prisma.task.update({
            where: { id: task.id },
            data: { 
              status: 'PENDING',
              // 在description中记录失败原因，方便用户查看
              description: `${result.description || ''}\n\n⚠️ 入队失败: ${queueError instanceof Error ? queueError.message : String(queueError)}`.trim(),
            },
          });
          console.log(`[TaskService] 🔄 已回滚任务状态为PENDING: ${task.id}`);
        } catch (rollbackErr) {
          console.error(`[TaskService] ❌ 状态回滚也失败: ${task.id}`, rollbackErr);
        }

        // 注意：不抛出错误，仍返回任务对象给前端（前端可根据status=PENDING判断异常）
      }
    }

    return result;
  }

  static async getTasks(params: { 
    skip?: number; 
    take?: number; 
    status?: TaskStatus;
    reviewMode?: string;
    search?: string;
    creator?: string;
    startDate?: string;
    endDate?: string;
    creatorId?: string;
    [key: string]: any;
  }): Promise<{ total: number; tasks: any[] }> {
    const { skip = 0, take = 10, status, reviewMode, search, creator, startDate, endDate, creatorId, ...restFilter } = params;

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (reviewMode) {
      where.reviewMode = reviewMode;
    }
    if (creatorId) {
      where.creatorId = creatorId;
    }
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }
    if (creator) {
      where.creator = { name: { contains: creator, mode: 'insensitive' } };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }
    // 合并 RBAC 过滤条件
    Object.assign(where, restFilter);

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        skip,
        take,
        include: {
          creator: {
            select: { id: true, username: true, name: true }
          },
          _count: {
            select: { files: true, details: true }
          },
          files: {
            select: { status: true, textLength: true, processedLength: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // 转换 _count 为文件数和错误数，计算进度
    const result = tasks.map(({ _count, files, ...task }) => {
      // 按内容字符数计算进度
      let totalTextLength = 0;
      let totalProcessedLength = 0;
      for (const f of files) {
        totalTextLength += (f as any).textLength || 0;
        if ((f as any).status === 'COMPLETED' || (f as any).status === 'FAILED') {
          totalProcessedLength += (f as any).textLength || 0;
        } else {
          totalProcessedLength += (f as any).processedLength || 0;
        }
      }

      let progress = totalTextLength > 0 ? Math.round((totalProcessedLength / totalTextLength) * 100) : 0;
      if (task.status === 'COMPLETED') progress = 100;
      if (task.status === 'PENDING') progress = 0;

      const isSelfCheck = task.reviewMode === 'SELF_CHECK';
      const errorCount = isSelfCheck
        ? (task.selfCheckReport as any)?.errorCount ?? 0
        : _count.details;

      return {
        ...task,
        fileCount: _count.files,
        errorCount,
        progress,
      };
    });

    return { total, tasks: result };
  }

  static async getTaskById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, name: true }
        },
        standard: { select: { id: true, title: true, version: true } },
        taskStandards: {
          include: { standard: { select: { id: true, title: true, version: true } } }
        },
        files: {
          orderBy: { createdAt: 'asc' }
        },
        refFileGroups: {
          include: { refFiles: true }
        },
      }
    });
  }

  static async createRefFileGroup(data: {
    taskId: string;
    groupName?: string;
    description?: string;
    files: Express.Multer.File[];
  }): Promise<any> {
    const { taskId, groupName = '默认参照组', description, files } = data;

    const group = await prisma.refFileGroup.create({
      data: { taskId, groupName, description },
    });

    if (files.length > 0) {
      await prisma.refFile.createMany({
        data: files.map((file) => ({
          groupId: group.id,
          fileName: TaskService.decodeFileName(file.originalname),
          filePath: `/uploads/${file.filename}`,
          fileSize: file.size,
          fileType: path.extname(file.originalname).toLowerCase().replace('.', ''),
        })),
      });
    }

    return prisma.refFileGroup.findUnique({
      where: { id: group.id },
      include: { refFiles: true },
    });
  }

  static async getRefFileGroups(taskId: string): Promise<any[]> {
    return prisma.refFileGroup.findMany({
      where: { taskId },
      include: { refFiles: true },
    });
  }

  static async getTaskDetails(taskId: string) {
    return prisma.taskDetail.findMany({
      where: { taskId },
      include: {
        file: {
          select: { id: true, fileName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    }).then((details) => details.map((detail: any) => ({
      ...detail,
      reviewSource: detail.reviewSource || (detail.ruleCode?.startsWith('STD_')
        ? 'STANDARD_REF'
        : detail.ruleCode
          ? 'RULE_ENGINE'
          : 'AI'),
      confidence: detail.confidence || (detail.ruleCode === 'NO_RESULT'
        ? 'NO_RESULT'
        : detail.ruleCode?.startsWith('STD_')
          ? 'STD_MATCH'
          : detail.ruleCode
            ? 'RULE_EXACT'
            : 'AI_INFERRED'),
      confidenceSource: detail.confidenceSource || (detail.ruleCode === 'NO_RESULT'
        ? 'system_summary'
        : detail.ruleCode?.startsWith('STD_')
          ? 'standard_ref'
          : detail.ruleCode
            ? 'rule_engine'
            : (detail.sourceReferences ? 'ai_with_sources' : 'ai_only')),
    })));
  }

  /**
   * 获取任务审查进度
   */
  static async getTaskProgress(taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, title: true },
    });

    if (!task) {
      return null;
    }

    const totalDetails = await prisma.taskDetail.count({ where: { taskId } });

    // 获取每个文件的处理状态和文本长度
    const files = await prisma.taskFile.findMany({
      where: { taskId },
      select: { id: true, fileName: true, status: true, errorCount: true, textLength: true, processedLength: true },
      orderBy: { createdAt: 'asc' },
    });

    // 按内容字符数计算进度
    let totalTextLength = 0;
    let totalProcessedLength = 0;
    for (const f of files) {
      totalTextLength += f.textLength || 0;
      if (f.status === 'COMPLETED' || f.status === 'FAILED') {
        totalProcessedLength += f.textLength || 0; // 完成或失败的文件算全部处理完
      } else {
        totalProcessedLength += f.processedLength || 0; // 处理中的按实际已审查字符数
      }
    }

    let progress = totalTextLength > 0 ? Math.round((totalProcessedLength / totalTextLength) * 100) : 0;
    if (task.status === 'COMPLETED') progress = 100;
    if (task.status === 'PENDING') progress = 0;

    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      totalFiles: files.length,
      totalTextLength,
      totalProcessedLength,
      totalDetails,
      progress,
      files,
    };
  }

  static async getTaskFiles(taskId: string): Promise<TaskFile[]> {
    return prisma.taskFile.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' }
    });
  }

  /**
   * 获取文件提取的文本内容（用于前端原文预览定位）
   * 优先返回 Markdown 格式（extractedMarkdown），否则返回纯文本（extractedText）
   */
  static async getTaskFileContent(taskId: string, fileId: string): Promise<{ extractedText: string | null; fileName: string; fileType: string } | null> {
    const file = await prisma.taskFile.findFirst({
      where: { id: fileId, taskId },
      select: { extractedText: true, extractedMarkdown: true, fileName: true, fileType: true },
    });
    if (!file) return null;

    // 优先使用 Markdown，回退到纯文本
    const content = file.extractedMarkdown || file.extractedText;

    // 如果数据库中没有缓存，尝试实时解析
    if (!content) {
      try {
        const fullFile = await prisma.taskFile.findUnique({ where: { id: fileId } });
        if (fullFile?.filePath) {
          const text = await ParserService.parseFile(fullFile.filePath, fullFile.fileType);
          const markdown = ParserService.getLastMarkdown() || text;
          if (text && text.trim().length > 0) {
            // 缓存到数据库
            await prisma.taskFile.update({
              where: { id: fileId },
              data: { extractedText: text, extractedMarkdown: markdown !== text ? markdown : null },
            });
            return { extractedText: markdown || text, fileName: file.fileName, fileType: file.fileType };
          }
        }
      } catch (e) {
        console.error(`[TaskService] 实时解析文件失败: ${fileId}`, e);
      }
    }

    return { extractedText: content, fileName: file.fileName, fileType: file.fileType };
  }

  static async getTaskFileRaw(taskId: string, fileId: string): Promise<{ filePath: string; fileName: string } | null> {
    return prisma.taskFile.findFirst({
      where: { id: fileId, taskId },
      select: { filePath: true, fileName: true },
    });
  }

  static async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data: { status }
    });
  }

  /**
   * 删除单个任务（级联删除关联的文件和审查结果）
   */
  static async deleteTask(id: string): Promise<void> {
    await prisma.task.delete({
      where: { id }
    });
  }

  /**
   * 批量删除任务
   */
  static async deleteTasks(ids: string[]): Promise<{ count: number }> {
    const result = await prisma.task.deleteMany({
      where: { id: { in: ids } }
    });
    return { count: result.count };
  }

  /**
   * 重新审核任务：清除旧审查结果，重置状态，重新触发审查流程
   */
  static async reReviewTask(taskId: string): Promise<Task> {
    // 1. 删除旧的审查结果
    await prisma.taskDetail.deleteMany({
      where: { taskId }
    });

    // 2. 重置文件错误计数
    await prisma.taskFile.updateMany({
      where: { taskId },
      data: { errorCount: 0 }
    });

    // 3. 重新触发审查
    return this.startTaskReview(taskId);
  }

  /**
   * 将任务置为处理中并异步触发审查
   */
  static async startTaskReview(taskId: string): Promise<Task> {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status: 'PROCESSING' }
    });

    addReviewJob(taskId).catch((err) => {
      console.error(`[TaskService] 重新审查入队失败: ${taskId}`, err);
    });

    return task;
  }

  static async createTaskDetail(data: {
    taskId: string;
    fileId?: string;
    issueType: string;
    originalText: string;
    suggestedText?: string;
    description?: string;
    cadHandleId?: string;
  }): Promise<TaskDetail> {
    const detail = await prisma.taskDetail.create({
      data
    });

    // 更新文件错误计数
    if (data.fileId) {
      const count = await prisma.taskDetail.count({
        where: { fileId: data.fileId }
      });
      await prisma.taskFile.update({
        where: { id: data.fileId },
        data: { errorCount: count }
      });
    }

    return detail;
  }

  /**
   * 导出任务审查报告为 Excel
   */
  static async exportTaskReport(taskId: string): Promise<Buffer> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: { select: { id: true, username: true, name: true } },
        files: { orderBy: { createdAt: 'asc' } },
        details: {
          include: { file: { select: { id: true, fileName: true } } },
          orderBy: { createdAt: 'desc' }
        },
      }
    });

    if (!task) {
      throw new Error('Task not found');
    }

    const workbook = new ExcelJS.Workbook();

    // Sheet 1: 任务概览
    const overviewSheet = workbook.addWorksheet('任务概览');
    overviewSheet.columns = [
      { header: '任务标题', key: 'title', width: 30 },
      { header: '创建人', key: 'creator', width: 15 },
      { header: '状态', key: 'status', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 20 },
      { header: '文件数', key: 'fileCount', width: 10 },
      { header: '错误数', key: 'errorCount', width: 10 },
    ];
    overviewSheet.getRow(1).font = { bold: true };
    overviewSheet.addRow({
      title: task.title,
      creator: task.creator?.name || '-',
      status: task.status,
      createdAt: task.createdAt.toLocaleString('zh-CN'),
      fileCount: task.files.length,
      errorCount: task.details.length,
    });

    // Sheet 2: 文件列表
    const filesSheet = workbook.addWorksheet('文件列表');
    filesSheet.columns = [
      { header: '文件名', key: 'fileName', width: 40 },
      { header: '文件类型', key: 'fileType', width: 12 },
      { header: '文件大小', key: 'fileSize', width: 15 },
      { header: '错误数', key: 'errorCount', width: 10 },
    ];
    filesSheet.getRow(1).font = { bold: true };
    task.files.forEach((file) => {
      filesSheet.addRow({
        fileName: file.fileName,
        fileType: file.fileType.toUpperCase(),
        fileSize: this.formatBytes(file.fileSize),
        errorCount: file.errorCount,
      });
    });

    // Sheet 3: 错误明细（增强版：含规则代码和严重度）
    const detailsSheet = workbook.addWorksheet('审查结果明细');
    detailsSheet.columns = [
      { header: '严重度', key: 'severity', width: 10 },
      { header: '问题分类', key: 'issueType', width: 14 },
      { header: '规则代码', key: 'ruleCode', width: 14 },
      { header: '所属文件', key: 'fileName', width: 28 },
      { header: '原文本', key: 'originalText', width: 32 },
      { header: '建议修改', key: 'suggestedText', width: 28 },
      { header: '违规说明', key: 'description', width: 44 },
      { header: 'CAD Handle', key: 'cadHandleId', width: 15 },
    ];
    detailsSheet.getRow(1).font = { bold: true };

    // 类型映射
    const issueTypeMap: Record<string, string> = {
      TYPO: '错别字', VIOLATION: '合规违规', NAMING: '命名规范',
      ENCODING: '编码一致性', ATTRIBUTE: '封面属性', HEADER: '页眉检查',
      PAGE: '页码检查', SCAN: '图纸扫描', TEMPLATE: '模板统一',
    };
    // 严重度映射
    const severityMap: Record<string, string> = {
      error: '错误', warning: '警告', info: '提示',
    };

    task.details.forEach((detail) => {
      const row = detailsSheet.addRow({
        severity: severityMap[detail.severity] || detail.severity,
        issueType: issueTypeMap[detail.issueType] || detail.issueType,
        ruleCode: detail.ruleCode || '-',
        fileName: detail.file?.fileName || '-',
        originalText: detail.originalText,
        suggestedText: detail.suggestedText || '-',
        description: detail.description || '-',
        cadHandleId: detail.cadHandleId || '-',
      });

      // 字符级差异着色（标准引用检查的 diffRanges 字段）
      const diffRanges = (detail as any).diffRanges as any;
      if (diffRanges && detail.issueType === 'VIOLATION' && detail.ruleCode?.startsWith('STD_')) {
        // 原文本列（第5列）- 差异字符标红
        const originalCell = row.getCell(5);
        if (diffRanges.original && Array.isArray(diffRanges.original)) {
          try {
            for (const range of diffRanges.original) {
              if (range.start >= 0 && range.length > 0) {
                const char = (originalCell as any).characters?.(range.start + 1, range.length);
                if (char?.font) char.font = { color: { argb: 'FFFF0000' } }; // 红色
              }
            }
          } catch (e) {
            // ExcelJS characters() 可能不支持所有场景，降级为整体红色
            originalCell.font = { color: { argb: 'FFCC0000' } };
          }
        }
        // 建议修改列（第6列）- 差异字符标绿
        const suggestedCell = row.getCell(6);
        if (diffRanges.correct && Array.isArray(diffRanges.correct)) {
          try {
            for (const range of diffRanges.correct) {
              if (range.start >= 0 && range.length > 0) {
                const char = (suggestedCell as any).characters?.(range.start + 1, range.length);
                if (char?.font) char.font = { color: { argb: 'FF00B050' } }; // 绿色
              }
            }
          } catch (e) {
            suggestedCell.font = { color: { argb: 'FF00B050' } };
          }
        }
      }

      // 根据严重度设置行颜色（非 STD 类型保留原逻辑）
      if (detail.severity === 'error' && !detail.ruleCode?.startsWith('STD_')) {
        row.eachCell((cell) => { cell.font = { color: { argb: 'CC0000' } }; });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;
    return buffer;
  }

  private static formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 标记/取消标记误报
   */
  static async toggleFalsePositive(
    detailId: string,
    userId: string,
    isFalsePositive: boolean,
    reason?: string
  ): Promise<TaskDetail> {
    const detail = await prisma.taskDetail.findUnique({ where: { id: detailId } });
    if (!detail) {
      throw new Error('Detail not found');
    }

    // 获取用户信息
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const userName = user?.name || '未知';

    // 获取任务信息
    const task = await prisma.task.findUnique({ where: { id: detail.taskId } });

    const updated = await prisma.taskDetail.update({
      where: { id: detailId },
      data: isFalsePositive
        ? {
            isFalsePositive: true,
            fpMarkedBy: userId,
            fpMarkedAt: new Date(),
            fpReason: reason || null,
          }
        : {
            isFalsePositive: false,
            fpMarkedBy: null,
            fpMarkedAt: null,
            fpReason: null,
          },
    });

    // 同步到误报标记库
    if (isFalsePositive) {
      await FalsePositiveLibraryService.syncFromTaskDetail({
        originalText: detail.originalText,
        fpReason: reason,
        issueType: detail.issueType,
        ruleCode: detail.ruleCode || undefined,
        severity: detail.severity,
        markedById: userId,
        markedByName: userName,
        taskId: detail.taskId,
        taskTitle: task?.title,
      });
    } else {
      // 取消标记时，从误报库中减少计数
      await FalsePositiveLibraryService.remove(detail.originalText);
    }

    return updated;
  }

  /**
   * 获取审查摘要：聚合 TaskDetail 结果，按严重度/文件/类型统计
   */
  static async getReviewSummary(taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        reviewMode: true,
        perspective: true,
        preAnalysisData: true,
        createdAt: true,
        updatedAt: true,
        creator: { select: { id: true, username: true, name: true } },
      },
    });

    if (!task) {
      return null;
    }

    // 获取所有审查结果
    const details = await prisma.taskDetail.findMany({
      where: { taskId },
      include: {
        file: { select: { id: true, fileName: true, fileType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 获取文件列表
    const files = await prisma.taskFile.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });

    // 统计严重度分布
    const severityCounts = { error: 0, warning: 0, info: 0 };
    for (const d of details) {
      if (d.severity === 'error') severityCounts.error++;
      else if (d.severity === 'warning') severityCounts.warning++;
      else severityCounts.info++;
    }

    // 统计问题类型分布
    const issueTypeMap: Record<string, number> = {};
    for (const d of details) {
      issueTypeMap[d.issueType] = (issueTypeMap[d.issueType] || 0) + 1;
    }
    const issueTypeCounts = Object.entries(issueTypeMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // 按文件统计
    const fileIssueCounts = files.map((f) => ({
      fileId: f.id,
      fileName: f.fileName,
      fileType: f.fileType,
      errorCount: f.errorCount || 0,
      totalIssues: details.filter((d) => d.fileId === f.id).length,
    }));

    // 按规则代码统计（Top 10）
    const ruleCodeMap: Record<string, { code: string; count: number; severity: string }> = {};
    for (const d of details) {
      const code = d.ruleCode || 'UNKNOWN';
      if (!ruleCodeMap[code]) {
        ruleCodeMap[code] = { code, count: 0, severity: d.severity };
      }
      ruleCodeMap[code].count++;
    }
    const topRuleCodes = Object.values(ruleCodeMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 误报统计
    const falsePositiveCount = details.filter((d) => d.isFalsePositive).length;
    const noResultReasons = details
      .filter((d) => d.ruleCode === 'NO_RESULT')
      .map((d) => d.description)
      .filter((d): d is string => Boolean(d));
    const effectiveDetails = details.filter((d) => d.ruleCode !== 'NO_RESULT');

    return {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        reviewMode: task.reviewMode,
        reviewSpecificationId: (task as any).reviewSpecificationId || null,
        ruleLibraryId: (task as any).ruleLibraryId || null,
        reviewPlan: (task as any).reviewPlan || null,
        reviewSpecification: (task as any).reviewSpecification || null,
        perspective: task.perspective,
        preAnalysisData: task.preAnalysisData,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        creator: task.creator,
      },
      overview: {
        totalIssues: effectiveDetails.length,
        falsePositives: falsePositiveCount,
        effectiveIssues: effectiveDetails.length - falsePositiveCount,
        severityCounts,
      },
      noResultReasons,
      issueTypeCounts,
      fileIssueCounts,
      topRuleCodes,
      fileCount: files.length,
    };
  }

}
