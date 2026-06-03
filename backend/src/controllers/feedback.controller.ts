import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { FeedbackService, CreateFeedbackInput, UpdateFeedbackStatusInput } from '../services/feedback.service';
import { FeedbackStatus, FeedbackCategory } from '@prisma/client';
import { success, error, paginated } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPath } from '../config/upload';

function UPLOAD_DIR() { return getUploadPath('feedback'); }

// 允许的文件类型
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * 提交反馈（支持文件上传）
 */
export const createFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, category } = req.body;
    const userId = req.user?.id;

    // 验证必填字段
    if (!title || !title.trim()) {
      error(res, '反馈标题不能为空', 400);
      return;
    }

    if (!content || !content.trim()) {
      error(res, '反馈内容不能为空', 400);
      return;
    }

    if (!category || !Object.values(FeedbackCategory).includes(category as FeedbackCategory)) {
      error(res, '请选择有效的反馈类别', 400);
      return;
    }

    if (!userId) {
      error(res, '请先登录后再提交反馈', 401);
      return;
    }

    // 处理文件上传
    const files = req.files as Express.Multer.File[];
    let attachmentPaths: Array<{
      id: string;
      fileName: string;
      filePath: string;
      fileSize: number;
      fileType: string;
    }> = [];

    if (files && files.length > 0) {
      // 验证文件数量和总大小
      if (files.length > 10) {
        error(res, '最多只能上传10个文件', 400);
        return;
      }

      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        error(res, '文件总大小不能超过50MB', 400);
        return;
      }

      // 验证每个文件
      for (const file of files) {
        // 检查文件大小
        if (file.size > MAX_FILE_SIZE) {
          error(res, `文件 ${file.originalname} 大小超过10MB限制`, 400);
          return;
        }

        // 检查MIME类型
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          error(res, `文件 ${file.originalname} 格式不支持`, 400);
          return;
        }

        // 生成唯一文件名
        const fileExt = path.extname(file.originalname);
        const fileName = `${uuidv4()}${fileExt}`;
        const filePath = path.join(UPLOAD_DIR(), fileName);

        // 移动文件
        fs.renameSync(file.path, filePath);

        attachmentPaths.push({
          id: uuidv4(),
          fileName: file.originalname,
          filePath: `/uploads/feedback/${fileName}`,
          fileSize: file.size,
          fileType: file.mimetype,
        });
      }
    }

    // 创建反馈
    const feedback = await FeedbackService.createFeedback({
      title: title.trim(),
      content: content.trim(),
      category: category as FeedbackCategory,
      userId,
      attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
    });

    success(res, feedback, '反馈提交成功');
  } catch (err) {
    console.error('Create Feedback Error:', err);
    error(res, '反馈提交失败，请稍后重试', 500);
  }
};

/**
 * 获取我的反馈列表
 */
export const getMyFeedbacks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      error(res, '请先登录', 401);
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await FeedbackService.getMyFeedbacks(userId, page, limit);
    paginated(res, result.feedbacks, result.total);
  } catch (err) {
    console.error('Get My Feedbacks Error:', err);
    error(res, '获取反馈列表失败', 500);
  }
};

/**
 * 获取反馈详情
 */
export const getFeedbackDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      error(res, '请先登录', 401);
      return;
    }

    const feedback = await FeedbackService.getFeedbackById(id as string, userId, userRole);
    if (!feedback) {
      error(res, '反馈不存在', 404);
      return;
    }

    success(res, feedback);
  } catch (err) {
    console.error('Get Feedback Detail Error:', err);
    if (err instanceof Error && err.message === '无权查看此反馈') {
      error(res, '无权查看此反馈', 403);
    } else {
      error(res, '获取反馈详情失败', 500);
    }
  }
};

/**
 * 获取所有反馈列表（管理员）
 */
export const getAllFeedbacks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as FeedbackStatus | undefined;
    const category = req.query.category as FeedbackCategory | undefined;
    const userId = req.query.userId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const keyword = req.query.keyword as string | undefined;

    const result = await FeedbackService.getAllFeedbacks({
      page,
      limit,
      status,
      category,
      userId,
      startDate,
      endDate,
      keyword,
    });

    paginated(res, result.feedbacks, result.total);
  } catch (err) {
    console.error('Get All Feedbacks Error:', err);
    error(res, '获取反馈列表失败', 500);
  }
};

/**
 * 更新反馈状态（管理员）
 */
export const updateFeedbackStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, remark } = req.body;
    const resolverId = req.user?.id;

    if (!resolverId) {
      error(res, '请先登录', 401);
      return;
    }

    if (!status || !Object.values(FeedbackStatus).includes(status as FeedbackStatus)) {
      error(res, '请选择有效的处理状态', 400);
      return;
    }

    const feedback = await FeedbackService.updateFeedbackStatus(id as string, {
      status: status as FeedbackStatus,
      resolverId,
      remark,
    });

    success(res, feedback, '反馈状态更新成功');
  } catch (err) {
    console.error('Update Feedback Status Error:', err);
    if (err instanceof Error && err.message === '反馈不存在') {
      error(res, '反馈不存在', 404);
    } else {
      error(res, '更新反馈状态失败', 500);
    }
  }
};

/**
 * 删除反馈（管理员）
 */
export const deleteFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const feedback = await FeedbackService.deleteFeedback(id as string);

    // 删除关联的文件
    const attachments = feedback.attachmentPaths as Array<{ filePath: string }> | null;
    if (attachments) {
      for (const attachment of attachments) {
        const rawPath = attachment.filePath
        const filePath = (path.isAbsolute(rawPath) && !rawPath.startsWith('/') && !rawPath.startsWith('\\'))
          ? rawPath
          : path.join(__dirname, '../..', rawPath.replace(/^[/\\]+/, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    success(res, null, '反馈删除成功');
  } catch (err) {
    console.error('Delete Feedback Error:', err);
    if (err instanceof Error && err.message === '反馈不存在') {
      error(res, '反馈不存在', 404);
    } else {
      error(res, '删除反馈失败', 500);
    }
  }
};

/**
 * 批量更新反馈状态（管理员）
 */
export const batchUpdateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, status, remark } = req.body;
    const resolverId = req.user?.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      error(res, '请选择要操作的反馈', 400);
      return;
    }

    if (!status || !Object.values(FeedbackStatus).includes(status as FeedbackStatus)) {
      error(res, '请选择有效的处理状态', 400);
      return;
    }

    if (!resolverId) {
      error(res, '请先登录', 401);
      return;
    }

    const result = await FeedbackService.batchUpdateStatus(ids, status as FeedbackStatus, resolverId, remark);
    success(res, result, `成功更新 ${result.count} 条反馈`);
  } catch (err) {
    console.error('Batch Update Status Error:', err);
    error(res, '批量更新失败', 500);
  }
};

/**
 * 批量删除反馈（管理员）
 */
export const batchDelete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      error(res, '请选择要删除的反馈', 400);
      return;
    }

    const result = await FeedbackService.batchDelete(ids);

    // 删除关联的文件
    for (const id of ids) {
      const feedback = await FeedbackService.getFeedbackById(id);
      if (feedback) {
        const attachments = feedback.attachmentPaths as Array<{ filePath: string }> | null;
        if (attachments) {
          for (const attachment of attachments) {
            const rawPath = attachment.filePath
            const filePath = (path.isAbsolute(rawPath) && !rawPath.startsWith('/') && !rawPath.startsWith('\\'))
              ? rawPath
              : path.join(__dirname, '../..', rawPath.replace(/^[/\\]+/, ''));
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }
      }
    }

    success(res, result, `成功删除 ${result.count} 条反馈`);
  } catch (err) {
    console.error('Batch Delete Error:', err);
    error(res, '批量删除失败', 500);
  }
};

/**
 * 获取反馈统计信息（管理员）
 */
export const getFeedbackStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await FeedbackService.getFeedbackStats();
    success(res, stats);
  } catch (err) {
    console.error('Get Feedback Stats Error:', err);
    error(res, '获取统计信息失败', 500);
  }
};

/**
 * 下载反馈附件
 */
export const downloadAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      error(res, '请先登录', 401);
      return;
    }

    // 查找包含该文件ID的反馈
    const feedbacks = await FeedbackService.getAllFeedbacks({
      page: 1,
      limit: 1000,
      userId: userRole === 'ADMIN' ? undefined : userId,
    });

    let foundAttachment: { filePath: string; fileName: string } | null = null;

    for (const feedback of feedbacks.feedbacks) {
      const attachments = feedback.attachmentPaths as Array<{
        id: string;
        filePath: string;
        fileName: string;
      }> | null;

      if (attachments) {
        const attachment = attachments.find((a) => a.id === fileId);
        if (attachment) {
          foundAttachment = attachment;
          break;
        }
      }
    }

    if (!foundAttachment) {
      error(res, '文件不存在或无权下载', 404);
      return;
    }

    let filePath: string
    const rawPath = foundAttachment.filePath
    if (path.isAbsolute(rawPath) && !rawPath.startsWith('/') && !rawPath.startsWith('\\')) {
      filePath = rawPath
    } else {
      const relativePath = rawPath.replace(/^[/\\]+/, '')
      filePath = path.join(__dirname, '../..', relativePath)
    }

    if (!fs.existsSync(filePath)) {
      error(res, '文件不存在', 404);
      return;
    }

    res.download(filePath, foundAttachment.fileName);
  } catch (err) {
    console.error('Download Attachment Error:', err);
    error(res, '文件下载失败', 500);
  }
};
