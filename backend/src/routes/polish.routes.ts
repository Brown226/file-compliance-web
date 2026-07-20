/**
 * AI 润色路由
 */

import { Router, Request, Response } from 'express';
import { PolishService } from '../services/polish.service';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);

/**
 * GET /api/polish/styles
 * 获取所有润色风格
 */
router.get('/styles', (_req: Request, res: Response) => {
  const styles = PolishService.getStyles();
  res.json({ success: true, data: styles });
});

/**
 * POST /api/polish
 * 执行 AI 润色
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { text, style } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: '缺少必填参数 text' });
    }
    if (!style) {
      return res.status(400).json({ success: false, message: '缺少必填参数 style' });
    }

    const result = await PolishService.polish({ text, style });
    res.json({ success: true, data: result });
  } catch (e: any) {
    console.error('[Polish] 润色失败:', e.message);
    res.status(500).json({ success: false, message: `润色失败: ${e.message}` });
  }
});

export default router;