import { Request, Response } from 'express';
import { TaskService } from '../services/task.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getTaskFilterByRole } from '../middlewares/rbac.middleware';
import { TaskStatus } from '@prisma/client';
import { success, error, paginated } from '../utils/response';

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, standardId, standardIds, reviewMode, maxkbKnowledgeId, maxkbKnowledgeIds } = req.body;
    const creatorId = req.user?.id;
    const files = req.files as Express.Multer.File[];

    if (!title) { error(res, '标题为必填项', 400); return; }
    if (!creatorId) { 
      console.error('[Create Task] 未认证用户尝试创建任务:', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hasAuthHeader: !!req.headers.authorization,
      });
      error(res, '未认证用户，请先登录', 401); 
      return; 
    }

    // 解析 standardIds（前端通过 FormData 传 JSON 字符串）
    let parsedStandardIds: string[] | undefined;
    if (Array.isArray(standardIds)) {
      parsedStandardIds = standardIds;
    } else if (typeof standardIds === 'string') {
      try { parsedStandardIds = JSON.parse(standardIds); }
      catch { /* 忽略解析错误 */ }
    }

    // 解析 maxkbKnowledgeIds（前端通过 FormData 传 JSON 字符串）
    let parsedKnowledgeIds: string[] | undefined;
    if (Array.isArray(maxkbKnowledgeIds)) {
      parsedKnowledgeIds = maxkbKnowledgeIds;
    } else if (typeof maxkbKnowledgeIds === 'string') {
      try { parsedKnowledgeIds = JSON.parse(maxkbKnowledgeIds); }
      catch { /* 忽略解析错误 */ }
    }

    // 解析 dwgParsedData（前端 WASM 解析的 DWG 结构化数据）
    // 支持两种格式：
    //   新版：{ "idx_0": data, "idx_1": data } — 按文件在 files 数组中的索引映射
    //   旧版/文件名方式：{ "fileName.dwg": data } — 按文件名映射
    let parsedDwgData: Record<string, any> | undefined;
    const { dwgParsedData } = req.body;
    if (typeof dwgParsedData === 'string') {
      try { parsedDwgData = JSON.parse(dwgParsedData); }
      catch { /* 忽略解析错误 */ }
    } else if (typeof dwgParsedData === 'object' && dwgParsedData !== null) {
      parsedDwgData = dwgParsedData;
    }

    const task = await TaskService.createTask({
      title,
      description,
      creatorId,
      standardId,
      standardIds: parsedStandardIds || (standardId ? [standardId] : []),
      reviewMode,
      maxkbKnowledgeId: maxkbKnowledgeId || parsedKnowledgeIds?.[0],
      maxkbKnowledgeIds: parsedKnowledgeIds,
      files: files || [],
      dwgParsedData: parsedDwgData,
    });

    success(res, task, '任务创建成功');
  } catch (err) {
    console.error('Create Task Error:', err);
    error(res, `服务器内部错误: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
};

export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 兼容前端传 page/limit 或 skip/take
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = parseInt(req.query.skip as string) || (page - 1) * limit;
    const take = parseInt(req.query.take as string) || limit;
    const status = req.query.status as TaskStatus | undefined;
    const search = req.query.search as string | undefined;
    const mine = req.query.mine === 'true';
    
    // RBAC: 根据角色过滤数据可见性
    const roleFilter = mine ? { creatorId: req.user?.id } : await getTaskFilterByRole(req.user);
    
    const result = await TaskService.getTasks({ skip, take, status, search, ...roleFilter });
    // 映射字段名以匹配前端期望的格式
    const items = result.tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      file_count: t.fileCount,
      issue_count: t.errorCount,
      progress: t.progress,
      user: t.creator ? { nick_name: t.creator.name, username: t.creator.username } : null,
      create_time: t.createdAt,
      reviewMode: t.reviewMode,
      description: t.description,
    }));
    paginated(res, items, result.total);
  } catch (err) {
    console.error('Get Tasks Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/**
 * 删除单个任务
 */
export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    // 检查任务是否存在
    const task = await TaskService.getTaskById(id);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    await TaskService.deleteTask(id);
    success(res, null, '任务删除成功');
  } catch (err) {
    console.error('Delete Task Error:', err);
    error(res, '删除任务失败', 500);
  }
};

/**
 * 批量删除任务
 */
export const deleteTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      error(res, '请选择要删除的任务', 400);
      return;
    }

    const result = await TaskService.deleteTasks(ids);
    success(res, { count: result.count }, `成功删除 ${result.count} 个任务`);
  } catch (err) {
    console.error('Delete Tasks Error:', err);
    error(res, '批量删除失败', 500);
  }
};

/**
 * 重新审核任务（清除旧结果，重新触发审查）
 */
export const reReviewTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    // 检查任务是否存在
    const task = await TaskService.getTaskById(id);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    // 检查是否有文件
    if (task.files.length === 0) {
      error(res, '该任务没有文件，无法重新审核', 400);
      return;
    }

    const updatedTask = await TaskService.reReviewTask(id);

    success(res, updatedTask, '已提交重新审核');
  } catch (err) {
    console.error('Re-review Task Error:', err);
    error(res, '重新审核失败', 500);
  }
};

/** 映射 task 对象字段为前端期望的 snake_case 格式 */
function mapTaskForFrontend(task: any) {
  return {
    ...task,
    user: task.creator ? { nick_name: task.creator.name, username: task.creator.username } : null,
    create_time: task.createdAt,
    files: (task.files || []).map(mapFileForFrontend),
  };
}

/** 映射 file 对象字段为前端期望的 snake_case 格式 */
function mapFileForFrontend(f: any) {
  return {
    ...f,
    file_name: f.fileName,
    file_type: f.fileType,
    file_size: f.fileSize,
    error_count: f.errorCount,
    dwg_metadata: f.dwgMetadata,
  };
}

export const getTaskById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const task = await TaskService.getTaskById(id);

    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    success(res, mapTaskForFrontend(task));
  } catch (err) {
    console.error('Get Task Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const getTaskDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    const task = await TaskService.getTaskById(id);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    const details = await TaskService.getTaskDetails(id);
    const files = await TaskService.getTaskFiles(id);
    success(res, {
      details,
      files: (files || []).map(mapFileForFrontend),
    });
  } catch (err) {
    console.error('Get Task Details Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const getTaskProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const progress = await TaskService.getTaskProgress(id);

    if (!progress) {
      error(res, '未找到该任务', 404);
      return;
    }

    success(res, progress);
  } catch (err) {
    console.error('Get Task Progress Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const getTaskFileContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const fileId = req.params.fileId as string;

    const file = await TaskService.getTaskFileContent(taskId, fileId);
    if (!file) {
      error(res, '未找到文件内容', 404);
      return;
    }

    success(res, file);
  } catch (err) {
    console.error('Get Task File Content Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const updateTaskStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!status || !['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(status)) {
      error(res, '无效的任务状态', 400);
      return;
    }

    const task = await TaskService.updateTaskStatus(id, status as TaskStatus);
    success(res, task, '任务状态更新成功');
  } catch (err) {
    console.error('Update Task Status Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const exportTaskReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const buffer = await TaskService.exportTaskReport(id);

    const task = await TaskService.getTaskById(id);
    const fileName = task ? `${task.title}_审查报告.xlsx` : '审查报告.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (err) {
    console.error('Export Task Report Error:', err);
    error(res, '导出失败', 500);
  }
};

/** 上传参照文件（以文审文模式） */
export const uploadRefFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const { groupName, description } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      error(res, '请上传参照文件', 400);
      return;
    }

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    const group = await TaskService.createRefFileGroup({ taskId, groupName, description, files });

    // DOC_REVIEW 在创建任务时会延迟触发审查，待参照文件上传后再启动
    if ((task as any).reviewMode === 'DOC_REVIEW' && task.status === 'PENDING') {
      await TaskService.startTaskReview(taskId);
    }

    success(res, group, '参照文件上传成功');
  } catch (err) {
    console.error('Upload Ref Files Error:', err);
    error(res, '上传参照文件失败', 500);
  }
};

/** 获取审查模式能力配置列表（可编辑版） */
export const getModeCapabilities = async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getModeCapabilitiesConfig } = await import('../services/review-pipeline/mode-config.service');
    const config = await getModeCapabilitiesConfig();
    success(res, config);
  } catch (err) {
    console.error('Get Mode Capabilities Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 保存审查模式能力配置 */
export const saveModeCapabilities = async (req: Request, res: Response): Promise<void> => {
  try {
    const { saveModeCapabilitiesConfig } = await import('../services/review-pipeline/mode-config.service');
    const { clearCapabilitiesCache } = await import('../services/review-pipeline');
    const config = req.body;
    await saveModeCapabilitiesConfig(config);
    // 清除缓存，确保下次 createPipeline 读取最新配置
    clearCapabilitiesCache();
    success(res, null, '保存成功');
  } catch (err) {
    console.error('Save Mode Capabilities Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 获取审查模式列表 */
export const getReviewModes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getAvailableModes } = await import('../services/review-pipeline');
    const modes = await getAvailableModes();
    success(res, modes);
  } catch (err) {
    console.error('Get Review Modes Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 标记/取消标记误报 */
export const toggleFalsePositive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detailId = req.params.detailId as string;
    const { isFalsePositive, reason } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }

    if (typeof isFalsePositive !== 'boolean') {
      error(res, 'isFalsePositive 必须为布尔值', 400);
      return;
    }

    const updated = await TaskService.toggleFalsePositive(detailId, userId, isFalsePositive, reason);
    success(res, updated, isFalsePositive ? '已标记为误报' : '已取消误报标记');
  } catch (err: any) {
    console.error('Toggle False Positive Error:', err);
    if (err?.message === 'Detail not found') {
      error(res, '未找到该审查结果', 404);
      return;
    }
    error(res, '服务器内部错误', 500);
  }
};
