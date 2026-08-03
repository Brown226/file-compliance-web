/**
 * Agent 路由 — 基于 Vercel AI SDK v7 的 Agentic 审查引擎对外端点
 *
 * 端点：
 *   POST /api/agent/chat/stream — SSE 流式对话（前端 useChat 默认期望的 UIMessage stream）
 *   POST /api/agent/upload     — 临时文件上传（FormData，比 base64 更高效，与 upload_file 工具互补）
 *
 * 参考：
 *   - Vercel AI SDK v7 流式写法（Task 1 验证：toUIMessageStreamResponse → 手动复制到 Express res）
 *   - backend/src/routes/maxkb.routes.ts（router.use(authenticate) 鉴权模式）
 *   - backend/src/routes/task.routes.ts（multer.diskStorage 上传模式）
 *
 * 约定（与项目既有路由一致）：
 *   - 用 `import` 引入项目内部模块 + Node 内置模块 + 类型化第三方包
 *   - AgentService 内部用 `require` 引入 ESM-only 的 ai / @ai-sdk/openai
 */

import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { AgentService } from '../services/agent/agent.service';
import { QASessionService } from '../services/agent/qa-session.service';
import { SessionStatsService } from '../services/agent/session-stats.service';
import { MemoryService } from '../services/agent/memory/memory.service';
import { SkillsService } from '../services/agent/skills/skills.service';
import { WorktreeService } from '../services/agent/worktree/worktree.service';
import { SteeringService } from '../services/agent/steering/steering.service';
import { SummaryService } from '../services/agent/summary/summary.service';
import { getUploadDir } from '../config/upload';

const router = Router();

// 所有 Agent 接口都需要认证
router.use(authenticate);

/**
 * POST /api/agent/chat/stream — SSE 流式对话
 *
 * Body:
 *   - messages: [{role, content}]（Vercel AI SDK useChat 默认发送格式）
 *   - sessionId?: string（可选，用于多轮对话上下文关联 + 工具临时文件隔离）
 *
 * 响应：UIMessage stream（text/event-stream）
 *   SSE 响应头（Content-Type / Cache-Control / Connection 等）由
 *   result.toUIMessageStreamResponse() 自动设置，下方手动复制到 Express res。
 */
router.post('/chat/stream', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages 不能为空' });
    }

    // Task 25：每用户单会话限制 — 新会话开始时自动结束旧会话
    const sessionId: string = req.body?.sessionId || '';
    const isNewSession = !sessionId;
    if (isNewSession) {
      // 检查用户是否有 active 会话，有则自动结束
      const activeSessions = await QASessionService.listSessions(userId, 1);
      const stillActive = activeSessions.find((s: any) => s.status === 'active');
      if (stillActive) {
        const prisma = require('../config/db').default;
        await prisma.qASession.update({
          where: { id: stillActive.id },
          data: { status: 'completed' },
        });
        console.log(`[Agent] 自动结束旧会话: ${stillActive.id}`);
      }
    }

    const result = await AgentService.chatStream({
      messages,
      userId,
      sessionId,
      modelKey: req.body?.modelKey || undefined,
      toolPreset: req.body?.toolPreset || undefined,
      toolNames: Array.isArray(req.body?.toolNames) ? req.body.toolNames : undefined,
      thinkingLevel: req.body?.thinkingLevel || undefined,
    });

    // Express 5 不直接接受 Web Response，手动转换（Task 1 验证过的写法）：
    // 1) 复制 status / headers（含 SSE 必需的 Content-Type: text/event-stream 等）
    // 2) 把 ReadableStream pipe 到 Express res
    const uiResponse = result.toUIMessageStreamResponse();
    res.status(uiResponse.status);
    // 显式标注 value/key 类型：AgentService.chatStream 返回 Promise<any>，
    // 导致 uiResponse.headers.forEach 回调参数退化为 implicit any（TS7006）
    uiResponse.headers.forEach((value: string, key: string) => {
      // 跳过 Node 自动管理的 transfer-encoding 头
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });

    const webBody = uiResponse.body;
    if (!webBody) {
      res.end();
      return;
    }

    const reader = webBody.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  } catch (e: any) {
    console.error('[Agent] 流式调用失败:', e?.message || e);

    // Task 21.2：LLM 整体失败降级 — 流未开始时（headersSent=false），
    // 降级到非流式 LlmService.chat() 重试一次，把结果包成 UIMessageStream 返回
    if (!res.headersSent) {
      try {
        const sessionId: string = req.body?.sessionId || '';
        const messages: any[] = req.body?.messages || [];

        // 从 messages 提取最后一条用户消息作为 prompt（降级模式无法支持工具调用）
        const lastUserMsg = [...messages].reverse().find((m: any) => m?.role === 'user');
        const userText = lastUserMsg
          ? (Array.isArray(lastUserMsg.parts)
            ? lastUserMsg.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
            : typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
          : '';

        if (!userText) {
          throw new Error('无法从 messages 提取用户消息');
        }

        console.warn(`[Agent:Fallback] 降级到 LlmService.chat()，sessionId=${sessionId || 'none'}`);

        // 调非流式 LLM
        const { LlmService } = require('../services/llm/llm.service');
        const fallbackText = await LlmService.chat(userText, {
          systemPrompt: '你是文件合规审查助手。由于流式调用失败，请直接基于用户消息回复（无法调用工具）。',
          mode: 'agent',
          traceId: sessionId || undefined,
        });

        // 把降级结果包成 UIMessageStream 格式（前端 useChat 能正常消费）
        const { createUIMessageStream } = require('ai');
        const fallbackStream = createUIMessageStream({
          execute: async ({ writer }: { writer: any }) => {
            writer.write({ type: 'text-start', id: 'fallback-text' });
            writer.write({ type: 'text-delta', id: 'fallback-text', delta: fallbackText });
            writer.write({ type: 'text-end', id: 'fallback-text' });
            writer.write({ type: 'finish', finishReason: 'stop' });
          },
        });

        const uiResp = fallbackStream.toUIMessageStreamResponse();
        res.status(uiResp.status);
        uiResp.headers.forEach((value: string, key: string) => {
          if (key.toLowerCase() === 'transfer-encoding') return;
          res.setHeader(key, value);
        });
        const reader = uiResp.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
        console.log('[Agent:Fallback] 降级成功');

        // Task 21.3：降级事件记入后端日志（AgentTrace 链路已移除，2026-08-03）
        if (sessionId) {
          console.warn(`[Agent:Fallback] LLM 流式失败降级: sessionId=${sessionId} reason=${(e as Error)?.message || e} fallbackLen=${fallbackText.length}`);
        }
        return;
      } catch (fallbackErr) {
        console.error('[Agent:Fallback] 降级也失败:', (fallbackErr as Error).message);
        res.status(500).json({
          success: false,
          message: `流式调用失败且降级也失败：${(fallbackErr as Error).message}`,
        });
      }
    } else {
      // 头已发送，只能结束连接（前端会看到流中断）
      res.end();
    }
    return;
  }
});

/**
 * POST /api/agent/upload — 临时文件上传（FormData）
 *
 * 与 upload_file 工具互补：upload_file 工具用于 LLM 自身持有 base64 数据时上传；
 * 本端点用于前端用户通过 FormData 直接上传（更高效，无 base64 膨胀）。
 *
 * Form fields:
 *   - file: 文件（multer single field，字段名固定为 'file'）
 *   - sessionId?: string（可选；建议在 file 字段之前发送，确保 multer 解析时可用）
 *                   未提供时自动生成 UUID，并在响应中返回，前端可用于后续 /chat/stream
 *
 * 返回：{ success, data: { filePath, fileName, size, sessionId } }
 *   - filePath: 服务端绝对路径（与 upload_file 工具返回格式一致，可直接喂给 extract_text 工具）
 *   - fileName: 原始文件名
 *   - size: 文件字节数
 *   - sessionId: 实际使用的会话 ID（便于前端续接对话）
 *
 * 存储路径与 upload_file 工具完全一致：backend/uploads/agent_temp/{userId}/{sessionId}/{fileName}
 */
const agentUploadStorage = multer.diskStorage({
  destination: (req: AuthRequest, _file, cb) => {
    const userId = req.user?.id || 'anonymous';
    // sessionId 来自 form field；未提供时生成新 UUID 并暂存到 req，供后续 handler 返回
    let sessionId = (req.body?.sessionId as string) || '';
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      (req as any).__agentGeneratedSessionId = sessionId;
    }
    const targetDir = path.join(getUploadDir(), 'agent_temp', userId, sessionId);
    // 同步创建目录（与 task.routes.ts 的 getUserUploadDir 模式一致）
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    // 保留原始扩展名，加时间戳防同名冲突
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});

const agentUpload = multer({
  storage: agentUploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB（与 task.routes.ts 默认上限一致）
});

router.post('/upload', agentUpload.single('file'), (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '未接收到文件（FormData 字段名必须为 file）' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    // 优先用前端传入的 sessionId，否则取 destination 阶段生成的 UUID
    const sessionId: string =
      (req.body?.sessionId as string) || (req as any).__agentGeneratedSessionId || '';

    // file.path 是 multer diskStorage 写入的绝对路径，与 upload_file 工具返回格式一致
    return res.json({
      success: true,
      data: {
        filePath: file.path,
        fileName: file.originalname,
        size: file.size,
        sessionId,
      },
    });
  } catch (e: any) {
    console.error('[Agent] 文件上传失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `文件上传失败: ${e?.message || e}` });
  }
});

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const sessionId = String(req.params.sessionId || '');
    const title = String(req.body?.title ?? '').trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }
    if (!title) {
      return res.status(400).json({ success: false, message: 'title 不能为空' });
    }
    if (title.length > 100) {
      return res.status(400).json({ success: false, message: 'title 长度不能超过 100 字符' });
    }

    const session = await QASessionService.renameSession(sessionId, userId, title);
    return res.json({ success: true, data: session });
  } catch (e: any) {
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 重命名会话失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `重命名失败: ${e?.message || e}` });
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
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

    const { LlmService } = require('../services/llm/llm.service');
    const titleRaw = await LlmService.chat(prompt, {
      systemPrompt: '你是一个会话标题生成助手。请根据对话内容生成简短的中文标题。',
      temperature: 0.3,
      maxTokens: 60,
      timeout: 30,
      traceId: sessionId,
    });

    // 清理：去首尾引号、去末尾句号/感叹号/问号、限制长度
    const cleanedTitle = String(titleRaw || '')
      .trim()
      .replace(/^["“”''「]+|["“”''」]+$/g, '')
      .replace(/[。.！!？?]+$/g, '')
      .slice(0, 100)
      .trim();
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });

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

// ===== Skills 管理（2026-08-03 新增：场景化能力 = SKILL.md）=====

/**
 * GET /api/agent/skills — 列出全部 skills（含禁用）
 */
router.get('/skills', async (_req: AuthRequest, res: Response) => {
  try {
    const skills = SkillsService.listSkills();
    return res.json({ success: true, data: skills });
  } catch (e: any) {
    console.error('[Agent] 列出 skills 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出 skills 失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/skills/:name — 单个 skill 详情
 */
router.get('/skills/:name', async (req: AuthRequest, res: Response) => {
  try {
    const skill = SkillsService.getSkill(String(req.params.name || ''));
    if (!skill) return res.status(404).json({ success: false, message: 'skill 不存在' });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 读取 skill 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `读取 skill 失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/skills — 新建 skill
 * Body: { name, description, content }
 */
router.post('/skills', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, content } = req.body || {};
    if (!name || !content) {
      return res.status(400).json({ success: false, message: 'name 和 content 必填' });
    }
    const skill = SkillsService.createSkill({ name, description: description || '', content });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 新建 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `新建 skill 失败: ${e?.message || e}` });
  }
});

/**
 * PUT /api/agent/skills/:name — 更新 skill
 * Body: { description?, content? }
 */
router.put('/skills/:name', async (req: AuthRequest, res: Response) => {
  try {
    const { description, content } = req.body || {};
    const skill = SkillsService.updateSkill(String(req.params.name || ''), { description, content });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 更新 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `更新 skill 失败: ${e?.message || e}` });
  }
});

/**
 * PATCH /api/agent/skills/:name — 启用/禁用
 * Body: { enabled: boolean }
 */
router.patch('/skills/:name', async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled 必须为布尔值' });
    }
    const skill = SkillsService.setSkillEnabled(String(req.params.name || ''), enabled);
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 切换 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `切换 skill 失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/skills/:name — 删除 skill
 */
router.delete('/skills/:name', async (req: AuthRequest, res: Response) => {
  try {
    SkillsService.deleteSkill(String(req.params.name || ''));
    return res.json({ success: true, data: null });
  } catch (e: any) {
    console.error('[Agent] 删除 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `删除 skill 失败: ${e?.message || e}` });
  }
});

// ===== Worktree 管理（2026-08-03 新增：Agent 多任务规划工作区）=====

/**
 * GET /api/agent/worktrees — 列出全部 worktree
 */
router.get('/worktrees', async (_req: AuthRequest, res: Response) => {
  try {
    const list = await WorktreeService.listWorktrees();
    return res.json({ success: true, data: list });
  } catch (e: any) {
    console.error('[Agent] 列出 worktree 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出 worktree 失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/worktrees — 新建 worktree（新分支）
 * Body: { branch: string }
 */
router.post('/worktrees', async (req: AuthRequest, res: Response) => {
  try {
    const { branch } = req.body || {};
    if (!branch) {
      return res.status(400).json({ success: false, message: 'branch 必填' });
    }
    const worktree = await WorktreeService.addWorktree(String(branch));
    return res.json({ success: true, data: worktree });
  } catch (e: any) {
    console.error('[Agent] 新建 worktree 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `新建 worktree 失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/worktrees?path=<绝对路径> — 删除 worktree（仅限非主工作区）
 */
router.delete('/worktrees', async (req: AuthRequest, res: Response) => {
  try {
    const targetPath = String(req.query.path || '');
    if (!targetPath) {
      return res.status(400).json({ success: false, message: 'path 必填（query 参数）' });
    }
    await WorktreeService.removeWorktree(targetPath);
    return res.json({ success: true, data: null });
  } catch (e: any) {
    console.error('[Agent] 删除 worktree 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `删除 worktree 失败: ${e?.message || e}` });
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });

    const sessionId = String(req.params.id || '');
    const session = await QASessionService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在或无权访问' });
    }

    const messages = await QASessionService.listMessages(sessionId, userId);
    const chatMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }));

    const { CompactionService } = require('../services/agent/context-compaction/compaction.service');
    const result = await CompactionService.compact(chatMessages);

    if (result.truncatedMessages && result.truncatedMessages > 0) {
      const prisma = require('../config/db').default;
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

// ===== 模型与 Provider 管理（2026-08-03 新增）=====

/**
 * GET /api/agent/models — 可用模型列表
 *
 * 从 system_configs.llm_profiles 展平所有 provider 的模型，
 * 附带系统默认模型（llm_chat_model 当前配置）。
 *
 * 返回：{ success, data: { defaultKey: string|null, models: [{ key, label }] } }
 *   key 格式：<providerId>::<modelName>（null 表示系统默认）
 */
router.get('/models', async (_req: AuthRequest, res: Response) => {
  try {
    const prisma = require('../config/db').default;
    const { LlmService } = require('../services/llm/llm.service');

    const defaultCfg = await LlmService.getLlmConfig();
    const models: Array<{ key: string | null; label: string }> = [];
    if (defaultCfg?.modelName) {
      models.push({ key: null, label: `${defaultCfg.modelName}（系统默认）` });
    }

    const profilesCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    if (profilesCfg?.value) {
      const raw = typeof profilesCfg.value === 'string' ? JSON.parse(profilesCfg.value) : profilesCfg.value;
      const profiles = Array.isArray(raw) ? raw : [];
      for (const p of profiles) {
        if (p?.id && p?.model) {
          models.push({
            key: `${p.id}::${p.model}`,
            label: `${p.name || p.id} · ${p.model}`,
          });
        }
      }
    }

    return res.json({ success: true, data: { defaultKey: null, models } });
  } catch (e: any) {
    console.error('[Agent] 列出模型失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出模型失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/providers — LLM 供应商配置列表（llm_profiles）
 */
router.get('/providers', async (_req: AuthRequest, res: Response) => {
  try {
    const prisma = require('../config/db').default;
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    const raw = cfg?.value
      ? (typeof cfg.value === 'string' ? JSON.parse(cfg.value) : cfg.value)
      : [];
    return res.json({ success: true, data: Array.isArray(raw) ? raw : [] });
  } catch (e: any) {
    console.error('[Agent] 读取 providers 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `读取 providers 失败: ${e?.message || e}` });
  }
});

/**
 * PUT /api/agent/providers — 保存 LLM 供应商配置
 * Body: { profiles: Array<{ id, name, apiBase, apiKey, model, provider?, timeout? }> }
 */
router.put('/providers', async (req: AuthRequest, res: Response) => {
  try {
    const { profiles } = req.body || {};
    if (!Array.isArray(profiles)) {
      return res.status(400).json({ success: false, message: 'profiles 必须为数组' });
    }
    const prisma = require('../config/db').default;
    await prisma.systemConfig.upsert({
      where: { key: 'llm_profiles' },
      update: { value: JSON.stringify(profiles) },
      create: { key: 'llm_profiles', value: JSON.stringify(profiles) },
    });
    return res.json({ success: true, data: profiles });
  } catch (e: any) {
    console.error('[Agent] 保存 providers 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `保存 providers 失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/models/test — 模型连通性测试
 * Body: { apiBase, apiKey, model }
 */
router.post('/models/test', async (req: AuthRequest, res: Response) => {
  try {
    const { apiBase, apiKey, model } = req.body || {};
    if (!apiBase || !apiKey || !model) {
      return res.status(400).json({ success: false, message: 'apiBase/apiKey/model 必填' });
    }
    const { LlmService } = require('../services/llm/llm.service');
    const caps = await LlmService.probeModelCapabilities(apiBase, apiKey, model);
    return res.json({
      success: true,
      data: caps
        ? { ok: true, contextWindow: caps.contextWindow, maxOutput: caps.maxOutput, reasoning: caps.reasoning }
        : { ok: false, message: '模型不可达或未识别（请检查 apiBase/apiKey/model）' },
    });
  } catch (e: any) {
    console.error('[Agent] 模型测试失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `模型测试失败: ${e?.message || e}` });
  }
});

export default router;
