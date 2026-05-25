import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/db';
import { VectorService } from '../services/vector.service';
import { LlmService } from '../services/llm.service';
import { success, error } from '../utils/response';

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;

interface QAMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const normalizeHistory = (history: QAMessage[]): QAMessage[] => {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => ['user', 'assistant'].includes(item?.role))
    .map(item => ({
      role: item.role as 'user' | 'assistant',
      content: String(item.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, MAX_HISTORY_CHARS),
    }))
    .filter(item => item.content)
    .slice(-MAX_HISTORY_MESSAGES);
};

const buildSystemPrompt = () => [
  '你是核审通智能问答助手，专注于核电工程文件合规审查领域。',
  '使用与用户相同的语言回答问题。',
  '你可以基于知识库中的标准规范、法律法规和审查规则来回答问题。',
  '不要编造法规条文编号、标准名称或案例信息。',
  '如果知识库中没有足够的依据，请明确告知用户。',
  '对于技术问题，优先引用知识库中的标准规范作为依据。',
].join('\n');

/** 获取会话历史 */
export const getHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.sessionId as string;
    const messages = await prisma.qAMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    success(res, messages);
  } catch (err) {
    console.error('Get QA History Error:', err);
    error(res, '获取历史记录失败', 500);
  }
};

/** 获取用户的会话列表 */
export const listSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const sessions = await prisma.qASession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: { _count: { select: { messages: true } } },
    });
    success(res, sessions);
  } catch (err) {
    console.error('List QA Sessions Error:', err);
    error(res, '获取会话列表失败', 500);
  }
};

/** 创建新会话 */
export const createSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      error(res, '用户不存在，请重新登录', 401);
      return;
    }
    const { title, taskId } = (req.body || {}) as { title?: string; taskId?: string | null };
    const session = await prisma.qASession.create({
      data: { userId, title: title || '新对话', taskId: taskId || null },
    });
    success(res, session);
  } catch (err) {
    console.error('Create QA Session Error:', err);
    error(res, '创建会话失败', 500);
  }
};

/** 删除会话 */
export const deleteSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.sessionId as string;
    await prisma.qASession.delete({ where: { id: sessionId } });
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete QA Session Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 流式问答（SSE） */
export const askStream = async (req: AuthRequest, res: Response): Promise<void> => {
  const { question, sessionId, taskId, history = [] } = req.body;
  if (!question) { error(res, '请输入问题', 400); return; }

  const userId = req.user!.id;

  const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!userExists) {
    error(res, '用户不存在，请重新登录', 401);
    return;
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 确保会话存在
    let session = sessionId ? await prisma.qASession.findUnique({ where: { id: sessionId } }) : null;
    if (!session) {
      session = await prisma.qASession.create({
        data: { userId, title: question.slice(0, 50), taskId: taskId || null },
      });
    }

    // 保存用户消息
    await prisma.qAMessage.create({
      data: { sessionId: session.id, role: 'user', content: question },
    });

    // 更新会话标题
    if (!session.title || session.title === '新对话') {
      await prisma.qASession.update({
        where: { id: session.id },
        data: { title: question.slice(0, 50) },
      });
    }

    send('meta', { sessionId: session.id });

    // 知识库检索
    const normalizedHistory = normalizeHistory(history);
    const recentQuestions = normalizedHistory
      .filter(item => item.role === 'user')
      .slice(-3)
      .map(item => item.content)
      .join('\n');
    const searchQuery = [recentQuestions, question].filter(Boolean).join('\n');

    // 使用 SearchService 检索（支持查询优化）
    let knowledgeResults: any[] = [];
    let ragEnabled = true;

    try {
      knowledgeResults = await VectorService.hybridSearch(searchQuery, {
        limit: 8,
        rerank: true,
      });
    } catch (searchError: any) {
      console.warn(`[QnA] 知识库检索失败，降级为无RAG模式: ${searchError.message}`);
      ragEnabled = false;
      knowledgeResults = [];
    }

    send('meta', { tools: [{ name: 'knowledge_search', status: `completed:${knowledgeResults.length}${ragEnabled ? '' : ':degraded'}` }] });

    // 构建 LLM 消息
    const knowledgeContext = knowledgeResults.map((item, i) =>
      `[K${i + 1}] ${item.title || ''}${item.clause_id ? ` ${item.clause_id}` : ''}: ${item.content}`
    ).join('\n');

    const evidencePrompt = ragEnabled
      ? [
          '知识库检索结果:',
          knowledgeContext || '未检索到相关内容。',
          '',
          '请基于以上知识库内容回答用户问题。如果知识库中没有足够依据，请如实告知。',
        ].join('\n')
      : [
          '[系统提示] 当前知识库检索服务不可用，将以通用模式回答问题。',
          '',
          '请基于你的专业知识回答用户问题。如果你知道相关的标准规范或法规要求，可以引用；如果不确定，请明确说明。',
        ].join('\n');

    const llmMessages = [
      { role: 'system' as const, content: buildSystemPrompt() },
      ...normalizedHistory,
      { role: 'system' as const, content: evidencePrompt },
      { role: 'user' as const, content: question },
    ];

    // 调用 LLM 流式接口
    const config = await LlmService.getLlmConfig();
    if (!config) throw new Error('LLM 未配置');

    const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: llmMessages,
        stream: true,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok || !response.body) {
      throw new Error(`LLM API 错误: ${response.status}`);
    }

    let answer = '';
    const reader = (response.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(dataStr);
          const content = chunk.choices?.[0]?.delta?.content || '';
          if (content) {
            answer += content;
            send('delta', { content });
          }
        } catch { /* skip non-JSON lines */ }
      }
    }

    answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 保存助手消息
    await prisma.qAMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: answer },
    });

    send('done', { answer, sessionId: session.id });
    res.end();
  } catch (err: any) {
    console.error('QA Stream Error:', err);
    send('error', { error: err.message || '问答请求失败' });
    res.end();
  }
};
