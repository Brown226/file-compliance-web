import prisma from '../config/db';

/**
 * MaxKB 知识库检索服务
 *
 * 核心职责：
 * 1. 管理 MaxKB 知识库 — 标准文档自动同步
 * 2. 向量检索（RAG）— 使用 hit_test API 进行语义检索
 * 3. 获取知识库段落 — 为自有 LLM 提供审查上下文
 *
 * API 结构：
 * - 管理 API: http://{MAXKB_HOST}/admin/api/...  (需要 JWT token)
 *
 * 注意：本服务不再调用 MaxKB 智能体应用进行审查，
 *       审查功能已迁移到自有 LLM + RAG 知识库检索
 */

interface MaxKBConfig {
  baseUrl: string;       // MaxKB 服务地址，如 http://localhost:8080
  adminApiPrefix: string;// 管理 API 前缀，默认 /admin/api
  username: string;      // 管理员用户名
  password: string;      // 管理员密码
}

const DEFAULT_CONFIG: MaxKBConfig = {
  baseUrl: process.env.MAXKB_BASE_URL || 'http://localhost:8080',
  adminApiPrefix: '/admin/api',
  username: 'admin',
  password: 'Password01!',
};

// ==================== 类型定义 ====================

export interface MaxKBKnowledge {
  id: string;
  name: string;
  desc?: string;
  type?: string;
  embedding_mode?: string;
  model_id?: string;
}

export interface MaxKBDocument {
  id: string;
  name: string;
  char_length?: number;
  status?: string;
  is_active?: boolean;
}

// ==================== MaxKB 客户端 ====================

export class MaxKBService {
  private static tokenCache: { token: string; expires: number } | null = null;

  /**
   * 获取 MaxKB 配置（从数据库或默认值）
   */
  static async getConfig(): Promise<MaxKBConfig> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'maxkb_config' },
      });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        return { ...DEFAULT_CONFIG, ...v };
      }
    } catch (e) {
      console.warn('[MaxKB] 获取配置失败，使用默认值:', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  /**
   * 保存 MaxKB 配置到数据库
   */
  static async saveConfig(config: Partial<MaxKBConfig>): Promise<void> {
    const current = await this.getConfig();
    const merged = { ...current, ...config };
    await prisma.systemConfig.upsert({
      where: { key: 'maxkb_config' },
      update: { value: merged },
      create: { key: 'maxkb_config', value: merged },
    });
  }

  // ==================== 认证 ====================

  /**
   * 登录 MaxKB 获取 JWT token
   */
  static async getAdminToken(): Promise<string> {
    // 缓存 token，5分钟内复用
    if (this.tokenCache && this.tokenCache.expires > Date.now()) {
      return this.tokenCache.token;
    }

    const config = await this.getConfig();
    const url = `${config.baseUrl}${config.adminApiPrefix}/user/login`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.username,
        password: config.password,
      }),
    });

    const data = await response.json() as any;

    // MaxKB 可能在 HTTP 200 时返回业务错误码 { code: 500, message: "用户名或密码不正确" }
    if (!response.ok || (data?.code && data.code !== 200)) {
      const msg = data?.message || await response.text();
      throw new Error(`MaxKB 登录失败 (${response.status}): ${msg}`);
    }

    // MaxKB 返回格式: { code: 200, data: { token: "..." } } 或 { token: "..." }
    const token = data?.data?.token || data?.data || data?.token;

    if (!token) {
      throw new Error(`MaxKB 登录返回异常: ${JSON.stringify(data)}`);
    }

    this.tokenCache = { token, expires: Date.now() + 5 * 60 * 1000 };
    console.log('[MaxKB] 登录成功，获取 token');
    return token;
  }

  // ==================== 管理API封装 ====================

  /**
   * 通用管理 API 请求方法
   */
  private static async adminRequest(
    method: string,
    path: string,
    body?: any,
  ): Promise<any> {
    const config = await this.getConfig();
    const token = await this.getAdminToken();
    const url = `${config.baseUrl}${config.adminApiPrefix}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json() as any;

    // MaxKB 格式: { code: 200, data: {...}, message: "success" }
    if (data?.code !== 200 && data?.code !== undefined) {
      // token 过期时重新登录
      if (data?.code === 401 || response.status === 401) {
        this.tokenCache = null;
        const newToken = await this.getAdminToken();
        options.headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newToken}`,
        };
        const retryResponse = await fetch(url, options);
        const retryData = await retryResponse.json() as any;
        if (retryData?.code !== 200 && retryData?.code !== undefined) {
          throw new Error(`MaxKB API 错误: ${retryData.message || JSON.stringify(retryData)}`);
        }
        return retryData.data;
      }
      throw new Error(`MaxKB API 错误: ${data.message || JSON.stringify(data)}`);
    }

    return data?.data !== undefined ? data.data : data;
  }

  // ==================== 工作空间 ====================

  /**
   * 获取工作空间列表
   */
  static async getWorkspaces(): Promise<any[]> {
    const profile = await this.adminRequest('GET', '/user/profile');
    return profile?.workspace_list || [];
  }

  /**
   * 获取默认工作空间 ID 和名称
   */
  static async getDefaultWorkspaceId(): Promise<string> {
    const workspaces = await this.getWorkspaces();
    if (workspaces.length === 0) {
      throw new Error('MaxKB 没有可用的工作空间，请先创建工作空间');
    }
    return workspaces[0].id;
  }

  /** 获取默认工作空间的完整信息（含 name）*/
  static async getDefaultWorkspace(): Promise<{ id: string; name: string }> {
    const workspaces = await this.getWorkspaces();
    if (workspaces.length === 0) {
      throw new Error('MaxKB 没有可用的工作空间，请先创建工作空间');
    }
    return { id: workspaces[0].id, name: workspaces[0].name || 'MaxKB 工作空间' };
  }

  /**
   * 尝试获取知识库文件夹列表（用于构建树形结构）
   * MaxKB 2.8.0 可能没有独立的文件夹列表接口，返回空数组表示不可用
   */
  static async listKnowledgeFolders(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      // 尝试调用知识库目录接口（不同版本路径可能不同）
      const result = await this.adminRequest(
        'GET',
        `/workspace/${workspaceId}/knowledge/folder`,
      );
      if (Array.isArray(result)) return result;
      return [];
    } catch {
      // 接口不存在时静默降级
      return [];
    }
  }

  // ==================== 知识库管理 ====================

  /**
   * 获取知识库列表（遍历所有目录）
   * MaxKB 2.8.0: GET /workspace/{id}/knowledge
   * 
   * 注意：不使用 folder_id 参数以获取所有知识库
   * 如果需要支持子文件夹递归获取，可调用 listKnowledgeByFolder
   */
  static async listKnowledge(workspaceId: string): Promise<MaxKBKnowledge[]> {
    // 1. 首先获取根目录下的知识库（不带 folder_id）
    const result = await this.adminRequest(
      'GET',
      `/workspace/${workspaceId}/knowledge`,
    );
    
    let allKnowledge: MaxKBKnowledge[] = [];
    
    if (Array.isArray(result)) {
      allKnowledge = result;
    } else if (result?.records) {
      allKnowledge = result.records;
    }
    
    // 2. 尝试获取子文件夹并递归获取其中的知识库
    try {
      const folders = await this.listKnowledgeFolders(workspaceId);
      for (const folder of folders) {
        const folderKnowledge = await this.listKnowledgeByFolder(workspaceId, folder.id);
        // 合并去重
        for (const kb of folderKnowledge) {
          if (!allKnowledge.some(k => k.id === kb.id)) {
            allKnowledge.push(kb);
          }
        }
      }
    } catch (e) {
      // 子文件夹获取失败不影响主列表
      console.warn(`[MaxKB] 获取子文件夹知识库失败:`, e);
    }
    
    console.log(`[MaxKB] 获取到 ${allKnowledge.length} 个知识库`);
    return allKnowledge;
  }

  /**
   * 获取指定文件夹下的知识库列表
   */
  static async listKnowledgeByFolder(
    workspaceId: string, 
    folderId: string
  ): Promise<MaxKBKnowledge[]> {
    const result = await this.adminRequest(
      'GET',
      `/workspace/${workspaceId}/knowledge?folder_id=${folderId}`,
    );
    if (Array.isArray(result)) return result;
    if (result?.records) return result.records;
    return [];
  }

  // ==================== 文档管理 ====================

  /**
   * 上传文本文档到知识库
   * MaxKB 2.8.0: POST /workspace/{id}/knowledge/{kid}/document
   * 请求体: { name: string, paragraphs: [{ content: string }] }
   */
  static async createTextDocument(
    workspaceId: string,
    knowledgeId: string,
    data: {
      name: string;
      content: string;
    },
  ): Promise<MaxKBDocument> {
    // 将文本内容按段落分割，每个段落作为 paragraphs 数组的一个元素
    const paragraphs = data.content
      .split(/\n+/)
      .filter(p => p.trim().length > 0)
      .map(p => ({ content: p.trim() }));

    // 如果没有有效段落，创建一个包含全部内容的段落
    if (paragraphs.length === 0) {
      paragraphs.push({ content: data.content });
    }

    const result = await this.adminRequest(
      'POST',
      `/workspace/${workspaceId}/knowledge/${knowledgeId}/document`,
      {
        name: data.name,
        paragraphs,
      },
    );

    // 返回格式: { document_id: string, ... } 或直接是文档对象
    return Array.isArray(result) ? result[0] : result;
  }

  /**
   * 批量创建文档
   * MaxKB 2.8.0: PUT /workspace/{id}/knowledge/{kid}/document/batch_create
   * 请求体: [{ name: string, paragraphs: [{ content: string }] }]
   */
  static async batchCreateDocuments(
    workspaceId: string,
    knowledgeId: string,
    documents: Array<{ name: string; content: string }>,
  ): Promise<any> {
    const documentList = documents.map(doc => ({
      name: doc.name,
      paragraphs: doc.content
        .split(/\n+/)
        .filter((p: string) => p.trim().length > 0)
        .map((p: string) => ({ content: p.trim() })),
    }));

    return this.adminRequest(
      'PUT',
      `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/batch_create`,
      documentList,
    );
  }

  /**
   * 获取知识库文档列表
   * MaxKB 2.8.0: GET /workspace/{id}/knowledge/{kid}/document/{page}/{pageSize}
   * 返回格式可能是：
   *   1. { total: number, records: [...] } (标准格式)
   *   2. [...] (直接数组，某些版本)
   */
  static async listDocuments(
    workspaceId: string,
    knowledgeId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{ records: MaxKBDocument[]; total: number }> {
    const result = await this.adminRequest(
      'GET',
      `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/${page}/${pageSize}`,
    );

    // 兼容两种返回格式
    if (Array.isArray(result)) {
      // 直接返回数组格式：total = 数组长度
      return { records: result, total: result.length };
    }

    // 标准格式 { total, records }
    if (result && typeof result === 'object') {
      return {
        records: Array.isArray(result.records) ? result.records : [],
        total: typeof result.total === 'number' ? result.total : 0,
      };
    }

    return { records: [], total: 0 };
  }

  /**
   * 删除标准关联文档（按 standardId）
   */
  static async deleteStandardDocument(standardId: string): Promise<void> {
    // 先查找对应的知识库和文档
    const standard = await prisma.standard.findUnique({
      where: { id: standardId },
      select: { maxkbDocId: true },
    });
    
    if (!standard?.maxkbDocId) return;
    
    try {
      // 从 MaxKB 中删除文档
      const workspaceId = process.env.MAXKB_WORKSPACE_ID || 'default';
      const knowledgeId = process.env.MAXKB_KNOWLEDGE_ID || '';
      await this.deleteDocument(workspaceId, knowledgeId, standard.maxkbDocId);
      
      // 清除数据库中的引用
      await prisma.standard.update({
        where: { id: standardId },
        data: { maxkbDocId: null },
      });
    } catch (e) {
      console.warn(`[MaxKB] 删除文档失败: ${standardId}`, e);
    }
  }

  /**
   * 删除文档
   */
  static async deleteDocument(
    workspaceId: string,
    knowledgeId: string,
    documentId: string,
  ): Promise<void> {
    await this.adminRequest('DELETE', `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/${documentId}`);
  }

  /**
   * 命中测试 — 检查知识库检索效果
   */
  static async hitTest(
    workspaceId: string,
    knowledgeId: string,
    query: string,
    topNumber: number = 5,
  ): Promise<any[]> {
    return this.adminRequest('POST', `/workspace/${workspaceId}/knowledge/${knowledgeId}/hit_test`, {
      query_text: query,
      top_number: topNumber,
      similarity: 0.2,
      search_mode: 'embedding',
    });
  }

  // ==================== 知识库段落检索 ====================

  /**
   * 获取知识库中的段落内容（用于降级到自有 LLM 时提供上下文）
   * 通过 MaxKB 管理 API 获取指定知识库的文档列表和段落内容
   */
  static async getKnowledgeParagraphs(
    knowledgeId: string,
    options?: { maxParagraphs?: number; maxChars?: number },
  ): Promise<string> {
    const maxParagraphs = options?.maxParagraphs || 50;
    const maxChars = options?.maxChars || 20000;

    try {
      const workspaceId = await this.getDefaultWorkspaceId();

      // 获取知识库的文档列表
      const documents = await this.adminRequest(
        'GET',
        `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/1/100`,
      );

      const docList = (documents as any)?.records || (documents as any)?.data || [];
      if (!Array.isArray(docList) || docList.length === 0) {
        console.log(`[MaxKB] 知识库 ${knowledgeId} 没有文档`);
        return '';
      }

      // 收集段落内容
      let allContent = '';
      let paragraphCount = 0;

      for (const doc of docList) {
        if (paragraphCount >= maxParagraphs || allContent.length >= maxChars) break;

        try {
          // 获取文档的段落列表
          const paragraphs = await this.adminRequest(
            'GET',
            `/workspace/${workspaceId}/knowledge/${knowledgeId}/document/${doc.id}/paragraph/1/100`,
          );

          const paraList = (paragraphs as any)?.records || (paragraphs as any)?.data || [];
          if (Array.isArray(paraList)) {
            for (const para of paraList) {
              if (paragraphCount >= maxParagraphs || allContent.length >= maxChars) break;
              const content = para.content || '';
              if (content && content.length > 10 && !content.includes('\x00')) {
                // 过滤掉二进制内容和过短的段落
                const title = para.title ? `【${para.title}】` : '';
                allContent += `${title}${content}\n\n`;
                paragraphCount++;
              }
            }
          }
        } catch (e) {
          // 跳过获取失败的文档
        }
      }

      console.log(`[MaxKB] 获取知识库段落: ${paragraphCount} 段, ${allContent.length} 字符`);
      return allContent.substring(0, maxChars);
    } catch (e) {
      console.warn(`[MaxKB] 获取知识库段落失败:`, e);
      return '';
    }
  }

  // ==================== 知识库选择（审查时） ====================

  /**
   * 获取用户可选的知识库列表
   */
  static async getAvailableKnowledgeBases(): Promise<Array<{ id: string; name: string; desc?: string; documentCount?: number }>> {
    const workspaceId = await this.getDefaultWorkspaceId();
    const knowledgeList = await this.listKnowledge(workspaceId);

    // 为每个知识库获取文档数量
    const result = [];
    for (const kb of knowledgeList) {
      let documentCount = 0;
      try {
        const docs = await this.listDocuments(workspaceId, kb.id, 1, 1);
        documentCount = docs.total;
      } catch (e) {
        // 忽略
      }
      result.push({
        id: kb.id,
        name: kb.name,
        desc: kb.desc,
        documentCount,
      });
    }
    return result;
  }

  // ==================== 一键初始化 ====================

  /**
   * 一键初始化 MaxKB 集成（仅知识库）
   *
   * 1. 确保工作空间
   * 2. 验证知识库可访问
   * 3. 保存配置到数据库
   *
   * 注意：本方法不再创建应用，审查功能使用自建 RAG + 自有 LLM
   */
  static async initialize(): Promise<{
    workspaceId: string;
    knowledgeId: string;
  }> {
    console.log('[MaxKB] 开始一键初始化...');

    // 1. 获取工作空间
    const workspaceId = await this.getDefaultWorkspaceId();
    console.log(`[MaxKB] 工作空间: ${workspaceId}`);

    // 2. 获取知识库列表（用户需要在 MaxKB 中手动创建知识库并上传文档）
    const knowledgeList = await this.listKnowledge(workspaceId);
    if (knowledgeList.length === 0) {
      throw new Error('MaxKB 中没有知识库，请先在 MaxKB 管理界面创建知识库并上传标准文档');
    }
    
    // 遍历所有知识库，找到文档数量最多的那个
    let bestKnowledge = knowledgeList[0];
    let maxDocCount = 0;
    
    for (const kb of knowledgeList) {
      try {
        const docs = await this.listDocuments(workspaceId, kb.id, 1, 1);
        const docCount = docs.total;
        console.log(`[MaxKB] 知识库 "${kb.name}" 文档数: ${docCount}`);
        if (docCount > maxDocCount) {
          maxDocCount = docCount;
          bestKnowledge = kb;
        }
      } catch (e) {
        console.warn(`[MaxKB] 获取知识库 "${kb.name}" 文档数失败`);
      }
    }
    
    const knowledge = bestKnowledge;
    console.log(`[MaxKB] 选择知识库: ${knowledge.id} (${knowledge.name}), 文档数: ${maxDocCount}`);

    // 3. 保存配置到数据库
    await prisma.systemConfig.upsert({
      where: { key: 'maxkb_integration' },
      update: {
        value: {
          workspaceId,
          knowledgeId: knowledge.id,
          initializedAt: new Date().toISOString(),
        },
      },
      create: {
        key: 'maxkb_integration',
        value: {
          workspaceId,
          knowledgeId: knowledge.id,
          initializedAt: new Date().toISOString(),
        },
      },
    });

    console.log('[MaxKB] 一键初始化完成！');
    return {
      workspaceId,
      knowledgeId: knowledge.id,
    };
  }

  /**
   * 获取当前集成状态
   */
  static async getIntegrationStatus(): Promise<{
    initialized: boolean;
    workspaceId?: string;
    knowledgeId?: string;
    knowledgeDocCount?: number;
  }> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'maxkb_integration' },
      });

      if (!config?.value || typeof config.value !== 'object') {
        return { initialized: false };
      }

      const v = config.value as any;

      let knowledgeDocCount: number | undefined;

      try {
        // 遍历所有知识库，累加文档数量
        const knowledgeList = await this.listKnowledge(v.workspaceId);
        let totalDocs = 0;
        for (const kb of knowledgeList) {
          try {
            const docs = await this.listDocuments(v.workspaceId, kb.id, 1, 0);
            totalDocs += docs.total || 0;
          } catch (e: any) {
            console.error(`[MaxKB] 获取知识库 ${kb.name} 文档数量失败: ${e.message}`);
          }
        }
        knowledgeDocCount = totalDocs;
        console.log(`[MaxKB] 所有知识库文档总数: ${knowledgeDocCount}（共 ${knowledgeList.length} 个知识库）`);
      } catch (e: any) {
        console.error(`[MaxKB] 获取文档数量失败: ${e.message}`);
      }

      return {
        initialized: true,
        workspaceId: v.workspaceId,
        knowledgeId: v.knowledgeId,
        knowledgeDocCount,
      };
    } catch (e) {
      return { initialized: false };
    }
  }

  // ==================== 健康检查 ====================

  /**
   * 测试 MaxKB 连接（支持传入临时配置，不落库）
   */
  static async testConnectionWithConfig(configInput?: Partial<MaxKBConfig>): Promise<{
    reachable: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const current = await this.getConfig();
      const config: MaxKBConfig = { ...current, ...(configInput || {}) };

      // 使用登录 API 测试连通性（比 /api/application/profile 更可靠）
      const response = await fetch(`${config.baseUrl}${config.adminApiPrefix}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password }),
        signal: AbortSignal.timeout(10000),
      });

      // 只要能连上（无论密码是否正确），说明 MaxKB 在运行
      if (response.ok || response.status < 500) {
        return { reachable: true };
      }

      return { reachable: true, error: `HTTP ${response.status}` };
    } catch (e: any) {
      return { reachable: false, error: e.message };
    }
  }

  /**
   * 测试 MaxKB 连接（使用已保存配置）
   */
  static async healthCheck(): Promise<{
    reachable: boolean;
    version?: string;
    error?: string;
  }> {
    return this.testConnectionWithConfig();
  }
}

