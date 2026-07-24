/**
 * OpenSpec Agent 代理服务
 *
 * 封装对 Python Agent (FastAPI) 的 HTTP 调用，使 Node.js 后端
 * 可直接调用文档生成、长期记忆、模板匹配等功能。
 * 不改 Python Agent 一行代码，纯 HTTP 转发。
 *
 * 鉴权方案：Node 后端调用 agent 时，用共享的 JWT_SECRET 临时签发
 * 一个短期 service token（携带真实 userId），agent 的 JWT 中间件
 * 验证后提取 user_id 用于记忆隔离。
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';
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
  alternatives?: Array<{ templateId: string; templateName: string; similarity: number }>;
}

/**
 * 用共享 JWT_SECRET 签发短期 service token
 * agent 的 JwtAuthMiddleware 会验签并提取 user_id
 */
function _serviceToken(userId?: string): string {
  const payload: Record<string, unknown> = {
    // agent 优先读 sub，回退到 id（见 jwt_auth.py 兼容逻辑）
    sub: userId || 'system-service',
    id: userId || 'system-service',
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '5m' });
}

function _authHeaders(userId?: string): { Authorization: string } {
  return { Authorization: `Bearer ${_serviceToken(userId)}` };
}

export class OpenSpecAgentService {
  /**
   * 流式生成段落（SSE 流）
   * 调用 /agent/rag/generate_paragraph_stream
   * 返回 fetch Response，调用方可直接消费 body 流
   */
  static async generateParagraphStream(
    params: GenerationParams,
  ): Promise<Response> {
    const response = await fetch(`${AGENT_BASE_URL}/agent/rag/generate_paragraph_stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ..._authHeaders(params.userId),
      },
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
    const response = await axios.post(
      `${AGENT_BASE_URL}/agent/workflow/chat/batch`,
      {
        message: projectInfo,
        chapters,
        user_id: userId,
        project_id: projectId,
      },
      { headers: _authHeaders(userId) },
    );
    return response.data?.data?.paragraphs || [];
  }

  /**
   * 召回长期记忆
   * 调用 /agent/memory/recall
   * 注意：agent 从 JWT 提取 user_id，body 里不传 user_id
   */
  static async recallMemory(
    userId: string,
    query: string,
    limit: number = 5,
  ): Promise<MemoryItem[]> {
    const response = await axios.post(
      `${AGENT_BASE_URL}/agent/memory/recall`,
      { query, limit },
      { headers: _authHeaders(userId) },
    );
    const data = response.data?.data || [];
    // agent 返回字段是 created_at/chapter_name，统一映射为 camelCase
    return data.map((m: any) => ({
      id: m.id,
      content: m.content,
      chapterName: m.chapter_name ?? null,
      category: m.category ?? 'other',
      createdAt: m.created_at,
      score: m.similarity,
    }));
  }

  /**
   * 模板匹配
   * 调用 /agent/template/search（注意：agent 实际端点是 search，非 match）
   */
  static async matchTemplate(
    text: string,
    professionTagId?: number,
    businessTypeTagId?: number,
    userId?: string,
  ): Promise<TemplateMatchResult> {
    const response = await axios.post(
      `${AGENT_BASE_URL}/agent/template/search`,
      {
        userId: userId || 'system-service',
        chapterTitle: text,
        professionTagId,
        businessTypeTagId,
      },
      { headers: _authHeaders(userId) },
    );
    const data = response.data?.data || {};
    const matched = data.matched;
    return {
      matched: !!matched,
      templateId: matched?.templateId ?? null,
      templateName: matched?.templateName ?? null,
      score: matched?.similarity ?? 0,
      alternatives: (data.alternatives || []).map((a: any) => ({
        templateId: a.templateId,
        templateName: a.templateName,
        similarity: a.similarity,
      })),
    };
  }

  /**
   * 健康检查
   * 调用 GET /agent/test（白名单，无需 JWT）
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
