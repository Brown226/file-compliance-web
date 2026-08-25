/**
 * Agent 聊天路由 — 流式对话 + 临时文件上传/预览
 *
 * 端点（挂载于 /api/agent）：
 *   POST /chat/stream     — SSE 流式对话（前端 useChat 默认期望的 UIMessage stream）
 *   POST /upload          — 临时文件上传（FormData，比 base64 更高效，与 upload_file 工具互补）
 *   GET  /files/read      — 读取当前用户上传的临时文件内容（右栏文件查看器预览）
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { AgentService } from '../../services/agent/agent.service';
import { LlmService } from '../../services/llm/llm.service';
import { QASessionService } from '../../services/agent/qa-session.service';
import { sessionStore } from '../../services/agent/session-store';
import { getUploadDir } from '../../config/upload';
import { fixMojibake } from '../../services/agent/tools/file/filename';

const router = Router();

/**
 * 两级降级链（Task 21.2）：chatWithGenerateText（保留工具调用）→ LlmService.chat（纯文本）。
 * 把降级结果包成 UIMessageStream 写到 res（前端 useChat 可正常消费）。
 *
 * 供两处调用（P0 修复 needFallback 死开关后新增第二调用点）：
 *   1. /chat/stream 主调抛异常且 headersSent=false（catch 分支，原内联逻辑）
 *   2. 流式嗅探判定「零内容流」（streamText 正常结束但未产出任何文本/工具事件，
 *      即 agent.service onStepFinish 标记的 needFallback 场景——此前该标志从未被消费）
 *
 * 前置条件：res 头尚未发送；调用方已清理 streamTimeout。
 */
async function respondWithFallbackChain(
  req: AuthRequest,
  res: Response,
  controller: AbortController,
): Promise<void> {
  const sessionId: string = req.body?.sessionId || '';
  const messages: any[] = req.body?.messages || [];
  try {
    let fallbackText = '';
    let fallbackMode = '';

    // 第一级兜底：chatWithGenerateText（非流式但保留工具调用循环）
    try {
      const uid = (req as any).user?.id || '';
      const generateResult = await AgentService.chatWithGenerateText({
        messages,
        userId: uid,
        sessionId,
        signal: controller.signal,
      });
      fallbackText = typeof generateResult?.text === 'string' ? generateResult.text : '';
      fallbackMode = 'generateText';
      console.warn(`[Agent:Fallback] 降级到 chatWithGenerateText()，sessionId=${sessionId || 'none'}`);
    } catch (genErr: any) {
      console.error('[Agent:Fallback] generateText 兜底失败，继续降级到 LlmService.chat():', (genErr as Error)?.message || genErr);
    }

    // 第二级兜底：纯文本 LlmService.chat()
    if (!fallbackText) {
      const lastUserMsg = [...messages].reverse().find((m: any) => m?.role === 'user');
      const userText = lastUserMsg
        ? (Array.isArray(lastUserMsg.parts)
          ? lastUserMsg.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
          : typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
        : '';

      if (!userText) {
        throw new Error('无法从 messages 提取用户消息');
      }

      fallbackText = await LlmService.chat(userText, {
        systemPrompt: '你是文件合规审查助手。由于流式调用失败，请直接基于用户消息回复（无法调用工具）。',
        mode: 'agent',
        traceId: sessionId || undefined,
      });
      fallbackMode = 'LlmService.chat';
    }

    // 用 ai 包官方 pipeUIMessageStreamToResponse 直接把流写到 Express res
    const { createUIMessageStream, pipeUIMessageStreamToResponse } = require('ai');
    const fallbackStream = createUIMessageStream({
      execute: async ({ writer }: { writer: any }) => {
        writer.write({ type: 'text-start', id: 'fallback-text' });
        writer.write({ type: 'text-delta', id: 'fallback-text', delta: fallbackText });
        writer.write({ type: 'text-end', id: 'fallback-text' });
        writer.write({ type: 'finish', finishReason: 'stop' });
      },
    });

    await pipeUIMessageStreamToResponse({ response: res, stream: fallbackStream });
    console.log(`[Agent:Fallback] 降级成功（${fallbackMode}）`);

    // P1-1：降级产物也持久化为 assistant 消息（此前降级回答不入库，会话历史断档）
    const uid = (req as any).user?.id || '';
    if (sessionId && fallbackText && uid) {
      QASessionService.persistAssistantMessage(sessionId, uid, fallbackText, 'completed')
        .catch((e: Error) => console.warn('[Agent:Fallback] 持久化降级消息失败:', (e as Error).message));
    }

    if (sessionId) {
      console.warn(`[Agent:Fallback] LLM 流式失败降级: sessionId=${sessionId} mode=${fallbackMode} fallbackLen=${fallbackText.length}`);
    }
  } catch (fallbackErr) {
    console.error('[Agent:Fallback] 降级也失败:', (fallbackErr as Error)?.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: `流式调用失败且降级也失败：${(fallbackErr as Error)?.message}`,
      });
    } else {
      try { res.end(); } catch { /* 连接已断 */ }
    }
  }
}

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
  // 请求开始时间：用于并发新会话竞态防护（见下方 completeActiveSessions 调用）
  const requestStartedAt = new Date();
  // 安全修复：LLM 调用中止控制（提升到 try 外，catch 降级分支也可见）
  const controller = new AbortController();
  const streamTimeout = setTimeout(() => controller.abort(), 600_000);
  const onClientClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  // 注意：req 'close' 在请求体完整接收后也会触发（Connection: close 客户端 /
  // 部分代理在响应前关闭请求流），此时 req.complete === true 表示请求已完整
  // 送达，不是客户端中途断开——若直接 abort 会误杀正在进行的 LLM 调用。
  // 只有 req.complete === false（body 未收完连接即断）才算真正断开。
  req.on('close', () => {
    if (req.complete) return;
    onClientClose();
  });
  res.on('close', onClientClose);
  try {
    const userId = req.user.id;

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages 不能为空' });
    }
    // 输入校验：条数/角色/体量上限，防超长输入拖垮 LLM 上下文与 SSE 连接
    if (messages.length > 200) {
      return res.status(400).json({ success: false, message: 'messages 条数不能超过 200' });
    }
    const VALID_ROLES = new Set(['system', 'user', 'assistant']);
    let totalChars = 0;
    for (const m of messages) {
      if (!m || typeof m !== 'object' || !VALID_ROLES.has(String(m.role || ''))) {
        return res.status(400).json({ success: false, message: 'messages 中每条必须包含合法的 role（system/user/assistant）' });
      }
      totalChars += JSON.stringify(m).length;
      if (totalChars > 2_000_000) {
        return res.status(400).json({ success: false, message: 'messages 总体量过大（上限约 200 万字符）' });
      }
    }

    // Task 25：每用户单会话限制 — 新会话开始时自动结束旧会话（真实约束）
    // P0 #1 修复：改为调用 QASessionService.completeActiveSessions（service 内按 status 过滤）
    // 2026-08-04 修复：无 sessionId 时必须创建新会话并返回 sessionId，
    //   否则 chatStream 不会持久化消息、前端拿不到会话 id（单活跃会话死循环）
    // 2026-08-07 竞态修复：completeActiveSessions 只关闭 createdAt 早于本请求开始时间的
    //   会话，避免两个并发新会话请求互相误杀对方刚创建的会话。
    let sessionId: string = req.body?.sessionId || '';
    const isNewSession = !sessionId;
    if (isNewSession) {
      const closedCount = await QASessionService.completeActiveSessions(userId, requestStartedAt);
      if (closedCount > 0) {
        console.log(`[Agent] 自动结束旧会话: ${closedCount} 个`);
      }
      // 生成新会话 id 并创建（status=active），让本次对话进入真实会话
      const crypto = require('crypto');
      sessionId = crypto.randomUUID();
      await QASessionService.ensureSession(sessionId, userId, undefined, {
        modelKey: req.body?.modelKey || undefined,
        toolPreset: req.body?.toolPreset || undefined,
        thinkingLevel: req.body?.thinkingLevel || undefined,
      });
      console.log(`[Agent] 创建新会话: ${sessionId.slice(0, 8)}`);
    } else {
      // 安全修复：携带 sessionId 时必须校验该会话属于当前用户，
      // 防止跨用户向他人会话写入消息 / 消费 steering / 回答他人挂起的提问
      // 2026-08-11 修复：区分「会话不存在」与「存在但越权」——
      // 前端 startNewSession() 用 crypto.randomUUID() 生成新会话 id 并随首条消息传入，
      // 此时会话在后端尚不存在，应自动创建而非 403（此前新会话首条消息必失败）。
      const rawSession = await sessionStore.getByIdWithOwner(sessionId);
      if (!rawSession) {
        // 会话 id 不存在 → 前端新会话场景，自动创建并绑定当前用户
        await QASessionService.ensureSession(sessionId, userId, undefined, {
          modelKey: req.body?.modelKey || undefined,
          toolPreset: req.body?.toolPreset || undefined,
          thinkingLevel: req.body?.thinkingLevel || undefined,
        });
        console.log(`[Agent] 自动创建前端新会话: ${sessionId.slice(0, 8)}`);
      } else if (rawSession.userId !== userId) {
        // 会话存在但属于其他用户 → 拒绝，防越权写入
        return res.status(403).json({ success: false, message: '无权访问该会话' });
      }
    }

    // 安全修复：LLM 调用中止控制
    // 1. 客户端断开（关页面/切网络）→ req/res close 时 abort，LLM 调用立即取消，
    //    不再把配额与资源浪费在已断开的连接上
    // 2. 全流程超时（10 步工具循环 + LLM 网关异常挂起兜底）：600s 后强制中止，
    //    防止网关挂起时请求永久悬挂
    const result = await AgentService.chatStream({
      messages,
      userId,
      sessionId,
      modelKey: req.body?.modelKey || undefined,
      toolPreset: req.body?.toolPreset || undefined,
      toolNames: Array.isArray(req.body?.toolNames) ? req.body.toolNames : undefined,
      thinkingLevel: req.body?.thinkingLevel || undefined,
      pendingAskAnswer: req.body?.pendingAskAnswer || null,
      signal: controller.signal,
    });

    // Express 5 不直接接受 Web Response，手动转换（Task 1 验证过的写法）：
    // 1) 复制 status / headers（含 SSE 必需的 Content-Type: text/event-stream 等）
    // 2) 把 ReadableStream pipe 到 Express res
    const uiResponse = result.toUIMessageStreamResponse();
    // P0 修复（needFallback 死开关）：先读首块再写 SSE 头的基础上，升级为「流内容嗅探」。
    //
    // 背景：agent.service onStepFinish 检测到首步 finishReason="other" 且无工具调用时置
    // needFallback=true，但该标志从未被路由层消费——异常流照常透传给前端，用户拿到空回答。
    // （minimax 类模型流式工具调用不兼容的典型表现：start/finish 空转，零 text-delta 零工具事件）
    //
    // 方案：在写头之前缓冲字节，直到看到第一个「内容事件」或流结束：
    //   - 看到内容事件 → 健康流：写头 + 冲缓冲 + 继续增量转发（体验几乎无损）
    //   - 流结束仍零内容 / 收到 error 事件 → 头未发送，取消上游并走两级降级链
    //   - 缓冲超限仍未判定（异常但非空转的流）→ 从宽处理：按健康流转发
    // 这样降级链在「流正常结束但零产出」场景下真正可达，且 headersSent=false 保证可重试。
    const webBody = uiResponse.body;
    if (!webBody) {
      res.end();
      return;
    }

    const reader = webBody.getReader();
    // 内容事件标记：出现任一即视为健康流（UIMessageStream 的 SSE data 为 JSON）
    const CONTENT_MARKERS = [
      '"type":"text-delta"',
      '"type":"tool-input-available"',
      '"type":"tool-output-available"',
      '"type":"tool-output-error"',
      '"type":"reasoning-delta"',
    ];
    // 判定窗口上限：超过此体积仍无内容标记的流按健康处理（防御性，避免无限缓冲）
    const SNIFF_BUFFER_LIMIT = 64 * 1024;

    let sawContent = false;
    let streamDone = false;
    const buffered: Uint8Array[] = [];
    let bufferedBytes = 0;
    const decoder = new TextDecoder();
    let sniffText = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamDone = true;
          break;
        }
        if (value) {
          buffered.push(value);
          bufferedBytes += value.byteLength;
          sniffText += decoder.decode(value, { stream: true });
        }
        if (CONTENT_MARKERS.some((m) => sniffText.includes(m))) {
          sawContent = true;
          break;
        }
        if (sniffText.includes('"type":"error"')) {
          // 上游显式 error 事件：视为失败流，走降级（sawContent 保持 false）
          break;
        }
        if (bufferedBytes > SNIFF_BUFFER_LIMIT) {
          // 超窗仍未判定：从宽按健康流转发（避免对超长前言流误杀）
          sawContent = true;
          break;
        }
      }
    } finally {
      // 嗅探结束（出内容/流出错/流结束），LLM 已开始响应——解除超时定时器，
      // 但客户端断开监听保持（断开时仍中止 LLM 后续工具循环）
      clearTimeout(streamTimeout);
    }

    if (!sawContent) {
      // 零内容/error 流：头未发送，安全走两级降级链。
      // 先取消上游读取（若流未自然结束），释放连接资源。
      try { await reader.cancel(); } catch { /* 已结束则忽略 */ }
      console.warn(`[Agent:Fallback] 嗅探到零内容/error 流（streamDone=${streamDone}），触发降级链`);
      await respondWithFallbackChain(req, res, controller);
      return;
    }

    res.status(uiResponse.status);
    // 显式标注 value/key 类型：AgentService.chatStream 返回 Promise<any>，
    // 导致 uiResponse.headers.forEach 回调参数退化为 implicit any（TS7006）
    uiResponse.headers.forEach((value: string, key: string) => {
      // 跳过 Node 自动管理的 transfer-encoding 头
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });

    // 注意：不能在这里注入自定义 `data:` 首帧（如 session-init）。
    // AI SDK 前端（@ai-sdk/vue useChat）的 processUIMessageStream 只认识标准
    // UIMessageStream 事件，未知类型会被原样 enqueue 导致流解析失败、请求中止，
    // assistant 消息不渲染。前端 sessionId 由 useAgentChat 用 crypto.randomUUID()
    // 自行生成并随请求体传入，无需后端回传。
    for (const chunk of buffered) {
      res.write(chunk);
    }
    if (streamDone) {
      res.end();
      return;
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  } catch (e: any) {
    console.error('[Agent] 流式调用失败:', e?.message || e);

    // 中止场景（客户端断开 / 600s 超时）：不再降级重试——
    // 客户端已断开时写入无意义，超时时 LLM 大概率不可用，降级只会再等一轮超时。
    // 断开场景 res 已不可写，静默结束即可；超时场景给前端明确提示。
    if (controller.signal.aborted) {
      if (res.writableEnded) return;
      try {
        clearTimeout(streamTimeout);
        if (res.headersSent) {
          res.end();
        } else {
          res.status(504).json({ success: false, message: '流式调用超时（600s），请重试' });
        }
      } catch {
        // 连接已断开，忽略写错误
      }
      return;
    }

    // Task 21.2：LLM 整体失败降级 — 流未开始时（headersSent=false）走两级降级链：
    // 先降级到 AgentService.chatWithGenerateText()（非流式但保留工具调用循环），
    // 再失败才降级到纯文本 LlmService.chat()。逻辑已抽取为 respondWithFallbackChain 共用
    //（流嗅探判定「零内容/error 流」时也调用同一函数，见上方管道段）。
    if (!res.headersSent) {
      try {
        clearTimeout(streamTimeout);
        await respondWithFallbackChain(req, res, controller);
        return;
      } catch (fallbackErr) {
        console.error('[Agent:Fallback] 降级链执行异常:', (fallbackErr as Error)?.message);
        res.status(500).json({
          success: false,
          message: `流式调用失败且降级也失败：${(fallbackErr as Error)?.message}`,
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
 *                   未提供时响应中为空串——新会话 ID 由前端在 /chat/stream 前自行生成
 *
 * 返回：{ success, data: { filePath, fileName, size, sessionId } }
 *   - filePath: 服务端绝对路径（与 upload_file 工具返回格式一致，可直接喂给 extract_text 工具）
 *   - fileName: 原始文件名
 *   - size: 文件字节数
 *   - sessionId: 前端传入的会话 ID（原样回显，便于前端续接对话）
 *
 * 存储路径与 upload_file 工具完全一致：backend/uploads/agent_temp/{userId}/{YYYY-MM-DD}/{fileName}
 */
const agentUploadStorage = multer.diskStorage({
  destination: (req: AuthRequest, _file, cb) => {
    const userId = req.user?.id || 'anonymous';
    // 按用户 + 日期划分存储：agent_temp/{userId}/{YYYY-MM-DD}/
    // 不再按 sessionId 分区（避免同一批上传因会话不一致散落不同目录）
    const targetDir = getTodayDir(userId);
    // 同步创建目录（与 task.routes.ts 的 getUserUploadDir 模式一致）
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    // 修复中文文件名乱码：multer 在 Windows 上会把 multipart 的 UTF-8 文件名
    // 按 latin1 解码（"先初始化" → "åå§ååäºè§£..."），导致 Agent 无法按路径访问。
    // 这里把 latin1 字节序列反向解码回原始 UTF-8 字符串，再存盘。
    let originalName = file.originalname;
    try {
      const utf8 = Buffer.from(originalName, 'latin1').toString('utf8');
      // 仅当解码后仍可逆（无 U+FFFD 替换符）且含中文时才采用，避免破坏本就正常的 ASCII 文件名
      if (!utf8.includes('�')) originalName = utf8;
    } catch {
      // 忽略解码失败，保持原样
    }
    // 保留原始扩展名，加时间戳防同名冲突
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});

/**
 * 拒绝上传的可执行/脚本类扩展名（与 upload_file 工具一致，防 XSS 与恶意文件传播）。
 * html/htm/svg 是脚本注入载体（files/read 预览走 base64 + 前端 iframe/v-html），一并拒绝。
 */
const BLOCKED_UPLOAD_EXT = new Set([
  'exe', 'dll', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'reg',
  'sh', 'bash', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'jar', 'class',
  'php', 'phtml', 'php3', 'php4', 'php5', 'asp', 'aspx', 'jsp', 'jspx',
  'html', 'htm', 'svg', 'swf', 'apk', 'app', 'gadget', 'msh',
]);

const agentUpload = multer({
  storage: agentUploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB（与 task.routes.ts 默认上限一致）
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
    if (BLOCKED_UPLOAD_EXT.has(ext)) {
      return cb(new Error(`不支持上传 .${ext} 类型的文件（可执行/脚本类文件被拒绝）`));
    }
    cb(null, true);
  },
});

/** 获取当前用户当天的上传目录（agent_temp/{userId}/{YYYY-MM-DD}） */
function getTodayDir(userId: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.resolve(path.join(getUploadDir(), 'agent_temp', userId, `${y}-${m}-${d}`));
}

router.post('/upload', agentUpload.single('file'), (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '未接收到文件（FormData 字段名必须为 file）' });
    }

    // 修复死代码：原实现读 (req as any).__agentGeneratedSessionId（从未被设置，恒为空串）。
    // multer 的 diskStorage destination 回调执行时 req.body 已含非文件字段，
    // 但此处不生成新 sessionId——新会话 ID 由前端在 /chat/stream 前用
    // crypto.randomUUID() 生成并传入（见 useAgentChat.ts），这里只回显前端传入值。
    const sessionId: string = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';

    // file.path 是 multer diskStorage 写入的绝对路径，与 upload_file 工具返回格式一致
    return res.json({
      success: true,
      data: {
        filePath: file.path,
        // 修复 latin1 误解码的中文文件名（multer 在 Windows 上的历史问题）
        fileName: fixMojibake(file.originalname),
        size: file.size,
        sessionId,
      },
    });
  } catch (e: any) {
    console.error('[Agent] 文件上传失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `文件上传失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/files/read — 读取当前用户上传的临时文件内容（供右栏文件查看器预览）
 *
 * Query:
 *   - filePath: 上传接口返回的绝对路径（必须是当前用户 agent_temp 目录下的文件）
 *   - source?: 'auto'（默认）| 'text' | 'base64' —— 文本类直接返回文本；图片/PDF 返回 base64
 *   - chunkIndex?: number（P0-⑨ 知识引用溯源，0-based，可选）—— 按 chunk 定位：
 *       文本类 → 返回该分段的 chunkText/totalChunks/charOffset（fixed_4000 分块，与 chunk_document 一致）；
 *       PDF → 返回 pageNumber = chunkIndex + 1（chunk 按页分块）；不传时行为完全不变。
 *
 * 安全约束：
 *   - 仅允许读取 backend/uploads/agent_temp/{userId}/ 前缀内的文件，杜绝目录穿越
 *   - 非当前用户目录 / 不存在 / 超大文件均拒绝
 *
 * 返回：{ success, data: { filePath, fileName, ext, size, kind, content?, base64?, mime, chunkIndex?, totalChunks?, chunkText?, charOffset?, pageNumber? } }
 *   - kind: 'text'（utf-8 文本/markdown/json 等）| 'image' | 'pdf' | 'binary'
 */
const MAX_PREVIEW_TEXT_BYTES = 1024 * 1024; // 文本预览上限 1MB
const MAX_PREVIEW_BASE64_BYTES = 8 * 1024 * 1024; // base64 预览上限 8MB（图片/PDF）

/**
 * P0-⑨ 知识引用溯源：fixed 策略分块（4000 字符 + 200 重叠，与 chunk_document 的 fixed_4000 一致）
 * 用于 files/read?chunkIndex=N 按 chunk 定位文本文件（返回 { text, offset }）
 */
function splitFixedChunks(text: string): Array<{ text: string; offset: number }> {
  const CHUNK_SIZE = 4000;
  const OVERLAP = 200;
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) return [{ text, offset: 0 }];
  const chunks: Array<{ text: string; offset: number }> = [];
  let start = 0;
  while (start < text.length) {
    chunks.push({ text: text.slice(start, start + CHUNK_SIZE), offset: start });
    start += CHUNK_SIZE - OVERLAP;
  }
  return chunks;
}

/**
 * P0-⑨ 知识引用溯源：解析可选 chunkIndex 查询参数（非法值返回 null 表示不启用定位）
 */
function parseChunkIndexQuery(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}

router.get('/files/read', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const filePath = (req.query.filePath as string) || '';
    if (!filePath) {
      return res.status(400).json({ success: false, message: '缺少 filePath 参数' });
    }

    const userDir = path.resolve(path.join(getUploadDir(), 'agent_temp', userId));
    // 第一重校验：参数解析后的路径必须位于当前用户 agent_temp 目录内（允许子目录如 sessionId）
    const resolvedRaw = path.resolve(filePath);
    if (resolvedRaw !== userDir && !resolvedRaw.startsWith(userDir + path.sep)) {
      return res.status(403).json({ success: false, message: '无权读取该文件' });
    }

    if (!fs.existsSync(resolvedRaw)) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }

    // 第二重校验：realpath 解析 symlink 后的真实路径也必须位于用户目录内，
    // 防止白名单目录内的符号链接指向外部文件（目录穿越变体）
    let resolved: string;
    try {
      resolved = fs.realpathSync(resolvedRaw);
    } catch {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    if (resolved !== userDir && !resolved.startsWith(userDir + path.sep)) {
      return res.status(403).json({ success: false, message: '无权读取该文件' });
    }

    if (!fs.statSync(resolved).isFile()) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }

    const stat = fs.statSync(resolved);
    const ext = path.extname(resolved).toLowerCase().replace('.', '');
    // 修复 latin1 误解码的中文文件名（multer 在 Windows 上的历史问题）
    const fileName = fixMojibake(path.basename(resolved));

    // P0-⑨ 知识引用溯源：可选 chunkIndex（0-based），按 chunk 定位返回上下文片段
    const chunkIndex = parseChunkIndexQuery(req.query.chunkIndex);

    const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'js', 'ts', 'tsx', 'jsx', 'vue', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'sh', 'py', 'sql', 'ini', 'conf', 'env']);
    const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);

    // 图片/PDF：返回 base64（前端 img 直接展示 / iframe 预览）
    if (IMAGE_EXTS.has(ext) || ext === 'pdf') {
      if (stat.size > MAX_PREVIEW_BASE64_BYTES) {
        return res.status(413).json({ success: false, message: '文件过大，无法预览' });
      }
      const base64 = fs.readFileSync(resolved).toString('base64');
      const mime = ext === 'pdf'
        ? 'application/pdf'
        : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const data: any = { filePath: resolved, fileName, ext, size: stat.size, kind: ext === 'pdf' ? 'pdf' : 'image', base64, mime };
      // PDF：chunkIndex → 页码（chunk 按页分块，0-based 转 1-based），前端 iframe #page=N 定位
      if (ext === 'pdf' && chunkIndex !== null) {
        data.pageNumber = chunkIndex + 1;
      }
      return res.json({ success: true, data });
    }

    // 文本类：返回 utf-8 文本
    if (TEXT_EXTS.has(ext)) {
      if (stat.size > MAX_PREVIEW_TEXT_BYTES) {
        return res.status(413).json({ success: false, message: '文本文件过大，仅支持预览 1MB 以内' });
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      const data: any = { filePath: resolved, fileName, ext, size: stat.size, kind: 'text', content, mime: 'text/plain' };
      // chunkIndex 定位：fixed_4000 分块，返回目标分段（content 保持全文，兼容旧调用方）
      if (chunkIndex !== null) {
        const chunks = splitFixedChunks(content);
        if (chunkIndex >= chunks.length) {
          return res.status(400).json({ success: false, message: `chunkIndex 越界：共 ${chunks.length} 个分段，请求索引 ${chunkIndex}` });
        }
        const target = chunks[chunkIndex];
        data.chunkIndex = chunkIndex;
        data.totalChunks = chunks.length;
        data.chunkText = target.text;
        data.charOffset = target.offset;
      }
      return res.json({ success: true, data });
    }

    // 2026-08-04：docx/xlsx 支持预览（前端用 mammoth/xlsx 库渲染，参考传统审查 TaskDetails 方案）
    // - docx → 返回 base64（前端 mammoth.convertToHtml 渲染）
    // - xlsx → 返回 base64（前端 xlsx 库解析渲染）
    if (ext === 'docx' || ext === 'xlsx' || ext === 'xls') {
      if (stat.size > MAX_PREVIEW_BASE64_BYTES) {
        return res.status(413).json({ success: false, message: 'Office 文件过大，仅支持预览 20MB 以内' });
      }
      const base64 = fs.readFileSync(resolved).toString('base64');
      const mime = ext === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      return res.json({
        success: true,
        data: {
          filePath: resolved, fileName, ext, size: stat.size,
          kind: ext === 'docx' ? 'docx' : 'xlsx',
          base64, mime,
        },
      });
    }

    // 其他二进制：拒绝预览（避免前端渲染乱码）
    return res.status(415).json({ success: false, message: `暂不支持预览 .${ext} 类型文件` });
  } catch (e: any) {
    console.error('[Agent] 文件读取失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `文件读取失败: ${e?.message || e}` });
  }
});

export default router;
