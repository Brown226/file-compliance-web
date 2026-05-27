/**
 * 指标服务 - 监控和可观测性
 *
 * 支持功能：
 * - 性能指标收集
 * - 错误率统计
 * - 自定义指标
 * - 健康检查
 *
 * 使用场景：
 * - Embedding/LLM API 调用延迟
 * - 数据库查询统计
 * - 检索性能分析
 */

export interface MetricPoint {
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
  timestamp: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: boolean;
    embedding: boolean;
    reranker: boolean;
    cache: boolean;
  };
  uptime: number;
  version: string;
}

export class MetricsService {
  private static metrics: MetricPoint[] = [];
  private static maxMetrics = 1000;
  private static startTime = Date.now();
  private static version = '2.0.0';

  private static counters = new Map<string, number>();
  private static histograms = new Map<string, number[]>();

  static configure(version: string) {
    this.version = version;
  }

  static getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  static getUptimeFormatted(): string {
    const seconds = this.getUptime();
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }

  static recordMetric(name: string, value: number, unit: string = 'ms', tags?: Record<string, string>) {
    this.metrics.push({
      name,
      value,
      unit,
      tags,
      timestamp: Date.now(),
    });

    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  static incrementCounter(name: string, value: number = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  static recordHistogram(name: string, value: number) {
    const values = this.histograms.get(name) || [];
    values.push(value);

    if (values.length > 1000) {
      values.shift();
    }

    this.histograms.set(name, values);
  }

  static recordEmbeddingLatency(latencyMs: number, success: boolean) {
    this.recordMetric('embedding.latency', latencyMs, 'ms', { success: String(success) });
    this.recordHistogram('embedding.latency.histogram', latencyMs);
    this.incrementCounter(success ? 'embedding.success' : 'embedding.errors');
  }

  static recordRerankLatency(latencyMs: number, success: boolean) {
    this.recordMetric('rerank.latency', latencyMs, 'ms', { success: String(success) });
    this.recordHistogram('rerank.latency.histogram', latencyMs);
    this.incrementCounter(success ? 'rerank.success' : 'rerank.errors');
  }

  static recordLLMCallLatency(latencyMs: number, success: boolean) {
    this.recordMetric('llm.latency', latencyMs, 'ms', { success: String(success) });
    this.recordHistogram('llm.latency.histogram', latencyMs);
    this.incrementCounter(success ? 'llm.success' : 'llm.errors');
  }

  static recordRetrievalLatency(latencyMs: number, resultCount: number) {
    this.recordMetric('retrieval.latency', latencyMs, 'ms', { results: String(resultCount) });
    this.recordHistogram('retrieval.latency.histogram', latencyMs);
    this.incrementCounter('retrieval.total');
  }

  static recordParseLatency(latencyMs: number, success: boolean, fileType: string) {
    this.recordMetric('parse.latency', latencyMs, 'ms', { success: String(success), fileType });
    this.recordHistogram('parse.latency.histogram', latencyMs);
    this.incrementCounter(success ? 'parse.success' : 'parse.errors');
  }

  static recordVectorizationLatency(latencyMs: number, chunkCount: number, success: boolean) {
    this.recordMetric('vectorization.latency', latencyMs, 'ms', {
      success: String(success),
      chunks: String(chunkCount),
    });
    this.recordHistogram('vectorization.latency.histogram', latencyMs);
    this.incrementCounter(success ? 'vectorization.success' : 'vectorization.errors');
  }

  static recordCacheStats(hits: number, misses: number) {
    this.recordMetric('cache.hits', hits, 'count');
    this.recordMetric('cache.misses', misses, 'count');
  }

  static recordApiRequest(method: string, path: string, statusCode: number, latencyMs: number) {
    this.recordMetric('api.request', latencyMs, 'ms', {
      method,
      path,
      status: String(statusCode),
    });
    this.incrementCounter(`api.${method}.${statusCode}`);
  }

  static getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  static getHistogramStats(name: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sum / sorted.length * 100) / 100,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  static getMetrics(limit: number = 100): MetricPoint[] {
    return this.metrics.slice(-limit);
  }

  static getMetricsByName(name: string): MetricPoint[] {
    return this.metrics.filter((m) => m.name.startsWith(name));
  }

  static getSummary(): {
    metrics: MetricPoint[];
    counters: Record<string, number>;
    histograms: Record<string, ReturnType<typeof MetricsService.getHistogramStats>>;
    cacheStats: any;
  } {
    const cacheStats = this.getCacheStats();

    return {
      metrics: this.metrics.slice(-50),
      counters: this.getCounters(),
      histograms: {
        'embedding.latency': this.getHistogramStats('embedding.latency.histogram'),
        'rerank.latency': this.getHistogramStats('rerank.latency.histogram'),
        'llm.latency': this.getHistogramStats('llm.latency.histogram'),
        'retrieval.latency': this.getHistogramStats('retrieval.latency.histogram'),
        'parse.latency': this.getHistogramStats('parse.latency.histogram'),
        'vectorization.latency': this.getHistogramStats('vectorization.latency.histogram'),
      },
      cacheStats,
    };
  }

  static async getHealthStatus(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      embedding: await this.checkEmbedding(),
      reranker: await this.checkReranker(),
      cache: true,
    };

    const healthyCount = Object.values(checks).filter(Boolean).length;
    let status: 'healthy' | 'degraded' | 'unhealthy';

    if (healthyCount === 4) {
      status = 'healthy';
    } else if (healthyCount >= 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      checks,
      uptime: this.getUptime(),
      version: this.version,
    };
  }

  private static async checkDatabase(): Promise<boolean> {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();
      return true;
    } catch {
      return false;
    }
  }

  private static async checkEmbedding(): Promise<boolean> {
    try {
      const { EmbeddingService } = await import('./embedding.service');
      return await EmbeddingService.isReady();
    } catch {
      return false;
    }
  }

  private static async checkReranker(): Promise<boolean> {
    try {
      const { EmbeddingService } = await import('./embedding.service');
      const result = await EmbeddingService.rerankDocuments(
        'test query',
        [{ content: 'test document content for reranker' }],
        1
      );
      return result.length >= 0;
    } catch {
      return false;
    }
  }

  private static getCacheStats() {
    const { CacheService } = require('./cache.service');
    return CacheService.getStats();
  }

  static reset() {
    this.metrics = [];
    this.counters.clear();
    this.histograms.clear();
  }
}
