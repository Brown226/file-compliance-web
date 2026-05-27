import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { RuleLibraryService } from '../services/rule-library.service';
import { ParserService } from '../services/parser.service';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { FileTypeService } from '../services/file-type.service';
import prisma from '../config/db';
import { WebSocketService } from '../services/websocket.service';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/rule-libraries');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 获取规则库列表 */
export const listLibraries = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const selectableOnly = _req.query.selectableOnly === 'true';
    const options: Record<string, any> = { selectableOnly };
    if (_req.query.keyword) options.keyword = String(_req.query.keyword);
    if (_req.query.status) options.status = String(_req.query.status);
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
    const { name, description } = req.body;
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const library = await RuleLibraryService.create({
      name: name.trim(),
      description,
      createdBy: req.user!.id,
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
    const savedPath = path.join(UPLOAD_DIR, savedName);
    fs.renameSync(file.path, savedPath);

    const fileType = FileTypeService.getStandardizedType(ext);
    const text = await ParserService.parseFile(savedPath, fileType);
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
    const savedPath = path.join(UPLOAD_DIR, savedName);
    fs.renameSync(file.path, savedPath);

    const fileType = FileTypeService.getStandardizedType(ext);
    const text = await ParserService.parseFile(savedPath, fileType);
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
 * 支持最多 5 个文件同时上传，后台按序解析，合并候选规则结果
 */
export const parseRulesPreviewAsync = async (req: AuthRequest, res: Response): Promise<void> => {
  const savedPaths: string[] = [];
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) { error(res, '请选择文件', 400); return; }
    if (files.length > 5) {
      // 清理已接收文件
      files.forEach(f => { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} });
      error(res, '最多支持同时上传 5 个文件', 400);
      return;
    }

    const libraryId = req.params.id as string;
    const userId = (req as any).user?.id as string | undefined;

    // 1. 保存文件（重命名为 uuid，避免重名/中文问题）
    const fileMetaList: Array<{ originalName: string; savedPath: string; ext: string }> = [];
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR, savedName);
      fs.renameSync(f.path, savedPath);
      savedPaths.push(savedPath);
      fileMetaList.push({ originalName: f.originalname, savedPath, ext });
    }

    const title = fileMetaList.length === 1
      ? `AI 解析规则：${fileMetaList[0].originalName}`
      : `AI 解析规则：${fileMetaList.length} 个文件`;

    // 2. 创建 PROCESSING 任务
    const task = await prisma.task.create({
      data: {
        title,
        status: 'PROCESSING',
        reviewMode: 'RULE_PARSING',
        creatorId: userId || 'system',
        selfCheckReport: {
          libraryId,
          fileCount: fileMetaList.length,
          files: fileMetaList.map(m => m.originalName),
          phase: 'upload',
        } as any,
      },
    });

    // 3. 立即返回
    success(res, { taskId: task.id, status: 'PROCESSING' }, '解析任务已创建，正在后台执行');

    // 4. 后台异步按序解析并合并结果
    (async () => {
      try {
        const total = fileMetaList.length;
        const allItems: any[] = [];

        for (let i = 0; i < total; i++) {
          const meta = fileMetaList[i];
          const basePct = Math.floor((i / total) * 90); // 0..90 分配给各文件
          WebSocketService.emitTaskProgress(task.id, {
            type: 'rule_parsing_start',
            step: `解析文件 (${i + 1}/${total})`,
            progress: basePct + 5,
            message: `正在解析：${meta.originalName}`,
          });

          const fileType = FileTypeService.getStandardizedType(meta.ext);
          const text = await ParserService.parseFile(meta.savedPath, fileType);
          if (!text || text.trim().length < 10) {
            // 单文件失败跳过，不中断整体
            WebSocketService.emitTaskProgress(task.id, {
              type: 'rule_parsing_progress',
              step: `跳过文件 (${i + 1}/${total})`,
              progress: basePct + 40,
              message: `${meta.originalName} 内容过少或解析失败，已跳过`,
            });
            continue;
          }

          WebSocketService.emitTaskProgress(task.id, {
            type: 'rule_parsing_progress',
            step: `提取规则 (${i + 1}/${total})`,
            progress: basePct + 40,
            message: `${meta.originalName} 已解析（${text.length} 字符），正在提取规则...`,
          });

          const preview = await RuleLibraryService.previewRulesFromText(libraryId, text, meta.originalName);
          // 标记来源文件名
          const tagged = (preview.items || []).map(it => ({
            ...it,
            sourceLocation: it.sourceLocation || meta.originalName,
          }));
          allItems.push(...tagged);
        }

        // 5. 写入任务结果
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'COMPLETED',
            selfCheckReport: {
              libraryId,
              fileCount: total,
              items: allItems,
              sourceFileName: fileMetaList.map(m => m.originalName).join(', '),
              count: allItems.length,
            } as any,
          },
        });

        WebSocketService.emitTaskProgress(task.id, {
          type: 'rule_parsing_complete',
          step: '解析完成',
          progress: 100,
          message: `成功解析 ${allItems.length} 条候选规则（共 ${total} 个文件）`,
        });
      } catch (err: any) {
        console.error('Async Parse Rules Error:', err);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }).catch(() => {});
        WebSocketService.emitTaskProgress(task.id, {
          type: 'error',
          step: '解析失败',
          progress: 0,
          message: err?.message || '规则解析失败',
        });
      }
    })();
  } catch (err: any) {
    console.error('Create Async Parse Task Error:', err);
    // 清理已保存文件
    savedPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
    error(res, err.message || '创建解析任务失败', 500);
  }
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
