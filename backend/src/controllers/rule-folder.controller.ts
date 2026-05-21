import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { RuleFolderService } from '../services/rule-folder.service';
import { success, error } from '../utils/response';

/** 获取目录树 */
export const getTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tree = await RuleFolderService.getTree();
    success(res, tree);
  } catch (err) {
    console.error('Get RuleFolder Tree Error:', err);
    error(res, '获取目录树失败', 500);
  }
};

/** 创建目录 */
export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, parentId } = req.body || {};
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const folder = await RuleFolderService.create({ name: name.trim(), parentId: parentId || null });
    success(res, folder, '创建成功');
  } catch (err) {
    console.error('Create RuleFolder Error:', err);
    error(res, '创建失败', 500);
  }
};

/** 更新目录 */
export const updateFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const folder = await RuleFolderService.update(req.params.id, { name: name.trim() });
    success(res, folder, '更新成功');
  } catch (err) {
    console.error('Update RuleFolder Error:', err);
    error(res, '更新失败', 500);
  }
};

/** 删除目录 */
export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await RuleFolderService.delete(req.params.id);
    success(res, null, '删除成功');
  } catch (err: any) {
    console.error('Delete RuleFolder Error:', err);
    error(res, err.message || '删除失败', 500);
  }
};

/** 移动目录 */
export const moveFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, targetId } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) { error(res, '请选择要移动的目录', 400); return; }
    if (!targetId) { error(res, '请选择目标目录', 400); return; }
    await RuleFolderService.moveFolders(ids, targetId);
    success(res, null, '移动成功');
  } catch (err: any) {
    console.error('Move RuleFolders Error:', err);
    error(res, err.message || '移动失败', 500);
  }
};

/** 合并目录 */
export const mergeFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, name } = req.body || {};
    if (!Array.isArray(ids) || ids.length < 2) { error(res, '至少选择 2 个目录进行合并', 400); return; }
    if (!name?.trim()) { error(res, '请输入合并后的目录名称', 400); return; }
    await RuleFolderService.mergeFolders(ids, name.trim());
    success(res, null, '合并成功');
  } catch (err: any) {
    console.error('Merge RuleFolders Error:', err);
    error(res, err.message || '合并失败', 500);
  }
};
