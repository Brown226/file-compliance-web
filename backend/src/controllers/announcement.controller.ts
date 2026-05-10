import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AnnouncementService, CreateAnnouncementInput, UpdateAnnouncementInput, AnnouncementQueryParams } from '../services/announcement.service';
import { AnnouncementStatus, AnnouncementUrgency } from '@prisma/client';
import { success, error, paginated } from '../utils/response';

/**
 * 创建公告草稿（管理员）
 */
export const createAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, urgency } = req.body;
    const userId = req.user?.id;

    if (!title || !title.trim()) {
      error(res, '公告标题不能为空', 400);
      return;
    }

    if (!content || !content.trim()) {
      error(res, '公告内容不能为空', 400);
      return;
    }

    if (!urgency || !Object.values(AnnouncementUrgency).includes(urgency as AnnouncementUrgency)) {
      error(res, '请选择有效的紧急程度', 400);
      return;
    }

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const input: CreateAnnouncementInput = {
      title: title.trim(),
      content,
      urgency: urgency as AnnouncementUrgency,
      createdBy: userId,
    };

    const announcement = await AnnouncementService.createAnnouncement(input);
    success(res, announcement, '公告草稿创建成功');
  } catch (err: any) {
    console.error('创建公告失败:', err);
    error(res, err.message || '创建公告失败', 500);
  }
};

/**
 * 更新公告草稿（管理员）
 */
export const updateAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, content, urgency } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const updates: UpdateAnnouncementInput = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (urgency !== undefined) {
      if (!Object.values(AnnouncementUrgency).includes(urgency as AnnouncementUrgency)) {
        error(res, '请选择有效的紧急程度', 400);
        return;
      }
      updates.urgency = urgency as AnnouncementUrgency;
    }

    const announcement = await AnnouncementService.updateAnnouncement(id as string, updates, userId);
    success(res, announcement, '公告更新成功');
  } catch (err: any) {
    console.error('更新公告失败:', err);
    error(res, err.message || '更新公告失败', 500);
  }
};

/**
 * 发布公告（管理员）
 */
export const publishAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const announcement = await AnnouncementService.publishAnnouncement(id as string, userId);
    success(res, announcement, '公告发布成功');
  } catch (err: any) {
    console.error('发布公告失败:', err);
    error(res, err.message || '发布公告失败', 500);
  }
};

/**
 * 撤回公告（管理员）
 */
export const withdrawAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const announcement = await AnnouncementService.withdrawAnnouncement(id as string, userId);
    success(res, announcement, '公告已撤回');
  } catch (err: any) {
    console.error('撤回公告失败:', err);
    error(res, err.message || '撤回公告失败', 500);
  }
};

/**
 * 删除公告（管理员）
 */
export const deleteAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    await AnnouncementService.deleteAnnouncement(id as string, userId);
    success(res, null, '公告已删除');
  } catch (err: any) {
    console.error('删除公告失败:', err);
    error(res, err.message || '删除公告失败', 500);
  }
};

/**
 * 获取公告列表（管理员）
 */
export const getAnnouncementsForAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, status, urgency, keyword } = req.query;

    const params: AnnouncementQueryParams = {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 10,
      keyword: keyword as string,
    };

    if (status && Object.values(AnnouncementStatus).includes(status as AnnouncementStatus)) {
      params.status = status as AnnouncementStatus;
    }
    if (urgency && Object.values(AnnouncementUrgency).includes(urgency as AnnouncementUrgency)) {
      params.urgency = urgency as AnnouncementUrgency;
    }

    const result = await AnnouncementService.getAnnouncementsForAdmin(params);
    paginated(res, result.items, result.total, '获取公告列表成功');
  } catch (err: any) {
    console.error('获取公告列表失败:', err);
    error(res, err.message || '获取公告列表失败', 500);
  }
};

/**
 * 获取公告详情
 */
export const getAnnouncementDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const announcement = await AnnouncementService.getAnnouncementById(id as string);
    if (!announcement) {
      error(res, '公告不存在', 404);
      return;
    }

    success(res, announcement);
  } catch (err: any) {
    console.error('获取公告详情失败:', err);
    error(res, err.message || '获取公告详情失败', 500);
  }
};

/**
 * 获取用户未读公告
 */
export const getUnreadAnnouncements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const announcements = await AnnouncementService.getUnreadAnnouncements(userId);
    success(res, announcements);
  } catch (err: any) {
    console.error('获取未读公告失败:', err);
    error(res, err.message || '获取未读公告失败', 500);
  }
};

/**
 * 标记公告为已读
 */
export const markAnnouncementRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { confirmed } = body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    await AnnouncementService.markAsRead(userId, id as string, confirmed);
    success(res, null, '已标记为已读');
  } catch (err: any) {
    console.error('标记已读失败:', err);
    error(res, err.message || '标记已读失败', 500);
  }
};

/**
 * 批量标记公告为已读
 */
export const markAllAnnouncementsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { announcementIds } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    if (!Array.isArray(announcementIds)) {
      error(res, '公告 ID 列表格式不正确', 400);
      return;
    }

    await AnnouncementService.markAllAsRead(userId, announcementIds);
    success(res, null, '已全部标记为已读');
  } catch (err: any) {
    console.error('批量标记已读失败:', err);
    error(res, err.message || '批量标记已读失败', 500);
  }
};

/**
 * 获取用户公告历史
 */
export const getAnnouncementHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { page, limit, urgency, keyword } = req.query;

    if (!userId) {
      error(res, '请先登录后再操作', 401);
      return;
    }

    const params: AnnouncementQueryParams = {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 10,
      keyword: keyword as string,
    };

    if (urgency && Object.values(AnnouncementUrgency).includes(urgency as AnnouncementUrgency)) {
      params.urgency = urgency as AnnouncementUrgency;
    }

    const result = await AnnouncementService.getAnnouncementHistory(userId, params);
    paginated(res, result.items, result.total, '获取公告历史成功');
  } catch (err: any) {
    console.error('获取公告历史失败:', err);
    error(res, err.message || '获取公告历史失败', 500);
  }
};
