import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { ReviewSpecificationService } from '../services/review-specification.service';
import { TextExtractionService } from '../services/review-pipeline/text-extraction.service';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { FileTypeService } from '../services/file-type.service';
import { getUploadPath } from '../config/upload';

function UPLOAD_DIR() { return getUploadPath('review-specifications'); }

export const listSpecifications = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const selectableOnly = _req.query.selectableOnly === 'true';
    const options: Record<string, any> = { selectableOnly };
    if (_req.query.folderId) options.folderId = String(_req.query.folderId);
    if (_req.query.keyword) options.keyword = String(_req.query.keyword);
    if (_req.query.status) options.status = String(_req.query.status);
    const specifications = await ReviewSpecificationService.list(options);
    success(res, specifications);
  } catch (err) {
    console.error('List ReviewSpecifications Error:', err);
    error(res, '获取审查规范集列表失败', 500);
  }
};

export const getSpecification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const specification = await ReviewSpecificationService.getById((req.params.id as string));
    if (!specification) { error(res, '审查规范集不存在', 404); return; }
    success(res, specification);
  } catch (err) {
    console.error('Get ReviewSpecification Error:', err);
    error(res, '获取详情失败', 500);
  }
};

export const createSpecification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, folderId } = req.body;
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const specification = await ReviewSpecificationService.create({
      name: name.trim(),
      description,
      folderId: folderId || null,
      createdBy: req.user!.id,
    });
    success(res, specification, '创建成功');
  } catch (err) {
    console.error('Create ReviewSpecification Error:', err);
    error(res, '创建失败', 500);
  }
};

export const updateSpecification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const specification = await ReviewSpecificationService.update((req.params.id as string), req.body);
    success(res, specification, '更新成功');
  } catch (err) {
    console.error('Update ReviewSpecification Error:', err);
    error(res, '更新失败', 500);
  }
};

export const deleteSpecification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ReviewSpecificationService.delete((req.params.id as string));
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete ReviewSpecification Error:', err);
    error(res, '删除失败', 500);
  }
};

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

    const count = await ReviewSpecificationService.parseRulesFromText((req.params.id as string), text, file.originalname);
    success(res, { count, fileName: file.originalname }, `成功解析 ${count} 条规则`);
  } catch (err: any) {
    console.error('Parse Rules Error:', err);
    error(res, err.message || '解析失败', 500);
  }
};

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

    const preview = await ReviewSpecificationService.previewRulesFromText((req.params.id as string), text, file.originalname);
    success(res, preview, `成功解析 ${preview.items.length} 条候选规则`);
  } catch (err: any) {
    console.error('Parse Rules Preview Error:', err);
    error(res, err.message || '解析预览失败', 500);
  }
};

export const importPreviewItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { items, mode, sourceFileName } = req.body || {};
    if (!Array.isArray(items)) {
      error(res, 'items 必须为数组', 400); return;
    }

    const result = await ReviewSpecificationService.importPreviewItems(
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

export const addItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await ReviewSpecificationService.addItem((req.params.id as string), req.body);
    success(res, item, '添加成功');
  } catch (err) {
    console.error('Add SpecificationItem Error:', err);
    error(res, '添加失败', 500);
  }
};

export const updateItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await ReviewSpecificationService.updateItem((req.params.itemId as string), req.body);
    success(res, item, '更新成功');
  } catch (err) {
    console.error('Update SpecificationItem Error:', err);
    error(res, '更新失败', 500);
  }
};

export const deleteItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ReviewSpecificationService.deleteItem((req.params.itemId as string));
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete SpecificationItem Error:', err);
    error(res, '删除失败', 500);
  }
};