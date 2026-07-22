import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { TaskService } from '../services/task.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getTaskFilterByRole } from '../middlewares/rbac.middleware';
import { resolveFilePath } from '../config/upload';
import { TaskStatus } from '@prisma/client';
import { success, error, paginated } from '../utils/response';

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, standardId, standardIds, maxkbKnowledgeId, maxkbKnowledgeIds,
      perspective, selectedTemplateId, intraFileConsistency,
      reviewPlan, reviewSpecificationId, ruleLibraryId, entryModule, reviewMode, contractStance } = req.body;
    const creatorId = req.user?.id;
    const creatorUsername = req.user?.username || creatorId;
    const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
    const files = filesMap?.files as Express.Multer.File[] | undefined;
    const refFiles = filesMap?.refFiles as Express.Multer.File[] | undefined;

    if (!title) { error(res, '标题为必填项', 400); return; }
    if (!files || files.length === 0) { error(res, '请至少上传一个待审文件', 400); return; }
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

    let parsedReviewPlan: any = undefined;
    if (typeof reviewPlan === 'string') {
      try { parsedReviewPlan = JSON.parse(reviewPlan); }
      catch { /* 忽略解析错误 */ }
    } else if (typeof reviewPlan === 'object' && reviewPlan !== null) {
      parsedReviewPlan = reviewPlan;
    }

    // 合同审查立场：注入到 reviewPlan 中
    if (contractStance && parsedReviewPlan) {
      parsedReviewPlan.contractStance = contractStance;
    }

    const task = await TaskService.createTask({
      title,
      description,
      creatorId,
      creatorUsername,
      standardId,
      standardIds: parsedStandardIds || (standardId ? [standardId] : []),
      maxkbKnowledgeId: maxkbKnowledgeId || parsedKnowledgeIds?.[0],
      maxkbKnowledgeIds: parsedKnowledgeIds,
      files: files || [],
      dwgParsedData: parsedDwgData,
      perspective,
      reviewPlan: parsedReviewPlan,
      reviewSpecificationId: typeof reviewSpecificationId === 'string' && reviewSpecificationId.trim() ? reviewSpecificationId.trim() : undefined,
      ruleLibraryId: typeof ruleLibraryId === 'string' && ruleLibraryId.trim() ? ruleLibraryId.trim() : undefined,
      selectedTemplateId,
      intraFileConsistency: intraFileConsistency === 'true' || intraFileConsistency === true,
      entryModule,
      reviewMode,
    });

    // 处理前端随任务一起上传的参照文件（以文审文模式）
    if (refFiles && refFiles.length > 0) {
      try {
        const group = await TaskService.createRefFileGroup({
          taskId: task.id,
          groupName: '默认参照组',
          files: refFiles,
          creatorId: creatorUsername,
        });

        // 参照比对模式：任务创建后有参照文件，立即触发审查
        if (parsedReviewPlan?.objective === 'COMPARE' && (task as any).status === 'PENDING') {
          await TaskService.startTaskReview(task.id);
        }
      } catch (refErr) {
        console.error('[Create Task] 参照文件保存失败（不影响任务创建）:', refErr);
      }
    }

    success(res, task, '任务创建成功');
  } catch (err) {
    console.error('Create Task Error:', err);
    error(res, '服务器内部错误', 500);
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
    const reviewMode = req.query.reviewMode as string | undefined;
    const search = req.query.search as string | undefined;
    const creator = req.query.creator as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const mine = req.query.mine === 'true';
    
    // RBAC: 根据角色过滤数据可见性
    const roleFilter = mine ? { creatorId: req.user?.id } : await getTaskFilterByRole(req.user);
    
    const result = await TaskService.getTasks({ skip, take, status, reviewMode, search, creator, startDate, endDate, ...roleFilter });
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
      selfCheckReport: t.selfCheckReport,
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

    // RBAC: 检查用户是否有权删除这些任务
    const user = req.user;
    if (!user) {
      error(res, '未认证用户', 401);
      return;
    }

    // 非管理员需要检查每个任务的所有权
    if (user.role !== 'ADMIN') {
      const tasks = await TaskService.getTasksByIds(ids);
      const unauthorizedTasks = tasks.filter(t => t.creatorId !== user.id);
      
      // MANAGER 可以删除本部门及下属部门的任务
      if (user.role === 'MANAGER' && user.departmentId) {
        const { canAccessTask } = await import('../middlewares/rbac.middleware');
        const accessibleTasks: string[] = [];
        for (const task of unauthorizedTasks) {
          const hasAccess = await canAccessTask(user, task.creatorId);
          if (hasAccess) accessibleTasks.push(task.id);
        }
        // 过滤出用户有权删除的任务
        const allowedIds = tasks
          .filter(t => t.creatorId === user.id || accessibleTasks.includes(t.id))
          .map(t => t.id);
        
        if (allowedIds.length === 0) {
          error(res, '无权删除这些任务', 403);
          return;
        }
        
        const result = await TaskService.deleteTasks(allowedIds);
        success(res, { count: result.count }, `成功删除 ${result.count} 个任务`);
        return;
      }
      
      // USER 只能删除自己的任务
      if (unauthorizedTasks.length > 0) {
        error(res, '只能删除自己创建的任务', 403);
        return;
      }
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
    reviewSpecificationId: task.reviewSpecificationId || null,
    ruleLibraryId: task.ruleLibraryId || null,
    reviewPlan: task.reviewPlan || null,
    reviewSpecification: task.reviewSpecification || null,
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

export const getTaskById = async (req: AuthRequest, res: Response): Promise<void> => {
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

export const getTaskDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    const task = await TaskService.getTaskById(id);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    const details = await TaskService.getTaskDetails(id, req.user?.role);
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

export const getTaskProgress = async (req: AuthRequest, res: Response): Promise<void> => {
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

export const getTaskFileContent = async (req: AuthRequest, res: Response): Promise<void> => {
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

export const getTaskFileRaw = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const fileId = req.params.fileId as string;

    const file = await TaskService.getTaskFileRaw(taskId, fileId);
    if (!file) {
      error(res, '未找到文件', 404);
      return;
    }

    let absPath: string
    const rawPath = file.filePath
    if (rawPath.startsWith('/uploads/') || rawPath.startsWith('\\uploads\\')) {
      absPath = resolveFilePath(rawPath)
    } else if (path.isAbsolute(rawPath)) {
      absPath = rawPath
    } else {
      absPath = resolveFilePath('/uploads/' + rawPath.replace(/^[/\\]+/, ''))
    }
    if (!fs.existsSync(absPath)) {
      console.error('[getTaskFileRaw] 文件不存在:', { taskId, fileId, absPath, rawPath })
      error(res, '文件不存在', 404);
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.sendFile(absPath);
  } catch (err) {
    console.error('Get Task File Raw Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const convertDocToDocx = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const fileId = req.params.fileId as string;

    const file = await TaskService.getTaskFileRaw(taskId, fileId);
    if (!file) {
      error(res, '未找到文件', 404);
      return;
    }

    // 只处理 .doc 文件
    const ext = path.extname(file.fileName).toLowerCase();
    if (ext !== '.doc') {
      error(res, '仅支持 .doc 格式转换', 400);
      return;
    }

    let absPath: string;
    const rawPath = file.filePath;
    if (rawPath.startsWith('/uploads/') || rawPath.startsWith('\\uploads\\')) {
      absPath = resolveFilePath(rawPath);
    } else if (path.isAbsolute(rawPath)) {
      absPath = rawPath;
    } else {
      absPath = resolveFilePath('/uploads/' + rawPath.replace(/^[/\\]+/, ''));
    }
    if (!fs.existsSync(absPath)) {
      error(res, '文件不存在', 404);
      return;
    }

    // 调用 doc-parser 服务进行 .doc → .docx 转换
    const parserUrl = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';
    const fileBuffer = fs.readFileSync(absPath);

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/msword' });
    formData.append('file', blob, file.fileName);

    const response = await fetch(`${parserUrl}/api/convert/doc-to-docx`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[convertDocToDocx] 转换失败:', response.status, errText);
      error(res, '文档转换失败，请稍后重试', 500);
      return;
    }

    const docxBuffer = Buffer.from(await response.arrayBuffer());
    const docxFileName = file.fileName.replace(/\.doc$/i, '.docx');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(docxFileName)}"`);
    res.send(docxBuffer);
  } catch (err) {
    console.error('Convert Doc to Docx Error:', err);
    error(res, '文档转换服务不可用', 500);
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

    // 状态转换校验：防止非法状态跳转
    const task = await TaskService.getTaskById(id);
    if (!task) {
      error(res, '未找到该任务', 404);
      return;
    }

    const validTransitions: Record<string, string[]> = {
      PENDING: ['PROCESSING', 'FAILED'],
      PROCESSING: ['COMPLETED', 'FAILED'],
      COMPLETED: [],  // 终态，不允许转换
      FAILED: ['PENDING'],  // 失败后可以重新排队
    };

    const currentStatus = task.status;
    const allowedNext = validTransitions[currentStatus] || [];
    if (!allowedNext.includes(status)) {
      error(res, `不允许从 ${currentStatus} 转换到 ${status}`, 400);
      return;
    }

    const updatedTask = await TaskService.updateTaskStatus(id, status as TaskStatus);
    success(res, updatedTask, '任务状态更新成功');
  } catch (err) {
    console.error('Update Task Status Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const exportTaskReport = async (req: AuthRequest, res: Response): Promise<void> => {
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

export const exportTaskReportWord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const task = await TaskService.getTaskById(id);
    const details = await TaskService.getTaskDetails(id);
    const fileName = task ? `${task.title}_审查报告.doc` : '审查报告.doc';

    const html = buildWordHtml(task, details);
    const buffer = Buffer.from('\ufeff' + html, 'utf-8');

    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (err) {
    console.error('Export Word Error:', err);
    error(res, '导出Word失败', 500);
  }
};

/** 构建Word兼容HTML文档 */
function buildWordHtml(task: any, details: any): string {
  const issues = Array.isArray(details) ? details : (details?.issues || []);
  const summary = Array.isArray(details) ? {} : (details?.summary || {});

  // 从数组中统计严重度
  if (Array.isArray(details)) {
    summary.errors = issues.filter((d: any) => d.severity === 'error').length;
    summary.warnings = issues.filter((d: any) => d.severity === 'warning').length;
    summary.infos = issues.filter((d: any) => d.severity === 'info').length;
  }

  const issuesHtml = issues.map((issue: any, i: number) => {
    const severityLabels: Record<string, string> = { error: '错误', warning: '警告', info: '提示' };
    const severity = severityLabels[issue.severity] || issue.severity || '-';
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${severity}</td>
        <td>${issue.ruleCode || issue.code || '-'}</td>
        <td>${issue.description || issue.message || '-'}</td>
        <td>${issue.suggestedText || issue.suggestion || '-'}</td>
      </tr>`;
  }).join('');

  return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
  body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; padding: 40px; }
  h1 { text-align: center; font-size: 22px; margin-bottom: 10px; }
  h2 { font-size: 16px; color: #333; border-bottom: 2px solid #1890FF; padding-bottom: 6px; margin-top: 24px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
  .meta p { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 13px; text-align: left; }
  th { background: #F0F5FF; font-weight: 600; }
  .stats { display: flex; gap: 24px; margin: 16px 0; }
  .stat-item { padding: 12px 20px; background: #F5F7FA; border-radius: 6px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-label { font-size: 12px; color: #888; }
</style>
</head>
<body>
  <h1>文件智能审查报告</h1>
  <div class="meta">
    <p><strong>任务名称：</strong>${task?.title || '-'}</p>
    <p><strong>审查时间：</strong>${task?.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN') : '-'}</p>
    <p><strong>审查状态：</strong>${task?.status || '-'}</p>
  </div>
  
  <h2>审查概览</h2>
  <div class="stats">
    <div class="stat-item">
      <div class="stat-value" style="color:#DC2626;">${summary.errors || 0}</div>
      <div class="stat-label">错误</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color:#D97706;">${summary.warnings || 0}</div>
      <div class="stat-label">警告</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color:#2563EB;">${summary.infos || 0}</div>
      <div class="stat-label">提示</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${issues.length}</div>
      <div class="stat-label">总计</div>
    </div>
  </div>

  <h2>问题明细</h2>
  <table>
    <thead>
      <tr>
        <th width="50">#</th>
        <th width="70">严重度</th>
        <th width="120">规则代码</th>
        <th>问题描述</th>
        <th>修改建议</th>
      </tr>
    </thead>
    <tbody>
      ${issuesHtml || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无审查问题</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

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

    const dirName = req.user?.username || req.user?.id || 'anonymous';
    const group = await TaskService.createRefFileGroup({ taskId, groupName, description, files, creatorId: dirName });

    // 参照比对模式在创建任务时会延迟触发审查，待参照文件上传后再启动
    if ((task as any).reviewPlan?.objective === 'COMPARE' && task.status === 'PENDING') {
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

/** 标记/取消标记采纳 */
export const toggleAdopt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detailId = req.params.detailId as string;
    const { adopted } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }

    if (typeof adopted !== 'boolean') {
      error(res, 'adopted 必须为布尔值', 400);
      return;
    }

    const updated = await TaskService.toggleAdopt(detailId, userId, adopted);
    success(res, updated, adopted ? '已标记为采纳' : '已取消采纳标记');
  } catch (err: any) {
    console.error('Toggle Adopt Error:', err);
    error(res, err.message || '操作失败', 500);
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

/** 获取任务审查摘要（聚合统计） */
export const getReviewSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const summary = await TaskService.getReviewSummary(id);

    if (!summary) {
      error(res, '未找到该任务', 404);
      return;
    }

    success(res, summary);
  } catch (err) {
    console.error('Get Review Summary Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 人工复核 issue（MANAGER/ADMIN 角色可调用） */
export const reviewIssue = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detailId = req.params.detailId as string;
    const { reviewStatus } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }

    if (!reviewStatus || !['CONFIRMED', 'DISMISSED'].includes(reviewStatus)) {
      error(res, '无效的复核状态，仅支持 CONFIRMED 或 DISMISSED', 400);
      return;
    }

    const updated = await TaskService.reviewIssue(detailId, reviewStatus, userId);
    success(res, updated, `已标记为${reviewStatus === 'CONFIRMED' ? '已确认' : '已驳回'}`);
  } catch (err: any) {
    console.error('Review Issue Error:', err);
    if (err?.message === 'Detail not found') {
      error(res, '未找到该审查结果', 404);
      return;
    }
    if (err?.message === '该条目无需人工复核') {
      error(res, err.message, 400);
      return;
    }
    error(res, '服务器内部错误', 500);
  }
};
