import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { RuleLibraryService } from '../services/rule-library.service';
import { ParserService } from '../services/parser.service';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { FileTypeService } from '../services/file-type.service';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/rule-libraries');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 获取规则库列表 */
export const listLibraries = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const selectableOnly = _req.query.selectableOnly === 'true';
    const libraries = await RuleLibraryService.list({ selectableOnly });
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
    const library = await RuleLibraryService.create({ name: name.trim(), description, createdBy: req.user!.id });
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
