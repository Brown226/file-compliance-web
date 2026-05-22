/**
 * 健康检查和指标 API
 */

import { Request, Response } from 'express';
import { MetricsService } from '../services/metrics.service';
import { CacheService } from '../services/cache.service';
import { success, error } from '../utils/response';

export class HealthController {
  /**
   * 健康检查
   */
  static async getHealth(req: Request, res: Response) {
    try {
      const status = await MetricsService.getHealthStatus();
      const statusCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json({
        status: status.status,
        ...status,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 指标统计
   */
  static async getMetrics(req: Request, res: Response) {
    try {
      const { limit } = req.query;
      const summary = MetricsService.getSummary();
      success(res, summary);
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }

  /**
   * 计数器列表
   */
  static async getCounters(req: Request, res: Response) {
    try {
      const counters = MetricsService.getCounters();
      success(res, counters);
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }

  /**
   * 直方图统计
   */
  static async getHistogram(req: Request, res: Response) {
    try {
      const { name } = req.params;
      const stats = MetricsService.getHistogramStats(name);

      if (!stats) {
        error(res, 'Histogram not found', 404);
        return;
      }

      success(res, stats);
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }

  /**
   * 缓存统计
   */
  static async getCacheStats(req: Request, res: Response) {
    try {
      const stats = CacheService.getStats();
      success(res, stats);
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }

  /**
   * 清除缓存
   */
  static async clearCache(req: Request, res: Response) {
    try {
      CacheService.clear();
      success(res, { message: 'Cache cleared' });
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }

  /**
   * 重置指标
   */
  static async resetMetrics(req: Request, res: Response) {
    try {
      MetricsService.reset();
      CacheService.resetStats();
      success(res, { message: 'Metrics reset' });
    } catch (err: any) {
      error(res, err.message, 500);
    }
  }
}
