/**
 * Agent 会话历史持久化服务 — QASession / QAMessage CRUD
 *
 * 功能：
 * 1. listSessions(userId) — 列出用户的会话（按 updatedAt 倒序，含最近一条消息预览）
 * 2. getSession(id, userId) — 查询单个会话（含权限校验）
 * 3. listMessages(sessionId, userId) — 查询会话的消息列表（按 createdAt 升序）
 * 4. ensureSession(sessionId, userId, title?) — 确保会话存在（不存在则创建）
 * 5. persistUserMessage(sessionId, userId, content) — 持久化用户消息
 * 6. persistAssistantMessage(sessionId, userId, content, status, sources?) — 持久化 assistant 消息
 * 7. updateAssistantMessage(messageId, content, status, sources?) — 更新 assistant 消息（流式结束时回填）
 * 8. deleteSession(id, userId) — 删除会话（级联删除 messages + agentTraces）
 * 9. renameSession(id, userId, title) — 重命名会话
 *
 * 设计要点：
 * - 所有查询都强制 userId 过滤（RBAC：用户只能访问自己的会话）
 * - persistUserMessage / persistAssistantMessage 是 fire-and-forget 友好的（不阻塞 chatStream）
 * - title 自动从首条用户消息截取（前 30 字符 + ...）
 * - 删除会话级联删除 messages 和 agentTraces（schema 已配置 onDelete: Cascade）
 */

import prisma from '../../config/db';

/** 会话列表项（含最近消息预览） */
export interface SessionListItem {
  id: string;
  title: string | null;
  taskId: string | null;
  status: string; // P0 #1：会话状态 active/completed（每用户单活跃会话限制用）
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会话详情 */
export interface SessionDetail {
  id: string;
  title: string | null;
  taskId: string | null;
  userId: string;
  /** 会话选用的模型（<providerId>::<modelName>，null = 系统默认） */
  modelKey: string | null;
  /** 工具预设：none / default / full */
  toolPreset: string;
  /** 推理强度：low / medium / high（模型不支持时忽略） */
  thinkingLevel: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 消息项 */
export interface MessageItem {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  status: string;
  sources: any;
  debug: any;
  createdAt: string;
  updatedAt: string;
}

/**
 * Agent 会话历史持久化服务
 */
export class QASessionService {
  /**
   * 列出用户的会话（按 updatedAt 倒序，含最近一条消息预览）
   */
  static async listSessions(userId: string, limit = 50): Promise<SessionListItem[]> {
    const sessions = await prisma.qASession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,  // 只取最近一条消息作为预览
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });

    return sessions.map((s: any) => {
      const lastMsg = s.messages[0];
      const preview = lastMsg?.content ?? null;
      // 预览截断到 80 字符
      const lastMessagePreview = preview
        ? (preview.length > 80 ? preview.slice(0, 80) + '...' : preview)
        : null;

      return {
        id: s.id,
        title: s.title,
        taskId: s.taskId,
        status: s.status ?? 'active',
        messageCount: s._count.messages,
        lastMessagePreview,
        lastMessageAt: lastMsg?.createdAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };
    });
  }

  /**
   * 关闭用户的全部 active 会话（单活跃会话约束：新建会话时调用）
   *
   * 把该用户所有 status='active' 的会话置为 'completed'，
   * 确保每用户同一时刻只有一个活跃会话。
   *
   * @returns 被关闭的会话数量
   */
  static async completeActiveSessions(userId: string): Promise<number> {
    const res = await prisma.qASession.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'completed' },
    });
    return res.count;
  }

  /**
   * 查询单个会话（含权限校验）
   */
  static async getSession(sessionId: string, userId: string): Promise<SessionDetail | null> {
    const session = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) return null;

    return {
      id: session.id,
      title: session.title,
      taskId: session.taskId,
      userId: session.userId,
      modelKey: session.modelKey,
      toolPreset: session.toolPreset ?? 'full',
      thinkingLevel: session.thinkingLevel,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  /**
   * 查询会话的消息列表（按 createdAt 升序）
   */
  static async listMessages(sessionId: string, userId: string): Promise<MessageItem[]> {
    // 权限校验：确认会话属于该用户
    const session = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    const messages = await prisma.qAMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m: any) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      status: m.status,
      sources: m.sources,
      debug: m.debug,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));
  }

  /**
   * 确保会话存在（不存在则创建）
   * - TraceService.ensureQASession 的正式版本，补充 title 自动截取
   *
   * @param sessionId 会话 ID
   * @param userId 用户 ID
   * @param title 会话标题（可选，未提供时由首条用户消息触发自动截取）
   */
  static async ensureSession(
    sessionId: string,
    userId: string,
    title?: string,
    settings?: { modelKey?: string; toolPreset?: string; thinkingLevel?: string },
  ): Promise<void> {
    const exists = await prisma.qASession.findUnique({
      where: { id: sessionId },
      select: { id: true, title: true },
    });

    if (!exists) {
      await prisma.qASession.create({
        data: {
          id: sessionId,
          userId,
          title: title ?? null,
          status: 'active', // 显式声明（不依赖 DB 默认值），保证单活跃会话约束语义明确
          modelKey: settings?.modelKey ?? null,
          toolPreset: settings?.toolPreset ?? 'full',
          thinkingLevel: settings?.thinkingLevel ?? null,
        },
      });
    } else if (title && !exists.title) {
      // 已存在但无 title，且本次传入了 title → 更新 title
      await prisma.qASession.update({
        where: { id: sessionId },
        data: { title },
      });
    }
  }

  /**
   * 更新会话设置（模型/工具预设/推理强度）
   * 仅允许会话所有者操作；不存在的字段不更新
   */
  static async updateSessionSettings(
    sessionId: string,
    userId: string,
    settings: { modelKey?: string | null; toolPreset?: string; thinkingLevel?: string | null },
  ): Promise<void> {
    const exists = await prisma.qASession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
    if (!exists || exists.userId !== userId) return;
    const data: any = {};
    if (settings.modelKey !== undefined) data.modelKey = settings.modelKey;
    if (settings.toolPreset !== undefined) data.toolPreset = settings.toolPreset;
    if (settings.thinkingLevel !== undefined) data.thinkingLevel = settings.thinkingLevel;
    if (Object.keys(data).length > 0) {
      await prisma.qASession.update({ where: { id: sessionId }, data });
    }
  }

  /**
   * 持久化用户消息
   * - 自动确保会话存在
   * - 若会话无 title，用首条用户消息前 30 字符作为 title
   *
   * @returns 消息 ID（失败返回 null）
   */
  static async persistUserMessage(
    sessionId: string,
    userId: string,
    content: string,
    settings?: { modelKey?: string; toolPreset?: string; thinkingLevel?: string },
  ): Promise<string | null> {
    try {
      await QASessionService.ensureSession(sessionId, userId, undefined, settings);

      // 检查是否需要更新 title（首条用户消息）
      const session = await prisma.qASession.findUnique({
        where: { id: sessionId },
        select: { title: true },
      });
      if (session && !session.title) {
        const autoTitle = content.length > 30 ? content.slice(0, 30) + '...' : content;
        await prisma.qASession.update({
          where: { id: sessionId },
          data: { title: autoTitle },
        });
      }

      const message = await prisma.qAMessage.create({
        data: {
          sessionId,
          role: 'user',
          content,
          status: 'completed',
        },
      });

      return message.id;
    } catch (e) {
      console.warn(`[Agent:QASession] 持久化用户消息失败: sessionId=${sessionId}`, (e as Error).message);
      return null;
    }
  }

  /**
   * 持久化 assistant 消息（流式开始时创建占位，流式结束时更新）
   *
   * @param status 消息状态：processing（流式进行中）/ completed / failed
   * @param sources 引用来源（可选）
   * @param debug 调试/过程信息（可选）：存工具调用过程（toolCalls 数组），供前端历史回看渲染
   * @returns 消息 ID（失败返回 null）
   */
  static async persistAssistantMessage(
    sessionId: string,
    userId: string,
    content: string,
    status: 'processing' | 'completed' | 'failed' = 'completed',
    sources?: any,
    debug?: any,
  ): Promise<string | null> {
    try {
      await QASessionService.ensureSession(sessionId, userId);

      const message = await prisma.qAMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content,
          status,
          sources: sources ?? undefined,
          debug: debug ?? undefined,
        },
      });

      return message.id;
    } catch (e) {
      console.warn(`[Agent:QASession] 持久化 assistant 消息失败: sessionId=${sessionId}`, (e as Error).message);
      return null;
    }
  }

  /**
   * 更新 assistant 消息（流式结束时回填完整内容）
   *
   * @param messageId 消息 ID
   * @param content 完整内容
   * @param status 最终状态
   * @param sources 引用来源（可选）
   * @param debug 调试/过程信息（可选）
   */
  static async updateAssistantMessage(
    messageId: string,
    content: string,
    status: 'completed' | 'failed',
    sources?: any,
    debug?: any,
  ): Promise<boolean> {
    try {
      await prisma.qAMessage.update({
        where: { id: messageId },
        data: {
          content,
          status,
          ...(sources !== undefined ? { sources } : {}),
          ...(debug !== undefined ? { debug } : {}),
        },
      });
      return true;
    } catch (e) {
      console.warn(`[Agent:QASession] 更新 assistant 消息失败: messageId=${messageId}`, (e as Error).message);
      return false;
    }
  }

  /**
   * 删除会话（级联删除 messages + agentTraces）
   */
  static async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    // 权限校验：确认会话属于该用户
    const session = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    await prisma.qASession.delete({
      where: { id: sessionId },
    });
    return true;
  }

  /**
   * 复制会话（简化版分支：多方案并行）
   *
   * 复制会话全部字段 + 全部消息（按 createdAt 升序）到新会话：
   * - 新会话 title 加「（副本）」后缀
   * - status 强制 'active'（新会话可继续对话）
   * - modelKey/toolPreset/thinkingLevel 复制原值（保持相同模型/预设）
   * - 消息的 role/content/status/sources/debug 原样复制，createdAt 保留原值（保证时序保真）
   *
   * @param sessionId 源会话 ID
   * @param userId 当前用户（权限校验：只能复制自己的会话）
   * @returns 新会话详情（SessionDetail）
   */
  static async duplicateSession(sessionId: string, userId: string): Promise<SessionDetail> {
    // 权限校验 + 读取源会话
    const source = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!source) {
      throw new Error('会话不存在或无权访问');
    }

    // 读取全部消息（按 createdAt 升序，保证复制后顺序一致）
    const messages = await prisma.qAMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    // 事务：创建新会话 + 批量复制消息（任一失败整体回滚）
    const newSessionId = require('crypto').randomUUID();
    const newSession = await prisma.$transaction(async (tx) => {
      const created = await tx.qASession.create({
        data: {
          id: newSessionId,
          userId,
          title: source.title ? `${source.title}（副本）` : '未命名会话（副本）',
          status: 'active',
          modelKey: source.modelKey,
          toolPreset: source.toolPreset ?? 'full',
          thinkingLevel: source.thinkingLevel,
        },
      });
      if (messages.length > 0) {
        // 注：QAMessage.updatedAt 是 @updatedAt 字段，createMany 不允许显式传值（由 DB 自动生成），
        // 只复制 createdAt 保证时序保真
        await tx.qAMessage.createMany({
          data: messages.map((m) => ({
            sessionId: newSessionId,
            role: m.role,
            content: m.content,
            status: m.status,
            sources: m.sources ?? undefined,
            debug: m.debug ?? undefined,
            createdAt: m.createdAt,
          })),
        });
      }
      return created;
    });

    return {
      id: newSession.id,
      title: newSession.title,
      taskId: newSession.taskId,
      userId: newSession.userId,
      modelKey: newSession.modelKey,
      toolPreset: newSession.toolPreset ?? 'full',
      thinkingLevel: newSession.thinkingLevel,
      createdAt: newSession.createdAt.toISOString(),
      updatedAt: newSession.updatedAt.toISOString(),
    };
  }

  /**
   * 重命名会话
   */
  static async renameSession(
    sessionId: string,
    userId: string,
    title: string,
  ): Promise<SessionDetail | null> {
    // 权限校验
    const session = await prisma.qASession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    const updated = await prisma.qASession.update({
      where: { id: sessionId },
      data: { title },
    });

    return {
      id: updated.id,
      title: updated.title,
      taskId: updated.taskId,
      userId: updated.userId,
      modelKey: updated.modelKey,
      toolPreset: updated.toolPreset ?? 'full',
      thinkingLevel: updated.thinkingLevel,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
