/**
 * Agent 反馈路由 — 误报标记 / 结果收藏 / 会话搜索
 *
 * 端点（挂载于 /api/agent）：
 *   POST   /issues/false-positive — Agent 审查结果标记误报（P2-⑧）
 *   POST   /saves                 — 收藏一条结果
 *   GET    /saves                 — 收藏列表
 *   DELETE /saves/:id             — 删除收藏
 *   GET    /search                — 全文搜索会话消息
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import FalsePositiveLibraryService from '../../services/review/falsePositiveLibrary.service';
import prisma from '../../config/db';

const router = Router();

/**
 * POST /api/agent/issues/false-positive — Agent 审查结果标记误报（P2-⑧）
 *
 * 把 Agent 审查出的某条 issue 写入误报标记库（FalsePositiveLibrary），
 * 供「误报反馈闭环」沉淀：同文本再次出现时可在误报库中检索并跳过。
 *
 * Body:
 *   - originalText: string（必填，被标记为误报的原文）
 *   - reason?: string（误报原因）
 *   - issueType?: string（问题分类，如 VIOLATION）
 *   - ruleCode?: string（规则代码）
 *   - severity?: string（严重度，error/warning/info）
 *
 * 响应：{ success: true, data: { added: boolean, count: number } }
 *   added=true 表示新增记录，false 表示已存在（累加 count）。
 */
router.post('/issues/false-positive', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const { originalText, reason, issueType, ruleCode, severity } = req.body || {};
    if (typeof originalText !== 'string' || originalText.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'originalText 必填' });
    }

    const trimmed = originalText.trim();
    const existing = await FalsePositiveLibraryService.isInLibrary(trimmed);
    await FalsePositiveLibraryService.syncFromTaskDetail({
      originalText: trimmed,
      fpReason: typeof reason === 'string' && reason ? reason : undefined,
      issueType: typeof issueType === 'string' && issueType ? issueType : undefined,
      ruleCode: typeof ruleCode === 'string' && ruleCode ? ruleCode : undefined,
      severity: typeof severity === 'string' && severity ? severity : undefined,
      markedById: userId,
    });

    return res.json({
      success: true,
      data: { added: !existing, count: existing ? 'increment' : 1 },
    });
  } catch (e: any) {
    console.error('[Agent] 标记误报失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `标记误报失败: ${e?.message || e}` });
  }
});


/**
 * P2-⑭ 结果沉淀：收藏 / 搜索
 *
 * POST   /api/agent/saves           — 收藏一条结果（type/title/content/sourceSessionId）
 * GET    /api/agent/saves           — 收藏列表（可按 type 过滤）
 * DELETE /api/agent/saves/:id       — 删除收藏
 * GET    /api/agent/search?q=       — 全文搜索会话消息（QAMessage.content ILIKE）
 *
 * 依赖 saved_items 表（prisma db push 后生效）
 */
router.post('/saves', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { type, title, content, sourceSessionId, sourceMessageId } = req.body || {};
    if (!title || typeof title !== 'string' || !content || typeof content !== 'string') {
      return res.status(400).json({ success: false, message: 'title 和 content 必填' });
    }
    // 防超长收藏内容拖垮存储与列表接口
    if (content.length > 100000) {
      return res.status(400).json({ success: false, message: 'content 长度不能超过 100000 字符' });
    }
    
    const item = await prisma.savedItem.create({
      data: {
        userId,
        type: String(type || 'qa'),
        title: String(title).slice(0, 200),
        content,
        sourceSessionId: sourceSessionId ? String(sourceSessionId) : null,
        sourceMessageId: sourceMessageId ? String(sourceMessageId) : null,
      },
    });
    return res.json({ success: true, data: item });
  } catch (e: any) {
    console.error('[Agent] 收藏失败:', e?.message || e);
    // 表不存在时给出明确提示
    if (/does not exist|relation/i.test(e?.message || '')) {
      return res.status(500).json({ success: false, message: 'saved_items 表未创建，请先执行 prisma db push' });
    }
    return res.status(500).json({ success: false, message: `收藏失败: ${e?.message || e}` });
  }
});

router.get('/saves', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const type = req.query.type;
    
    const items = await prisma.savedItem.findMany({
      where: { userId, ...(type ? { type: String(type) } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.json({ success: true, data: items });
  } catch (e: any) {
    console.error('[Agent] 收藏列表失败:', e?.message || e);
    if (/does not exist|relation/i.test(e?.message || '')) {
      return res.status(500).json({ success: false, message: 'saved_items 表未创建，请先执行 prisma db push' });
    }
    return res.status(500).json({ success: false, message: `收藏列表失败: ${e?.message || e}` });
  }
});

router.delete('/saves/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    
    const result = await prisma.savedItem.deleteMany({ where: { id: String(req.params.id), userId } });
    if (result.count === 0) return res.status(404).json({ success: false, message: '收藏不存在' });
    return res.json({ success: true, data: { deleted: result.count } });
  } catch (e: any) {
    console.error('[Agent] 删除收藏失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `删除收藏失败: ${e?.message || e}` });
  }
});

router.get('/search', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    // 防超长 ILIKE 拖垮数据库查询
    if (q.length > 100) {
      return res.status(400).json({ success: false, message: '搜索关键词长度不能超过 100 字符' });
    }
    
    // 全文搜索会话消息（ILIKE 关键词）
    const messages = await prisma.qAMessage.findMany({
      where: {
        session: { userId },
        content: { contains: q, mode: 'insensitive' },
      },
      include: { session: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json({
      success: true,
      data: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content.slice(0, 500),
        sessionId: m.sessionId,
        sessionTitle: m.session?.title || null,
        createdAt: m.createdAt,
      })),
    });
  } catch (e: any) {
    console.error('[Agent] 搜索失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `搜索失败: ${e?.message || e}` });
  }
});

export default router;
