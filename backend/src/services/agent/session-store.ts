/**
 * Agent 会话统一查询层（隔离收口）
 *
 * 借鉴 qm-cnpe 的 store 抽象思想：所有"按用户过滤"的会话查询
 * 必须经过本层单一出口，杜绝散落在 controller/service 里的
 * 裸 prisma 查询漏写 userId 导致越权。
 *
 * 使用约定：
 * - 查询"单个会话/消息"一律用 getForUser / listMessagesForUser（强制 userId 过滤）
 * - 内部使用（已确认归属）的按 id 直查用 getById / getByIds（仅在 getSession 归属校验通过后使用）
 */
import prisma from '../../config/db';

export const sessionStore = {
  /**
   * 按 id + userId 查会话（归属校验查询：会话必须属于该用户）
   * 返回 null 表示不存在或不属于该用户
   */
  getForUser(sessionId: string, userId: string) {
    return prisma.qASession.findFirst({
      where: { id: sessionId, userId },
    });
  },

  /**
   * 按 id 直查会话（内部使用：仅当调用方已通过归属校验后）
   * ⚠️ 不要用于面向用户的入口——那里必须走 getForUser
   */
  getById(sessionId: string) {
    return prisma.qASession.findUnique({
      where: { id: sessionId },
    });
  },

  /**
   * 按 id 直查会话（含 userId 归属字段，供调用方区分"不存在"与"越权"）
   * 典型场景：chat/stream 需要区分「会话不存在 → 自动创建」与「存在但属于他人 → 403」
   */
  getByIdWithOwner(sessionId: string) {
    return prisma.qASession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
  },

  /**
   * 按 id 数组直查会话（批量内部使用，同上）
   */
  getByIds(sessionIds: string[]) {
    return prisma.qASession.findMany({
      where: { id: { in: sessionIds } },
    });
  },

  /**
   * 查用户全部会话（列表）
   */
  listForUser(userId: string) {
    return prisma.qASession.findMany({
      where: { userId },
    });
  },

  /**
   * 查会话是否存在（不带归属校验——调用方需自行保证场景安全）
   */
  exists(sessionId: string) {
    return prisma.qASession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
  },
};
