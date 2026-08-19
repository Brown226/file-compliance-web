/**
 * Agent 会话路由 — 会话 CRUD / 消息 / 统计 / 自动命名 / 手动压缩 / 挂起提问
 *
 * 端点（挂载于 /api/agent）：
 *   GET    /sessions                    — 列出用户的会话
 *   GET    /sessions/:sessionId         — 查询单个会话详情
 *   GET    /sessions/:sessionId/messages— 查询会话的消息列表
 *   PATCH  /sessions/:sessionId         — 重命名会话 / 更新会话设置
 *   DELETE /sessions/:sessionId         — 删除会话
 *   POST   /sessions/:sessionId/duplicate — 复制会话
 *   GET    /sessions/:sessionId/stats   — 会话 token 用量统计
 *   POST   /sessions/:sessionId/auto-name — 自动生成会话标题
 *   POST   /sessions/:id/compact        — 手动触发上下文压缩
 *   GET    /sessions/:id/pending-ask    — 查询会话是否被 Agent 挂起等待用户回复
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { QASessionService } from '../../services/agent/qa-session.service';
import { SessionStatsService } from '../../services/agent/session-stats.service';
import { AskUserService } from '../../services/agent/ask-user/ask-user.service';
import { LlmService } from '../../services/llm/llm.service';
import { CompactionService } from '../../services/agent/context-compaction/compaction.service';
import prisma from '../../config/db';

const router = Router();

/** auto-name 防刷冷却表（sessionId → 最近触发时间戳） */
const autoNameCooldown = new Map<string, number>();

// ===== 会话历史管理（Task 14） =====
// 注：/api/agent/traces/* 端点已随 AgentTrace 链路移除（2026-08-03），
// 工具执行过程由 QAMessage.parts 承载，token 统计见 /sessions/:id/stats

/**
 * GET /api/agent/sessions — 列出用户的会话
 *
 * Task 14.2：返回用户的所有会话（按 updatedAt 倒序），含最近一条消息预览。
 *
 * Query:
 *   - limit: 返回数量上限（默认 50，最大 200）
 *
 * 返回：{ success, data: SessionListItem[] }
 */
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const limit = Math.min(parseInt(String(req.query?.limit ?? '50'), 10) || 50, 200);
    const sessions = await QASessionService.listSessions(userId, limit);
    return res.json({ success: true, data: sessions });
  } catch (e: any) {
    console.error('[Agent] 查询会话列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/sessions/:sessionId — 查询单个会话详情
 *
 * 返回：{ success, data: SessionDetail }
 */
router.get('/sessions/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    return res.json({ success: true, data: session });
  } catch (e: any) {
    console.error('[Agent] 查询会话详情失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/sessions/:sessionId/messages — 查询会话的消息列表
 *
 * Task 14.2：返回会话的所有消息（按 createdAt 升序），用于前端历史对话回放。
 *
 * 返回：{ success, data: MessageItem[] }
 */
router.get('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    const messages = await QASessionService.listMessages(sessionId, userId);
    return res.json({ success: true, data: messages });
  } catch (e: any) {
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 查询消息列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * PATCH /api/agent/sessions/:sessionId — 重命名会话
 *
 * Body: { title: string }
 *
 * 返回：{ success, data: SessionDetail }
 */
router.patch('/sessions/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    // title 与 settings 至少提供其一（title 若提供仍必须非空）
    const rawTitle = req.body?.title;
    const title = rawTitle !== undefined ? String(rawTitle).trim() : undefined;
    const settings = req.body?.settings;
    if (title === undefined && !settings) {
      return res.status(400).json({ success: false, message: 'title 或 settings 至少提供一个' });
    }
    if (rawTitle !== undefined && !title) {
      return res.status(400).json({ success: false, message: 'title 不能为空' });
    }
    if (title !== undefined && title.length > 100) {
      return res.status(400).json({ success: false, message: 'title 长度不能超过 100 字符' });
    }

    // 会话设置更新（模型 / 工具预设 / 推理强度，per-session 持久化）
    if (settings && typeof settings === 'object') {
      const patch: { modelKey?: string | null; toolPreset?: string; thinkingLevel?: string | null } = {};
      if (settings.modelKey !== undefined) {
        patch.modelKey = settings.modelKey === null ? null : String(settings.modelKey);
      }
      if (settings.toolPreset !== undefined) {
        const preset = String(settings.toolPreset);
        if (!['none', 'default', 'full', 'qa'].includes(preset)) {
          return res.status(400).json({ success: false, message: 'toolPreset 只能是 none / default / full / qa' });
        }
        patch.toolPreset = preset;
      }
      if (settings.thinkingLevel !== undefined) {
        patch.thinkingLevel = settings.thinkingLevel === null ? null : String(settings.thinkingLevel);
      }
      await QASessionService.updateSessionSettings(sessionId, userId, patch);
    }

    if (title) {
      await QASessionService.renameSession(sessionId, userId, title);
    }

    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }
    return res.json({ success: true, data: session });
  } catch (e: any) {
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 更新会话失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `更新失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/sessions/:sessionId — 删除会话
 *
 * 级联删除 messages + agentTraces（schema 已配置 onDelete: Cascade）
 *
 * 返回：{ success, message }
 */
router.delete('/sessions/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    await QASessionService.deleteSession(sessionId, userId);
    return res.json({ success: true, message: '会话已删除' });
  } catch (e: any) {
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 删除会话失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `删除失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/sessions/:sessionId/duplicate — 复制会话（简化版分支）
 *
 * 复制源会话全部消息到新会话（title 加「（副本）」后缀，status=active，
 * modelKey/toolPreset/thinkingLevel 原值保留），用于多方案并行对比。
 *
 * 返回：{ success, data: SessionDetail }
 */
router.post('/sessions/:sessionId/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) return res.status(400).json({ success: false, message: 'sessionId 不能为空' });

    const newSession = await QASessionService.duplicateSession(sessionId, userId);
    return res.json({ success: true, data: newSession });
  } catch (e: any) {
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 复制会话失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `复制失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/sessions/:sessionId/stats — 会话 token 用量统计
 *
 * 聚合该会话的消息计数（user/assistant/total）+ 工具调用计数（AgentTrace）+
 * LLM token 用量（通过 AgentTrace.traceId 关联 LlmCallLog 聚合）。
 *
 * 注意：
 * - cacheRead/cacheWrite 在当前 LlmCallLog schema 中无对应字段，固定返回 0
 * - cost 暂无数据来源，固定返回 0
 * - contextUsage 暂占位返回，待后端具备上下文窗口能力后补全
 *
 * 返回：{ success, data: SessionStats }
 */
router.get('/sessions/:sessionId/stats', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    // 聚合逻辑在 SessionStatsService（权限校验 + 消息计数 + 工具统计 + token 聚合）
    const data = await SessionStatsService.getSessionStats(sessionId, userId);
    if (!data) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    return res.json({ success: true, data });
  } catch (e: any) {
    console.error('[Agent] 查询会话统计失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/sessions/:sessionId/auto-name — 自动生成会话标题
 *
 * 取会话前 4 条 user/assistant 消息作为上下文，调 LlmService.chat() 生成简短标题，
 * 写回 QASession.title。
 *
 * 返回：{ success, data: { title } }
 * LLM 调用失败返回 500。
 */
router.post('/sessions/:sessionId/auto-name', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    // 防刷限流：同一会话 30s 内只允许触发一次（内存 Map，单实例有效；多实例容忍少量穿透）
    const now = Date.now();
    const lastAt = autoNameCooldown.get(sessionId) || 0;
    if (now - lastAt < 30_000) {
      return res.status(429).json({ success: false, message: '操作过于频繁，请 30 秒后再试' });
    }
    autoNameCooldown.set(sessionId, now);
    if (autoNameCooldown.size > 1000) {
      autoNameCooldown.clear(); // 防 Map 无限膨胀（清理后冷却记录失效可接受）
    }

    // 权限校验
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    // 取前 4 条 user/assistant 消息作为上下文
    const messages = await QASessionService.listMessages(sessionId, userId);
    const dialogueMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .slice(0, 4);
    if (dialogueMessages.length === 0) {
      return res.status(400).json({ success: false, message: '会话尚无消息，无法生成标题' });
    }

    const dialogue = dialogueMessages
      .map((m: any) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n');
    const prompt = `根据以下对话内容，生成一个简短的会话标题（不超过20个中文字符，不要加引号、不要加句号）。只返回标题文本。\n\n${dialogue}`;

    const titleRaw = await LlmService.chat(prompt, {
      systemPrompt: '你是一个会话标题生成助手。请根据对话内容生成简短的中文标题。',
      temperature: 0.3,
      maxTokens: 60,
      timeout: 30,
      traceId: sessionId,
    });

    // 清理：去首尾引号、去末尾句号/感叹号/问号、限制长度。
    // 循环清洗直至稳定——处理 「xxx」。 / "xxx." 等引号外带标点的嵌套形态
    // （单轮先删引号再删标点会残留「xxx」尾部引号）
    let cleanedTitle = String(titleRaw || '').trim();
    for (let i = 0; i < 3; i++) {
      const before = cleanedTitle;
      cleanedTitle = cleanedTitle
        .replace(/^["“”''「]+|["“”''」]+$/g, '')
        .replace(/[。.！!？?]+$/g, '')
        .trim();
      if (cleanedTitle === before) break;
    }
    cleanedTitle = cleanedTitle.slice(0, 100).trim();
    if (!cleanedTitle) {
      return res.status(500).json({ success: false, message: 'LLM 返回空标题' });
    }

    // 写回 QASession.title（复用 renameSession 保持权限校验一致）
    await QASessionService.renameSession(sessionId, userId, cleanedTitle);

    return res.json({ success: true, data: { title: cleanedTitle } });
  } catch (e: any) {
    console.error('[Agent] 自动命名失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `自动命名失败: ${e?.message || e}` });
  }
});

// ===== 会话压缩（手动 compact，2026-08-03 新增）=====

/**
 * POST /api/agent/sessions/:id/compact — 手动触发上下文压缩
 *
 * 对会话早期消息生成 LLM 摘要并替换（阻塞操作，可能耗时数秒）。
 * 与自动压缩共用 CompactionService.compact。
 */
router.post('/sessions/:id/compact', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sessionId = String(req.params.id || '');
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    const messages = await QASessionService.listMessages(sessionId, userId);
    const chatMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }));

    const result = await CompactionService.compact(chatMessages);

    if (result.truncatedMessages && result.truncatedMessages > 0) {
      
      // 删除被压缩的早期消息（按时间正序取前 N 条），插入摘要 system 消息
      const ordered = [...messages].sort((a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const toDelete = ordered.slice(0, result.truncatedMessages).map((m: any) => m.id);
      if (toDelete.length > 0) {
        await prisma.qAMessage.deleteMany({
          where: { id: { in: toDelete }, sessionId },
        });
      }
      if (result.summary) {
        await prisma.qAMessage.create({
          data: {
            sessionId,
            role: 'system',
            content: `[上下文摘要]\n${result.summary}`,
            status: 'completed',
          },
        });
      }
    }

    return res.json({
      success: true,
      data: {
        truncatedMessages: result.truncatedMessages || 0,
        estimatedTokens: result.estimatedTokens,
        hasSummary: Boolean(result.summary),
      },
    });
  } catch (e: any) {
    console.error('[Agent] 手动压缩失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `压缩失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/sessions/:id/pending-ask — 查询会话是否被 Agent 挂起等待用户回复
 *
 * Task 44（ask_user 主动提问）：流式结束后前端轮询此端点，若返回非 null 则弹提问对话框。
 * 返回 { success, data: { requestId, question, method, options?, timeoutSec } | null }
 */
router.get('/sessions/:id/pending-ask', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const sid = String(req.params.id || '');
    if (!sid) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    // 安全修复：校验会话归属，防止轮询他人会话的挂起提问（泄露敏感上下文）
    const owned = await QASessionService.getSession(sid, userId);
    if (!owned) {
      return res.status(403).json({ success: false, message: '无权访问该会话' });
    }

    const ask = await AskUserService.getPending(sid);
    return res.json({
      success: true,
      data: ask
        ? {
            requestId: ask.requestId,
            question: ask.question,
            method: ask.method,
            options: ask.options || undefined,
            timeoutSec: ask.timeoutSec,
          }
        : null,
    });
  } catch (e: any) {
    console.error('[Agent] 查询挂起提问失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询挂起提问失败: ${e?.message || e}` });
  }
});

export default router;
