/**
 * OpenSpec Agent 代理服务
 *
 * 封装对 Python Agent (FastAPI) 的 HTTP 调用，使 Node.js 后端
 * 可直接调用文档生成、长期记忆、模板匹配等功能。
 * 不改 Python Agent 一行代码，纯 HTTP 转发。
 */

import axios from 'axios';
import { env } from '../../config/env';

const AGENT_BASE_URL = env.openspecAgentUrl || 'http://localhost:5000';

export interface GenerationParams {
  projectInfo: string;
  template: string;
  chapterName: string;
  professionTagId?: number;
  userId?: string;
  projectId?: string;
}

export interface ParagraphResult {
  content: string;
  chapterName: string;
  references: Array<{ id: string; source: string; content: string }>;
}

export interface MemoryItem {
  id: number;
  content: string;
  chapterName: string | null;
  category: string;
  createdAt: string;
  /** Agent 召回时附带的相似度（0~1，越大越相似）；用于记忆去重阈值判断 */
  score?: number;
}

export interface TemplateMatchResult {
  matched: boolean;
  templateId: string | null;
  templateName: string | null;
  score: number;
}

export class OpenSpecAgentService {
  /**
   * 流式生成段落（SSE 流）
   * 调用 /agent/rag/generate_paragraph_stream
   * 返回 Node.js ReadableStream，前端可直接消费
   */
  static async generateParagraphStream(
    params: GenerationParams,
  ): Promise<Response> {
    const response = await fetch(`${AGENT_BASE_URL}/agent/rag/generate_paragraph_stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.chapterName,
        prompt: params.projectInfo,
        template: params.template,
        profession_tag_id: params.professionTagId,
        user_id: params.userId,
        project_id: params.projectId,
      }),
    });
    return response;
  }

  /**
   * 批量生成文档（非流式）
   * 调用 /agent/workflow/chat/batch
   */
  static async generateBatch(
    projectInfo: string,
    chapters: Array<{ name: string; template: string }>,
    userId?: string,
    projectId?: string,
  ): Promise<ParagraphResult[]> {
    const response = await axios.post(`${AGENT_BASE_URL}/agent/workflow/chat/batch`, {
      project_info: projectInfo,
      chapters,
      user_id: userId,
      project_id: projectId,
    });
    return response.data?.data?.paragraphs || [];
  }

  /**
   * 保存长期记忆
   * 调用 /agent/memory/save
   */
  static async saveMemory(
    userId: string,
    content: string,
    chapterName?: string,
    sourceType: string = 'requirement',
    category?: string,
  ): Promise<void> {
    await axios.post(`${AGENT_BASE_URL}/agent/memory/save`, {
      user_id: userId,
      content,
      chapter_name: chapterName,
      source_type: sourceType,
      category,
    });
  }

  /**
   * 召回长期记忆
   * 调用 /agent/memory/recall
   */
  static async recallMemory(
    userId: string,
    query: string,
    limit: number = 5,
  ): Promise<MemoryItem[]> {
    const response = await axios.post(`${AGENT_BASE_URL}/agent/memory/recall`, {
      user_id: userId,
      query,
      limit,
    });
    return response.data?.data || [];
  }

  /**
   * 列出用户记忆
   * 调用 /agent/memory/list
   */
  static async listMemory(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ total: number; items: MemoryItem[] }> {
    const response = await axios.get(`${AGENT_BASE_URL}/agent/memory/list`, {
      params: { user_id: userId, page, page_size: pageSize },
    });
    return response.data?.data || { total: 0, items: [] };
  }

  /**
   * 删除记忆
   * 调用 DELETE /agent/memory/{id}
   */
  static async deleteMemory(id: number): Promise<void> {
    await axios.delete(`${AGENT_BASE_URL}/agent/memory/${id}`);
  }

  /**
   * 模板匹配
   * 调用 /agent/template/match
   */
  static async matchTemplate(
    text: string,
    professionTagId?: number,
    businessTypeTagId?: number,
  ): Promise<TemplateMatchResult> {
    const response = await axios.post(`${AGENT_BASE_URL}/agent/template/match`, {
      text,
      profession_tag_id: professionTagId,
      business_type_tag_id: businessTypeTagId,
    });
    return response.data?.data || { matched: false, templateId: null, templateName: null, score: 0 };
  }

  /**
   * 健康检查
   * 调用 GET /agent/test
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${AGENT_BASE_URL}/agent/test`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}