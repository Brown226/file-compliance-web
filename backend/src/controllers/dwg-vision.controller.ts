import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { addDwgVisionJob, getDwgVisionJobStatus } from '../services/system/queue.service';
import { redisClient } from '../utils/redis';
import prisma from '../config/db';
import { DwgVisionService } from '../services/file/dwg-vision.service';
import { PythonParserService } from '../services/file/python-parser.service';
import { FileTypeService } from '../services/file/file-type.service';

// 参照文件上传：memoryStorage（文件小，直接 buffer 处理），限制 20MB
const refUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.docx', '.doc', '.xlsx', '.xls', '.pdf', '.pptx', '.txt'];
    if (!allowed.includes(ext)) {
      cb(new Error(`不支持的参照文件格式: ${ext}。支持: ${allowed.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

// 参照文件上传中间件（单文件，字段名 file）
export const uploadReferenceFileMiddleware = refUpload.single('file');

// Task 16: SSE 进度推送的 Redis 频道前缀
const SSE_CHANNEL_PREFIX = 'dwg-vision:progress:';

// Task 17/18: 新增 profession（专业审查）和 frameCheck（图框规范检查）维度
const VALID_ANALYSES = ['titleBlock', 'symbols', 'annotations', 'compliance', 'profession', 'frameCheck'];

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
    const { imageBase64, fileName, analyses, refText, referenceText, profession, dwgMetadata } = req.body;

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

    // 参照文本与 compliance 维度的合理性校验
    // referenceText（参照文件解析文本）和 refText（手动输入条文）都仅对 compliance 维度有效
    const mergedRef = [refText, referenceText].filter(t => t && typeof t === 'string' && t.trim()).join('\n---\n');
    if (mergedRef && !selectedAnalyses.includes('compliance')) {
      res.status(400).json({ code: 400, message: '参照文本/标准条文仅在 compliance 维度被选中时有效' });
      return;
    }

    // Task 17: profession 与 profession 维度的合理性校验
    const VALID_PROFESSIONS = ['building', 'structural', 'plumbing', 'hvac', 'electrical', 'process', 'nuclear'];
    if (profession && !VALID_PROFESSIONS.includes(profession)) {
      res.status(400).json({ code: 400, message: `profession 参数无效，可选值: ${VALID_PROFESSIONS.join(', ')}` });
      return;
    }
    if (selectedAnalyses.includes('profession') && !profession) {
      res.status(400).json({ code: 400, message: '选择 profession 维度时必须指定 profession 参数' });
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
    console.log(`[DWG Vision] 入队: ${fileName || 'unknown'}, 分析项: ${selectedAnalyses.join(', ')}, hasRef=${!!mergedRef}, jobKey=${jobKey}`);

    const job = await addDwgVisionJob({
      jobKey,
      imageBase64,
      analyses: selectedAnalyses,
      refText: mergedRef || undefined,
      userId,
      fileName,
      profession,
      dwgMetadata,
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
 * POST /api/dwg/vision-upload-ref
 * 上传参照文件（Word/Excel/PDF/PPT/TXT），解析为文本后返回给前端，前端再随 vision-analyze 一起提交
 *
 * 使用场景：
 *   - 用户上传参照表格（Excel），系统解析表格数据，供 AI 与图纸表格数据比对
 *   - 用户上传说明书（Word/PDF），系统提炼注意事项，结合图纸合规审查
 *
 * 流程：
 *   1. multer memoryStorage 接收文件（限 20MB，限 docx/doc/xlsx/xls/pdf/pptx/txt）
 *   2. 写入临时文件（PythonParserService 需文件路径）
 *   3. 调用 doc-parser /api/parse 解析为 markdown
 *   4. 返回 { text, charCount, fileName, fileType }
 *   5. 前端拿到 text 后，作为 referenceText 参数传给 vision-analyze
 */
export const visionUploadReference = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ code: 400, message: '缺少上传文件（字段名 file）' });
      return;
    }

    const fileName = file.originalname;
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const fileType = FileTypeService.extractFromFileName(fileName) || ext || 'unknown';

    console.log(`[DWG Vision] 参照文件上传: ${fileName}, ${file.size} bytes, type=${fileType}`);

    // 写入临时文件（PythonParserService 需文件路径）
    const fs = await import('fs');
    const os = await import('os');
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `dwg-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`);

    try {
      await fs.promises.writeFile(tmpPath, file.buffer);

      // 调用 doc-parser 解析
      const parseResult = await PythonParserService.parseFile(tmpPath, fileType);

      // 提取文本（优先 markdown，其次 text）
      const text = (parseResult.markdown || parseResult.text || '').trim();
      if (!text) {
        res.status(422).json({
          code: 422,
          message: `参照文件解析结果为空：${fileName}（可能是空文件或扫描件未启用 OCR）`,
        });
        return;
      }

      // 截断至 60000 字符（避免 prompt 过长）
      const truncated = text.length > 60000 ? text.substring(0, 60000) + '\n\n[... 文档过长，已截断 ...]' : text;

      console.log(`[DWG Vision] 参照文件解析完成: ${fileName}, ${text.length} 字符`);

      res.json({
        code: 200,
        message: 'success',
        data: {
          text: truncated,
          charCount: truncated.length,
          truncated: text.length > 60000,
          fileName,
          fileType,
        },
      });
    } finally {
      // 清理临时文件
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
    }
  } catch (err: any) {
    console.error('[DWG Vision] 参照文件解析失败:', err);
    const message = err.message || '参照文件解析失败';
    res.status(500).json({ code: 500, message });
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

/**
 * GET /api/dwg/vision-history
 * 查询图纸视觉分析历史记录（Task 25）
 *
 * 查询参数：
 *   - limit:     返回条数（默认 20，最大 100）
 *   - offset:    分页偏移
 *   - fileName:  按文件名模糊匹配（可选）
 *   - imageHash: 按图片 hash 精确匹配（可选，用于同图历史）
 *   - userId:    按用户筛选（仅 ADMIN 可用，普通用户只能看自己的历史）
 *
 * 权限规则：
 *   - ADMIN: 可查看所有用户的历史，可通过 userId 参数筛选
 *   - MANAGER/USER: 只能查看自己的历史，userId 参数被忽略
 */
export const visionHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = (req as any).user;
    const currentRole = currentUser?.role || 'USER';
    const currentUserId = currentUser?.id;

    const { limit, offset, fileName, imageHash, userId } = req.query;

    // 权限：非 ADMIN 只能看自己的历史
    const filterUserId = currentRole === 'ADMIN' && userId
      ? String(userId)
      : currentUserId;

    const result = await DwgVisionService.queryHistory({
      userId: filterUserId,
      fileName: fileName ? String(fileName) : undefined,
      imageHash: imageHash ? String(imageHash) : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    res.json({ code: 200, message: 'success', data: result });
  } catch (err: any) {
    console.error('[DWG Vision] 查询历史失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
};

/**
 * GET /api/dwg/vision-history/:id
 * 查询单条历史记录详情（Task 25）
 */
export const visionHistoryDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id) {
      res.status(400).json({ code: 400, message: '缺少 id 参数' });
      return;
    }

    const currentUser = (req as any).user;
    const currentRole = currentUser?.role || 'USER';
    const currentUserId = currentUser?.id;

    const record = await prisma.visionAnalysis.findUnique({ where: { id } });
    if (!record) {
      res.status(404).json({ code: 404, message: '历史记录不存在' });
      return;
    }

    // 权限：非 ADMIN 只能看自己的记录
    if (currentRole !== 'ADMIN' && record.userId && record.userId !== currentUserId) {
      res.status(403).json({ code: 403, message: '无权查看他人的历史记录' });
      return;
    }

    res.json({ code: 200, message: 'success', data: record });
  } catch (err: any) {
    console.error('[DWG Vision] 查询历史详情失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
};

/**
 * GET /api/dwg/vision-stream/:jobKey
 * Task 16: SSE 流式推送图纸视觉分析进度
 *
 * 工作原理：
 *   1. 前端 POST /vision-analyze 入队后拿到 jobKey
 *   2. 前端用 EventSource 连接本端点，订阅该 jobKey 的进度
 *   3. 本端点用 Redis SUBSCRIBE 订阅 dwg-vision:progress:{jobKey} 频道
 *   4. analyze() 内部在各维度完成时 PUBLISH 事件到该频道
 *   5. 本端点收到消息后用 res.write('event: xxx\ndata: xxx\n\n') 推送给前端
 *   6. 收到 complete 或 error 事件后关闭连接
 *
 * 降级策略：
 *   - Redis 不可用 → 立即推 error 事件并关闭
 *   - 30 秒内无任何消息 → 推 progress 事件作为心跳（防止代理超时）
 *   - 10 分钟总超时 → 强制关闭
 *
 * 注意：SSE 连接是长连接，不走 Vite 代理的 /api 路径（需在 vite.config.ts 单独代理）
 */
export const visionStream = async (req: Request, res: Response): Promise<void> => {
  const jobKey = req.params.jobKey as string;
  if (!jobKey) {
    res.status(400).json({ code: 400, message: '缺少 jobKey 参数' });
    return;
  }

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // Nginx 不缓冲
  res.flushHeaders?.();

  const channel = `${SSE_CHANNEL_PREFIX}${jobKey}`;

  // 心跳定时器（30 秒无消息推一次注释行，防止代理超时断开）
  const heartbeatTimer = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 30000);

  // 总超时（10 分钟）
  const totalTimeout = setTimeout(() => {
    sendSseEvent(res, 'error', { jobKey, error: 'SSE 连接超时（10 分钟）', timestamp: Date.now() });
    cleanup();
  }, 10 * 60 * 1000);

  // 清理函数
  const cleanup = () => {
    clearInterval(heartbeatTimer);
    clearTimeout(totalTimeout);
    if (subscriber) {
      subscriber.unsubscribe(channel).catch(() => { /* ignore */ });
      subscriber.quit().catch(() => { /* ignore */ });
    }
    try { res.end(); } catch { /* ignore */ }
  };

  // 监听客户端断开
  req.on('close', () => {
    cleanup();
  });

  let subscriber: any = null;

  try {
    // 创建独立订阅连接（不能用主连接，否则会阻塞其他操作）
    const Redis = (await import('ioredis')).default;
    subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await subscriber.subscribe(channel);

    subscriber.on('message', (_ch: string, message: string) => {
      try {
        const event = JSON.parse(message);
        // 推送事件给前端
        sendSseEvent(res, event.type, event);

        // complete 或 error 事件后关闭连接
        if (event.type === 'complete' || event.type === 'error') {
          cleanup();
        }
      } catch (e: any) {
        console.warn('[DWG Vision SSE] 消息解析失败:', e.message);
      }
    });
  } catch (e: any) {
    console.error('[DWG Vision SSE] 订阅失败:', e.message);
    sendSseEvent(res, 'error', { jobKey, error: `SSE 订阅失败: ${e.message}`, timestamp: Date.now() });
    cleanup();
  }
};

/**
 * Task 16: 发送 SSE 事件给前端
 * 格式：event: <type>\ndata: <json>\n\n
 */
function sendSseEvent(res: Response, type: string, data: any): void {
  try {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* ignore */ }
}

/**
 * GET /api/dwg/vision-llm-logs/:traceId
 * Task 29: 查询图纸视觉分析的 LLM 调用日志（推理回放）
 *
 * 按 traceId（即 jobKey）查询 LlmCallLog，返回该次分析所有维度的 LLM 调用记录。
 * 权限：所有登录用户均可查询（dwg-vision 是工具页面，日志 traceId 不可枚举，无敏感隔离需求）。
 */
export const visionLlmLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const traceId = req.params.traceId as string;
    if (!traceId) {
      res.status(400).json({ code: 400, message: '缺少 traceId 参数' });
      return;
    }

    const logs = await prisma.llmCallLog.findMany({
      where: { traceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        mode: true,
        model: true,
        provider: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        latencyMs: true,
        status: true,
        errorMsg: true,
        promptFull: true,
        completionFull: true,
        ragChunks: true,
        createdAt: true,
      },
    });
    // BigInt id 序列化为 string
    const serialized = logs.map(l => ({ ...l, id: l.id.toString() }));
    res.json({ code: 200, message: 'success', data: serialized });
  } catch (err: any) {
    console.error('[DWG Vision] 查询 LLM 调用日志失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
};

/**
 * POST /api/dwg/vision-cross-compare
 * Task 39: 跨文件轴线对齐比对
 * 从历史记录中选 ≥2 条记录，提取轴线编号做交叉一致性检查
 *
 * body: { recordIds: string[] }
 */
export const visionCrossFileCompare = async (req: Request, res: Response): Promise<void> => {
  try {
    const { recordIds } = req.body || {};
    if (!Array.isArray(recordIds) || recordIds.length < 2) {
      res.status(400).json({ code: 400, message: 'recordIds 参数需为 ≥2 个记录 ID 数组' });
      return;
    }

    const result = await DwgVisionService.crossFileCompare(recordIds);
    res.json({ code: 200, message: 'success', data: result });
  } catch (err: any) {
    console.error('[DWG Vision] 跨文件比对失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
};
