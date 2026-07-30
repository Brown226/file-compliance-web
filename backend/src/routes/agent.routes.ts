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
import { TraceService } from '../services/agent/trace/trace.service';
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

    // sessionId 可选：未提供时传空串，AgentService 内部仍可工作（工具临时文件按 userId 隔离）
    const sessionId: string = req.body?.sessionId || '';

    const result = await AgentService.chatStream({ messages, userId, sessionId });

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
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: `流式调用失败: ${e?.message || e}` });
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

/**
 * GET /api/agent/traces/:sessionId — 查询会话的 Agent 执行追踪列表
 *
 * Task 13.3：返回该会话所有工具调用的 trace（按 stepIndex 排序），
 * 供前端调试面板展示 Agent 的决策过程。
 *
 * 权限：只能查自己的会话（TraceService.listTraces 内部校验 userId）
 *
 * 返回：{ success, data: TraceItem[] }
 */
router.get('/traces/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId 不能为空' });
    }

    const traces = await TraceService.listTraces(sessionId, userId);
    return res.json({ success: true, data: traces });
  } catch (e: any) {
    // 会话不存在或无权访问时返回 404
    if (e?.message?.includes('不存在或无权访问')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[Agent] 查询 trace 列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/traces/trace/:traceId — 查询单条 trace + 关联的 LlmCallLog
 *
 * Task 13.4：通过 traceId 关联 LlmCallLog，展示工具调用对应的 LLM 调用详情
 * （token 用量 / 耗时 / 模型 / 状态）。
 *
 * 返回：{ success, data: TraceWithLlmCallLog }
 */
router.get('/traces/trace/:traceId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const traceId = String(req.params.traceId || '');
    if (!traceId) {
      return res.status(400).json({ success: false, message: 'traceId 不能为空' });
    }

    const trace = await TraceService.getTraceWithLlmCallLog(traceId);
    if (!trace) {
      return res.status(404).json({ success: false, message: 'trace 不存在' });
    }

    return res.json({ success: true, data: trace });
  } catch (e: any) {
    console.error('[Agent] 查询 trace 详情失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询失败: ${e?.message || e}` });
  }
});

export default router;
