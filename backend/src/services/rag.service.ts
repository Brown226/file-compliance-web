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
import { LlmService, ReviewIssue, SourceReference } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';

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

    const workspaceId = await MaxKBService.getDefaultWorkspaceId();
    const topNumber = options?.topNumber ?? 5;
    const similarity = options?.similarity ?? 0.3;
    const searchMode = options?.searchMode || 'blend';

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
        // 2a. 向量检索：从多个知识库获取与该分片相关的标准规范
        const allRetrievedChunks: RAGRetrievedChunk[] = [];
        for (const kbId of kbIds) {
          try {
            const kbChunks = await this.retrieve(kbId, chunk.text, {
              topNumber: topK,
              similarity: 0.2,  // 审查场景降低阈值以获得更多参考
              searchMode: 'blend',
            });
            allRetrievedChunks.push(...kbChunks);
          } catch (e: any) {
            console.warn(`[RAG] 知识库 ${kbId} 检索失败:`, e.message);
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
          positionInfo: {
            chunkIndex: chunk.chunkIndex,
            chunkStartIndex: chunk.startIndex,
            totalChunks,
          },
        });

        // 2f. 为每个 issue 附加来源引用
        if (sources.length > 0 && issues.length > 0) {
          for (const issue of issues) {
            issue.sourceReferences = sources;
          }
          allSources.push(...sources);
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

  /**
   * 获取知识库树形结构（含文件夹分组和文档数）
   * 数据完全来自 MaxKB API，根目录名使用工作空间名称
   */
  static async getKnowledgeTree(): Promise<KnowledgeTreeNode[]> {
    const workspace = await MaxKBService.getDefaultWorkspace();
    const workspaceId = workspace.id;
    const workspaceName = workspace.name;
    const knowledgeList = await MaxKBService.listKnowledge(workspaceId);

    // 尝试获取文件夹列表（用于获取真实目录名）
    const folders = await MaxKBService.listKnowledgeFolders(workspaceId);
    const folderNameMap = new Map<string, string>();
    for (const f of folders) { folderNameMap.set(f.id, f.name); }

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

    // 根节点使用工作空间真实名称
    const root: KnowledgeTreeNode = {
      id: workspaceId,
      name: workspaceName,
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

    if (root.children!.length <= 2 && !folderMap.size) {
      return enrichedKbs.map(kb => ({
        id: kb.id,
        name: kb.name,
        type: 'knowledge' as const,
        documentCount: kb.documentCount,
      }));
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
