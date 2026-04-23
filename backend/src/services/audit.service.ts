import prisma from '../config/db';

export class AuditService {
  async getLogs(query: {
    page?: number;
    limit?: number;
    action?: string;
    resource?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.action) {
      where.action = query.action;
    }
    if (query.resource) {
      where.resource = query.resource;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  async createLog(data: {
    action: string;
    resource: string;
    details?: any;
    userId?: string;
    ipAddress?: string;
  }) {
    return prisma.auditLog.create({
      data,
    });
  }

  /**
   * 根据筛选条件导出 CSV 格式的审计日志
   */
  async exportLogsCSV(query: {
    action?: string;
    resource?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    const where: any = {};

    if (query.action) {
      where.action = query.action;
    }
    if (query.resource) {
      where.resource = query.resource;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            username: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // CSV header
    const headers = ['ID', '操作', '资源', '用户名', '姓名', 'IP地址', '详情', '时间'];
    const escapeCSV = (val: any): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = logs.map((log) => [
      escapeCSV(log.id),
      escapeCSV(log.action),
      escapeCSV(log.resource),
      escapeCSV(log.user?.username),
      escapeCSV(log.user?.name),
      escapeCSV(log.ipAddress),
      escapeCSV(log.details ? JSON.stringify(log.details) : ''),
      escapeCSV(log.createdAt.toISOString()),
    ].join(','));

    // BOM for UTF-8 in Excel
    return '\uFEFF' + [headers.join(','), ...rows].join('\n');
  }
}
