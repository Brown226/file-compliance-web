import { Request, Response } from 'express';
import { addDwgVisionJob, getDwgVisionJobStatus } from '../services/system/queue.service';
import { redisClient } from '../utils/redis';
import prisma from '../config/db';

const VALID_ANALYSES = ['titleBlock', 'symbols', 'annotations', 'compliance'];

// ==================== 用户级配额管理 ====================

/**
 * 检查用户配额（每日次数 + 并发数）
 * Redis 不可用时降级跳过（fail-open）
 */
async function checkDwgVisionQuota(userId: string): Promise<{ ok: boolean; status?: number; body?: any }> {
  // 读配额配置
  let dailyLimit = 100;
  let concurrentLimit = 3;
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'dwg_vision_quota' } });
    if (cfg?.value && typeof cfg.value === 'object') {
      const v = cfg.value as any;
      if (typeof v.dailyLimit === 'number') dailyLimit = v.dailyLimit;
      if (typeof v.concurrentLimit === 'number') concurrentLimit = v.concurrentLimit;
    }
  } catch { /* 用默认值 */ }

  try {
    const client = redisClient.getClient();
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
    const dailyKey = `dwg_vision:quota:daily:${userId}:${today}`;
    const concurrentKey = `dwg_vision:quota:concurrent:${userId}`;

    // 每日次数：INCR + 首次 EXPIRE 到当天 23:59:59
    const dailyCount = await client.incr(dailyKey);
    if (dailyCount === 1) {
      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const ttl = Math.max(1, Math.floor((endOfDay.getTime() - now.getTime()) / 1000));
      await client.expire(dailyKey, ttl);
    }
    if (dailyCount > dailyLimit) {
      return { ok: false, status: 429, body: { error: '今日配额已用完', usage: dailyCount, limit: dailyLimit } };
    }

    // 并发数：INCR + 兜底 EXPIRE（防泄漏，分析通常不超过 1 小时）
    const concurrentCount = await client.incr(concurrentKey);
    await client.expire(concurrentKey, 3600);
    if (concurrentCount > concurrentLimit) {
      await client.decr(concurrentKey);  // 超限则回退计数
      return { ok: false, status: 429, body: { error: '并发数超限', current: concurrentCount, limit: concurrentLimit } };
    }

    return { ok: true };
  } catch (e: any) {
    // Redis 异常时失败放行
    console.warn('[DWG Vision] 配额检查失败，降级放行:', e.message);
    return { ok: true };
  }
}

/**
 * 释放并发计数（任务完成后调用）
 */
async function releaseDwgVisionConcurrent(userId: string): Promise<void> {
  try {
    await redisClient.getClient().decr(`dwg_vision:quota:concurrent:${userId}`);
  } catch { /* ignore */ }
}

/**
 * POST /api/dwg/vision-analyze
 * 图纸视觉智能分析
 */
export const visionAnalyze = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.id || 'anonymous';
  let quotaAcquired = false;

  try {
    const { imageBase64, fileName, analyses, refText } = req.body;

    // 参数校验
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ code: 400, message: '缺少 imageBase64 参数（PNG 图片 base64 编码）' });
      return;
    }

    // 检查图片大小（base64 长度 * 0.75 ≈ 实际字节数，限制 10MB）
    const estimatedSize = imageBase64.length * 0.75;
    if (estimatedSize > 10 * 1024 * 1024) {
      res.status(400).json({ code: 400, message: '图片过大（超过 10MB），请降低渲染分辨率后重试' });
      return;
    }

    // 校验分析项
    const selectedAnalyses: string[] = Array.isArray(analyses) && analyses.length > 0
      ? analyses.filter((a: string) => VALID_ANALYSES.includes(a))
      : VALID_ANALYSES; // 默认全部

    if (selectedAnalyses.length === 0) {
      res.status(400).json({ code: 400, message: `analyses 参数无效，可选值: ${VALID_ANALYSES.join(', ')}` });
      return;
    }

    // 用户级配额检查
    const quota = await checkDwgVisionQuota(userId);
    if (!quota.ok) {
      res.status(quota.status || 429).json({ code: quota.status || 429, ...quota.body });
      return;
    }
    quotaAcquired = true;

    // 生成 jobKey 并入队
    const jobKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    console.log(`[DWG Vision] 入队: ${fileName || 'unknown'}, 分析项: ${selectedAnalyses.join(', ')}, jobKey=${jobKey}`);

    const job = await addDwgVisionJob({
      jobKey,
      imageBase64,
      analyses: selectedAnalyses,
      refText,
      userId,
    });

    // 任务完成后（成功或失败）释放并发计数
    if (typeof job.finished === 'function') {
      job.finished().finally(() => releaseDwgVisionConcurrent(userId));
    }

    res.json({
      code: 200,
      message: 'success',
      data: { jobId: jobKey, status: 'queued' },
    });
  } catch (err: any) {
    // 入队失败时释放已占用的并发计数
    if (quotaAcquired) {
      await releaseDwgVisionConcurrent(userId);
    }
    console.error('[DWG Vision] 入队失败:', err);
    const message = err.message || '图纸视觉分析失败';
    const statusCode = message.includes('未配置') ? 400 : 500;
    res.status(statusCode).json({ code: statusCode, message });
  }
};

/**
 * GET /api/dwg/vision-status
 * 检查视觉模型是否已配置
 */
export const visionStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    // 尝试获取配置（不实际调用 API）
    const prisma = (await import('../config/db')).default;
    const keys = ['llm_vision_model', 'llm_ocr_model'];
    let configured = false;
    let modelName = '';

    for (const key of keys) {
      const config = await prisma.systemConfig.findUnique({ where: { key } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          configured = true;
          modelName = v.modelName;
          break;
        }
      }
    }

    res.json({
      code: 200,
      data: { configured, modelName, analyses: VALID_ANALYSES },
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
};

/**
 * GET /api/dwg/vision-job-status/:jobKey
 * 查询图纸视觉分析任务状态
 */
export const visionJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobKey = req.params.jobKey as string;
    if (!jobKey) {
      res.status(400).json({ code: 400, message: '缺少 jobKey 参数' });
      return;
    }

    const status = await getDwgVisionJobStatus(jobKey);
    if (!status) {
      res.status(404).json({ code: 404, message: '任务不存在或已完成清理' });
      return;
    }

    res.json({ code: 200, message: 'success', data: status });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
};
