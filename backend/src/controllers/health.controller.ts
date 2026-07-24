/**
 * 健康检查和指标 API
 */

import { Request, Response } from 'express';
import { MetricsService } from '../services/system/metrics.service';
import { CacheService } from '../services/system/cache.service';
import { OcrService } from '../services/file/ocr.service';
import { success, error } from '../utils/response';

export class HealthController {
  /**
   * 健康检查
   */
  static async getHealth(_req: Request, res: Response) {
    try {
      const status = await MetricsService.getHealthStatus();
      const statusCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json({
        ...status,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(503).json({
        status: 'unhealthy',
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 指标统计
   */
  static async getMetrics(_req: Request, res: Response) {
    try {
      const summary = MetricsService.getSummary();
      success(res, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * 计数器列表
   */
  static async getCounters(_req: Request, res: Response) {
    try {
      const counters = MetricsService.getCounters();
      success(res, counters);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * 直方图统计
   */
  static async getHistogram(req: Request, res: Response) {
    try {
      const name = req.params.name as string;
      const stats = MetricsService.getHistogramStats(name);

      if (!stats) {
        error(res, 'Histogram not found', 404);
        return;
      }

      success(res, stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * 缓存统计
   */
  static async getCacheStats(_req: Request, res: Response) {
    try {
      const stats = CacheService.getStats();
      success(res, stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * 清除缓存
   */
  static async clearCache(_req: Request, res: Response) {
    try {
      await CacheService.clear();
      success(res, { message: 'Cache cleared' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * 重置指标
   */
  static async resetMetrics(_req: Request, res: Response) {
    try {
      MetricsService.reset();
      CacheService.resetStats();
      success(res, { message: 'Metrics reset' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error(res, message, 500);
    }
  }

  /**
   * OCR 服务健康检查
   */
  static async checkOcr(_req: Request, res: Response) {
    try {
      const healthy = await OcrService.checkHealth();
      res.json({ status: healthy ? 'ok' : 'degraded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(503).json({ status: 'degraded', error: message });
    }
  }

  /**
   * 队列健康检查
   */
  static async checkQueue(_req: Request, res: Response) {
    const status = (globalThis as any).__QUEUE_DEGRADED ? 'degraded' : 'healthy';
    res.json({ status });
  }

  /**
   * OPT-037: MaxKB 健康检查
   */
  static async checkMaxKB(_req: Request, res: Response) {
    try {
      const { MaxKBService } = await import('../services/knowledge/maxkb.service');
      const health = await MaxKBService.healthCheck();
      res.json({ status: health.reachable ? 'ok' : 'unreachable', error: health.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(503).json({ status: 'unreachable', error: message });
    }
  }

  /**
   * OPT-037: 综合健康检查（聚合所有服务状态）
   */
  static async checkAll(_req: Request, res: Response) {
    const results: Record<string, { status: string; error?: string }> = {};

    // Queue
    results.queue = { status: (globalThis as any).__QUEUE_DEGRADED ? 'degraded' : 'healthy' };

    // OCR
    try {
      const { OcrService } = await import('../services/file/ocr.service');
      const ocrHealthy = await OcrService.checkHealth();
      results.ocr = { status: ocrHealthy ? 'ok' : 'degraded' };
    } catch (e: any) {
      results.ocr = { status: 'degraded', error: e.message };
    }

    // MaxKB
    try {
      const { MaxKBService } = await import('../services/knowledge/maxkb.service');
      const health = await MaxKBService.healthCheck();
      results.maxkb = { status: health.reachable ? 'ok' : 'unreachable', error: health.error };
    } catch (e: any) {
      results.maxkb = { status: 'unreachable', error: e.message };
    }

    // Database
    try {
      const { default: prisma } = await import('../config/db');
      await prisma.$queryRaw`SELECT 1`;
      results.database = { status: 'ok' };
    } catch (e: any) {
      results.database = { status: 'error', error: e.message };
    }

    const allOk = Object.values(results).every(r => r.status === 'ok' || r.status === 'healthy');
    res.status(allOk ? 200 : 207).json({ status: allOk ? 'healthy' : 'partial', services: results });
  }
}
