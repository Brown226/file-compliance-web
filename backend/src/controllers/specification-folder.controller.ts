import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { SpecificationFolderService } from '../services/specification-folder.service';
import { success, error } from '../utils/response';

export const getTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tree = await SpecificationFolderService.getTree();
    success(res, tree);
  } catch (err) {
    console.error('Get SpecificationFolder Tree Error:', err);
    error(res, '获取目录树失败', 500);
  }
};

export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, parentId } = req.body || {};
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const folder = await SpecificationFolderService.create({ name: name.trim(), parentId: parentId || null });
    success(res, folder, '创建成功');
  } catch (err) {
    console.error('Create SpecificationFolder Error:', err);
    error(res, '创建失败', 500);
  }
};

export const updateFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const folder = await SpecificationFolderService.update(req.params.id, { name: name.trim() });
    success(res, folder, '更新成功');
  } catch (err) {
    console.error('Update SpecificationFolder Error:', err);
    error(res, '更新失败', 500);
  }
};

export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await SpecificationFolderService.delete(req.params.id);
    success(res, null, '删除成功');
  } catch (err: any) {
    console.error('Delete SpecificationFolder Error:', err);
    error(res, err.message || '删除失败', 500);
  }
};

export const moveFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, targetId } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) { error(res, '请选择要移动的目录', 400); return; }
    if (!targetId) { error(res, '请选择目标目录', 400); return; }
    await SpecificationFolderService.moveFolders(ids, targetId);
    success(res, null, '移动成功');
  } catch (err: any) {
    console.error('Move SpecificationFolders Error:', err);
    error(res, err.message || '移动失败', 500);
  }
};

export const mergeFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, name } = req.body || {};
    if (!Array.isArray(ids) || ids.length < 2) { error(res, '至少选择 2 个目录进行合并', 400); return; }
    if (!name?.trim()) { error(res, '请输入合并后的目录名称', 400); return; }
    await SpecificationFolderService.mergeFolders(ids, name.trim());
    success(res, null, '合并成功');
  } catch (err: any) {
    console.error('Merge SpecificationFolders Error:', err);
    error(res, err.message || '合并失败', 500);
  }
};