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
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { AgentService } from '../services/agent/agent.service';
import { QASessionService } from '../services/agent/qa-session.service';
import { SessionStatsService } from '../services/agent/session-stats.service';
import { MemoryService } from '../services/agent/memory/memory.service';
import { SkillsService } from '../services/agent/skills/skills.service';
import { WorktreeService } from '../services/agent/worktree/worktree.service';
import { SteeringService } from '../services/agent/steering/steering.service';
import { SummaryService } from '../services/agent/summary/summary.service';
import { getUploadDir } from '../config/upload';
import { fixMojibake } from '../services/agent/tools/file/filename';
import { getTodayDir } from '../services/agent/tools/file/paths';
import { lookupCapabilities } from '../services/llm/model-capabilities.registry';
import FalsePositiveLibraryService from '../services/review/falsePositiveLibrary.service';
import prisma from '../config/db';
import { AskUserService } from '../services/agent/ask-user/ask-user.service';
import {
  submitBatchJob,
  getBatchJob,
  listBatchJobs,
  cancelBatchJob,
} from '../services/system/agent-batch-queue.service';
import type { BatchTask } from '../services/agent/tools/batch/batch_process';

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

    // Task 25：每用户单会话限制 — 新会话开始时自动结束旧会话（真实约束）
    // P0 #1 修复：改为调用 QASessionService.completeActiveSessions（service 内按 status 过滤）
    // 2026-08-04 修复：无 sessionId 时必须创建新会话并返回 sessionId，
    //   否则 chatStream 不会持久化消息、前端拿不到会话 id（单活跃会话死循环）
    let sessionId: string = req.body?.sessionId || '';
    const isNewSession = !sessionId;
    if (isNewSession) {
      const closedCount = await QASessionService.completeActiveSessions(userId);
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
    }

    const result = await AgentService.chatStream({
      messages,
      userId,
      sessionId,
      modelKey: req.body?.modelKey || undefined,
      toolPreset: req.body?.toolPreset || undefined,
      toolNames: Array.isArray(req.body?.toolNames) ? req.body.toolNames : undefined,
      thinkingLevel: req.body?.thinkingLevel || undefined,
      pendingAskAnswer: req.body?.pendingAskAnswer || null,
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
    // 注意：不能在这里注入自定义 `data:` 首帧（如 session-init）。
    // AI SDK 前端（@ai-sdk/vue useChat）的 processUIMessageStream 只认识标准
    // UIMessageStream 事件，未知类型会被原样 enqueue 导致流解析失败、请求中止，
    // assistant 消息不渲染。前端 sessionId 由 useAgentChat 用 crypto.randomUUID()
    // 自行生成并随请求体传入，无需后端回传。
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
    // 降级重试。P0 #1（接通纸面能力）：先降级到 AgentService.chatWithGenerateText()
    // （非流式但保留工具调用循环，generateText 兜底），再失败才降级到纯文本 LlmService.chat()。
    if (!res.headersSent) {
      try {
        const sessionId: string = req.body?.sessionId || '';
        const messages: any[] = req.body?.messages || [];

        let fallbackText = '';
        let fallbackMode = '';

        // 第一级兜底：chatWithGenerateText（保留工具调用能力，能处理上传文件/检索/规则）
        try {
          const { AgentService } = require('../services/agent/agent.service');
          // catch 块内 try 无法访问外层 try 的 userId（块级作用域），重新取
          const uid = (req as any).user?.id || '';
          const generateResult = await AgentService.chatWithGenerateText({ messages, userId: uid, sessionId });
          // generateText result 的 text 字段为最终文本
          fallbackText = typeof generateResult?.text === 'string' ? generateResult.text : '';
          fallbackMode = 'generateText';
          console.warn(`[Agent:Fallback] 降级到 chatWithGenerateText()，sessionId=${sessionId || 'none'}`);
        } catch (genErr: any) {
          console.error('[Agent:Fallback] generateText 兜底失败，继续降级到 LlmService.chat():', (genErr as Error)?.message || genErr);
        }

        // 第二级兜底：纯文本 LlmService.chat()（generateText 也失败时）
        if (!fallbackText) {
          // 从 messages 提取最后一条用户消息作为 prompt
          const lastUserMsg = [...messages].reverse().find((m: any) => m?.role === 'user');
          const userText = lastUserMsg
            ? (Array.isArray(lastUserMsg.parts)
              ? lastUserMsg.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
              : typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
            : '';

          if (!userText) {
            throw new Error('无法从 messages 提取用户消息');
          }

          // 调非流式 LLM
          const { LlmService } = require('../services/llm/llm.service');
          fallbackText = await LlmService.chat(userText, {
            systemPrompt: '你是文件合规审查助手。由于流式调用失败，请直接基于用户消息回复（无法调用工具）。',
            mode: 'agent',
            traceId: sessionId || undefined,
          });
          fallbackMode = 'LlmService.chat';
        }

        // 把降级结果包成 UIMessageStream 格式（前端 useChat 能正常消费）
        // 注意：createUIMessageStream 返回裸 ReadableStream（UI message chunk 流），
        // 不能用 toUIMessageStreamResponse（那只存在于 streamText 的 result 上）。
        // 用 ai 包官方 pipeUIMessageStreamToResponse 直接把流写到 Express res（处理 SSE headers + 编码）。
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

        // Task 21.3：降级事件记入后端日志（AgentTrace 链路已移除，2026-08-03）
        if (sessionId) {
          console.warn(`[Agent:Fallback] LLM 流式失败降级: sessionId=${sessionId} reason=${(e as Error)?.message || e} mode=${fallbackMode} fallbackLen=${fallbackText.length}`);
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const filePath = (req.query.filePath as string) || '';
    if (!filePath) {
      return res.status(400).json({ success: false, message: '缺少 filePath 参数' });
    }

    const resolved = path.resolve(filePath);
    const userDir = path.resolve(path.join(getUploadDir(), 'agent_temp', userId));
    // 必须位于当前用户 agent_temp 目录内（允许子目录如 sessionId）
    if (resolved !== userDir && !resolved.startsWith(userDir + path.sep)) {
      return res.status(403).json({ success: false, message: '无权读取该文件' });
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
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
 * POST /api/agent/sessions/:sessionId/duplicate — 复制会话（简化版分支）
 *
 * 复制源会话全部消息到新会话（title 加「（副本）」后缀，status=active，
 * modelKey/toolPreset/thinkingLevel 原值保留），用于多方案并行对比。
 *
 * 返回：{ success, data: SessionDetail }
 */
router.post('/sessions/:sessionId/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });

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
 * 从 system_configs.llm_profiles 展平所有 provider 的模型（不含系统默认条目，
 * 模型列表只来自用户配置；默认选中由前端取第一个模型）。
 *
 * 返回：{ success, data: { defaultKey: string|null, models: AgentModelOption[] } }
 *   AgentModelOption: { key, label, provider, modelId, name, vision }
 *   key 格式：<providerId>::<modelName>
 *   provider/modelId/name 为结构化字段（对齐参考 pi-web modelList: { id, name, provider }[]）
 *   vision 表示该模型配置时勾选了视觉能力（capabilities.inputModalities 含 image）
 */
router.get('/models', async (req: AuthRequest, res: Response) => {
  try {
    const models: Array<{ key: string | null; label: string; provider: string; modelId: string; name: string; vision: boolean }> = [];

    const profilesCfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
    if (profilesCfg?.value) {
      const raw = typeof profilesCfg.value === 'string' ? JSON.parse(profilesCfg.value) : profilesCfg.value;
      const profiles = Array.isArray(raw) ? raw : [];
      for (const p of profiles) {
        if (p?.id && p?.model) {
          // provider 分组用 p.name（真实供应商名，如 CNPE），而不是 p.id（随机串）。
          // llm_profiles 是「一 provider 一 model」扁平结构，同一供应商的多模型 name 相同，
          // 按 name 分组才能在对话下拉里归成一组（对齐 pi-web providers->models 两级视图）。
          const providerName = p.name || p.id;
          const inputModalities: string[] = Array.isArray(p?.capabilities?.inputModalities)
            ? p.capabilities.inputModalities
            : [];
          const vision = inputModalities.includes('image') || inputModalities.includes('images');
          models.push({
            key: `${p.id}::${p.model}`,
            label: `${providerName} · ${p.model}`,
            provider: providerName,
            modelId: p.model,
            name: p.model,
            vision,
          });
        }
      }
    }

    // P2-㉑ 模型范围 scopedModels：?scope=a*,b* 用 minimatch glob 过滤可见模型
    const scopeRaw = req.query.scope;
    if (typeof scopeRaw === 'string' && scopeRaw.trim()) {
      const patterns = scopeRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (patterns.length > 0) {
        const { minimatch } = require('minimatch');
        const filtered = models.filter(m => {
          const target = m.key || m.label;
          return patterns.some(p => minimatch(target, p, { nocase: true }));
        });
        return res.json({ success: true, data: { defaultKey: null, models: filtered } });
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
 * 仅管理员可读（含 apiKey 敏感信息）
 */
router.get('/providers', requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    
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
 * 仅管理员可写
 */
router.put('/providers', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { profiles } = req.body || {};
    if (!Array.isArray(profiles)) {
      return res.status(400).json({ success: false, message: 'profiles 必须为数组' });
    }
    
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
 * 仅管理员可调
 */
router.post('/models/test', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
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

// ===== Provider 模型发现与目录填充（参考项目 pi 的 discover/catalog 能力适配）=====

/** 判断 API Key 是否为脱敏值（系统脱敏格式：前4后4中间 ****） */
function isMaskedApiKey(key: string): boolean {
  return key.includes('***');
}

/**
 * 构建模型列表接口 URL（适配 OpenAI 兼容 / Anthropic / Google 三种协议）
 * 参考 pi-web model-discovery.ts buildModelsListUrl
 */
function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === 'anthropic-messages' && !/\/v\d+(?:beta)?$/i.test(path)) path += '/v1';
    if (api === 'google-generative-ai' && !/\/v\d+(?:beta)?$/i.test(path)) path += '/v1beta';
    url.pathname = `${path}/models`.replace(/\/+/g, '/');
  }
  return url;
}

/** 解析 /models 上游响应为模型列表（兼容 string[] / {id,model,name}[] / data/models/results/items 包裹）
 *  同时解析能力信息（capabilities.contextWindow/maxOutput/reasoning/inputModalities），
 *  供前端添加模型时自动回填上下文窗口 / 最大输出 / 推理 / 图片输入。 */
function parseDiscoveredModels(value: any): Array<{
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  inputModalities?: string[];
}> {
  const seen = new Set<string>();
  const models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    inputModalities?: string[];
  }> = [];
  const list = Array.isArray(value)
    ? value
    : (value?.data ?? value?.models ?? value?.results ?? value?.items ?? []);
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.id ?? item.model ?? item.name ?? '').trim();
    if (!rawId) continue;
    const id = rawId.startsWith('models/') ? rawId.slice('models/'.length) : rawId;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = String(item.display_name ?? item.displayName ?? '').trim() || undefined;
    // 能力解析：兼容 cbcn 网关 capabilities 字段与 OpenRouter/vLLM 的 context_length/max_model_len
    const c = item.capabilities || {};
    const contextWindow = Number(c.contextWindow ?? item.context_length ?? item.max_model_len ?? 0) || undefined;
    const maxTokens = Number(c.maxOutput ?? c.max_output_tokens ?? item.max_completion_tokens ?? 0) || undefined;
    const reasoning = c.reasoning === true ? true : undefined;
    const inputModalities = Array.isArray(c.inputModalities) && c.inputModalities.length
      ? c.inputModalities
      : undefined;

    const m: {
      id: string;
      name?: string;
      contextWindow?: number;
      maxTokens?: number;
      reasoning?: boolean;
      inputModalities?: string[];
    } = { id };
    if (name && name !== id) m.name = name;
    if (contextWindow) m.contextWindow = contextWindow;
    if (maxTokens) m.maxTokens = maxTokens;
    if (reasoning) m.reasoning = true;
    if (inputModalities) m.inputModalities = inputModalities;
    models.push(m);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}

/**
 * POST /api/agent/providers/discover — 从 Provider 的 /models 接口拉取模型列表
 * Body: { providerName, provider: { baseUrl, api, apiKey } }
 * apiKey 为空或为脱敏值时，从 llm_profiles 按 providerName 匹配真实凭证。
 * 仅管理员可调
 */
router.post('/providers/discover', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { providerName, provider } = req.body || {};
    if (!providerName || typeof providerName !== 'string') {
      return res.status(400).json({ success: false, message: 'providerName 必填' });
    }
    if (!provider || typeof provider !== 'object') {
      return res.status(400).json({ success: false, message: 'provider 必填' });
    }

    const baseUrl = String(provider.baseUrl || '').trim();
    if (!baseUrl) {
      return res.status(400).json({ success: false, message: 'Base URL 必填' });
    }
    const api = String(provider.api || 'openai-completions');
    let apiKey = String(provider.apiKey || '').trim();

    // 脱敏/空 key 时从 llm_profiles 匹配真实凭证
    if (!apiKey || isMaskedApiKey(apiKey)) {
      
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'llm_profiles' } });
      if (cfg?.value) {
        const raw = typeof cfg.value === 'string' ? JSON.parse(cfg.value) : cfg.value;
        const profiles = Array.isArray(raw) ? raw : [];
        const matched = profiles.find((p: any) => (p.name || p.id) === providerName);
        if (matched?.apiKey) apiKey = String(matched.apiKey);
      }
    }

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return res.status(400).json({ success: false, message: 'Base URL 无效' });
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) {
      if (api === 'anthropic-messages') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (api === 'google-generative-ai') {
        headers['x-goog-api-key'] = apiKey;
      } else if (!headers['Authorization']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    // 显式用全局 fetch 响应类型，避免与 express 的 Response 冲突
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(endpoint, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = (await response.text()).slice(0, 500);
      return res.status(502).json({
        success: false,
        message: errText || `上游返回 HTTP ${response.status}`,
      });
    }

    const payload = await response.json();
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return res.status(502).json({ success: false, message: '上游响应中没有可用模型' });
    }

    return res.json({ success: true, data: { models, endpoint: endpoint.toString() } });
  } catch (e: any) {
    console.error('[Agent] 模型发现失败:', e?.message || e);
    const message = e?.name === 'AbortError' ? '拉取模型列表超时（20s）' : (e?.message || '拉取失败');
    return res.status(500).json({ success: false, message });
  }
});

/**
 * POST /api/agent/providers/catalog — 本地模型目录填充（替代参考项目的 models.dev）
 * Body: { model }
 * 用本地预置能力库 lookupCapabilities 返回模型元数据建议，供前端回填空字段。
 * 仅管理员可调
 */
router.post('/providers/catalog', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { model } = req.body || {};
    const modelName = String(model || '').trim();
    if (!modelName) {
      return res.status(400).json({ success: false, message: 'model 必填' });
    }
    const caps = lookupCapabilities(modelName);
    if (!caps) {
      return res.json({
        success: true,
        data: { matched: false, recommendation: null },
      });
    }
    return res.json({
      success: true,
      data: {
        matched: true,
        recommendation: {
          name: modelName,
          reasoning: /reasoner|thinking|r1|o1|o3/i.test(modelName) || undefined,
          input: caps.inputModalities,
          contextWindow: caps.contextWindowTokens || undefined,
          maxTokens: caps.maxOutputTokens || undefined,
        },
      },
    });
  } catch (e: any) {
    console.error('[Agent] 目录填充失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `目录填充失败: ${e?.message || e}` });
  }
});

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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    const { type, title, content, sourceSessionId, sourceMessageId } = req.body || {};
    if (!title || typeof title !== 'string' || !content || typeof content !== 'string') {
      return res.status(400).json({ success: false, message: 'title 和 content 必填' });
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    
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

// ===== 文件树/目录浏览（任务 8）=====

/**
 * 目录白名单（AGENT_ALLOWED_DIRS，逗号分隔的绝对路径，支持 ~ 展开主目录）
 * 未配置时回退到 backend/uploads/agent_temp/{userId}（当前用户临时目录）
 */
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.venv', 'venv', 'env',
  'dist', 'build', 'out', 'coverage', '.cache', '__pycache__', '.idea', '.vscode',
]);

/** 解析 AGENT_ALLOWED_DIRS 环境变量为规范化绝对路径数组 */
function getAllowedDirRoots(userId: string): string[] {
  const raw = process.env.AGENT_ALLOWED_DIRS;
  const list: string[] = [];
  if (raw && raw.trim()) {
    for (const item of raw.split(',')) {
      const t = item.trim();
      if (!t) continue;
      const expanded = t.startsWith('~/')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', t.slice(2))
        : t;
      list.push(path.resolve(expanded));
    }
  }
  // 回退：当前用户 agent_temp 目录
  if (list.length === 0) {
    list.push(path.resolve(path.join(getUploadDir(), 'agent_temp', userId)));
  }
  return list;
}

/** 判断路径是否在某个允许根目录内（严格前缀 + path.sep，防路径穿越） */
function isWithinAllowedRoot(resolvedPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return resolvedPath === normalizedRoot || resolvedPath.startsWith(normalizedRoot + path.sep);
  });
}

/**
 * GET /api/agent/directories/browse — 浏览授权目录（受白名单约束）
 *
 * Query:
 *   - path?: string — 要列出的目录绝对路径；缺省返回白名单根目录列表
 *
 * 返回：{ success, data: { roots: [...], root: string|null, entries: [...] } }
 *   - roots: 白名单根目录列表（[{ name, path }]）
 *   - root: 当前浏览的根目录路径（path 缺省时为 null）
 *   - entries: 目录条目列表（[{ name, path, type: 'dir'|'file', size, mtime }]）
 *
 * 安全约束：
 *   - path 必须位于某个允许根目录内（AGENT_ALLOWED_DIRS 或 agent_temp/{userId}）
 *   - 忽略 node_modules/.git/.next 等目录
 *   - 目录不存在/越权返回 404/403
 */
router.get('/directories/browse', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });

    const roots = getAllowedDirRoots(userId);
    // 缺省 path → 返回白名单根目录列表
    const rawPath = (req.query.path as string) || '';
    if (!rawPath) {
      const rootEntries = roots.map((root) => ({
        name: path.basename(root) || root,
        path: root,
      }));
      return res.json({ success: true, data: { roots: rootEntries, root: null, entries: [] } });
    }

    const resolved = path.resolve(rawPath);
    // 越权校验：必须在某个允许根目录内
    if (!isWithinAllowedRoot(resolved, roots)) {
      return res.status(403).json({ success: false, message: '无权浏览该目录（不在白名单内）' });
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(404).json({ success: false, message: '目录不存在' });
    }

    let names: string[] = [];
    try {
      names = fs.readdirSync(resolved);
    } catch (e: any) {
      return res.status(500).json({ success: false, message: `读取目录失败: ${e?.message || e}` });
    }

    // 排序：目录在前，文件在后，各自按名称字母序
    const entries: Array<{ name: string; path: string; type: 'dir' | 'file'; size: number; mtime: string }> = [];
    for (const name of names) {
      const full = path.join(resolved, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // 单个条目 stat 失败（如权限）跳过
      }
      if (stat.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(name)) continue; // 忽略 node_modules/.git 等
        entries.push({ name, path: full, type: 'dir', size: 0, mtime: stat.mtime.toISOString() });
      } else if (stat.isFile()) {
        entries.push({ name, path: full, type: 'file', size: stat.size, mtime: stat.mtime.toISOString() });
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

    return res.json({
      success: true,
      data: {
        roots: roots.map((root) => ({ name: path.basename(root) || root, path: root })),
        root: resolved,
        entries,
      },
    });
  } catch (e: any) {
    console.error('[Agent] 目录浏览失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `目录浏览失败: ${e?.message || e}` });
  }
});

// ===== 批量文档处理（P1-② 异步化）=====

const BATCH_TASKS: BatchTask[] = ['extract', 'chunk', 'summarize', 'review', 'knowledge'];

/**
 * POST /api/agent/batch — 提交批量文档处理任务（异步）
 *
 * Body: { files: [{ filePath, tasks: string[] }] }
 *   - filePath 必须是已上传到 agent_temp 的绝对路径（upload_file 返回值）
 *   - tasks ∈ { extract, chunk, summarize, review, knowledge }
 *
 * 返回：{ success, data: { id, status } } —— 客户端用 GET /batch/:id 轮询结果
 */
router.post('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });

    const files = (req.body || {}).files;
    if (!Array.isArray(files) || files.length === 0 || files.length > 10) {
      return res.status(400).json({ success: false, message: 'files 必须是 1-10 个文件数组' });
    }
    for (const f of files) {
      if (!f || typeof f.filePath !== 'string' || !Array.isArray(f.tasks) || f.tasks.length === 0) {
        return res.status(400).json({ success: false, message: '每个文件必须包含 filePath 和 tasks' });
      }
      for (const t of f.tasks) {
        if (!BATCH_TASKS.includes(t)) {
          return res.status(400).json({ success: false, message: `不支持的子任务: ${t}（可选 ${BATCH_TASKS.join('/')}）` });
        }
      }
    }

    const data = await submitBatchJob(userId, files as Array<{ filePath: string; tasks: BatchTask[] }>);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error('[Agent] 提交批量任务失败:', e?.message || e);
    if (/does not exist|relation/i.test(e?.message || '')) {
      return res.status(500).json({ success: false, message: 'agent_batch_jobs 表未创建，请先执行 prisma db push' });
    }
    return res.status(500).json({ success: false, message: `提交批量任务失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/batch/:jobId — 查询批量任务状态/结果
 */
router.get('/batch/:jobId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    const record = await getBatchJob(String(req.params.jobId), userId);
    if (!record) return res.status(404).json({ success: false, message: '批次不存在' });
    return res.json({ success: true, data: record });
  } catch (e: any) {
    console.error('[Agent] 查询批量任务失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `查询批量任务失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/batch — 批量任务列表
 *
 * Query: page / pageSize
 */
router.get('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const data = await listBatchJobs(userId, page, pageSize);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error('[Agent] 批量任务列表失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `批量任务列表失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/batch/:jobId/cancel — 取消批量任务
 */
router.post('/batch/:jobId/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '未认证' });
    const ok = await cancelBatchJob(String(req.params.jobId), userId);
    if (!ok) return res.status(404).json({ success: false, message: '批次不存在' });
    return res.json({ success: true, data: { cancelled: true } });
  } catch (e: any) {
    console.error('[Agent] 取消批量任务失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `取消批量任务失败: ${e?.message || e}` });
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
    const sid = String(req.params.id || '');
    const ask = AskUserService.getPending(sid);
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
