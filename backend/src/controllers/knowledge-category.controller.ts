import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { KnowledgeCategoryService } from '../services/knowledge-category.service';
import { VectorService } from '../services/vector.service';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/knowledge');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 获取知识子库列表 */
export const listCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await KnowledgeCategoryService.list();
    success(res, categories);
  } catch (err) {
    console.error('List KnowledgeCategories Error:', err);
    error(res, '获取知识子库列表失败', 500);
  }
};

/** 获取所有知识子库（扁平） */
export const listAllCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await KnowledgeCategoryService.listAll();
    success(res, categories);
  } catch (err) {
    console.error('ListAll KnowledgeCategories Error:', err);
    error(res, '获取知识子库列表失败', 500);
  }
};

/** 创建知识子库 */
export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, documentTypes, parentId } = req.body;
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const category = await KnowledgeCategoryService.create({ name: name.trim(), description, documentTypes, parentId });
    success(res, category, '创建成功');
  } catch (err) {
    console.error('Create KnowledgeCategory Error:', err);
    error(res, '创建失败', 500);
  }
};

/** 更新知识子库 */
export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const category = await KnowledgeCategoryService.update(id, req.body);
    success(res, category, '更新成功');
  } catch (err) {
    console.error('Update KnowledgeCategory Error:', err);
    error(res, '更新失败', 500);
  }
};

/** 删除知识子库 */
export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await KnowledgeCategoryService.delete(id);
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete KnowledgeCategory Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 上传文档到知识子库 */
export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

    // 移动到永久目录
    const ext = path.extname(file.originalname);
    const savedName = `${uuidv4()}${ext}`;
    const savedPath = path.join(UPLOAD_DIR, savedName);
    fs.renameSync(file.path, savedPath);

    const result = await KnowledgeCategoryService.uploadDocument(id, savedPath, file.originalname);
    success(res, result, `上传成功，已分块 ${result.chunks} 个向量片段`);
  } catch (err: any) {
    console.error('Upload Document Error:', err);
    error(res, err.message || '上传失败', 500);
  }
};

/** 获取向量文档列表 */
export const listDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, pageSize, query, sourceType, categoryId } = req.query;
    const result = await VectorService.listDocuments({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 10,
      query: query as string,
      sourceType: sourceType as string,
      categoryId: categoryId as string,
    });
    success(res, result);
  } catch (err) {
    console.error('List VectorDocuments Error:', err);
    error(res, '获取文档列表失败', 500);
  }
};

/** 删除向量文档 */
export const deleteDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, categoryId } = req.body;
    if (ids?.length) {
      await VectorService.deleteDocuments({ ids });
    } else if (categoryId) {
      await VectorService.deleteDocuments({ categoryId });
    } else {
      error(res, '请指定删除条件', 400); return;
    }
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete VectorDocuments Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 获取向量库统计 */
export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await VectorService.getStats();
    success(res, stats);
  } catch (err) {
    console.error('Get VectorStats Error:', err);
    error(res, '获取统计失败', 500);
  }
};
