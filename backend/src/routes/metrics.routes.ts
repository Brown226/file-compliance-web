import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * Task 16: LLM 调用日志写入失败 fallback 文件路径
 *
 * 与 llm.service.ts 中 writeLlmCallFallback 使用的路径保持一致：
 * backend/src/logs/llm-call-failed.log（基于 __dirname 解析）
 */
const LLM_FALLBACK_LOG_PATH = path.join(__dirname, '../logs/llm-call-failed.log');

/**
 * GET /api/metrics/llm-log-failures
 *
 * 读取 LlmCallLog DB 写入失败时落盘的 fallback 日志，返回最近 N 条。
 * 仅 ADMIN 可访问。
 *
 * Query:
 *   - limit: 返回条数，默认 100，最大 1000（从文件末尾倒序取）
 */
router.get('/llm-log-failures', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const limitRaw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 100;

    // 文件不存在时直接返回空数组（fallback 从未触发过）
    if (!fs.existsSync(LLM_FALLBACK_LOG_PATH)) {
      res.json({ code: 200, data: [] });
      return;
    }

    // 读取整个文件并按行拆分（fallback 文件预期不会很大；如未来需要可改流式 tail）
    const content = fs.readFileSync(LLM_FALLBACK_LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // 从末尾取最近 limit 条，逐行 JSON.parse，跳过损坏行
    const start = Math.max(0, lines.length - limit);
    const entries: any[] = [];
    for (let i = lines.length - 1; i >= start; i--) {
      try {
        entries.push(JSON.parse(lines[i]));
      } catch {
        // 跳过无法解析的行（部分写入 / 编码损坏）
      }
    }

    res.json({
      code: 200,
      data: entries,
      meta: {
        totalLines: lines.length,
        returned: entries.length,
        limit,
        logPath: LLM_FALLBACK_LOG_PATH,
      },
    });
  } catch (error: any) {
    console.error('[metrics] 读取 LLM fallback 日志失败:', error);
    res.status(500).json({ code: 500, message: '读取 fallback 日志失败', error: error.message });
  }
});

export default router;
