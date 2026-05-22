import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { LangChainSearchService } from '../services/langchain/langchain-search.service';
import { LangChainRAGService } from '../services/langchain/langchain-rag.service';
import { SearchMode } from '../services/langchain/langchain-retriever';
import { success, error } from '../utils/response';

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
    const { question, categoryIds, history, topK, enableMultiQuery, enableHyDE } = req.body;

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
    });

    success(res, result);
  } catch (err: any) {
    console.error('[LangChain] 问答失败:', err);
    error(res, err.message || '问答失败', 500);
  }
};

export const langchainAskStream = async (req: AuthRequest, res: Response): Promise<void> => {
  const { question, categoryIds, history = [], topK, enableMultiQuery, enableHyDE } = req.body;

  if (!question) { error(res, '请输入问题', 400); return; }
  if (!categoryIds || categoryIds.length === 0) { error(res, '请选择知识库', 400); return; }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('status', { message: '正在检索知识库...' });

    const searchResult = await LangChainRAGService.askQuestion(question, categoryIds, history, {
      topK: topK ?? 8,
      enableMultiQuery: enableMultiQuery ?? true,
      enableHyDE: enableHyDE ?? true,
    });

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
        } catch { /* skip */ }
      }
    }

    answer = answer.replace(/<think[\s\S]*?<\/think>/g, '').trim();
    send('done', { answer });
    res.end();
  } catch (err: any) {
    console.error('[LangChain] 流式问答失败:', err);
    send('error', { error: err.message || '问答请求失败' });
    res.end();
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


