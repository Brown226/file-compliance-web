import { Request, Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { success } from '../utils/response';

const dashboardService = new DashboardService();

export class DashboardController {
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const role = req.query.role as string;
      const userId = req.query.userId as string;

      if (role === 'user' && userId) {
        const personalStats = await dashboardService.getPersonalStats(userId);
        success(res, personalStats);
      } else {
        const stats = await dashboardService.getStats();
        success(res, stats);
      }
    } catch (err) {
      next(err);
    }
  }

  async getTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const trend = await dashboardService.getTrend(days);
      success(res, trend);
    } catch (err) {
      next(err);
    }
  }
}
