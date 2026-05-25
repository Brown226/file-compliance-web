import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { LangChainSearchService } from '../services/langchain/langchain-search.service';
import { LangChainRAGService } from '../services/langchain/langchain-rag.service';
import { SearchMode } from '../services/langchain/langchain-retriever';
import { success, error } from '../utils/response';
import prisma from '../config/db';

export const langchainSearch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { query, categoryId, sourceTypes, limit, enableMultiQuery, enableHyDE, minSimilarity, searchMode } = req.body;

    if (!query) {
      error(res, '请输入查询内容', 400);
      return;
    }

    const results = await LangChainSearchService.search(query, {
      limit: limit ?? 5,
      categoryId,
      sourceTypes,
      enableMultiQuery: enableMultiQuery ?? false,
      enableHyDE: enableHyDE ?? false,
      minSimilarity: minSimilarity ?? 0.3,
      searchMode: (searchMode as SearchMode) ?? 'hybrid',
    });

    success(res, results);
  } catch (err: any) {
    console.error('[LangChain] 搜索失败:', err);
    error(res, err.message || '搜索失败', 500);
  }
};

export const langchainHitTest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { query, categoryId, sourceTypes, topNumber, enableMultiQuery, enableHyDE, searchMode } = req.body;

    if (!query) {
      error(res, '请输入查询内容', 400);
      return;
    }

    const result = await LangChainSearchService.hitTest({
      query,
      categoryId,
      sourceTypes,
      topNumber: topNumber ?? 10,
      enableMultiQuery: enableMultiQuery ?? true,
      enableHyDE: enableHyDE ?? true,
      searchMode: (searchMode as SearchMode) ?? 'hybrid',
    });

    success(res, result);
  } catch (err: any) {
    console.error('[LangChain] 命中测试失败:', err);
    error(res, err.message || '命中测试失败', 500);
  }
};

export const langchainAskQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { question, categoryIds, history, topK, enableMultiQuery, enableHyDE, enableCompression } = req.body;

    if (!question) {
      error(res, '请输入问题', 400);
      return;
    }

    if (!categoryIds || categoryIds.length === 0) {
      error(res, '请选择知识库', 400);
      return;
    }

    const result = await LangChainRAGService.askQuestion(question, categoryIds, history, {
      topK: topK ?? 8,
      enableMultiQuery: enableMultiQuery ?? true,
      enableHyDE: enableHyDE ?? true,
      enableCompression: enableCompression ?? true,
    });

    success(res, result);
  } catch (err: any) {
    console.error('[LangChain] 问答失败:', err);
    error(res, err.message || '问答失败', 500);
  }
};

export const langchainAskStream = async (req: AuthRequest, res: Response): Promise<void> => {
  const { question, categoryIds, sessionId: providedSessionId, history = [], topK, enableMultiQuery, enableHyDE, enableCompression } = req.body
  const userId = req.user!.id

  if (!question) { error(res, '请输入问题', 400); return }
  if (!categoryIds || categoryIds.length === 0) { error(res, '请选择知识库', 400); return }

  // 验证用户存在
  const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!userExists) { error(res, '用户不存在，请重新登录', 401); return }

  const response = res as any
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders?.()

  const send = (event: string, data: any) => {
    response.write(`event: ${event}\n`)
    response.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // 确定或创建会话
    let actualSessionId = providedSessionId
    if (actualSessionId) {
      const session = await prisma.qASession.findFirst({ where: { id: actualSessionId, userId } })
      if (!session) {
        send('error', { error: '会话不存在或无权访问' })
        response.end()
        return
      }
    } else {
      const newSession = await prisma.qASession.create({
        data: { userId, title: question.slice(0, 50) },
      })
      actualSessionId = newSession.id
    }

    // 保存用户消息
    const userMessage = await prisma.qAMessage.create({
      data: { sessionId: actualSessionId, role: 'user', content: question, status: 'completed' },
    })

    // 创建助手消息占位
    const assistantMessage = await prisma.qAMessage.create({
      data: { sessionId: actualSessionId, role: 'assistant', content: '', status: 'processing' },
    })

    // 更新会话时间
    await prisma.qASession.update({ where: { id: actualSessionId }, data: { updatedAt: new Date() } })

    // 发送元数据事件，让前端获取 ID
    send('meta', {
      sessionId: actualSessionId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    })

    send('status', { message: '正在检索知识库...' })

    const searchResult = await LangChainRAGService.askQuestion(question, categoryIds, history, {
      topK: topK ?? 8,
      enableMultiQuery: enableMultiQuery ?? true,
      enableHyDE: enableHyDE ?? true,
      enableCompression: enableCompression ?? true,
    })

    send('sources', { sources: searchResult.sources, debug: searchResult.debug });

    const { LlmService } = require('../services/llm.service');
    const config = await LlmService.getLlmConfig();
    if (!config) throw new Error('LLM 未配置');

    const systemPrompt = [
      '你是核审通智能问答助手，专注于核电工程文件合规审查领域。',
      '使用与用户相同的语言回答问题。',
      '不要编造法规条文编号、标准名称或案例信息。',
      '如果知识库中没有足够的依据，请明确告知用户。',
    ].join('\n');

    const knowledgeContext = LangChainRAGService.formatContext(
      searchResult.sources.map(s => ({
        pageContent: s.content,
        metadata: { title: s.document_name, score: s.similarity },
      }))
    );

    const evidencePrompt = searchResult.sources.length > 0
      ? `知识库检索结果:\n${knowledgeContext}\n\n请基于以上知识库内容回答用户问题。`
      : '未检索到相关内容，请基于你的专业知识回答。';

    const llmMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const normalizedHistory = (Array.isArray(history) ? history : [])
      .filter((item: any) => ['user', 'assistant'].includes(item?.role))
      .map((item: any) => ({ role: item.role, content: String(item.content || '').trim() }))
      .filter((item: any) => item.content)
      .slice(-12);

    for (const h of normalizedHistory) {
      llmMessages.push({ role: h.role, content: h.content });
    }

    llmMessages.push({ role: 'system', content: evidencePrompt });
    llmMessages.push({ role: 'user', content: question });

    const llmResponse = await fetch(`${config.apiBaseUrl}/chat/completions`, {
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

    if (!llmResponse.ok || !llmResponse.body) {
      throw new Error(`LLM API 错误: ${llmResponse.status}`);
    }

    let answer = '';
    const reader = (llmResponse.body as any).getReader();
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
        } catch { /* skip */ }
      }
    }

    answer = answer.replace(/<think[\s\S]*?<\/think>/g, '').trim();

    // 持久化完成结果到数据库
    await prisma.qAMessage.update({
      where: { id: assistantMessage.id },
      data: {
        content: answer || '暂未返回有效回答，请稍后重试。',
        status: 'completed',
        sources: (searchResult.sources || []) as any,
        debug: (searchResult.debug || {}) as any,
      },
    });

    console.log(`[LangChain] 流式问答完成并持久化: session=${actualSessionId}, msg=${assistantMessage.id}`);

    send('done', { answer, sessionId: actualSessionId });
    response.end();
  } catch (err: any) {
    console.error('[LangChain] 流式问答失败:', err);
    send('error', { error: err.message || '问答请求失败' });
    response.end();
  }
};

export const langchainReviewWithKnowledge = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { text, categoryIds, chunkSize, topK, llmMaxTokens, llmTimeout, scene, enableMultiQuery, enableHyDE, enableCompression } = req.body;

    if (!text) {
      error(res, '请输入待审查文本', 400);
      return;
    }

    if (!categoryIds || categoryIds.length === 0) {
      error(res, '请选择知识库', 400);
      return;
    }

    const result = await LangChainRAGService.reviewWithKnowledge(text, categoryIds, {
      chunkSize,
      topK,
      llmMaxTokens,
      llmTimeout,
      scene,
      enableMultiQuery: enableMultiQuery ?? true,
      enableHyDE: enableHyDE ?? true,
      enableCompression: enableCompression ?? true,
    });

    success(res, result);
  } catch (err: any) {
    console.error('[LangChain] RAG 审查失败:', err);
    error(res, err.message || 'RAG 审查失败', 500);
  }
};

// 后台问答任务处理
const processQuestionInBackground = async (
  messageId: string,
  question: string,
  categoryIds: string[],
  history: Array<{ role: string; content: string }>,
  options: { topK?: number; enableMultiQuery?: boolean; enableHyDE?: boolean; enableCompression?: boolean }
) => {
  try {
    // 更新消息状态为处理中
    await prisma.qAMessage.update({
      where: { id: messageId },
      data: { status: 'processing' },
    });

    // 检索知识库
    const searchResult = await LangChainRAGService.askQuestion(question, categoryIds, history, {
      topK: options.topK ?? 8,
      enableMultiQuery: options.enableMultiQuery ?? true,
      enableHyDE: options.enableHyDE ?? true,
      enableCompression: options.enableCompression ?? true,
    });

    // 更新消息内容和来源
    await prisma.qAMessage.update({
      where: { id: messageId },
      data: {
        content: searchResult.answer || '暂未返回有效回答，请稍后重试。',
        status: 'completed',
        sources: (searchResult.sources || []) as any,
        debug: (searchResult.debug || {}) as any,
      },
    });

    console.log(`[LangChain] 后台问答完成: ${messageId}`);
  } catch (err: any) {
    console.error(`[LangChain] 后台问答失败: ${messageId}`, err);
    await prisma.qAMessage.update({
      where: { id: messageId },
      data: {
        content: '抱歉，问答请求失败。请检查知识库选择和网络连接后重试。',
        status: 'failed',
      },
    });
  }
};

// 后台问答 API（立即返回，后台处理）
export const langchainAskBackground = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { question, categoryIds, sessionId, history = [], topK, enableMultiQuery, enableHyDE, enableCompression } = req.body;

    if (!question) {
      error(res, '请输入问题', 400);
      return;
    }

    if (!categoryIds || categoryIds.length === 0) {
      error(res, '请选择知识库', 400);
      return;
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      error(res, '用户不存在，请重新登录', 401);
      return;
    }

    // 确定会话 ID
    let actualSessionId = sessionId;
    if (actualSessionId) {
      // 验证会话是否属于当前用户
      const session = await prisma.qASession.findFirst({
        where: { id: actualSessionId, userId },
      });
      if (!session) {
        error(res, '会话不存在或无权访问', 403);
        return;
      }
    } else {
      const newSession = await prisma.qASession.create({
        data: {
          userId,
          title: question.slice(0, 50),
        },
      });
      actualSessionId = newSession.id;
    }

    // 保存用户消息
    const userMessage = await prisma.qAMessage.create({
      data: {
        sessionId: actualSessionId,
        role: 'user',
        content: question,
      },
    });

    // 创建助手消息
    const assistantMessage = await prisma.qAMessage.create({
      data: {
        sessionId: actualSessionId,
        role: 'assistant',
        content: '',
      },
    });

    // 更新会话时间
    await prisma.qASession.update({
      where: { id: actualSessionId },
      data: { updatedAt: new Date() },
    });

    // 启动后台任务（不等待完成）
    processQuestionInBackground(
      assistantMessage.id,
      question,
      categoryIds,
      history,
      { topK, enableMultiQuery, enableHyDE, enableCompression }
    );

    // 立即返回
    success(res, {
      sessionId: actualSessionId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    });
  } catch (err: any) {
    console.error('[LangChain] 后台问答启动失败:', err);
    error(res, err.message || '后台问答启动失败', 500);
  }
};

// 获取消息状态（轮询）
export const getMessageStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { messageId } = req.params;

    const message = await prisma.qAMessage.findFirst({
      where: {
        id: messageId as string,
        session: { userId },
      },
      select: {
        id: true,
        content: true,
        status: true,
        sources: true,
        debug: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!message) {
      error(res, '消息不存在', 404);
      return;
    }

    success(res, message);
  } catch (err: any) {
    console.error('[LangChain] 获取消息状态失败:', err);
    error(res, err.message || '获取消息状态失败', 500);
  }
};

// 批量获取消息状态
export const getMessagesStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds)) {
      error(res, '请提供消息 ID 列表', 400);
      return;
    }

    const messages = await prisma.qAMessage.findMany({
      where: {
        id: { in: messageIds },
        session: { userId },
      },
      select: {
        id: true,
        content: true,
        status: true,
        sources: true,
        debug: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    success(res, messages);
  } catch (err: any) {
    console.error('[LangChain] 批量获取消息状态失败:', err);
    error(res, err.message || '批量获取消息状态失败', 500);
  }
};

// 对话记录管理 API

// 获取用户的对话列表
export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const conversations = await prisma.qASession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    success(res, conversations.map(c => ({
      id: c.id,
      title: c.title || '新对话',
      messageCount: c._count.messages,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })));
  } catch (err: any) {
    console.error('[LangChain] 获取对话列表失败:', err);
    error(res, err.message || '获取对话列表失败', 500);
  }
};

// 获取对话详情（包含消息）
export const getConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const conversation = await prisma.qASession.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      error(res, '对话不存在', 404);
      return;
    }

    success(res, conversation);
  } catch (err: any) {
    console.error('[LangChain] 获取对话详情失败:', err);
    error(res, err.message || '获取对话详情失败', 500);
  }
};

// 创建新对话
export const createConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { title } = req.body;

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      error(res, '用户不存在，请重新登录', 401);
      return;
    }

    const conversation = await prisma.qASession.create({
      data: {
        userId,
        title: title || '新对话',
      },
    });

    success(res, conversation);
  } catch (err: any) {
    console.error('[LangChain] 创建对话失败:', err);
    error(res, err.message || '创建对话失败', 500);
  }
};

// 更新对话标题
export const updateConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { title } = req.body;

    const conversation = await prisma.qASession.findFirst({
      where: { id, userId },
    });

    if (!conversation) {
      error(res, '对话不存在', 404);
      return;
    }

    const updated = await prisma.qASession.update({
      where: { id },
      data: { title },
    });

    success(res, updated);
  } catch (err: any) {
    console.error('[LangChain] 更新对话失败:', err);
    error(res, err.message || '更新对话失败', 500);
  }
};

// 删除对话
export const deleteConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const conversation = await prisma.qASession.findFirst({
      where: { id, userId },
    });

    if (!conversation) {
      error(res, '对话不存在', 404);
      return;
    }

    await prisma.qASession.delete({
      where: { id },
    });

    success(res, { message: '删除成功' });
  } catch (err: any) {
    console.error('[LangChain] 删除对话失败:', err);
    error(res, err.message || '删除对话失败', 500);
  }
};

// 保存消息到对话
export const saveMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.sessionId as string;
    const { role, content } = req.body;

    const conversation = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!conversation) {
      error(res, '对话不存在', 404);
      return;
    }

    const message = await prisma.qAMessage.create({
      data: {
        sessionId,
        role,
        content,
      },
    });

    // 更新对话标题（使用第一条用户消息）
    if (role === 'user' && !conversation.title) {
      await prisma.qASession.update({
        where: { id: sessionId },
        data: { title: content.slice(0, 50) },
      });
    }

    // 更新对话时间
    await prisma.qASession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    success(res, message);
  } catch (err: any) {
    console.error('[LangChain] 保存消息失败:', err);
    error(res, err.message || '保存消息失败', 500);
  }
};


