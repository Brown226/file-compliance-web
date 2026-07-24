import { Request, Response } from 'express';
import { MaxKBService } from '../services/knowledge/maxkb.service';
import { MaxKBEmbedService } from '../services/knowledge/maxkb-embed.service';
import { RAGService } from '../services/knowledge/rag.service';
import { success, error } from '../utils/response';

/**
 * MaxKB 集成控制器
 */

/** 获取 MaxKB 集成状态 */
export const getMaxKBStatus = async (_req: Request, res: Response) => {
  try {
    const [status, health] = await Promise.all([
      MaxKBService.getIntegrationStatus(),
      MaxKBService.healthCheck(),
    ]);

    success(res, {
      ...status,
      maxkbReachable: health.reachable,
      maxkbError: health.error,
    });
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 一键初始化 MaxKB 集成 */
export const initializeMaxKB = async (_req: Request, res: Response) => {
  try {
    const result = await MaxKBService.initialize();
    success(res, result);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 知识库命中测试 */
export const hitTest = async (req: Request, res: Response) => {
  try {
    const { query, topNumber } = req.body;
    const status = await MaxKBService.getIntegrationStatus();

    if (!status.initialized || !status.knowledgeId || !status.workspaceId) {
      error(res, 'MaxKB 尚未初始化', 400);
      return;
    }

    const results = await MaxKBService.hitTest(
      status.workspaceId,
      status.knowledgeId,
      query,
      topNumber || 5,
    );

    success(res, { results });
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 保存 MaxKB 配置 */
export const saveMaxKBConfig = async (req: Request, res: Response) => {
  try {
    await MaxKBService.saveConfig(req.body);
    // 清除 token 缓存
    (MaxKBService as any).tokenCache = null;
    success(res, null, '配置保存成功');
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 测试 MaxKB 连接（不保存配置） */
export const testMaxKBConnection = async (req: Request, res: Response) => {
  try {
    const result = await MaxKBService.testConnectionWithConfig(req.body || {});
    success(res, result);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取 MaxKB 知识库管理页面 URL（用于 iframe 嵌入） */

export const getMaxKBKnowledgeUrl = async (_req: Request, res: Response) => {
  try {
    const config = await MaxKBService.getConfig();
    const status = await MaxKBService.getIntegrationStatus();

    if (!status.initialized || !status.workspaceId || !status.knowledgeId) {
      error(res, 'MaxKB 尚未初始化，请先执行一键初始化', 400);
      return;
    }

    // 获取登录 token
    const token = await MaxKBService.getAdminToken();

    // MaxKB 前端使用 HTML5 history 模式，路由守卫支持 ?token=xxx 参数自动写入 localStorage 完成认证
    // 直接使用 MaxKB 原始地址（不需要代理，MaxKB 未设置 X-Frame-Options）
    // publicUrl 供浏览器访问（可能不同于后端内网 baseUrl）
    const publicBaseUrl = process.env.MAXKB_PUBLIC_URL || config.baseUrl;
    const knowledgePageUrl = `${publicBaseUrl}/admin/knowledge?token=${token}`;

    success(res, {
      knowledgePageUrl,
      token,
      knowledgeId: status.knowledgeId,
      workspaceId: status.workspaceId,
      maxkbBaseUrl: config.baseUrl,
    });
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取 MaxKB 配置 */
export const getMaxKBConfig = async (_req: Request, res: Response) => {
  try {
    const config = await MaxKBService.getConfig();
    // 脱敏密码
    success(res, {
      ...config,
      password: config.password ? '******' : '',
    });
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取可选的知识库列表 */
export const getKnowledgeBases = async (_req: Request, res: Response) => {
  try {
    const knowledgeBases = await MaxKBService.getAvailableKnowledgeBases();
    success(res, knowledgeBases);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取 MaxKB 应用（智能体）列表 */
export const getApplications = async (_req: Request, res: Response) => {
  try {
    const config = await MaxKBService.getConfig();
    const workspaceId = await MaxKBService.getDefaultWorkspaceId();
    const applications = await MaxKBService.listApplications(workspaceId);
    const publicBaseUrl = process.env.MAXKB_PUBLIC_URL || config.baseUrl;
    // 为每个应用获取 access_token（公开访问凭证）
    const result = await Promise.all(applications.map(async (app: any) => {
      let chatUrl = `${publicBaseUrl}/chat/${app.id}`;
      try {
        chatUrl = await MaxKBService.getApplicationChatUrl(app.id);
      } catch {}
      return { ...app, chatUrl };
    }));
    success(res, result);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取嵌入问答 URL —— 用于 iframe 嵌入 MaxKB 原生聊天界面 */
export const getMaxKBEmbedUrl = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }
    const applicationId = (req.query.applicationId as string) || '';
    if (!applicationId) {
      error(res, 'applicationId 不能为空', 400);
      return;
    }
    const result = await MaxKBEmbedService.getEmbedUrl(userId, applicationId);
    success(res, result);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 清理某 application 的嵌入会话（下次进入会重新签发 chatUserToken） */
export const clearMaxKBEmbedSession = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      error(res, '未认证用户', 401);
      return;
    }
    const applicationId = (req.body?.applicationId as string) || '';
    if (!applicationId) {
      error(res, 'applicationId 不能为空', 400);
      return;
    }
    await MaxKBEmbedService.clearSession(userId, applicationId);
    success(res, null, '会话已清理');
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** 获取知识库树形结构（含目录分组和文档数，用于前端树形选择器） */
export const getKnowledgeTree = async (_req: Request, res: Response) => {
  try {
    const tree = await RAGService.getKnowledgeTree();
    success(res, tree);
  } catch (err: any) {
    error(res, err.message, 500);
  }
};

/** Webhook: MaxKB 文档上传通知 */
export const maxkbWebhook = async (req: Request, res: Response) => {
  try {
    const { event, document_name, knowledge_id } = req.body;

    console.log(`[MaxKB Webhook] 收到通知: event=${event}, doc=${document_name}, knowledge_id=${knowledge_id}`);

    // Webhook 必须快速返回
    success(res, { received: true });
  } catch (err: any) {
    // 即使出错也返回 200，避免 MaxKB 重试
    console.error('[MaxKB Webhook] 错误:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
};

/** OPT-017: 获取知识库文档分段审计 */
export const getDocumentSegments = async (req: Request, res: Response) => {
  try {
    const kbId = req.params.kbId as string;
    const docId = req.params.docId as string;
    if (!kbId || !docId) {
      error(res, '缺少 kbId 或 docId 参数', 400);
      return;
    }

    const segments = await MaxKBService.getDocumentSegments(kbId, docId);
    const metrics = MaxKBService.calculateSegmentMetrics(segments);

    success(res, {
      segments: segments.slice(0, 100), // 最多返回 100 条，避免过大
      metrics,
      total: segments.length,
    });
  } catch (err: any) {
    error(res, `获取分段失败: ${err.message}`, 500);
  }
};
