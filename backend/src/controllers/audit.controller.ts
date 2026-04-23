import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service';
import { success } from '../utils/response';

const auditService = new AuditService();

export class AuditController {
  async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page,
        limit,
        action,
        resource,
        userId,
        startDate,
        endDate,
      } = req.query;

      const result = await auditService.getLogs({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        action: action as string,
        resource: resource as string,
        userId: userId as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      success(res, result);
    } catch (err) {
      next(err);
    }
  }

  async exportLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { action, resource, userId, startDate, endDate } = req.query;

      const csvContent = await auditService.exportLogsCSV({
        action: action as string,
        resource: resource as string,
        userId: userId as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      const filename = `audit-logs-${new Date().toISOString().substring(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(csvContent);
    } catch (err) {
      next(err);
    }
  }
}
