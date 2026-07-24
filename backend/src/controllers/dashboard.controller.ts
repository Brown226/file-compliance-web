import { Request, Response, NextFunction } from 'express';
import { DashboardService } from '../services/system/dashboard.service';
import { ReviewMetricsService } from '../services/review/review-metrics.service';
import { dashboardExtendedService } from '../services/system/dashboard-extended.service';
import { success, error } from '../utils/response';

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

  /** OPT-015: 审查质量指标 */
  async getReviewMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const granularity = (req.query.granularity as string) === 'weekly' ? 'weekly' : 'daily';
      const days = parseInt(req.query.days as string) || 30;

      const [precision, trend, topRules] = await Promise.all([
        ReviewMetricsService.calculatePrecision({ startDate, endDate }),
        ReviewMetricsService.getTrend(granularity, days),
        ReviewMetricsService.getTopFalsePositiveRules(10),
      ]);

      success(res, { precision, trend, topFalsePositiveRules: topRules });
    } catch (err) {
      next(err);
    }
  }

  /** OPT-015: 提交审查结果反馈 */
  async submitFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const taskId = req.params.taskId as string;
      const detailId = req.params.detailId as string;
      const { feedbackType, fileId } = req.body;
      const userId = (req as any).user?.id;

      if (!feedbackType || !['useful', 'false_positive', 'missed'].includes(feedbackType)) {
        error(res, 'feedbackType 必须为 useful/false_positive/missed', 400);
        return;
      }

      const feedback = await ReviewMetricsService.submitFeedback({
        taskId,
        detailId,
        fileId,
        feedbackType,
        userId,
      });

      success(res, feedback, '反馈已提交');
    } catch (err) {
      next(err);
    }
  }

  /** 平台运营：在线用户 */
  async getOnlineUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await dashboardExtendedService.getOnlineUsers();
      success(res, data);
    } catch (err) {
      next(err);
    }
  }

  /** 平台运营：活跃度趋势（DAU/WAU + 任务趋势） */
  async getActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const data = await dashboardExtendedService.getActivity(days);
      success(res, data);
    } catch (err) {
      next(err);
    }
  }

  /** 平台运营：LLM Token 用量 */
  async getLlmUsage(req: Request, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const data = await dashboardExtendedService.getLlmUsage(days);
      success(res, data);
    } catch (err) {
      next(err);
    }
  }

  /** 平台运营：部门使用度 */
  async getDepartmentStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await dashboardExtendedService.getDepartmentStats();
      success(res, data);
    } catch (err) {
      next(err);
    }
  }
}
