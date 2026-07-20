/**
 * 模板匹配路由
 */

import { Router, Request, Response } from 'express';
import { TemplateMatcherService } from '../services/template-matcher.service';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);

/**
 * POST /api/template/match
 * 匹配文档模板
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { text, professionTagId, businessTypeTagId } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: '缺少必填参数 text' });
    }

    const result = await TemplateMatcherService.match({
      text,
      professionTagId,
      businessTypeTagId,
    });

    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(502).json({ success: false, message: `模板匹配失败: ${e.message}` });
  }
});

/**
 * POST /api/template/batch-match
 * 批量匹配模板名称
 */
router.post('/batch-match', async (req: Request, res: Response) => {
  try {
    const { fileNames, professionTagId } = req.body;
    if (!fileNames || !Array.isArray(fileNames)) {
      return res.status(400).json({ success: false, message: '缺少必填参数 fileNames' });
    }

    const results = await TemplateMatcherService.batchMatchNames(fileNames, professionTagId);
    res.json({ success: true, data: results });
  } catch (e: any) {
    res.status(502).json({ success: false, message: `批量匹配失败: ${e.message}` });
  }
});

export default router;
