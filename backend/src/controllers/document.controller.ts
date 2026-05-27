/**
 * 文档管理 API 控制器
 */

import { Request, Response } from 'express';
import { DocumentService } from '../services/document.service';
import { success, error } from '../utils/response';
import { DocumentStatus } from '@prisma/client';

export class DocumentController {
  /**
   * 获取文档列表
   */
  static async listDocuments(req: Request, res: Response) {
    try {
      const { categoryId, status, search, page, pageSize } = req.query;

      const result = await DocumentService.listDocuments({
        categoryId: categoryId as string,
        status: status as DocumentStatus,
        search: search as string,
        page: page ? parseInt(page as string) : undefined,
        pageSize: pageSize ? parseInt(pageSize as string) : undefined,
      });

      success(res, result);
    } catch (err: any) {
      console.error('[Document] 列表查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 获取文档详情
   */
  static async getDocument(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const document = await DocumentService.getDocument(id);

      if (!document) {
        error(res, '文档不存在', 404);
        return;
      }

      success(res, document);
    } catch (err: any) {
      console.error('[Document] 详情查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 更新文档信息
   */
  static async updateDocument(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { title, status, metadata } = req.body;

      const document = await DocumentService.updateDocument(id, {
        title,
        status,
        metadata,
      });

      success(res, document);
    } catch (err: any) {
      console.error('[Document] 更新失败:', err);
      error(res, err.message || '更新失败', 500);
    }
  }

  /**
   * 删除文档（软删除）
   */
  static async deleteDocument(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      await DocumentService.deleteDocument(id);
      success(res, { message: '文档已删除' });
    } catch (err: any) {
      console.error('[Document] 删除失败:', err);
      error(res, err.message || '删除失败', 500);
    }
  }

  /**
   * 归档文档
   */
  static async archiveDocument(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      await DocumentService.archiveDocument(id);
      success(res, { message: '文档已归档' });
    } catch (err: any) {
      console.error('[Document] 归档失败:', err);
      error(res, err.message || '归档失败', 500);
    }
  }

  /**
   * 恢复文档
   */
  static async unarchiveDocument(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      await DocumentService.unarchiveDocument(id);
      success(res, { message: '文档已恢复' });
    } catch (err: any) {
      console.error('[Document] 恢复失败:', err);
      error(res, err.message || '恢复失败', 500);
    }
  }

  /**
   * 获取文档版本列表
   */
  static async listVersions(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const versions = await DocumentService.listVersions(id);
      success(res, versions);
    } catch (err: any) {
      console.error('[Document] 版本列表查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 获取指定版本详情
   */
  static async getVersion(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const version = req.params.version as string;
      const versionData = await DocumentService.getVersion(id, parseInt(version));

      if (!versionData) {
        error(res, '版本不存在', 404);
        return;
      }

      success(res, versionData);
    } catch (err: any) {
      console.error('[Document] 版本详情查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 回滚到指定版本
   */
  static async restoreVersion(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const version = req.params.version as string;
      const { createdBy } = req.body;

      const document = await DocumentService.restoreVersion(id, parseInt(version), {
        createdBy,
      });

      success(res, { message: '版本已恢复', document });
    } catch (err: any) {
      console.error('[Document] 版本回滚失败:', err);
      error(res, err.message || '回滚失败', 500);
    }
  }

  /**
   * 获取文档段落列表
   */
  static async getDocumentChunks(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { page, pageSize } = req.query;

      const result = await DocumentService.getDocumentChunks(id, {
        page: page ? parseInt(page as string) : undefined,
        pageSize: pageSize ? parseInt(pageSize as string) : undefined,
      });

      success(res, result);
    } catch (err: any) {
      console.error('[Document] 段落查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 添加文档标签
   */
  static async addTag(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { tagId } = req.body;

      await DocumentService.addTag(id, tagId);
      success(res, { message: '标签已添加' });
    } catch (err: any) {
      console.error('[Document] 添加标签失败:', err);
      error(res, err.message || '操作失败', 500);
    }
  }

  /**
   * 移除文档标签
   */
  static async removeTag(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { tagId } = req.body;

      await DocumentService.removeTag(id, tagId);
      success(res, { message: '标签已移除' });
    } catch (err: any) {
      console.error('[Document] 移除标签失败:', err);
      error(res, err.message || '操作失败', 500);
    }
  }

  /**
   * 获取文档统计
   */
  static async getStats(req: Request, res: Response) {
    try {
      const { categoryId } = req.query;
      const stats = await DocumentService.getDocumentStats(categoryId as string);
      success(res, stats);
    } catch (err: any) {
      console.error('[Document] 统计查询失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }

  /**
   * 检查同名文档
   */
  static async checkDuplicate(req: Request, res: Response) {
    try {
      const { categoryId, title } = req.query;

      const existing = await DocumentService.findByTitle(
        categoryId as string,
        title as string
      );

      success(res, {
        exists: !!existing,
        document: existing,
      });
    } catch (err: any) {
      console.error('[Document] 同名检查失败:', err);
      error(res, err.message || '查询失败', 500);
    }
  }
}
