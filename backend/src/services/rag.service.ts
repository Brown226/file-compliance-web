/**
 * 自建 RAG 检索服务
 *
 * 核心思路：脱离 MaxKB 智能应用，直接使用 MaxKB 知识库的向量检索 API (hit_test)
 * 获取相关段落，然后组装 prompt 调用自有 LLM 进行审查。
 *
 * 提示词由调用方（Pipeline）按场景指定，RAGService 只负责检索+调用。
 *
 * 优势：
 * 1. Prompt 完全可控（不再被 MaxKB RAG prompt 覆盖）
 * 2. 知识库自由选择（无需创建/绑定/发布应用）
 * 3. 分段引用完整（每条结果含 document_name + similarity + content）
 * 4. 检索更快（纯向量检索 ~1s，vs MaxKB 完整管道 ~30s）
 */

import { MaxKBService } from './maxkb.service';
import { RagflowProvider } from './ragflow.service';
import { LlmService, ReviewIssue, SourceReference } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { CacheService } from './cache.service';

// ==================== 类型定义 ====================

/** RAG 检索到的单个段落 */
export interface RAGRetrievedChunk {
  id: string;
  content: string;
  document_name: string;
  knowledge_name?: string;
  similarity: number;
  comprehensive_score: number;
}

/** 知识库树节点 */
export interface KnowledgeTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'knowledge';
  documentCount?: number;
  children?: KnowledgeTreeNode[];
}

/** RAG 审查结果 */
export interface RAGReviewResult {
  issues: ReviewIssue[];
  sourceReferences: SourceReference[];
}

/** RAG 审查选项 */
export interface RAGReviewOptions {
  chunkSize?: number;
  topK?: number;
  llmMaxTokens?: number;
  llmTimeout?: number;
  /** 审查场景（对应 PromptTemplate module），默认 library_review */
  scene?: string;
  /** 文档ID，用于LLM缓存键 */
  documentId?: string;
}

// ==================== RAG 检索服务 ====================

export class RAGService {

  /**
   * 从指定知识库中检索与查询文本相关的段落
   *
   * 使用 MaxKB hit_test API 进行向量/混合检索
   *
   * @param knowledgeId 知识库 ID
   * @param queryText 待检索的查询文本
   * @param options 检索选项
   */
  static async retrieve(
    knowledgeId: string,
    queryText: string,
    options?: { topNumber?: number; similarity?: number; searchMode?: 'embedding' | 'blend' | 'keywords' },
  ): Promise<RAGRetrievedChunk[]> {

    const topNumber = options?.topNumber ?? 5;
    const similarity = options?.similarity ?? 0.55;
    const searchMode = options?.searchMode || 'blend';

    // 缓存键：基于查询内容的完整哈希（不再截断，提高缓存命中率）
    const cacheKey = CacheService.generateKey('rag:retrieve', knowledgeId, searchMode, String(topNumber), queryText);
    const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

    // 检查缓存
    const cached = CacheService.get<RAGRetrievedChunk[]>(cacheKey);
    if (cached !== null) {
      console.log(`[RAG] 缓存命中: kb=${knowledgeId}, results=${cached.length}`);
      return cached;
    }

    const workspaceId = await MaxKBService.getDefaultWorkspaceId();

    console.log(`[RAG] 开始检索: kb=${knowledgeId}, query_len=${queryText.length}, mode=${searchMode}, top=${topNumber}`);

    const results = await (MaxKBService as any).adminRequest(
      'POST',
      `/workspace/${workspaceId}/knowledge/${knowledgeId}/hit_test`,
      {
        query_text: queryText,
        top_number: topNumber,
        similarity,
        search_mode: searchMode,
      },
    ) as any[];

    if (!Array.isArray(results) || results.length === 0) {
      console.log(`[RAG] 未检索到相关段落`);
      return [];
    }

    const chunks: RAGRetrievedChunk[] = results.map((r: any) => ({
      id: r.id || '',
      content: r.content || '',
      document_name: r.document_name || '未知文档',
      knowledge_name: r.knowledge_name || '',
      similarity: r.similarity ?? 0,
      comprehensive_score: r.comprehensive_score ?? 0,
    }));

    // 缓存结果
    CacheService.set(cacheKey, chunks, CACHE_TTL);

    console.log(`[RAG] 检索到 ${chunks.length} 条段落, 相似度范围: [${Math.min(...chunks.map(c => c.similarity)).toFixed(4)}, ${Math.max(...chunks.map(c => c.similarity)).toFixed(4)}]`);
    return chunks;
  }

  /**
   * 将检索结果组装为 RAG 上下文文本
   *
   * 格式化输出，便于 LLM 引用
   */
  static formatRAGContext(chunks: RAGRetrievedChunk[]): string {
    if (chunks.length === 0) return '';

    let context = '';
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      context += `【来源${i + 1}：${chunk.document_name}】\n`;
      context += `(相似度: ${(chunk.similarity * 100).toFixed(1)}%)\n`;
      context += `${chunk.content}\n\n`;
    }
    return context.trim();
  }

  /**
   * 核心方法：使用知识库 RAG 检索增强的 LLM 审查
   *
   * 流程：
   * 1. 将待审查文本分片
   * 2. 对每个分片从多个知识库中检索相关标准规范（合并检索结果）
   * 3. 按场景加载提示词模板，组装 RAG prompt
   * 4. 调用自有 LLM 进行审查（prompt 可控，确保 JSON 输出）
   * 5. 收集所有 issue 并附加分段引用信息
   *
   * @param text 待审查文本
   * @param knowledgeIds 要使用的知识库 ID 列表（支持多个知识库联合检索）
   * @param options 配置选项（含 scene 审查场景）
   */
  static async reviewWithKnowledge(
    text: string,
    knowledgeIds: string | string[],
    options?: RAGReviewOptions,
  ): Promise<RAGReviewResult> {

    // 统一为数组
    const kbIds = Array.isArray(knowledgeIds) ? knowledgeIds : [knowledgeIds];
    if (kbIds.length === 0) {
      return { issues: [], sourceReferences: [] };
    }

    const scene = options?.scene || 'library_review';
    const chunkSize = options?.chunkSize || 4000;
    const topK = options?.topK || 5;
    const llmMaxTokens = options?.llmMaxTokens || 4096;
    const llmTimeout = options?.llmTimeout || 180;

    // 一期 A：知识库审查 Agent 化（疑点驱动检索闭环）。通过 system_configs.rag_agent_enabled 灰度开关控制，默认关闭。
    const agentEnabled = await RAGService.isAgentEnabled();
    if (agentEnabled) {
      console.log(`[RAG] Agent 模式启用（疑点驱动检索），共 ${kbIds.length} 个知识库`);
      try {
        return await RAGService.runRAGReviewAgent(text, kbIds, { chunkSize, topK, llmMaxTokens, llmTimeout, scene, documentId: options?.documentId });
      } catch (e: any) {
        console.warn(`[RAG] Agent 模式失败，降级到单跳 legacy:`, e.message);
      }
    }

    // 1. 文本分片（带位置信息）
    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;
    console.log(`[RAG] 文本分为 ${totalChunks} 片, 总长度 ${text.length}, 知识库: [${kbIds.join(',')}], 场景: ${scene}`);

    const allIssues: ReviewIssue[] = [];
    const allSources: SourceReference[] = [];

    // 2. 对每个分片进行 RAG 增强 LLM 审查
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[RAG] 处理分片 ${i + 1}/${totalChunks} (${chunk.text.length}字)`);

      try {
        // 2a. 向量检索：并行从多个知识库获取相关标准规范
        const allRetrievedChunks: RAGRetrievedChunk[] = [];
        const kbResults = await Promise.allSettled(
          kbIds.map(kbId => {
            // 按前缀路由：ragflow: 前缀走 RAGFlow 提供方，否则走 MaxKB（默认）
            if (typeof kbId === 'string' && kbId.startsWith('ragflow:')) {
              return RagflowProvider.retrieve(kbId.slice('ragflow:'.length), chunk.text, {
                topNumber: topK,
              });
            }
            return this.retrieve(kbId, chunk.text, {
              topNumber: topK,
              similarity: 0.5,
              searchMode: 'blend',
            });
          })
        );
        for (const result of kbResults) {
          if (result.status === 'fulfilled') {
            allRetrievedChunks.push(...result.value);
          } else {
            console.warn(`[RAG] 知识库检索失败:`, result.reason?.message || result.reason);
          }
        }

        // 按相似度排序，取 top K
        allRetrievedChunks.sort((a, b) => b.similarity - a.similarity);
        const retrievedChunks = allRetrievedChunks.slice(0, topK * 2);

        // 2b. 组装 RAG 上下文
        let standardContext = '';
        let sources: SourceReference[] = [];

        if (retrievedChunks.length > 0) {
          standardContext = this.formatRAGContext(retrievedChunks);
          sources = retrievedChunks.map(c => ({
            content: c.content.substring(0, 200),
            document_name: c.document_name,
            similarity: c.similarity,
          }));
        }

        // 2c. 按场景加载系统提示词
        const systemPrompt = await PromptTemplateService.getPromptByScene(
          scene, 'system', 'default',
          '你是文件合规审查专家。请检查文本中的问题，严格按照 JSON 数组格式输出。',
        );

        // 2d. 按场景+变体加载用户提示词
        const variant = standardContext ? 'with_context' : 'no_context';
        let userPrompt: string;

        if (standardContext) {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'with_context',
            '【参考标准】\n${ragContext}\n\n【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl
            .replace(/\$\{ragContext\}/g, standardContext)
            .replace(/\$\{standardContext\}/g, standardContext)
            .replace(/\$\{text\}/g, chunk.text);
        } else {
          const tpl = await PromptTemplateService.getPromptByScene(
            scene, 'user', 'no_context',
            '【待审查文本】\n${text}\n\n请检查以上文本的合规性问题。严格按照 JSON 数组格式输出审查结果。',
          );
          userPrompt = tpl.replace(/\$\{text\}/g, chunk.text);
        }

        // 2e. 调用自有 LLM 审查（场景系统提示词 + 已组装的用户提示词）
        const issues = await LlmService.reviewText(userPrompt, {
          maxTokens: llmMaxTokens,
          timeout: llmTimeout,
          systemPrompt: systemPrompt,
          skipUserTemplate: true,
          documentId: options?.documentId,
          positionInfo: {
            chunkIndex: chunk.chunkIndex,
            chunkStartIndex: chunk.startIndex,
            totalChunks,
          },
        });

        // 2f. 来源引用真实绑定：仅当本分片确有检索结果时才挂引用，避免"假引用"
        // 检索为空时标记 ruleCode=UNVERIFIED，前端可显式标注"AI 推测，无知识库依据"
        if (sources.length > 0 && issues.length > 0) {
          for (const issue of issues) {
            issue.sourceReferences = sources;
            if (issue.ruleCode === undefined) issue.ruleCode = 'KB_VERIFIED';
          }
          allSources.push(...sources);
        } else if (issues.length > 0) {
          for (const issue of issues) {
            if (issue.ruleCode === undefined) issue.ruleCode = 'UNVERIFIED';
          }
        }

        allIssues.push(...issues);
        console.log(`[RAG] 分片 ${i + 1}: 检测到 ${issues.length} 个问题`);
      } catch (e: any) {
        console.warn(`[RAG] 分片 ${i + 1} 审查失败:`, e.message);
      }
    }

    console.log(`[RAG] 审查完成: ${allIssues.length} 个问题, ${allSources.length} 条引用来源`);

    return {
      issues: allIssues,
      sourceReferences: allSources,
    };
  }

  /** 读取 Agent 灰度开关（system_configs.rag_agent_enabled，默认关闭） */
  static async isAgentEnabled(): Promise<boolean> {
    try {
      const prisma = (global as any).prisma;
      if (!prisma) return false;
      const row = await prisma.systemConfig.findUnique({ where: { key: 'rag_agent_enabled' } });
      const v = row?.value;
      if (v === true || v === 'true') return true;
      if (v && typeof v === 'object' && (v.enabled === true || v.enabled === 'true')) return true;
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 一期 A：知识库审查 Agent 化 —— 疑点驱动检索闭环
   *
   * 流程（每个分片）：
   *   ① 疑点抽取：LLM 通读分片，只列"可能违规/存疑的点"（不下结论、不检索）
   *   ② 定向检索：对每个疑点做 hit_test(top3, sim 0.5)，检索的是疑点本身而非整段
   *   ③ 判定：LLM 结合疑点 + 命中条款判定是否违规，引用真实绑定到该疑点命中的条款
   *   ④ 无命中：标记 UNVERIFIED（AI 推测，无知识库依据），不编造引用
   *
   * 相比单跳：检索更精准（query=疑点）、引用真实（每 issue 绑自己的依据）、可标注未核实。
   */
  static async runRAGReviewAgent(
    text: string,
    kbIds: string[],
    options: { chunkSize: number; topK: number; llmMaxTokens: number; llmTimeout: number; scene: string; documentId?: string },
  ): Promise<RAGReviewResult> {
    const { chunkSize, llmMaxTokens, llmTimeout, documentId } = options;
    const chunks = LlmService.splitText(text, chunkSize, true);
    const totalChunks = chunks.length;
    const allIssues: ReviewIssue[] = [];
    const allSources: SourceReference[] = [];

    const EXTRACT_SYS = '你是核电工程文件合规审查助手。请通读给定文本，只列出"可能违反标准规范或存在合规疑点"的地方，不要下最终结论、不要编造标准。' +
      '输出 JSON 数组，每条含 {"question": "疑点的简明问法（用于检索标准条款）", "snippet": "对应的原文片段（逐字复制，20-60字）"}。' +
      '只列合规/规范性疑点（如引用标准是否正确、参数是否符合规定、设计依据是否充分），不要列语句通顺性/错别字/排版问题。若无疑点输出 []。';

    const VERIFY_SYS = '你是核电工程文件合规审查专家。给你一个"疑点"和从知识库检索到的"相关条款"，请判定该疑点是否确实违规。' +
      '严格依据条款判定：条款能支持判定才报告问题；条款不足以判定则不要编造。' +
      '输出 JSON 数组（0 或 1 条）：{"issueType":"VIOLATION|CONSISTENCY|COMPLETENESS","originalText":"逐字复制的原文片段","suggestedText":"修改建议","description":"问题描述","ruleCode":"KB_VERIFIED","standardRef":"依据的条款编号或名称","plain_language":"通俗解释"}。若不构成问题输出 []。';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        // ① 疑点抽取
        const suspicions = await LlmService.reviewText(chunk.text, {
          maxTokens: llmMaxTokens, timeout: llmTimeout, systemPrompt: EXTRACT_SYS, skipUserTemplate: true, documentId,
        }) as any[];
        // reviewText 返回 ReviewIssue[]；疑点抽取复用其 JSON 解析，字段映射：description/originalText 兜底
        const points: Array<{ question: string; snippet: string }> = (Array.isArray(suspicions) ? suspicions : [])
          .map((s: any) => ({
            question: s.question || s.description || s.originalText || '',
            snippet: s.snippet || s.originalText || '',
          }))
          .filter(p => p.question && p.question.length > 3);

        console.log(`[RAG-Agent] 分片 ${i + 1}/${totalChunks}: 抽取 ${points.length} 个疑点`);

        for (const pt of points) {
          // ② 定向检索：疑点本身作为 query
          const retrieved: RAGRetrievedChunk[] = [];
          const results = await Promise.allSettled(
            kbIds.map(kbId =>
              kbId.startsWith('ragflow:')
                ? RagflowProvider.retrieve(kbId.slice('ragflow:'.length), pt.question, { topNumber: 3 })
                : this.retrieve(kbId, pt.question, { topNumber: 3, similarity: 0.5, searchMode: 'blend' }),
            ),
          );
          for (const r of results) if (r.status === 'fulfilled') retrieved.push(...r.value);
          retrieved.sort((a, b) => b.similarity - a.similarity);
          const top = retrieved.slice(0, 3);

          if (top.length === 0) {
            // ④ 无命中：AI 推测，标记未核实
            allIssues.push({
              issueType: 'VIOLATION',
              originalText: pt.snippet,
              suggestedText: '',
              description: `疑点：${pt.question}（未在知识库检索到支撑条款，需人工确认）`,
              ruleCode: 'UNVERIFIED',
              standardRef: null,
              severity: 'info',
            } as any);
            continue;
          }

          // ③ 判定：疑点 + 命中条款
          const clauseCtx = this.formatRAGContext(top);
          const verifyUser = `【疑点】${pt.question}\n【原文片段】${pt.snippet}\n\n【知识库检索到的相关条款】\n${clauseCtx}\n\n请依据条款判定该疑点是否违规，按要求输出 JSON。`;
          const verdicts = await LlmService.reviewText(verifyUser, {
            maxTokens: llmMaxTokens, timeout: llmTimeout, systemPrompt: VERIFY_SYS, skipUserTemplate: true, documentId,
          });
          const srcRefs: SourceReference[] = top.map(c => ({
            content: c.content.substring(0, 200), document_name: c.document_name, similarity: c.similarity,
          }));
          for (const v of verdicts) {
            v.sourceReferences = srcRefs;               // 真实绑定：本疑点命中的条款
            if (v.ruleCode === undefined) v.ruleCode = 'KB_VERIFIED';
            allIssues.push(v);
          }
          allSources.push(...srcRefs);
        }
      } catch (e: any) {
        console.warn(`[RAG-Agent] 分片 ${i + 1} 处理失败:`, e.message);
      }
    }

    console.log(`[RAG-Agent] 完成: ${allIssues.length} 个问题, ${allSources.length} 条引用`);
    return { issues: allIssues, sourceReferences: allSources };
  }

  /**
   * 获取知识库树形结构（含文件夹分组和文档数）
   * 数据完全来自 MaxKB API，根目录名使用工作空间名称
   */
  static async getKnowledgeTree(): Promise<KnowledgeTreeNode[]> {
    // 并行获取 RAGFlow 知识库（独立提供方，无配置时返回空，不影响 MaxKB）
    const ragflowKbs = await RagflowProvider.getKnowledgeTree();
    const ragflowRoot: KnowledgeTreeNode | null = ragflowKbs.length
      ? { id: 'ragflow-root', name: 'RAGFlow 知识库', type: 'folder', children: ragflowKbs.map(k => ({ id: k.id, name: k.name, type: 'knowledge' as const, documentCount: k.documentCount })) }
      : null;

    const workspace = await MaxKBService.getDefaultWorkspace();
    const workspaceId = workspace.id;
    const workspaceName = workspace.name;
    const knowledgeList = await MaxKBService.listKnowledge(workspaceId);

    // 尝试获取文件夹列表（用于获取真实目录名）
    const folders = await MaxKBService.listKnowledgeFolders(workspaceId);
    const folderNameMap = new Map<string, string>();
    for (const f of folders) { folderNameMap.set(f.id, f.name); }

    console.log(`[RAG] 工作空间: ${workspaceName} (${workspaceId})`);
    console.log(`[RAG] 知识库列表: ${knowledgeList.length} 个, 文件夹: ${folders.length} 个`);
    for (const kb of knowledgeList) {
      console.log(`[RAG]   知识库: "${kb.name}" folder_id=${(kb as any).folder_id || 'none'} docs=${(kb as any).document_count || 0}`);
    }
    for (const f of folders) {
      console.log(`[RAG]   文件夹: "${f.name}" id=${f.id}`);
    }

    const enrichedKbs = knowledgeList.map((kb: any) => ({
      id: kb.id,
      name: kb.name,
      type: 'knowledge' as const,
      folder_id: (kb as any).folder_id || workspaceId,
      documentCount: (kb as any).document_count || 0,
      desc: kb.desc,
      charLength: (kb as any).char_length || 0,
    }));

    const folderMap = new Map<string, KnowledgeTreeNode>();

    // 根节点使用工作空间真实名称，"default" 显示为 "根目录"
    const displayName = workspaceName === 'default' ? '根目录' : workspaceName;
    const root: KnowledgeTreeNode = {
      id: workspaceId,
      name: displayName,
      type: 'folder',
      children: [],
    };

    for (const kb of enrichedKbs) {
      const fid = kb.folder_id;

      if (fid === workspaceId || fid === 'default') {
        root.children!.push({
          id: kb.id,
          name: kb.name,
          type: 'knowledge',
          documentCount: kb.documentCount,
        });
        continue;
      }

      // 使用真实文件夹名（如果有），否则回退到 "知识库分组"
      if (!folderMap.has(fid)) {
        const realFolderName = folderNameMap.get(fid) || `知识库分组`;
        folderMap.set(fid, {
          id: fid,
          name: realFolderName,
          type: 'folder',
          children: [],
        });
      }

      const folderNode = folderMap.get(fid)!;
      folderNode.children!.push({
        id: kb.id,
        name: kb.name,
        type: 'knowledge',
        documentCount: kb.documentCount,
      });
    }

    for (const [, folderNode] of folderMap) {
      root.children!.push(folderNode);
    }

    root.children!.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (a.type === 'folder') return (b.children?.length || 0) - (a.children?.length || 0);
      return (b.documentCount || 0) - (a.documentCount || 0);
    });

    // 扁平分支：附带 RAGFlow 顶级 folder（若有）
    if (ragflowRoot) {
      const flat: KnowledgeTreeNode[] = enrichedKbs.map(kb => ({
        id: kb.id,
        name: kb.name,
        type: 'knowledge' as const,
        documentCount: kb.documentCount,
      }));
      flat.push(ragflowRoot);
      return flat;
    }

    if (root.children!.length <= 2 && !folderMap.size) {
      return enrichedKbs.map(kb => ({
        id: kb.id,
        name: kb.name,
        type: 'knowledge' as const,
        documentCount: kb.documentCount,
      }));
    }

    // 树形分支：把 RAGFlow 作为独立顶级节点挂到 root 下
    if (ragflowRoot) {
      root.children!.push(ragflowRoot);
    }

    return [root];
  }

  /**
   * 获取扁平化的知识库列表（兼容旧接口）
   */
  static async getFlatKnowledgeList(): Promise<Array<{ id: string; name: string; desc?: string; documentCount?: number; folderId?: string }>> {
    const workspaceId = await MaxKBService.getDefaultWorkspaceId();
    const list = await MaxKBService.listKnowledge(workspaceId);

    return list.map((kb: any) => ({
      id: kb.id,
      name: kb.name,
      desc: kb.desc,
      documentCount: kb.document_count || 0,
      folderId: (kb as any).folder_id || undefined,
    }));
  }
}
