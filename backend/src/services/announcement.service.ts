import prisma from '../config/db';
import { SystemAnnouncement, AnnouncementStatus, AnnouncementUrgency, Prisma } from '@prisma/client';

export interface CreateAnnouncementInput {
  title: string;
  content: string;
  urgency: AnnouncementUrgency;
  createdBy: string;
}

export interface UpdateAnnouncementInput {
  title?: string;
  content?: string;
  urgency?: AnnouncementUrgency;
}

export interface AnnouncementQueryParams {
  page?: number;
  limit?: number;
  status?: AnnouncementStatus;
  urgency?: AnnouncementUrgency;
  keyword?: string;
}

export interface AnnouncementWithCreator extends SystemAnnouncement {
  creator: {
    id: string;
    username: string;
    name: string;
  };
  isRead?: boolean;
  isConfirmed?: boolean;
}

export class AnnouncementService {
  /**
   * 创建公告草稿
   */
  static async createAnnouncement(input: CreateAnnouncementInput): Promise<SystemAnnouncement> {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('标题不能为空');
    }
    if (input.title.length > 200) {
      throw new Error('标题不能超过 200 个字符');
    }
    if (!input.content || input.content.trim().length === 0) {
      throw new Error('内容不能为空');
    }
    if (input.content.length > 50000) {
      throw new Error('内容不能超过 50000 个字符');
    }

    return prisma.systemAnnouncement.create({
      data: {
        title: input.title.trim(),
        content: input.content,
        urgency: input.urgency,
        status: AnnouncementStatus.DRAFT,
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * 更新公告草稿（仅 DRAFT 状态可更新）
   */
  static async updateAnnouncement(
    id: string,
    updates: UpdateAnnouncementInput,
    userId: string
  ): Promise<SystemAnnouncement> {
    const announcement = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!announcement) {
      throw new Error('公告不存在');
    }
    if (announcement.status !== AnnouncementStatus.DRAFT) {
      throw new Error('只有草稿状态的公告可以编辑');
    }

    // 验证更新内容
    if (updates.title !== undefined) {
      if (updates.title.trim().length === 0 || updates.title.length > 200) {
        throw new Error('标题长度必须在 1-200 个字符之间');
      }
    }
    if (updates.content !== undefined) {
      if (updates.content.trim().length === 0 || updates.content.length > 50000) {
        throw new Error('内容长度必须在 1-50000 个字符之间');
      }
    }

    return prisma.systemAnnouncement.update({
      where: { id },
      data: {
        ...(updates.title !== undefined && { title: updates.title.trim() }),
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.urgency !== undefined && { urgency: updates.urgency }),
      },
    });
  }

  /**
   * 发布公告（DRAFT → PUBLISHED）
   */
  static async publishAnnouncement(id: string, userId: string): Promise<SystemAnnouncement> {
    const announcement = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!announcement) {
      throw new Error('公告不存在');
    }
    if (announcement.status !== AnnouncementStatus.DRAFT) {
      throw new Error('只有草稿状态的公告可以发布');
    }

    return prisma.systemAnnouncement.update({
      where: { id },
      data: {
        status: AnnouncementStatus.PUBLISHED,
        publishAt: new Date(),
      },
    });
  }

  /**
   * 撤回公告（PUBLISHED → WITHDRAWN）
   */
  static async withdrawAnnouncement(id: string, userId: string): Promise<SystemAnnouncement> {
    const announcement = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!announcement) {
      throw new Error('公告不存在');
    }
    if (announcement.status !== AnnouncementStatus.PUBLISHED) {
      throw new Error('只有已发布的公告可以撤回');
    }

    return prisma.systemAnnouncement.update({
      where: { id },
      data: {
        status: AnnouncementStatus.WITHDRAWN,
        withdrawnAt: new Date(),
      },
    });
  }

  /**
   * 删除公告（仅 DRAFT/WITHDRAWN 可删除）
   */
  static async deleteAnnouncement(id: string, userId: string): Promise<void> {
    const announcement = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!announcement) {
      throw new Error('公告不存在');
    }
    if (announcement.status !== AnnouncementStatus.DRAFT && announcement.status !== AnnouncementStatus.WITHDRAWN) {
      throw new Error('只有草稿或已撤回的公告可以删除');
    }

    // 先删除相关的 UserAnnouncementRead 记录
    await prisma.userAnnouncementRead.deleteMany({
      where: { announcementId: id },
    });

    await prisma.systemAnnouncement.delete({ where: { id } });
  }

  /**
   * 获取公告详情（任何人可查看）
   */
  static async getAnnouncementById(id: string): Promise<AnnouncementWithCreator | null> {
    return prisma.systemAnnouncement.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    }) as Promise<AnnouncementWithCreator | null>;
  }

  /**
   * 管理员获取公告列表（分页 + 筛选）
   */
  static async getAnnouncementsForAdmin(params: AnnouncementQueryParams) {
    const page = params.page || 1;
    const limit = params.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.SystemAnnouncementWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }
    if (params.urgency) {
      where.urgency = params.urgency;
    }
    if (params.keyword) {
      where.title = {
        contains: params.keyword,
        mode: 'insensitive',
      };
    }

    const [items, total] = await Promise.all([
      prisma.systemAnnouncement.findMany({
        where,
        orderBy: [
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      }),
      prisma.systemAnnouncement.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 获取用户未读公告（最多 5 条，按紧急度+时间排序）
   */
  static async getUnreadAnnouncements(userId: string): Promise<AnnouncementWithCreator[]> {
    // 先获取所有已发布的公告
    const allPublished = await prisma.systemAnnouncement.findMany({
      where: {
        status: AnnouncementStatus.PUBLISHED,
      },
      orderBy: [
        { urgency: 'desc' }, // URGENT > IMPORTANT > NORMAL
        { publishAt: 'desc' },
      ],
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    // 获取用户已读的公告 ID
    const readRecords = await prisma.userAnnouncementRead.findMany({
      where: { userId },
      select: { announcementId: true },
    });
    const readIds = new Set(readRecords.map(r => r.announcementId));

    // 过滤出未读的公告
    const unread = allPublished.filter(a => !readIds.has(a.id));

    // 最多返回 5 条
    return unread.slice(0, 5) as AnnouncementWithCreator[];
  }

  /**
   * 标记公告为已读
   */
  static async markAsRead(
    userId: string,
    announcementId: string,
    confirmed?: boolean
  ): Promise<void> {
    await prisma.userAnnouncementRead.upsert({
      where: {
        userId_announcementId: {
          userId,
          announcementId,
        },
      },
      update: {
        ...(confirmed !== undefined && { confirmed }),
      },
      create: {
        userId,
        announcementId,
        confirmed: confirmed || false,
      },
    });
  }

  /**
   * 批量标记公告为已读
   */
  static async markAllAsRead(
    userId: string,
    announcementIds?: string[]
  ): Promise<void> {
    if (!announcementIds || announcementIds.length === 0) {
      // 标记已发布的所有公告为已读
      const published = await prisma.systemAnnouncement.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true },
      });
      if (published.length === 0) return;
      const data = published.map(a => ({ userId, announcementId: a.id }));
      await prisma.userAnnouncementRead.createMany({ data, skipDuplicates: true });
      return;
    }

    const data = announcementIds.map(id => ({
      userId,
      announcementId: id,
    }));

    await prisma.userAnnouncementRead.createMany({
      data,
      skipDuplicates: true,
    });
  }

  /**
   * 获取用户公告历史（分页，包含已读/未读状态）
   */
  static async getAnnouncementHistory(userId: string, params: AnnouncementQueryParams) {
    const page = params.page || 1;
    const limit = params.limit || 10;
    const skip = (page - 1) * limit;

    // 获取所有已发布的公告
    const where: Prisma.SystemAnnouncementWhereInput = {
      status: AnnouncementStatus.PUBLISHED,
    };

    if (params.urgency) {
      where.urgency = params.urgency;
    }
    if (params.keyword) {
      where.title = {
        contains: params.keyword,
        mode: 'insensitive',
      };
    }

    const [allAnnouncements, total] = await Promise.all([
      prisma.systemAnnouncement.findMany({
        where,
        orderBy: [
          { publishAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      }),
      prisma.systemAnnouncement.count({ where }),
    ]);

    // 获取用户的已读记录
    const readRecords = await prisma.userAnnouncementRead.findMany({
      where: { userId },
      select: { announcementId: true, confirmed: true },
    });
    const readMap = new Map(readRecords.map(r => [r.announcementId, r.confirmed]));

    // 合并已读状态
    const items = allAnnouncements.map(a => ({
      ...a,
      isRead: readMap.has(a.id),
      isConfirmed: readMap.get(a.id) || false,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
