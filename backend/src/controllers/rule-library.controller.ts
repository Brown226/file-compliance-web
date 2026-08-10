import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { RuleLibraryService } from '../services/llm/rule-library.service';
import { TextExtractionService } from '../services/review-pipeline/text-extraction.service';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { FileTypeService } from '../services/file/file-type.service';
import { getUploadPath } from '../config/upload';

function UPLOAD_DIR() { return getUploadPath('rule-libraries'); }

// 内存存储解析任务状态（不污染 Task 表）
interface ParseJob {
  id: string;
  libraryId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  step: string;
  message: string;
  items: any[];
  sourceFileName: string;
  createdAt: number;
}
const parseJobs = new Map<string, ParseJob>();

// 定期清理超过 1 小时的任务
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, job] of parseJobs) {
    if (job.createdAt < cutoff) parseJobs.delete(id);
  }
}, 60_000);

/** 获取规则库列表 */
export const listLibraries = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const selectableOnly = _req.query.selectableOnly === 'true';
    const options: Record<string, any> = { selectableOnly };
    if (_req.query.keyword) options.keyword = String(_req.query.keyword);
    if (_req.query.status) options.status = String(_req.query.status);
    // V3.2 条文库合并：按标准过滤审点库
    if (_req.query.standardId) options.standardId = String(_req.query.standardId);
    const libraries = await RuleLibraryService.list(options);
    success(res, libraries);
  } catch (err) {
    console.error('List RuleLibraries Error:', err);
    error(res, '获取规则库列表失败', 500);
  }
};

/** 获取规则库详情 */
export const getLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const library = await RuleLibraryService.getById((req.params.id as string));
    if (!library) { error(res, '规则库不存在', 404); return; }
    success(res, library);
  } catch (err) {
    console.error('Get RuleLibrary Error:', err);
    error(res, '获取详情失败', 500);
  }
};

/** 创建规则库 */
export const createLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, standardId } = req.body;
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const library = await RuleLibraryService.create({
      name: name.trim(),
      description,
      createdBy: req.user!.id,
      // V3.2 条文库合并：可关联标准
      standardId: standardId || null,
    });
    success(res, library, '创建成功');
  } catch (err) {
    console.error('Create RuleLibrary Error:', err);
    error(res, '创建失败', 500);
  }
};

/** 更新规则库 */
export const updateLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const library = await RuleLibraryService.update((req.params.id as string), req.body);
    success(res, library, '更新成功');
  } catch (err) {
    console.error('Update RuleLibrary Error:', err);
    error(res, '更新失败', 500);
  }
};

/** 删除规则库 */
export const deleteLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await RuleLibraryService.delete((req.params.id as string));
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete RuleLibrary Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 上传文件解析规则 */
export const parseRulesFromFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

    const ext = path.extname(file.originalname).toLowerCase();
    const savedName = `${uuidv4()}${ext}`;
    const savedPath = path.join(UPLOAD_DIR(), savedName);
    fs.renameSync(file.path, savedPath);

    const fileType = FileTypeService.getStandardizedType(ext);
    const text = await TextExtractionService.extractFileText(savedPath, fileType, file.originalname);
    if (!text || text.trim().length < 10) {
      error(res, '文件内容过少或解析失败', 400); return;
    }

    const count = await RuleLibraryService.parseRulesFromText((req.params.id as string), text, file.originalname);
    success(res, { count, fileName: file.originalname }, `成功解析 ${count} 条规则`);
  } catch (err: any) {
    console.error('Parse Rules Error:', err);
    error(res, err.message || '解析失败', 500);
  }
};

/** 上传文件解析规则预览 */
export const parseRulesPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

    const ext = path.extname(file.originalname).toLowerCase();
    const savedName = `${uuidv4()}${ext}`;
    const savedPath = path.join(UPLOAD_DIR(), savedName);
    fs.renameSync(file.path, savedPath);

    const fileType = FileTypeService.getStandardizedType(ext);
    const text = await TextExtractionService.extractFileText(savedPath, fileType, file.originalname);
    if (!text || text.trim().length < 10) {
      error(res, '文件内容过少或解析失败', 400); return;
    }

    const preview = await RuleLibraryService.previewRulesFromText((req.params.id as string), text, file.originalname);
    success(res, preview, `成功解析 ${preview.items.length} 条候选规则`);
  } catch (err: any) {
    console.error('Parse Rules Preview Error:', err);
    error(res, err.message || '解析预览失败', 500);
  }
};

/**
 * POST /api/rule-libraries/:id/parse-preview-async
 * 异步解析规则预览（适合大文件 / 长文档 / 多文件批量）
 * 用内存 Map 追踪状态，不创建 Task 记录
 */
export const parseRulesPreviewAsync = async (req: AuthRequest, res: Response): Promise<void> => {
  const savedPaths: string[] = [];
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) { error(res, '请选择文件', 400); return; }
    if (files.length > 5) {
      files.forEach(f => { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} });
      error(res, '最多支持同时上传 5 个文件', 400);
      return;
    }

    const libraryId = req.params.id as string;

    // 保存文件
    const fileMetaList: Array<{ originalName: string; savedPath: string; ext: string }> = [];
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR(), savedName);
      fs.renameSync(f.path, savedPath);
      savedPaths.push(savedPath);
      fileMetaList.push({ originalName: f.originalname, savedPath, ext });
    }

    // 创建内存任务
    const jobId = uuidv4();
    const job: ParseJob = {
      id: jobId, libraryId, status: 'PROCESSING',
      progress: 5, step: '上传完成', message: '等待解析...',
      items: [], sourceFileName: fileMetaList.map(m => m.originalName).join(', '),
      createdAt: Date.now(),
    };
    parseJobs.set(jobId, job);

    // 立即返回
    success(res, { jobId, status: 'PROCESSING' }, '解析任务已创建');

    // 后台异步解析
    (async () => {
      try {
        const total = fileMetaList.length;
        const allItems: any[] = [];

        for (let i = 0; i < total; i++) {
          const meta = fileMetaList[i];
          job.progress = Math.floor((i / total) * 90);
          job.step = `解析文件 (${i + 1}/${total})`;
          job.message = `正在解析：${meta.originalName}`;

          const fileType = FileTypeService.getStandardizedType(meta.ext);
          const text = await TextExtractionService.extractFileText(meta.savedPath, fileType, meta.originalName);
          if (!text || text.trim().length < 10) {
            job.message = `${meta.originalName} 内容过少，已跳过`;
            continue;
          }

          job.step = `提取规则 (${i + 1}/${total})`;
          job.message = `${meta.originalName} 已解析（${text.length} 字符），正在提取规则...`;

          const preview = await RuleLibraryService.previewRulesFromText(libraryId, text, meta.originalName);
          const tagged = (preview.items || []).map(it => ({
            ...it,
            sourceLocation: it.sourceLocation || meta.originalName,
          }));
          allItems.push(...tagged);
        }

        job.status = 'COMPLETED';
        job.progress = 100;
        job.step = '解析完成';
        job.items = allItems;
        job.message = `成功解析 ${allItems.length} 条候选规则`;
      } catch (err: any) {
        console.error('Async Parse Rules Error:', err);
        job.status = 'FAILED';
        job.progress = 0;
        job.step = '解析失败';
        job.message = err?.message || '规则解析失败';
      } finally {
        // 清理临时文件
        savedPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
      }
    })();
  } catch (err: any) {
    console.error('Create Async Parse Job Error:', err);
    savedPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
    error(res, err.message || '创建解析任务失败', 500);
  }
};

/**
 * POST /api/rule-libraries/:id/parse-checkpoints-async
 *
 * V3.1 审点模式异步解析：用 ClauseSplitterService 切分条文 + LLM 加工成 DEC 风格审点
 * 产出 clauseText + checkPrompt + auditDimension + mandatory，可直接驱动 DEC_REVIEW
 *
 * 与 parseRulesPreviewAsync 的区别：
 * - 旧模式：LLM 一次性提炼动作化描述（description + checkMethod）
 * - 审点模式：先正则切分条文 → 逐条 LLM 加工 → 产出可被 DEC 消费的审点
 */
export const parseCheckpointsPreviewAsync = async (req: AuthRequest, res: Response): Promise<void> => {
  const savedPaths: string[] = [];
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) { error(res, '请选择文件', 400); return; }
    if (files.length > 5) {
      files.forEach(f => { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} });
      error(res, '最多支持同时上传 5 个文件', 400);
      return;
    }

    const libraryId = req.params.id as string;

    const fileMetaList: Array<{ originalName: string; savedPath: string; ext: string }> = [];
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR(), savedName);
      fs.renameSync(f.path, savedPath);
      savedPaths.push(savedPath);
      fileMetaList.push({ originalName: f.originalname, savedPath, ext });
    }

    const jobId = uuidv4();
    const job: ParseJob = {
      id: jobId, libraryId, status: 'PROCESSING',
      progress: 5, step: '上传完成', message: '等待切分条文...',
      items: [], sourceFileName: fileMetaList.map(m => m.originalName).join(', '),
      createdAt: Date.now(),
    };
    parseJobs.set(jobId, job);

    success(res, { jobId, status: 'PROCESSING' }, '审点解析任务已创建');

    (async () => {
      try {
        const total = fileMetaList.length;
        const allItems: any[] = [];
        let totalClauses = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (let i = 0; i < total; i++) {
          const meta = fileMetaList[i];
          job.progress = Math.floor((i / total) * 90);
          job.step = `解析文件 (${i + 1}/${total})`;
          job.message = `正在解析：${meta.originalName}`;

          const fileType = FileTypeService.getStandardizedType(meta.ext);
          const text = await TextExtractionService.extractFileText(meta.savedPath, fileType, meta.originalName);
          if (!text || text.trim().length < 10) {
            job.message = `${meta.originalName} 内容过少，已跳过`;
            continue;
          }

          job.step = `切分条文 + LLM 加工 (${i + 1}/${total})`;
          job.message = `${meta.originalName} 已解析（${text.length} 字符），正在切分条文并加工审点...`;

          const result = await RuleLibraryService.previewCheckpointsFromText(libraryId, text, meta.originalName);
          const tagged = (result.items || []).map(it => ({
            ...it,
            sourceLocation: it.sourceLocation || meta.originalName,
          }));
          allItems.push(...tagged);
          totalClauses += result.totalClauses;
          totalSkipped += result.skipped;
          totalFailed += result.failed;
        }

        job.status = 'COMPLETED';
        job.progress = 100;
        job.step = '审点加工完成';
        job.items = allItems;
        job.message = `切分 ${totalClauses} 条条文，加工 ${allItems.length} 条审点（跳过已存在 ${totalSkipped}，失败 ${totalFailed}）`;
      } catch (err: any) {
        console.error('Async Parse Checkpoints Error:', err);
        job.status = 'FAILED';
        job.progress = 0;
        job.step = '解析失败';
        job.message = err?.message || '审点解析失败';
      } finally {
        savedPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
      }
    })();
  } catch (err: any) {
    console.error('Create Async Parse Checkpoints Job Error:', err);
    savedPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
    error(res, err.message || '创建审点解析任务失败', 500);
  }
};

/**
 * GET /api/rule-libraries/parse-jobs/:jobId
 * 查询解析任务状态
 */
export const getParseJobStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = req.params.jobId as string;
  const job = parseJobs.get(jobId);
  if (!job) {
    error(res, '任务不存在或已过期', 404);
    return;
  }
  success(res, {
    id: job.id,
    status: job.status,
    progress: job.progress,
    step: job.step,
    message: job.message,
    items: job.status === 'COMPLETED' ? job.items : undefined,
    sourceFileName: job.sourceFileName,
  });
};

/** 导入规则预览结果 */
export const importPreviewItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { items, mode, sourceFileName } = req.body || {};
    if (!Array.isArray(items)) {
      error(res, 'items 必须为数组', 400); return;
    }

    const result = await RuleLibraryService.importPreviewItems(
      req.params.id as string,
      items,
      mode === 'replace' ? 'replace' : 'merge',
      typeof sourceFileName === 'string' ? sourceFileName : undefined,
    );
    success(res, result, `成功导入 ${result.count} 条规则`);
  } catch (err: any) {
    console.error('Import Preview Items Error:', err);
    error(res, err.message || '导入失败', 500);
  }
};

/** 添加规则条目 */
export const addItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await RuleLibraryService.addItem((req.params.id as string), req.body);
    success(res, item, '添加成功');
  } catch (err) {
    console.error('Add RuleItem Error:', err);
    error(res, '添加失败', 500);
  }
};

/** 更新规则条目 */
export const updateItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await RuleLibraryService.updateItem((req.params.itemId as string), req.body);
    success(res, item, '更新成功');
  } catch (err) {
    console.error('Update RuleItem Error:', err);
    error(res, '更新失败', 500);
  }
};

/** 删除规则条目 */
export const deleteItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await RuleLibraryService.deleteItem((req.params.itemId as string));
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete RuleItem Error:', err);
    error(res, '删除失败', 500);
  }
};
