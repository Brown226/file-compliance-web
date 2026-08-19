/**
 * Agent 记忆路由 — 长期记忆 / steering 指令注入 / 智能摘要
 *
 * 端点（挂载于 /api/agent）：
 *   GET    /memory           — 列出用户的长期记忆
 *   PUT    /memory/:memoryId — 更新记忆
 *   DELETE /memory/:memoryId — 删除记忆
 *   POST   /steer            — 审查中途注入纠正指令
 *   POST   /summary          — 生成审查结果智能摘要
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { MemoryService } from '../../services/agent/memory/memory.service';
import { QASessionService } from '../../services/agent/qa-session.service';
import { SteeringService } from '../../services/agent/steering/steering.service';
import { SummaryService } from '../../services/agent/summary/summary.service';

const router = Router();

// ===== 记忆管理（Task 18）=====

/**
 * GET /api/agent/memory — 列出用户的长期记忆
 *
 * Task 18.1：返回用户的所有记忆项（按 updatedAt 倒序），支持 type/scope 过滤。
 *
 * Query:
 *   - type: preference / routine / feedback
 *   - scope: global / project / session
 *
 * 返回：{ success, data: MemoryItem[] }
 */
router.get('/memory', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const type = req.query?.type as string | undefined;
    const scope = req.query?.scope as string | undefined;

    const memories = await MemoryService.listMemories({
      userId,
      ...(type ? { type: type as any } : {}),
      ...(scope ? { scope: scope as any } : {}),
    });

    return res.json({ success: true, data: memories });
  } catch (e: any) {
    console.error('[Agent] 查询记忆列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * PUT /api/agent/memory/:memoryId — 更新记忆
 *
 * Task 18.1：更新记忆的 value 和/或 confidence（value 变化时自动重新生成 embedding）。
 *
 * Body: { value?: string, confidence?: number }
 *
 * 返回：{ success, message }
 */
router.put('/memory/:memoryId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const memoryId = String(req.params.memoryId || '');
    if (!memoryId) {
      return res.status(400).json({ success: false, message: 'memoryId 不能为空' });
    }

    const { value, confidence } = req.body || {};
    if (value === undefined && confidence === undefined) {
      return res.status(400).json({ success: false, message: '至少提供 value 或 confidence 之一' });
    }
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      return res.status(400).json({ success: false, message: 'value 必须为非空字符串' });
    }
    if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0.5 || confidence > 1.0)) {
      return res.status(400).json({ success: false, message: 'confidence 必须为 0.5-1.0 之间的数字' });
    }

    await MemoryService.updateMemory({
      id: memoryId,
      userId,
      value: value?.trim(),
      confidence,
    });

    return res.json({ success: true, message: '记忆已更新' });
  } catch (e: any) {
    console.error('[Agent] 更新记忆失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `更新失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/memory/:memoryId — 删除记忆
 *
 * Task 18.1：删除指定记忆项（含 userId 权限校验，deleteMany 返回 0 视为不存在）。
 *
 * 返回：{ success, message }
 */
router.delete('/memory/:memoryId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const memoryId = String(req.params.memoryId || '');
    if (!memoryId) {
      return res.status(400).json({ success: false, message: 'memoryId 不能为空' });
    }

    await MemoryService.deleteMemory({ id: memoryId, userId });

    return res.json({ success: true, message: '记忆已删除' });
  } catch (e: any) {
    console.error('[Agent] 删除记忆失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `删除失败: ${e?.message || e}` });
  }
});

// ===== Steering 机制（Task 13.6）=====

/**
 * POST /api/agent/steer — 审查中途注入指令
 *
 * 用户在审查过程中发现 Agent 方向有误时，通过此端点注入纠正指令。
 * 指令存入 Redis（agent:steer:{sessionId}），TTL 10min，
 * Agent 在下一轮 chatStream 的 systemPrompt 中看到并响应。
 *
 * Body: { sessionId: string, message: string }
 *
 * 返回：{ success, data: { id } }
 */
router.post('/steer', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const { sessionId, message } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'message 不能为空' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ success: false, message: 'message 长度不能超过 5000 字符' });
    }

    // 权限：确保会话属于该用户
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    const id = await SteeringService.inject(sessionId, message.trim());
    return res.json({ success: true, data: { id } });
  } catch (e: any) {
    console.error('[Agent] steering 注入失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `注入失败: ${e?.message || e}` });
  }
});

// ===== 智能摘要（Task 13.16）=====
// 注：/api/agent/replay/* 端点已随 AgentTrace 链路移除（2026-08-03），
// 会话过程由 QAMessage 承载，摘要功能保留

/**
 * POST /api/agent/summary — 生成审查结果智能摘要
 *
 * 基于 ReviewIssue[] 生成三种粒度的摘要：
 * - quick: 纯统计（不调 LLM）
 * - detailed: LLM 生成详细报告（控制在 1000 字）
 * - executive: LLM 生成管理层汇报（控制在 500 字）
 *
 * Body: { issues: ReviewIssue[], level?: 'quick'|'detailed'|'executive', context?: string }
 */
router.post('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { issues, level = 'quick', context } = req.body || {};
    if (!Array.isArray(issues) || issues.length === 0) {
      return res.status(400).json({ success: false, message: 'issues 必须为非空数组' });
    }
    if (!['quick', 'detailed', 'executive'].includes(level)) {
      return res.status(400).json({ success: false, message: 'level 必须是 quick/detailed/executive 之一' });
    }

    const summary = await SummaryService.generate(issues, level, context);
    return res.json({ success: true, data: summary });
  } catch (e: any) {
    console.error('[Agent] 摘要生成失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `摘要生成失败: ${e?.message || e}` });
  }
});

export default router;
