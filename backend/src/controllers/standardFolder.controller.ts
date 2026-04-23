import { Request, Response } from 'express';
import { StandardFolderService } from '../services/standardFolder.service';
import { success, error } from '../utils/response';

export const getFolderTree = async (_req: Request, res: Response): Promise<void> => {
  try {
    const tree = await StandardFolderService.getFolderTree();
    success(res, tree);
  } catch (err) {
    console.error('Get Folder Tree Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const getAllFolders = async (_req: Request, res: Response): Promise<void> => {
  try {
    const folders = await StandardFolderService.getAllFolders();
    success(res, folders);
  } catch (err) {
    console.error('Get All Folders Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const createFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, parentId } = req.body;
    if (!name || !name.trim()) {
      error(res, '文件夹名称为必填项', 400);
      return;
    }
    const folder = await StandardFolderService.createFolder({ name: name.trim(), parentId });
    success(res, folder, '文件夹创建成功');
  } catch (err: any) {
    console.error('Create Folder Error:', err);
    error(res, err.message || '创建失败', 400);
  }
};

export const updateFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, parentId } = req.body;
    const folder = await StandardFolderService.updateFolder(id, { name, parentId });
    success(res, folder, '文件夹更新成功');
  } catch (err: any) {
    console.error('Update Folder Error:', err);
    error(res, err.message || '更新失败', 400);
  }
};

export const deleteFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    await StandardFolderService.deleteFolder(id);
    success(res, null, '文件夹删除成功');
  } catch (err: any) {
    console.error('Delete Folder Error:', err);
    error(res, err.message || '删除失败', 400);
  }
};
