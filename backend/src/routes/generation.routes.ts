/**
 * 文档生成路由
 * 代理到 OpenSpec Agent 的生成端点
 */

import { Router, Request, Response } from 'express';
import { OpenSpecAgentService } from '../services/openspec-agent.service';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 所有生成路由需要认证
router.use(authenticate);

/**
 * POST /api/generation/stream
 * 流式生成段落
 */
router.post('/stream', async (req: Request, res: Response) => {
  try {
    const { projectInfo, template, chapterName, professionTagId } = req.body;
    if (!projectInfo || !chapterName) {
      return res.status(400).json({ success: false, message: '缺少必填参数 projectInfo 或 chapterName' });
    }

    const agentResponse = await OpenSpecAgentService.generateParagraphStream({
      projectInfo,
      template: template || '',
      chapterName,
      professionTagId,
      userId: (req as any).user?.id,
    });

    // 透传 SSE 流
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = agentResponse.body?.getReader();
    if (!reader) {
      return res.status(502).json({ success: false, message: 'Agent 服务不可用' });
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
    res.end();
  } catch (e: any) {
    console.error('[Generation] 流式生成失败:', e.message);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: `生成失败: ${e.message}` });
    }
  }
});

/**
 * POST /api/generation/batch
 * 批量生成文档
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { projectInfo, chapters } = req.body;
    if (!projectInfo || !chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ success: false, message: '缺少必填参数 projectInfo 或 chapters' });
    }

    const result = await OpenSpecAgentService.generateBatch(
      projectInfo,
      chapters,
      (req as any).user?.id,
    );

    res.json({ success: true, data: { paragraphs: result } });
  } catch (e: any) {
    console.error('[Generation] 批量生成失败:', e.message);
    res.status(502).json({ success: false, message: `生成失败: ${e.message}` });
  }
});

export default router;