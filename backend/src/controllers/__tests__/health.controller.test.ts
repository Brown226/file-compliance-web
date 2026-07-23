import { HealthController } from '../health.controller';
import { MetricsService } from '../../services/system/metrics.service';
import { CacheService } from '../../services/system/cache.service';

// Mock services
vi.mock('../../services/system/metrics.service');
vi.mock('../../services/system/cache.service');

// Mock response helpers
vi.mock('../../utils/response', () => ({
  success: vi.fn((res, data) => res.json({ success: true, data })),
  error: vi.fn((res, message, status) => res.status(status).json({ success: false, message })),
}));

const mockReq = () => ({} as any);
const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('HealthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHealth', () => {
    it('should return healthy status', async () => {
      (MetricsService.getHealthStatus as any).mockResolvedValue({
        status: 'healthy',
        uptime: 1000,
      });

      const req = mockReq();
      const res = mockRes();

      await HealthController.getHealth(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          uptime: 1000,
        })
      );
    });

    it('should return 503 for unhealthy status', async () => {
      (MetricsService.getHealthStatus as any).mockResolvedValue({
        status: 'unhealthy',
        error: 'DB down',
      });

      const req = mockReq();
      const res = mockRes();

      await HealthController.getHealth(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should handle service errors', async () => {
      (MetricsService.getHealthStatus as any).mockRejectedValue(new Error('Service error'));

      const req = mockReq();
      const res = mockRes();

      await HealthController.getHealth(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unhealthy' })
      );
    });
  });

  describe('getMetrics', () => {
    it('should return metrics summary', async () => {
      (MetricsService.getSummary as any).mockReturnValue({ totalRequests: 100 });

      const req = mockReq();
      const res = mockRes();

      await HealthController.getMetrics(req, res);

      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('getCounters', () => {
    it('should return counters', async () => {
      (MetricsService.getCounters as any).mockReturnValue({});

      const req = mockReq();
      const res = mockRes();

      await HealthController.getCounters(req, res);

      expect(MetricsService.getCounters).toHaveBeenCalled();
    });
  });

  describe('getHistogram', () => {
    it('should return histogram stats', async () => {
      (MetricsService.getHistogramStats as any).mockReturnValue({ min: 0, max: 100 });

      const req = { params: { name: 'response_time' } } as any;
      const res = mockRes();

      await HealthController.getHistogram(req, res);

      expect(MetricsService.getHistogramStats).toHaveBeenCalledWith('response_time');
    });

    it('should return 404 for missing histogram', async () => {
      (MetricsService.getHistogramStats as any).mockReturnValue(null);

      const req = { params: { name: 'nonexistent' } } as any;
      const res = mockRes();

      await HealthController.getHistogram(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache stats', async () => {
      (CacheService.getStats as any).mockReturnValue({ hits: 10, misses: 2 });

      const req = mockReq();
      const res = mockRes();

      await HealthController.getCacheStats(req, res);

      expect(CacheService.getStats).toHaveBeenCalled();
    });
  });

  describe('clearCache', () => {
    it('should clear cache', async () => {
      (CacheService.clear as any).mockReturnValue(undefined);

      const req = mockReq();
      const res = mockRes();

      await HealthController.clearCache(req, res);

      expect(CacheService.clear).toHaveBeenCalled();
    });
  });

  describe('resetMetrics', () => {
    it('should reset metrics and cache stats', async () => {
      const req = mockReq();
      const res = mockRes();

      await HealthController.resetMetrics(req, res);

      expect(MetricsService.reset).toHaveBeenCalled();
      expect(CacheService.resetStats).toHaveBeenCalled();
    });
  });
});
